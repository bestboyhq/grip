//! AVAssetWriter wrappers shared by the camera, iPhone/iPad, and matte writers.
//! Files are fragmented MP4 (a crash loses at most the last fragment) with strictly increasing
//! timestamps: AVAssetWriter fails the whole file on a non-increasing one, so we drop those instead.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::{self, NonNull};
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::*;
use objc2_core_foundation::{CFRetained, CFString};
use objc2_core_media::{
    kCMBlockBufferAssureMemoryNowFlag, CMAudioFormatDescriptionGetStreamBasicDescription,
    CMAudioSampleBufferCreateWithPacketDescriptions, CMBlockBuffer, CMFormatDescription, CMItemCount,
    CMSampleBuffer, CMSampleTimingInfo, CMTime, CMTimeFlags, kCMTimeInvalid,
};
use objc2_core_video::{
    kCVPixelBufferHeightKey, kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferPixelFormatTypeKey,
    kCVPixelBufferWidthKey, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, CVPixelBuffer, CVPixelBufferPool,
};
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString, NSURL};

pub const NV12: u32 = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;

pub fn cm_time(secs: f64, timescale: i32) -> CMTime {
    CMTime { value: (secs * timescale as f64).round() as i64, timescale, flags: CMTimeFlags::Valid, epoch: 0 }
}

/// Host-clock CMTime -> nanoseconds (the unit of clock::now_ns).
pub fn time_ns(t: CMTime) -> Option<u64> {
    if !t.flags.contains(CMTimeFlags::Valid) || t.timescale <= 0 || t.value < 0 {
        return None;
    }
    Some((t.value as i128 * 1_000_000_000 / t.timescale as i128) as u64)
}

pub fn ns_error(e: &NSError) -> String {
    e.localizedDescription().to_string()
}

/// CFString keys are toll-free bridged to NSString.
pub fn cf_key(k: &CFString) -> &NSString {
    unsafe { &*(k as *const CFString).cast::<NSString>() }
}

pub fn dict(pairs: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|p| p.0).collect();
    let values: Vec<&AnyObject> = pairs.iter().map(|p| p.1).collect();
    NSDictionary::from_slices(&keys, &values)
}

pub fn num(n: f64) -> Retained<NSNumber> {
    NSNumber::new_f64(n)
}

fn key(k: Option<&'static NSString>) -> &'static NSString {
    k.expect("AVFoundation constant missing")
}

/// Pixel buffer attributes for NV12 IOSurface-backed buffers, optionally of a fixed size.
pub fn nv12_attributes(size: Option<(usize, usize)>) -> Retained<NSDictionary<NSString, AnyObject>> {
    let format = NSNumber::new_u32(NV12);
    let surface = NSDictionary::<NSString, AnyObject>::new();
    let mut pairs: Vec<(&NSString, &AnyObject)> = unsafe {
        vec![(cf_key(kCVPixelBufferPixelFormatTypeKey), &format), (cf_key(kCVPixelBufferIOSurfacePropertiesKey), &surface)]
    };
    let size = size.map(|(w, h)| (num(w as f64), num(h as f64)));
    if let Some((w, h)) = &size {
        unsafe {
            pairs.push((cf_key(kCVPixelBufferWidthKey), w));
            pairs.push((cf_key(kCVPixelBufferHeightKey), h));
        }
    }
    dict(&pairs)
}

fn wait_finish(writer: &AVAssetWriter) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let done = RcBlock::new(move || {
        let _ = tx.send(());
    });
    unsafe { writer.finishWritingWithCompletionHandler(&done) };
    rx.recv_timeout(Duration::from_secs(60)).map_err(|_| "finishing the file timed out".to_string())?;
    match unsafe { writer.status() } {
        AVAssetWriterStatus::Completed => Ok(()),
        _ => Err(writer_error(writer)),
    }
}

/// The writer failed mid-recording (e.g. the disk filled up). Its fragments up to the failure are
/// a playable file, so keep them rather than lose the whole track.
fn kept_after_failure(path: &Path, error: &str) {
    eprintln!("recording of {} stopped early, keeping what was written: {error}", path.display());
}

fn writer_error(writer: &AVAssetWriter) -> String {
    unsafe { writer.error() }.map(|e| ns_error(&e)).unwrap_or_else(|| "the video writer failed".into())
}

fn new_writer(path: &Path, file_type: &'static AVFileType) -> Result<Retained<AVAssetWriter>, String> {
    if path.exists() {
        return Err(format!("{} already exists.", path.display())); // sources are never overwritten
    }
    let url = NSURL::from_file_path(path).ok_or_else(|| format!("invalid path {}", path.display()))?;
    let writer = unsafe { AVAssetWriter::assetWriterWithURL_fileType_error(&url, file_type) }.map_err(|e| ns_error(&e))?;
    unsafe {
        // Crash safety: a fragment per second, so a crash or power loss loses at most ~1 s.
        writer.setMovieFragmentInterval(cm_time(1.0, 600));
        writer.setShouldOptimizeForNetworkUse(false);
    }
    Ok(writer)
}

pub struct VideoSpec {
    pub width: usize,
    pub height: usize,
    pub fps: f64,
    /// Average bitrate = width * height * fps * bits_per_pixel.
    pub bits_per_pixel: f64,
    /// Live capture drops frames when the encoder is busy; offline writing waits instead.
    pub realtime: bool,
    pub timescale: i32,
    /// Session start: the first frame is shown from here, whatever its own timestamp.
    pub start: f64,
}

/// H.264 video track in a fragmented MP4, fed NV12 pixel buffers.
pub struct VideoWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    path: PathBuf,
    pub spec: VideoSpec,
    last: Option<i64>, // last appended time in timescale ticks
    pub frames: u32,
    pub dropped: u32,
    pub error: Option<String>,
}

// The writer is only touched by one thread at a time (behind a Mutex or owned by one thread);
// AVAssetWriter and its inputs are documented as usable from any thread.
unsafe impl Send for VideoWriter {}

impl VideoWriter {
    pub fn create(path: &Path, spec: VideoSpec) -> Result<Self, String> {
        let writer = new_writer(path, unsafe { key(AVFileTypeMPEG4) })?;
        let bitrate = num((spec.width * spec.height) as f64 * spec.fps * spec.bits_per_pixel);
        let fps = num(spec.fps);
        let keyframes = num(spec.fps.round().max(1.0)); // a keyframe a second keeps scrubbing fast
        let no = NSNumber::new_bool(false);
        let (w, h) = (num(spec.width as f64), num(spec.height as f64));
        let input = unsafe {
            let compression = dict(&[
                (key(AVVideoAverageBitRateKey), &bitrate),
                (key(AVVideoExpectedSourceFrameRateKey), &fps),
                (key(AVVideoMaxKeyFrameIntervalKey), &keyframes),
                (key(AVVideoAllowFrameReorderingKey), &no), // no B-frames: PTS order == decode order
            ]);
            // Tagged BT.709 (limited range), converting if the source is tagged otherwise, so
            // every decoder reads the same colors (and a matte's luma as exactly 0..1).
            let color = dict(&[
                (key(AVVideoColorPrimariesKey), key(AVVideoColorPrimaries_ITU_R_709_2)),
                (key(AVVideoTransferFunctionKey), key(AVVideoTransferFunction_ITU_R_709_2)),
                (key(AVVideoYCbCrMatrixKey), key(AVVideoYCbCrMatrix_ITU_R_709_2)),
            ]);
            let settings = dict(&[
                (key(AVVideoCodecKey), key(AVVideoCodecTypeH264)),
                (key(AVVideoWidthKey), &w),
                (key(AVVideoHeightKey), &h),
                (key(AVVideoColorPropertiesKey), &color),
                // A frame of another size fills the picture instead of letterboxing it.
                (key(AVVideoScalingModeKey), key(AVVideoScalingModeResizeAspectFill)),
                (key(AVVideoCompressionPropertiesKey), &compression),
            ]);
            AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(key(AVMediaTypeVideo), Some(&settings))
        };
        unsafe {
            input.setExpectsMediaDataInRealTime(spec.realtime);
            input.setMediaTimeScale(spec.timescale);
        }
        let adaptor = unsafe {
            AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(
                &input,
                Some(&nv12_attributes(Some((spec.width, spec.height)))),
            )
        };
        unsafe {
            if !writer.canAddInput(&input) {
                return Err("cannot add a video track".into());
            }
            writer.addInput(&input);
            if !writer.startWriting() {
                return Err(writer_error(&writer));
            }
            writer.startSessionAtSourceTime(cm_time(spec.start, spec.timescale));
        }
        Ok(Self { writer, input, adaptor, path: path.to_owned(), spec, last: None, frames: 0, dropped: 0, error: None })
    }

    /// A pool of NV12 buffers of the track size, for frames we produce ourselves.
    pub fn pool(&self) -> Option<Retained<CVPixelBufferPool>> {
        unsafe { self.adaptor.pixelBufferPool() }
    }

    /// Append a frame shown from `t` seconds. Returns false when it was dropped.
    pub fn append(&mut self, pb: &CVPixelBuffer, t: f64) -> bool {
        let ts = self.spec.timescale;
        // The first frame opens the file at the session start, so the track has no leading gap.
        let tick = if self.last.is_none() { cm_time(self.spec.start, ts).value } else { cm_time(t, ts).value };
        if self.error.is_some() || self.last.is_some_and(|l| tick <= l) {
            self.dropped += 1;
            return false;
        }
        // Live capture rides out encoder hiccups (meanwhile AVFoundation drops and counts late
        // frames), then gives up on this frame; offline writing always waits.
        let mut waited_ms = 0;
        while !unsafe { self.input.isReadyForMoreMediaData() } {
            if self.spec.realtime && waited_ms >= 100 {
                self.dropped += 1;
                return false;
            }
            std::thread::sleep(Duration::from_millis(1));
            waited_ms += 1;
        }
        let at = CMTime { value: tick, timescale: ts, flags: CMTimeFlags::Valid, epoch: 0 };
        if unsafe { self.adaptor.appendPixelBuffer_withPresentationTime(pb, at) } {
            self.last = Some(tick);
            self.frames += 1;
            true
        } else {
            self.dropped += 1;
            if unsafe { self.writer.status() } == AVAssetWriterStatus::Failed {
                self.error = Some(writer_error(&self.writer));
            }
            false
        }
    }

    /// Seconds of the last appended frame.
    pub fn last_time(&self) -> Option<f64> {
        self.last.map(|l| l as f64 / self.spec.timescale as f64)
    }

    /// Finalize. The last frame stays on screen until `end` (at least one frame long).
    pub fn finish(self, end: f64) -> Result<(), String> {
        let Some(last) = self.last_time() else {
            self.cancel();
            return Err("no video frames were recorded".into());
        };
        if let Some(e) = &self.error {
            return Ok(kept_after_failure(&self.path, e));
        }
        unsafe {
            self.input.markAsFinished();
            self.writer.endSessionAtSourceTime(cm_time(end.max(last + 1.0 / self.spec.fps), self.spec.timescale));
        }
        wait_finish(&self.writer)
    }

    /// Abandon the file and delete it.
    pub fn cancel(self) {
        unsafe { self.writer.cancelWriting() };
        let _ = std::fs::remove_file(&self.path);
    }
}

pub const AUDIO_RATE: f64 = 48_000.0;
pub const AUDIO_CHANNELS: usize = 2;
const AUDIO_FRAME_BYTES: usize = 4 * AUDIO_CHANNELS; // f32 interleaved

#[link(name = "AVFAudio", kind = "framework")]
unsafe extern "C" {
    static AVFormatIDKey: &'static NSString;
    static AVSampleRateKey: &'static NSString;
    static AVNumberOfChannelsKey: &'static NSString;
    static AVEncoderBitRateKey: &'static NSString;
    static AVLinearPCMBitDepthKey: &'static NSString;
    static AVLinearPCMIsFloatKey: &'static NSString;
    static AVLinearPCMIsNonInterleaved: &'static NSString;
    static AVLinearPCMIsBigEndianKey: &'static NSString;
}

/// Capture-side audio settings: 48 kHz stereo float32 interleaved, the format AudioWriter expects.
pub fn pcm_settings() -> Retained<NSDictionary<NSString, AnyObject>> {
    let lpcm = NSNumber::new_u32(u32::from_be_bytes(*b"lpcm"));
    let (rate, ch, bits) = (num(AUDIO_RATE), num(AUDIO_CHANNELS as f64), num(32.0));
    let (yes, no) = (NSNumber::new_bool(true), NSNumber::new_bool(false));
    unsafe {
        dict(&[
            (AVFormatIDKey, &lpcm),
            (AVSampleRateKey, &rate),
            (AVNumberOfChannelsKey, &ch),
            (AVLinearPCMBitDepthKey, &bits),
            (AVLinearPCMIsFloatKey, &yes),
            (AVLinearPCMIsNonInterleaved, &no),
            (AVLinearPCMIsBigEndianKey, &no),
        ])
    }
}

/// AAC track in a fragmented .m4a, fed 48 kHz stereo float PCM. The track is gapless from source
/// time 0: leading silence and dropouts are filled with silence and small timestamp jitter is
/// absorbed, so every decoder plays it in sync without relying on edit lists.
pub struct AudioWriter {
    writer: Retained<AVAssetWriter>,
    input: Retained<AVAssetWriterInput>,
    path: PathBuf,
    next: i64, // next sample index (48 kHz) the track expects
    pub error: Option<String>,
}

unsafe impl Send for AudioWriter {}

/// Timestamp jitter below this is absorbed by placing the buffer contiguously (2 ms).
const AUDIO_SLACK: i64 = 96;

impl AudioWriter {
    pub fn create(path: &Path) -> Result<Self, String> {
        let writer = new_writer(path, unsafe { key(AVFileTypeAppleM4A) })?;
        let aac = NSNumber::new_u32(u32::from_be_bytes(*b"aac "));
        let (rate, ch, bitrate) = (num(AUDIO_RATE), num(AUDIO_CHANNELS as f64), num(192_000.0));
        let input = unsafe {
            let settings = dict(&[
                (AVFormatIDKey, &aac),
                (AVSampleRateKey, &rate),
                (AVNumberOfChannelsKey, &ch),
                (AVEncoderBitRateKey, &bitrate),
            ]);
            AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(key(AVMediaTypeAudio), Some(&settings))
        };
        unsafe {
            input.setExpectsMediaDataInRealTime(true);
            if !writer.canAddInput(&input) {
                return Err("cannot add an audio track".into());
            }
            writer.addInput(&input);
            if !writer.startWriting() {
                return Err(writer_error(&writer));
            }
            writer.startSessionAtSourceTime(cm_time(0.0, AUDIO_RATE as i32));
        }
        Ok(Self { writer, input, path: path.to_owned(), next: 0, error: None })
    }

    /// Seconds of audio written so far.
    pub fn duration(&self) -> f64 {
        self.next as f64 / AUDIO_RATE
    }

    /// Append a PCM buffer (48 kHz stereo f32 interleaved) that starts at source time `t`.
    pub fn append(&mut self, sb: &CMSampleBuffer, t: f64) -> bool {
        if self.error.is_some() || !is_pcm(sb) {
            return false;
        }
        let n = unsafe { sb.num_samples() } as i64;
        let start = (t * AUDIO_RATE).round() as i64;
        if start + n <= self.next + AUDIO_SLACK {
            return false; // entirely in the past (late delivery across a pause)
        }
        if start > self.next + AUDIO_SLACK && !self.push_silence(start - self.next) {
            return false;
        }
        self.push(sb, n)
    }

    fn push_silence(&mut self, frames: i64) -> bool {
        // ponytail: one buffer for the whole gap; chunk it if gaps of minutes ever matter.
        pcm_buffer(frames as usize, |_, _| 0.0).is_some_and(|sb| self.push(&sb, frames))
    }

    /// Append `sb` right after what the track already has (absorbing timestamp jitter).
    fn push(&mut self, sb: &CMSampleBuffer, n: i64) -> bool {
        if !unsafe { self.input.isReadyForMoreMediaData() } {
            // The timeline stays intact: the next buffer's gap check fills this span with silence.
            return false;
        }
        let timing = CMSampleTimingInfo {
            duration: CMTime { value: 1, timescale: AUDIO_RATE as i32, flags: CMTimeFlags::Valid, epoch: 0 },
            presentationTimeStamp: CMTime { value: self.next, timescale: AUDIO_RATE as i32, flags: CMTimeFlags::Valid, epoch: 0 },
            decodeTimeStamp: unsafe { kCMTimeInvalid },
        };
        let mut out: *mut CMSampleBuffer = ptr::null_mut();
        let status = unsafe { CMSampleBuffer::create_copy_with_new_timing(None, sb, 1, &timing, NonNull::from(&mut out)) };
        let Some(copy) = NonNull::new(out).filter(|_| status == 0) else { return false };
        let copy = unsafe { CFRetained::from_raw(copy) };
        if unsafe { self.input.appendSampleBuffer(&copy) } {
            self.next += n;
            true
        } else {
            if unsafe { self.writer.status() } == AVAssetWriterStatus::Failed {
                self.error = Some(writer_error(&self.writer));
            }
            false
        }
    }

    /// Finalize, padding with silence up to `end` seconds so the track spans the recording.
    pub fn finish(mut self, end: f64) -> Result<(), String> {
        if self.next == 0 {
            unsafe { self.writer.cancelWriting() };
            let _ = std::fs::remove_file(&self.path);
            return Err("no audio was recorded".into());
        }
        let pad = (end * AUDIO_RATE).round() as i64 - self.next;
        if pad > AUDIO_SLACK {
            self.push_silence(pad);
        }
        if let Some(e) = &self.error {
            return Ok(kept_after_failure(&self.path, e));
        }
        unsafe {
            self.input.markAsFinished();
            self.writer.endSessionAtSourceTime(cm_time(self.duration(), AUDIO_RATE as i32));
        }
        wait_finish(&self.writer)
    }
}

/// CoreAudio's AudioStreamBasicDescription (the objc2 type lives in a crate we do not depend on).
#[repr(C)]
#[allow(non_snake_case)]
struct Asbd {
    mSampleRate: f64,
    mFormatID: u32,
    mFormatFlags: u32,
    mBytesPerPacket: u32,
    mFramesPerPacket: u32,
    mBytesPerFrame: u32,
    mChannelsPerFrame: u32,
    mBitsPerChannel: u32,
    mReserved: u32,
}

fn is_pcm(sb: &CMSampleBuffer) -> bool {
    let Some(fd) = (unsafe { sb.format_description() }) else { return false };
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&fd) }.cast::<Asbd>();
    let Some(a) = (unsafe { asbd.as_ref() }) else { return false };
    a.mFormatID == u32::from_be_bytes(*b"lpcm")
        && a.mSampleRate == AUDIO_RATE
        && a.mChannelsPerFrame as usize == AUDIO_CHANNELS
        && a.mBytesPerFrame as usize == AUDIO_FRAME_BYTES
}

/// The PCM format description AudioWriter accepts.
pub fn pcm_format() -> Option<CFRetained<CMFormatDescription>> {
    let asbd = Asbd {
        mSampleRate: AUDIO_RATE,
        mFormatID: u32::from_be_bytes(*b"lpcm"),
        mFormatFlags: 1 | 8, // float | packed
        mBytesPerPacket: AUDIO_FRAME_BYTES as u32,
        mFramesPerPacket: 1,
        mBytesPerFrame: AUDIO_FRAME_BYTES as u32,
        mChannelsPerFrame: AUDIO_CHANNELS as u32,
        mBitsPerChannel: 32,
        mReserved: 0,
    };
    let mut out: *const CMFormatDescription = ptr::null();
    let status = unsafe {
        objc2_core_media::CMAudioFormatDescriptionCreate(
            None,
            NonNull::from(&asbd).cast(),
            0,
            ptr::null(),
            0,
            ptr::null(),
            None,
            NonNull::from(&mut out),
        )
    };
    (status == 0 && !out.is_null()).then(|| unsafe { CFRetained::from_raw(NonNull::new_unchecked(out as *mut _)) })
}

/// A PCM buffer at time 0 (retimed on append): silence, or `fill(frame, channel)` for tests.
pub fn pcm_buffer(frames: usize, fill: impl Fn(usize, usize) -> f32) -> Option<CFRetained<CMSampleBuffer>> {
    let format = pcm_format()?;
    let bytes = frames * AUDIO_FRAME_BYTES;
    let mut block: *mut CMBlockBuffer = ptr::null_mut();
    let status = unsafe {
        CMBlockBuffer::create_with_memory_block(
            None,
            ptr::null_mut(),
            bytes,
            None,
            ptr::null(),
            0,
            bytes,
            kCMBlockBufferAssureMemoryNowFlag,
            NonNull::from(&mut block),
        )
    };
    if status != 0 || block.is_null() {
        return None;
    }
    let block = unsafe { CFRetained::from_raw(NonNull::new_unchecked(block)) };
    let samples: Vec<f32> = (0..frames * AUDIO_CHANNELS).map(|i| fill(i / AUDIO_CHANNELS, i % AUDIO_CHANNELS)).collect();
    let status = unsafe { CMBlockBuffer::replace_data_bytes(NonNull::new_unchecked(samples.as_ptr() as *mut c_void), &block, 0, bytes) };
    if status != 0 {
        return None;
    }
    let mut out: *mut CMSampleBuffer = ptr::null_mut();
    let status = unsafe {
        CMAudioSampleBufferCreateWithPacketDescriptions(
            None,
            Some(&block),
            true,
            None,
            ptr::null_mut(),
            &format,
            frames as CMItemCount,
            cm_time(0.0, AUDIO_RATE as i32),
            ptr::null(),
            NonNull::from(&mut out),
        )
    };
    (status == 0 && !out.is_null()).then(|| unsafe { CFRetained::from_raw(NonNull::new_unchecked(out)) })
}
