//! AVAssetWriter tracks of a recording: HEVC screen video and AAC audio.
//! Files grow by one movie fragment per second, so a crash, power loss, or kill -9 keeps all but
//! the last second (capture/recover.rs makes such a file whole); finishing turns them into regular MP4s.
//! Timestamps are source seconds from clock::SESSION (pauses already removed).

use std::path::Path;
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
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString, NSURL};

/// Seconds between movie fragments: the most a crash can lose.
const FRAGMENT_SECS: f64 = 1.0;
/// A static screen sends no frames; repeat the last one this often so the file keeps growing.
const HEARTBEAT_SECS: f64 = 0.5;
const VIDEO_TIMESCALE: i32 = 90_000;
/// HEVC hardware encode and Chromium decode limits.
const MAX_SIDE: f64 = 8192.0;
const MAX_PIXELS: f64 = 8192.0 * 4320.0;

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
pub fn dict(pairs: &[(&str, Retained<AnyObject>)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<_> = pairs.iter().map(|(k, _)| NSString::from_str(k)).collect();
    let keys: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
    let vals: Vec<&AnyObject> = pairs.iter().map(|(_, v)| &**v).collect();
    NSDictionary::from_slices(&keys, &vals)
}

/// Encoder-safe output size for a capture of `w`x`h` pixels: scaled down to fit the HEVC limits
/// (ultrawide, 6K+), even dimensions for 4:2:0.
pub fn fit_encoder(w: f64, h: f64) -> (usize, usize) {
    let k = (MAX_SIDE / w).min(MAX_SIDE / h).min((MAX_PIXELS / (w * h)).sqrt()).min(1.0);
    let even = |v: f64| ((v * k / 2.0).round() as usize * 2).max(2);
    (even(w), even(h))
}

/// Bit rate for screen content: text stays sharp while scrolling at this rate.
fn video_bitrate(w: usize, h: usize, fps: f64) -> f64 {
    // ponytail: fixed bits per pixel, tuned on synthetic text; a per-machine quality probe if users see blur.
    (w * h) as f64 * fps.min(60.0) * 0.12
}

fn open_writer(path: &Path) -> Result<Retained<AVAssetWriter>, String> {
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
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
) -> Result<Retained<AVAssetWriterInput>, String> {
    let kind =
        unsafe { if video { AVMediaTypeVideo } else { AVMediaTypeAudio } }.ok_or("AVFoundation media type missing")?;
    if !unsafe { w.canApplyOutputSettings_forMediaType(Some(settings), kind) } {
        return Err("The encoder does not support these settings on this Mac".into());
    }
    let input = unsafe {
        AVAssetWriterInput::initWithMediaType_outputSettings(AVAssetWriterInput::alloc(), kind, Some(settings))
    };
    unsafe { input.setExpectsMediaDataInRealTime(true) };
    if video {
        unsafe { input.setMediaTimeScale(VIDEO_TIMESCALE) };
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
    unsafe { w.startSessionAtSourceTime(video_time(0.0)) };
    Ok(())
}

fn video_time(t: f64) -> CMTime {
    unsafe { CMTime::new((t * VIDEO_TIMESCALE as f64).round() as i64, VIDEO_TIMESCALE) }
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

/// Screen video: HEVC, native size, variable frame rate (frames arrive only when the screen changes).
pub struct VideoWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    latest: Option<CFRetained<CVPixelBuffer>>,
    last_t: Option<f64>,
    fps: f64,
}

// SAFETY: AVFoundation writers may be used from any thread; the session serializes access with a Mutex.
unsafe impl Send for VideoWriter {}

impl VideoWriter {
    pub fn new(path: &Path, width: usize, height: usize, fps: f64) -> Result<Self, String> {
        let writer = open_writer(path)?;
        let compression = dict(&[
            ("AverageBitRate", num(video_bitrate(width, height, fps))),
            ("ExpectedFrameRate", num(fps)),
            ("MaxKeyFrameIntervalDuration", num(2.0)),
            ("AllowFrameReordering", obj(NSNumber::new_bool(false))),
            ("ProfileLevel", string("HEVC_Main_AutoLevel")),
        ]);
        let bt709 = || string("ITU_R_709_2");
        let color = dict(&[("ColorPrimaries", bt709()), ("TransferFunction", bt709()), ("YCbCrMatrix", bt709())]);
        let settings = dict(&[
            ("AVVideoCodecKey", string("hvc1")),
            ("AVVideoWidthKey", num(width as f64)),
            ("AVVideoHeightKey", num(height as f64)),
            ("AVVideoCompressionPropertiesKey", obj(compression)),
            ("AVVideoColorPropertiesKey", obj(color)),
        ]);
        let input = add_input(&writer, true, &settings)?;
        let adaptor = unsafe {
            AVAssetWriterInputPixelBufferAdaptor::initWithAssetWriterInput_sourcePixelBufferAttributes(
                AVAssetWriterInputPixelBufferAdaptor::alloc(),
                &input,
                None,
            )
        };
        start(&writer)?;
        Ok(Self { writer, input, adaptor, latest: None, last_t: None, fps })
    }

    /// New screen content. Appended at source time `t`; kept for later when `t` is None (paused).
    pub fn frame(&mut self, pb: CFRetained<CVPixelBuffer>, t: Option<f64>) {
        self.latest = Some(pb);
        if let Some(t) = t {
            self.append(t);
        }
    }

    /// Repeat the latest frame when nothing was appended for a while: the file keeps its
    /// fragments coming and the right duration while the screen is still.
    pub fn heartbeat(&mut self, t: f64) {
        if self.last_t.is_none_or(|l| t - l >= HEARTBEAT_SECS) {
            self.append(t);
        }
    }

    /// Append the latest frame at `t` right away (after resume: the screen may have changed while paused).
    pub fn append(&mut self, t: f64) {
        let Some(pb) = &self.latest else { return };
        // The first frame is real content and starts the file at 0.
        let t = if self.last_t.is_none() { 0.0 } else { t };
        if self.last_t.is_some_and(|l| t < l + 1e-3) || failed(&self.writer) {
            return;
        }
        if !unsafe { self.input.isReadyForMoreMediaData() } {
            return; // encoder busy: drop this frame, the next one or the heartbeat follows
        }
        if unsafe { self.adaptor.appendPixelBuffer_withPresentationTime(pb, video_time(t)) } {
            self.last_t = Some(t);
        }
    }

    pub fn error(&self) -> Option<String> {
        failed(&self.writer).then(|| failure(&self.writer))
    }

    pub fn has_frame(&self) -> bool {
        self.latest.is_some()
    }

    /// Finalize with the last frame held until `end`. Returns the duration.
    pub fn finish(mut self, end: f64) -> Result<f64, String> {
        if self.last_t.is_none() {
            self.append(0.0); // stopped before the first heartbeat: the one frame still counts
        }
        let Some(last) = self.last_t else {
            unsafe { self.writer.cancelWriting() };
            return Err("No screen frames were captured".into());
        };
        let end = end.max(last + 1.0 / self.fps);
        // The last frame lasts until `end`. A track's last sample lasts as long as the gap before
        // it, so repeat the frame twice just before `end`: the file ends there even for players
        // that ignore edit lists.
        let d = (1.0 / self.fps).min((end - last) / 3.0);
        if d > 1e-3 {
            for t in [end - 2.0 * d, end - d] {
                for _ in 0..50 {
                    if unsafe { self.input.isReadyForMoreMediaData() } {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                self.append(t);
            }
        }
        unsafe {
            self.input.markAsFinished();
            self.writer.endSessionAtSourceTime(video_time(end));
        }
        finish(&self.writer)?;
        Ok(end)
    }

    pub fn cancel(self) {
        unsafe { self.writer.cancelWriting() };
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

/// AAC audio track, sample-accurate on the master clock.
pub struct AudioWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    format: CFRetained<CMFormatDescription>,
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
        let input = add_input(&writer, false, &settings)?;
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
            CMAudioFormatDescriptionCreate(
                None,
                NonNull::from(&asbd),
                0,
                null(),
                0,
                null(),
                None,
                NonNull::from(&mut out),
            )
        };
        let format = NonNull::new(out as *mut CMFormatDescription)
            .filter(|_| status == 0)
            .map(|p| unsafe { CFRetained::from_raw(p) })
            .ok_or_else(|| format!("Audio format error {status}"))?;
        start(&writer)?;
        Ok(Self { writer, input, format, rate, channels, written: 0, last_end: None })
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
        let frames = samples.len() / self.channels;
        if frames == 0 || failed(&self.writer) || !unsafe { self.input.isReadyForMoreMediaData() } {
            return; // dropped: the next push realigns to the clock
        }
        let bytes = frames * self.channels * 4;
        let mut bb: *mut CMBlockBuffer = null_mut();
        let mut sb: *mut CMSampleBuffer = null_mut();
        unsafe {
            if CMBlockBuffer::create_with_memory_block(
                None,
                null_mut(),
                bytes,
                None,
                null(),
                0,
                bytes,
                kCMBlockBufferAssureMemoryNowFlag,
                NonNull::from(&mut bb),
            ) != 0
            {
                return;
            }
            let Some(bb) = NonNull::new(bb).map(|p| CFRetained::from_raw(p)) else { return };
            if CMBlockBuffer::replace_data_bytes(NonNull::new_unchecked(samples.as_ptr() as *mut _), &bb, 0, bytes) != 0
            {
                return;
            }
            let pts = CMTime::new(self.written as i64, self.rate as i32);
            if CMAudioSampleBufferCreateReadyWithPacketDescriptions(
                None,
                &bb,
                &self.format,
                frames as isize,
                pts,
                null(),
                NonNull::from(&mut sb),
            ) != 0
            {
                return;
            }
            let Some(sb) = NonNull::new(sb).map(|p| CFRetained::from_raw(p)) else { return };
            if self.input.appendSampleBuffer(&sb) {
                self.written += frames as u64;
            }
        }
    }

    pub fn error(&self) -> Option<String> {
        failed(&self.writer).then(|| failure(&self.writer))
    }

    /// Pad with silence to `end` (all tracks end together) and finalize. Returns the duration.
    pub fn finish(mut self, end: f64) -> Result<f64, String> {
        let target = (end * self.rate).round() as u64;
        self.silence(target.saturating_sub(self.written) as usize);
        if self.written == 0 {
            unsafe { self.writer.cancelWriting() };
            return Err("No audio was captured".into());
        }
        unsafe { self.input.markAsFinished() };
        finish(&self.writer)?;
        Ok(self.written as f64 / self.rate)
    }

    pub fn cancel(self) {
        unsafe { self.writer.cancelWriting() };
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
}
