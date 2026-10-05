//! The one AVAssetWriter wrapper: every recorded file (screen, camera, iPhone/iPad, camera matte,
//! mic, system audio) is an HEVC or AAC track written here.
//! Files grow by one movie fragment per second, so a crash, power loss, or kill -9 keeps all but
//! the last second (capture/recover.rs makes such a file whole); finishing turns them into regular MP4s.
//! Timestamps are source seconds (clock::SESSION, pauses removed); every track starts at 0.

use std::path::{Path, PathBuf};
use std::ptr::{NonNull, null, null_mut};
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::AllocAnyThread;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus, AVFileTypeMPEG4,
    AVMediaTypeAudio, AVMediaTypeVideo,
};
use objc2_core_audio_types::{
    AudioBufferList, AudioStreamBasicDescription, kAudioFormatFlagIsFloat, kAudioFormatFlagIsNonInterleaved,
    kAudioFormatFlagIsPacked, kAudioFormatLinearPCM,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    CMAudioFormatDescriptionCreate, CMAudioFormatDescriptionGetStreamBasicDescription,
    CMAudioSampleBufferCreateReadyWithPacketDescriptions, CMBlockBuffer, CMFormatDescription, CMSampleBuffer, CMTime,
    kCMBlockBufferAssureMemoryNowFlag, kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
};
use objc2_core_video::{CVPixelBuffer, CVPixelBufferPool, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange};
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString, NSURL};

/// Seconds between movie fragments: the most a crash can lose.
const FRAGMENT_SECS: f64 = 1.0;
/// A still screen sends no frames; the heartbeat repeats the last one this often so the file keeps growing.
const HEARTBEAT_SECS: f64 = 0.5;
const TIMESCALE: i32 = 90_000;
/// HEVC hardware encode and Chromium decode limits.
const MAX_SIDE: f64 = 8192.0;
const MAX_PIXELS: f64 = 8192.0 * 4320.0;

pub const NV12: u32 = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;

pub fn ns_error(e: &NSError) -> String {
    e.localizedDescription().to_string()
}

pub fn obj<T: objc2::Message>(v: Retained<T>) -> Retained<AnyObject> {
    // SAFETY: every Objective-C object is an AnyObject.
    unsafe { Retained::cast_unchecked(v) }
}
pub fn num(v: f64) -> Retained<AnyObject> {
    obj(NSNumber::new_f64(v))
}
pub fn string(s: &str) -> Retained<AnyObject> {
    obj(NSString::from_str(s))
}
/// A settings dictionary. Keys are the values of the AVFoundation/CoreVideo key constants
/// ("AVVideoCodecKey", "PixelFormatType"...), which are stable: they are written into files.
pub fn dict(pairs: &[(&str, Retained<AnyObject>)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<_> = pairs.iter().map(|(k, _)| NSString::from_str(k)).collect();
    let keys: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
    let vals: Vec<&AnyObject> = pairs.iter().map(|(_, v)| &**v).collect();
    NSDictionary::from_slices(&keys, &vals)
}

/// Pixel buffer attributes: NV12, IOSurface-backed, optionally of a fixed size.
pub fn nv12_attributes(size: Option<(usize, usize)>) -> Retained<NSDictionary<NSString, AnyObject>> {
    let mut pairs = vec![
        ("PixelFormatType", obj(NSNumber::new_u32(NV12))),
        ("IOSurfaceProperties", obj(NSDictionary::<NSString, AnyObject>::new())),
    ];
    if let Some((w, h)) = size {
        pairs.extend([("Width", num(w as f64)), ("Height", num(h as f64))]);
    }
    dict(&pairs)
}

/// Capture-side PCM settings (AVCaptureAudioDataOutput): float32 interleaved, what AudioWriter takes.
pub fn pcm_settings(rate: f64, channels: usize) -> Retained<NSDictionary<NSString, AnyObject>> {
    dict(&[
        ("AVFormatIDKey", num(kAudioFormatLinearPCM as f64)),
        ("AVSampleRateKey", num(rate)),
        ("AVNumberOfChannelsKey", num(channels as f64)),
        ("AVLinearPCMBitDepthKey", num(32.0)),
        ("AVLinearPCMIsFloatKey", obj(NSNumber::new_bool(true))),
        ("AVLinearPCMIsNonInterleaved", obj(NSNumber::new_bool(false))),
        ("AVLinearPCMIsBigEndianKey", obj(NSNumber::new_bool(false))),
    ])
}

/// Encoder-safe output size for a capture of `w`x`h` pixels: scaled down to fit the HEVC limits
/// (ultrawide, 6K+), even dimensions for 4:2:0.
pub fn fit_encoder(w: f64, h: f64) -> (usize, usize) {
    let k = (MAX_SIDE / w).min(MAX_SIDE / h).min((MAX_PIXELS / (w * h)).sqrt()).min(1.0);
    let even = |v: f64| ((v * k / 2.0).round() as usize * 2).max(2);
    (even(w), even(h))
}

fn open_writer(path: &Path) -> Result<Retained<AVAssetWriter>, String> {
    if path.exists() {
        return Err(format!("{} already exists.", path.display())); // sources are never overwritten
    }
    let url = NSURL::from_file_path(path).ok_or_else(|| format!("Invalid path: {}", path.display()))?;
    let file_type = unsafe { AVFileTypeMPEG4 }.ok_or("MPEG-4 writing is unavailable")?;
    let w = unsafe { AVAssetWriter::initWithURL_fileType_error(AVAssetWriter::alloc(), &url, file_type) }
        .map_err(|e| ns_error(&e))?;
    unsafe {
        w.setMovieFragmentInterval(CMTime::with_seconds(FRAGMENT_SECS, 600));
        w.setShouldOptimizeForNetworkUse(false);
    }
    Ok(w)
}

fn add_input(
    w: &AVAssetWriter,
    video: bool,
    settings: &NSDictionary<NSString, AnyObject>,
    realtime: bool,
) -> Result<Retained<AVAssetWriterInput>, String> {
    let kind =
        unsafe { if video { AVMediaTypeVideo } else { AVMediaTypeAudio } }.ok_or("AVFoundation media type missing")?;
    if !unsafe { w.canApplyOutputSettings_forMediaType(Some(settings), kind) } {
        return Err("The encoder does not support these settings on this Mac".into());
    }
    let input = unsafe {
        AVAssetWriterInput::initWithMediaType_outputSettings(AVAssetWriterInput::alloc(), kind, Some(settings))
    };
    unsafe { input.setExpectsMediaDataInRealTime(realtime) };
    if video {
        unsafe { input.setMediaTimeScale(TIMESCALE) };
    }
    if !unsafe { w.canAddInput(&input) } {
        return Err("Cannot add a track to the recording file".into());
    }
    unsafe { w.addInput(&input) };
    Ok(input)
}

fn start(w: &AVAssetWriter) -> Result<(), String> {
    if !unsafe { w.startWriting() } {
        return Err(failure(w));
    }
    unsafe { w.startSessionAtSourceTime(CMTime::new(0, TIMESCALE)) };
    Ok(())
}

fn ticks(t: f64) -> i64 {
    (t * TIMESCALE as f64).round() as i64
}

fn failure(w: &AVAssetWriter) -> String {
    unsafe { w.error() }.map_or_else(|| "Writing the recording failed".into(), |e| ns_error(&e))
}

fn failed(w: &AVAssetWriter) -> bool {
    (unsafe { w.status() }) == AVAssetWriterStatus::Failed
}

fn finish(w: &AVAssetWriter) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let done = RcBlock::new(move || {
        let _ = tx.send(());
    });
    unsafe { w.finishWritingWithCompletionHandler(&done) };
    rx.recv_timeout(Duration::from_secs(60)).map_err(|_| "Timed out finishing the recording file".to_string())?;
    if unsafe { w.status() } == AVAssetWriterStatus::Completed { Ok(()) } else { Err(failure(w)) }
}

/// Abandon a file. A writer that failed mid-recording (disk full) keeps its fragments: they are
/// a playable recording, and recovery makes them whole.
fn cancel(w: &AVAssetWriter, path: &Path) {
    if !failed(w) {
        unsafe { w.cancelWriting() };
        let _ = std::fs::remove_file(path);
    }
}

pub struct VideoSpec {
    pub width: usize,
    pub height: usize,
    pub fps: f64,
    /// Average bit rate = width * height * fps * bits_per_pixel.
    pub bits_per_pixel: f64,
    /// Live capture drops a frame the encoder cannot take within 100 ms; offline writing waits.
    pub realtime: bool,
}

/// HEVC video track fed NV12 pixel buffers. Frames keep the time they were captured at
/// (variable frame rate: a still screen sends none), strictly increasing, the first one at 0.
pub struct VideoWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    path: PathBuf,
    pub spec: VideoSpec,
    latest: Option<CFRetained<CVPixelBuffer>>,
    last: Option<i64>, // ticks of the last appended frame
    pub frames: u32,
    pub dropped: u32,
}

// SAFETY: AVFoundation writers may be used from any thread; owners serialize access (a Mutex or one thread).
unsafe impl Send for VideoWriter {}

impl VideoWriter {
    pub fn new(path: &Path, spec: VideoSpec) -> Result<Self, String> {
        let writer = open_writer(path)?;
        // ponytail: fixed bits per pixel per source, tuned on synthetic text; a quality probe if users see blur.
        let bitrate = (spec.width * spec.height) as f64 * spec.fps.min(60.0) * spec.bits_per_pixel;
        let compression = dict(&[
            ("AverageBitRate", num(bitrate)),
            ("ExpectedFrameRate", num(spec.fps)),
            ("MaxKeyFrameIntervalDuration", num(1.0)), // scrubbing decodes at most a second
            ("AllowFrameReordering", obj(NSNumber::new_bool(false))), // decode order == display order
            ("ProfileLevel", string("HEVC_Main_AutoLevel")),
        ]);
        // Tagged BT.709, converted if the source is tagged otherwise, so every decoder reads the
        // same colors (and a matte's luma as exactly 0..1).
        let bt709 = || string("ITU_R_709_2");
        let color = dict(&[("ColorPrimaries", bt709()), ("TransferFunction", bt709()), ("YCbCrMatrix", bt709())]);
        let settings = dict(&[
            ("AVVideoCodecKey", string("hvc1")),
            ("AVVideoWidthKey", num(spec.width as f64)),
            ("AVVideoHeightKey", num(spec.height as f64)),
            ("AVVideoCompressionPropertiesKey", obj(compression)),
            ("AVVideoColorPropertiesKey", obj(color)),
            // A frame of another size fills the picture instead of letterboxing it.
            ("AVVideoScalingModeKey", string("AVVideoScalingModeResizeAspectFill")),
        ]);
        let input = add_input(&writer, true, &settings, spec.realtime)?;
        let adaptor = unsafe {
            AVAssetWriterInputPixelBufferAdaptor::initWithAssetWriterInput_sourcePixelBufferAttributes(
                AVAssetWriterInputPixelBufferAdaptor::alloc(),
                &input,
                Some(&nv12_attributes(Some((spec.width, spec.height)))),
            )
        };
        start(&writer)?;
        Ok(Self {
            writer,
            input,
            adaptor,
            path: path.to_owned(),
            spec,
            latest: None,
            last: None,
            frames: 0,
            dropped: 0,
        })
    }

    /// New content, appended at `t`; kept for later when `t` is None (paused, or not started yet).
    /// Returns whether it was appended.
    pub fn frame(&mut self, pb: CFRetained<CVPixelBuffer>, t: Option<f64>) -> bool {
        self.latest = Some(pb);
        t.is_some_and(|t| self.append(t))
    }

    /// Append the latest frame at `t` (again: after a resume, or as a heartbeat).
    pub fn append(&mut self, t: f64) -> bool {
        let Some(pb) = self.latest.clone() else { return false };
        // The first frame opens the track at 0, so it has no leading gap.
        let tick = if self.last.is_none() { 0 } else { ticks(t) };
        if self.last.is_some_and(|l| tick <= l) || failed(&self.writer) || !self.ready(self.spec.realtime) {
            self.dropped += 1;
            return false;
        }
        let at = unsafe { CMTime::new(tick, TIMESCALE) };
        if unsafe { self.adaptor.appendPixelBuffer_withPresentationTime(&pb, at) } {
            self.last = Some(tick);
            self.frames += 1;
            true
        } else {
            self.dropped += 1;
            false
        }
    }

    /// Wait until the encoder takes more: up to 100 ms when `bounded`, else as long as it takes.
    fn ready(&self, bounded: bool) -> bool {
        for waited in 0.. {
            if unsafe { self.input.isReadyForMoreMediaData() } {
                return true;
            }
            if (bounded && waited >= 100) || failed(&self.writer) {
                return false;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        false
    }

    /// Repeat the latest frame when nothing was appended for a while: the file keeps its
    /// fragments coming and the right duration while the screen is still.
    pub fn heartbeat(&mut self, t: f64) {
        if self.last_time().is_none_or(|l| t - l >= HEARTBEAT_SECS) {
            self.append(t);
        }
    }

    pub fn has_frame(&self) -> bool {
        self.latest.is_some()
    }

    /// A pool of NV12 buffers of the track size, for frames we produce ourselves.
    pub fn pool(&self) -> Option<Retained<CVPixelBufferPool>> {
        unsafe { self.adaptor.pixelBufferPool() }
    }

    /// Seconds of the last appended frame.
    pub fn last_time(&self) -> Option<f64> {
        self.last.map(|l| l as f64 / TIMESCALE as f64)
    }

    pub fn error(&self) -> Option<String> {
        failed(&self.writer).then(|| failure(&self.writer))
    }

    /// Finalize with the last frame shown until `end` (at least one frame long). Returns the duration.
    pub fn finish(mut self, end: f64) -> Result<f64, String> {
        if self.last.is_none() {
            self.append(0.0); // stopped before the first heartbeat: the one frame still counts
        }
        let Some(last) = self.last_time() else {
            cancel(&self.writer, &self.path);
            return Err("No video frames were recorded.".into());
        };
        if let Some(e) = self.error() {
            return Err(e); // the fragments stay for recovery
        }
        let end = end.max(last + 1.0 / self.spec.fps);
        // A track's last sample lasts as long as the gap before it in players that ignore edit
        // lists. After a still stretch, repeat the frame twice just before `end`, so the file ends there.
        if end - last > 1.5 / self.spec.fps {
            let d = (1.0 / self.spec.fps).min((end - last) / 3.0);
            for t in [end - 2.0 * d, end - d] {
                if self.ready(false) {
                    self.append(t);
                }
            }
        }
        unsafe {
            self.input.markAsFinished();
            self.writer.endSessionAtSourceTime(CMTime::new(ticks(end), TIMESCALE));
        }
        finish(&self.writer)?;
        Ok(end)
    }

    /// Abandon the file and delete it.
    pub fn cancel(self) {
        cancel(&self.writer, &self.path);
    }
}

/// How to place `frames` new samples whose clock position is `expected` when `written` samples
/// are already in the file. Returns (silence to insert first, samples to skip, +1 repeat / -1 drop
/// one sample). After a discontinuity (the first buffer, a pause, a dropout) or a large offset the
/// samples go exactly where the clock says. A continuous stream only gets its device clock drift
/// corrected, one sample per buffer: inaudible, and every track stays on the master clock for hours.
pub fn align(written: u64, expected: i64, frames: usize, rate: f64, continuous: bool) -> (usize, usize, i8) {
    let drift = expected - written as i64;
    let hard = (rate * 0.02) as i64; // 20 ms
    let soft = (rate * 0.001) as i64; // 1 ms
    if !continuous || drift.abs() > hard {
        if drift > 0 { (drift as usize, 0, 0) } else { (0, ((-drift) as usize).min(frames), 0) }
    } else if drift > soft {
        (0, 0, 1)
    } else if drift < -soft {
        (0, 0, -1)
    } else {
        (0, 0, 0)
    }
}

/// Format of interleaved float32 PCM.
pub fn pcm_format(rate: f64, channels: usize) -> Option<CFRetained<CMFormatDescription>> {
    let asbd = AudioStreamBasicDescription {
        mSampleRate: rate,
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
        mBytesPerPacket: 4 * channels as u32,
        mFramesPerPacket: 1,
        mBytesPerFrame: 4 * channels as u32,
        mChannelsPerFrame: channels as u32,
        mBitsPerChannel: 32,
        mReserved: 0,
    };
    let mut out: *const CMFormatDescription = null();
    let status = unsafe {
        CMAudioFormatDescriptionCreate(None, NonNull::from(&asbd), 0, null(), 0, null(), None, NonNull::from(&mut out))
    };
    NonNull::new(out as *mut CMFormatDescription).filter(|_| status == 0).map(|p| unsafe { CFRetained::from_raw(p) })
}

/// A sample buffer of interleaved `samples` in `format`, presented at `pts`.
pub fn pcm_buffer(format: &CMFormatDescription, samples: &[f32], pts: CMTime) -> Option<CFRetained<CMSampleBuffer>> {
    let channels = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(format).as_ref() }?.mChannelsPerFrame;
    let frames = samples.len() / channels.max(1) as usize;
    let bytes = frames * channels as usize * 4;
    let mut bb: *mut CMBlockBuffer = null_mut();
    let mut sb: *mut CMSampleBuffer = null_mut();
    unsafe {
        let flags = kCMBlockBufferAssureMemoryNowFlag;
        if frames == 0
            || CMBlockBuffer::create_with_memory_block(None, null_mut(), bytes, None, null(), 0, bytes, flags, NonNull::from(&mut bb))
                != 0
        {
            return None;
        }
        let bb = CFRetained::from_raw(NonNull::new(bb)?);
        if CMBlockBuffer::replace_data_bytes(NonNull::new_unchecked(samples.as_ptr() as *mut _), &bb, 0, bytes) != 0 {
            return None;
        }
        let status = CMAudioSampleBufferCreateReadyWithPacketDescriptions(
            None,
            &bb,
            format,
            frames as isize,
            pts,
            null(),
            NonNull::from(&mut sb),
        );
        if status != 0 {
            return None;
        }
        Some(CFRetained::from_raw(NonNull::new(sb)?))
    }
}

/// AAC audio track, sample-accurate on the master clock: leading silence, dropouts, and pauses
/// cut short are filled so the track is gapless from 0, and device clock drift is corrected.
pub struct AudioWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    format: CFRetained<CMFormatDescription>,
    path: PathBuf,
    pub rate: f64,
    pub channels: usize,
    written: u64,
    /// Source time where the previous buffer ended, by its own timestamp.
    last_end: Option<f64>,
}

// SAFETY: see VideoWriter.
unsafe impl Send for AudioWriter {}

impl AudioWriter {
    pub fn new(path: &Path, rate: f64, channels: usize) -> Result<Self, String> {
        let writer = open_writer(path)?;
        let settings = dict(&[
            ("AVFormatIDKey", num(u32::from_be_bytes(*b"aac ") as f64)),
            ("AVSampleRateKey", num(rate)),
            ("AVNumberOfChannelsKey", num(channels as f64)),
            ("AVEncoderBitRateKey", num(128_000.0 * channels as f64)),
        ]);
        let input = add_input(&writer, false, &settings, true)?;
        let format = pcm_format(rate, channels).ok_or("Audio format error")?;
        start(&writer)?;
        Ok(Self { writer, input, format, path: path.to_owned(), rate, channels, written: 0, last_end: None })
    }

    /// Append interleaved samples whose first frame was captured at source time `t`.
    pub fn push(&mut self, t: f64, samples: &[f32]) {
        let frames = samples.len() / self.channels;
        let continuous = self.last_end.is_some_and(|e| (t - e).abs() < 0.002);
        self.last_end = Some(t + frames as f64 / self.rate);
        let (pad, skip, nudge) = align(self.written, (t * self.rate).round() as i64, frames, self.rate, continuous);
        self.silence(pad);
        let mut s = &samples[skip * self.channels..];
        let repeat;
        if nudge < 0 && s.len() > self.channels {
            s = &s[..s.len() - self.channels];
        } else if nudge > 0 && !s.is_empty() {
            repeat = [s, &s[s.len() - self.channels..]].concat();
            s = &repeat;
        }
        self.append(s);
    }

    fn silence(&mut self, mut frames: usize) {
        let chunk = vec![0f32; self.rate as usize * self.channels];
        while frames > 0 {
            let n = frames.min(self.rate as usize);
            self.append(&chunk[..n * self.channels]);
            frames -= n;
        }
    }

    fn append(&mut self, samples: &[f32]) {
        if failed(&self.writer) || !unsafe { self.input.isReadyForMoreMediaData() } {
            return; // dropped: the next push realigns to the clock
        }
        let pts = unsafe { CMTime::new(self.written as i64, self.rate as i32) };
        if let Some(sb) = pcm_buffer(&self.format, samples, pts)
            && unsafe { self.input.appendSampleBuffer(&sb) }
        {
            self.written += (samples.len() / self.channels) as u64;
        }
    }

    pub fn error(&self) -> Option<String> {
        failed(&self.writer).then(|| failure(&self.writer))
    }

    /// Pad with silence to `end` (all tracks end together) and finalize. Returns the duration.
    pub fn finish(mut self, end: f64) -> Result<f64, String> {
        if self.written == 0 {
            cancel(&self.writer, &self.path);
            return Err("No audio was captured.".into());
        }
        self.silence(((end * self.rate).round() as u64).saturating_sub(self.written) as usize);
        if let Some(e) = self.error() {
            return Err(e); // the fragments stay for recovery
        }
        unsafe { self.input.markAsFinished() };
        finish(&self.writer)?;
        Ok(self.written as f64 / self.rate)
    }

    pub fn cancel(self) {
        cancel(&self.writer, &self.path);
    }
}

/// Float PCM of an audio sample buffer as interleaved samples. Returns (samples, channels, rate).
pub fn interleaved_f32(sb: &CMSampleBuffer) -> Option<(Vec<f32>, usize, f64)> {
    unsafe {
        let fd = sb.format_description()?;
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(&fd).as_ref()?;
        if asbd.mFormatID != kAudioFormatLinearPCM
            || asbd.mFormatFlags & kAudioFormatFlagIsFloat == 0
            || asbd.mBitsPerChannel != 32
        {
            return None;
        }
        let ch = asbd.mChannelsPerFrame as usize;
        let frames = sb.num_samples() as usize;
        let mut size = 0usize;
        sb.audio_buffer_list_with_retained_block_buffer(&mut size, null_mut(), 0, None, None, 0, null_mut());
        if size == 0 || ch == 0 {
            return None;
        }
        let mut storage = vec![0u64; size.div_ceil(8)];
        let abl = storage.as_mut_ptr() as *mut AudioBufferList;
        let mut bb: *mut CMBlockBuffer = null_mut();
        let status = sb.audio_buffer_list_with_retained_block_buffer(
            null_mut(),
            abl,
            size,
            None,
            None,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            &mut bb,
        );
        let _bb = NonNull::new(bb).map(|p| CFRetained::from_raw(p)); // keeps the data alive
        if status != 0 {
            return None;
        }
        let buffers = std::slice::from_raw_parts((*abl).mBuffers.as_ptr(), (*abl).mNumberBuffers as usize);
        let plane = |b: &objc2_core_audio_types::AudioBuffer| {
            std::slice::from_raw_parts(b.mData as *const f32, b.mDataByteSize as usize / 4)
        };
        let mut out = vec![0f32; frames * ch];
        if asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0 {
            for (c, b) in buffers.iter().enumerate().take(ch) {
                for (i, v) in plane(b).iter().take(frames).enumerate() {
                    out[i * ch + c] = *v;
                }
            }
        } else if let Some(b) = buffers.first() {
            let p = plane(b);
            out[..p.len().min(frames * ch)].copy_from_slice(&p[..p.len().min(frames * ch)]);
        }
        Some((out, ch, asbd.mSampleRate))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn align_fixes_gaps_at_once_and_drift_gently() {
        let r = 48_000.0;
        assert_eq!(align(0, 1440, 1024, r, false), (1440, 0, 0), "first buffer: padded so audio starts at 0");
        assert_eq!(align(48_000, 47_520, 1024, r, false), (0, 480, 0), "after a pause: overlap cut at once");
        assert_eq!(align(48_000, 48_000, 1024, r, true), (0, 0, 0));
        assert_eq!(align(48_000, 48_000 + 2400, 1024, r, true), (2400, 0, 0), "50 ms dropout filled with silence");
        assert_eq!(align(48_000, 48_000 - 2400, 1024, r, true), (0, 1024, 0), "overlap skipped, capped to the buffer");
        assert_eq!(align(48_000, 48_100, 1024, r, true), (0, 0, 1), "device clock slow: repeat one sample");
        assert_eq!(align(48_100, 48_000, 1024, r, true), (0, 0, -1), "device clock fast: drop one sample");
        assert_eq!(align(48_000, 48_020, 1024, r, true), (0, 0, 0), "jitter inside 1 ms is left alone");
    }

    #[test]
    fn fit_encoder_keeps_native_size_and_scales_huge_sources() {
        assert_eq!(fit_encoder(2880.0, 1800.0), (2880, 1800));
        assert_eq!(fit_encoder(5120.0, 2880.0), (5120, 2880));
        assert_eq!(fit_encoder(1511.0, 945.0), (1512, 946), "odd sizes become even");
        let (w, h) = fit_encoder(10240.0, 2880.0); // dual 5K ultrawide
        assert!(w <= 8192 && (w * h) as f64 <= MAX_PIXELS && w % 2 == 0 && h % 2 == 0);
        assert!(((w as f64 / h as f64) - 10240.0 / 2880.0).abs() < 0.01, "aspect kept");
        let (w, h) = fit_encoder(6016.0, 3384.0); // Pro Display XDR
        assert!((w * h) as f64 <= MAX_PIXELS && w <= 8192);
    }

    #[test]
    fn pcm_buffers_round_trip_through_interleaved_f32() {
        for ch in [1, 2] {
            let samples: Vec<f32> = (0..480 * ch).map(|i| i as f32 / 1000.0).collect();
            let sb = pcm_buffer(&pcm_format(48_000.0, ch).unwrap(), &samples, unsafe { CMTime::new(7, 48_000) }).unwrap();
            assert_eq!(interleaved_f32(&sb), Some((samples, ch, 48_000.0)));
        }
    }
}
