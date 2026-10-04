//! Owner: camera. AVFoundation camera and iPhone/iPad (CoreMediaIO) capture, Vision analysis.
//!
//! How capture/mod.rs drives this (all calls from one thread; none need the main thread):
//! - Webcam: `CameraRecorder::start(id, "<bundle>/sources/camera.mp4")` (or `start_with(.., height)`
//!   for 720/1080/2160) BEFORE `clock::SESSION.start()`, so the camera warms up during the countdown;
//!   frames before the session start are dropped and the first kept frame opens the file at t = 0.
//!   Call `pause()`/`resume()` next to `SESSION.pause()`/`resume()`, then `stop(end)` and put the
//!   returned `VideoInfo` into `sources.camera`. The camera keeps running through pauses.
//! - iPhone/iPad screen as the recording target: `DeviceRecorder::start(id, ".../screen.mp4",
//!   Some(".../system.m4a"))` with the same lifecycle. `stop(end)` returns `DeviceInfo`: `video` goes
//!   into `sources.screen` (scale 1), `audio` into `sources.system`, and `rotations` into
//!   `sources.screen.rotations` (the file keeps the first frame's orientation; see `Rotation`).
//!   Device ids come from `listCameras()` entries with kind "ios".
//! - Both fail cleanly with a one-line, plain-language reason (no camera access, unplugged, ...).
//!   Camera access must already be granted: request it (permissions.rs) before starting.

mod analyze;

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Once};

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchRetained};
use napi::bindgen_prelude::{AbortSignal, PromiseRaw};
use napi::{Env, Error, Status};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_av_foundation::*;
use objc2_core_foundation::{CFRetained, CFString};
use objc2_core_media::{
    kCMMediaType_Audio, kCMMediaType_Video, CMClock, CMSampleBuffer, CMSyncConvertTime, CMTime,
    CMVideoFormatDescriptionGetDimensions,
};
use objc2_core_video::{CVPixelBuffer, CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferPool};
use objc2_foundation::{NSArray, NSNotification, NSNotificationCenter, NSObject, NSObjectProtocol, NSString};

use crate::clock::{self, SessionClock};
use crate::permissions::{Permission, missing};
use crate::writer::{self, AudioWriter, VideoSpec, VideoWriter, interleaved_f32, ns_error};

/// Camera quality when the caller does not choose one.
pub const DEFAULT_HEIGHT: u32 = 1080;
const TARGET_FPS: f64 = 30.0;
/// Device audio: what the capture output converts to (writer::pcm_settings).
const AUDIO_RATE: f64 = 48_000.0;

pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// Seconds the track spans.
    pub duration: f64,
    /// Frames written to the file (diagnostics: the tests check them).
    #[cfg_attr(not(test), allow(dead_code))]
    pub frames: u32,
    /// Frames lost: late in the capture pipeline, encoder busy, or out of order.
    #[cfg_attr(not(test), allow(dead_code))]
    pub dropped: u32,
}

/// From source time `t` on, stored frames must be turned `deg` degrees clockwise to be upright.
/// An iPhone/iPad changes its screen size when rotated; the file keeps the first frame's size and
/// orientation, so a frame of swapped size is stored turned 90° counter-clockwise (deg = 90).
#[napi(object)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rotation {
    pub t: f64,
    pub deg: u32,
}

pub struct DeviceInfo {
    pub video: VideoInfo,
    /// Device audio was recorded (48 kHz stereo AAC).
    pub audio: bool,
    pub rotations: Vec<Rotation>,
}

// ---------------------------------------------------------------------------------------------
// Devices and formats

#[napi(object)]
pub struct CameraFormat {
    pub width: u32,
    pub height: u32,
    /// Highest frame rate of this size.
    pub fps: f64,
}

#[napi(object)]
pub struct CameraDevice {
    pub id: String,
    pub name: String,
    #[napi(ts_type = "'built-in' | 'external' | 'continuity' | 'ios'")]
    pub kind: String,
    /// Distinct sizes, tallest first (webcams: landscape only). Recording resolves the quality
    /// the user picked (720, 1080, 2160) to the closest of these at 30 fps before it starts.
    pub formats: Vec<CameraFormat>,
}

/// iPhones and iPads connected over USB only show up as capture devices once this is set.
fn allow_screen_capture_devices() {
    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }
    #[link(name = "CoreMediaIO", kind = "framework")]
    unsafe extern "C" {
        fn CMIOObjectSetPropertyData(
            object: u32,
            address: *const Address,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: u32,
            data: *const c_void,
        ) -> i32;
    }
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let address = Address {
            selector: u32::from_be_bytes(*b"yes "), // kCMIOHardwarePropertyAllowScreenCaptureDevices
            scope: u32::from_be_bytes(*b"glob"),    // kCMIOObjectPropertyScopeGlobal
            element: 0,                             // kCMIOObjectPropertyElementMain
        };
        let allow: u32 = 1;
        // kCMIOObjectSystemObject = 1. Failure only means no iOS devices; cameras still work.
        unsafe { CMIOObjectSetPropertyData(1, &address, 0, std::ptr::null(), 4, (&allow as *const u32).cast()) };
    });
}

fn discover(types: &[&AVCaptureDeviceType], media: Option<&'static AVMediaType>) -> Vec<Retained<AVCaptureDevice>> {
    let types = NSArray::from_slice(types);
    let session = unsafe {
        AVCaptureDeviceDiscoverySession::discoverySessionWithDeviceTypes_mediaType_position(
            &types,
            media,
            AVCaptureDevicePosition::Unspecified,
        )
    };
    unsafe { session.devices() }.to_vec()
}

fn devices() -> Vec<(Retained<AVCaptureDevice>, &'static str)> {
    allow_screen_capture_devices();
    let mut out = Vec::new();
    unsafe {
        let cameras = [
            AVCaptureDeviceTypeBuiltInWideAngleCamera,
            AVCaptureDeviceTypeContinuityCamera,
            AVCaptureDeviceTypeDeskViewCamera,
            AVCaptureDeviceTypeExternal,
        ];
        for d in discover(&cameras, AVMediaTypeVideo) {
            let kind = if d.isContinuityCamera() {
                "continuity"
            } else if d.transportType() == i32::from_be_bytes(*b"bltn") {
                "built-in" // includes the MacBook's own Desk View
            } else {
                "external"
            };
            out.push((d, kind));
        }
        // iPhone/iPad screens: muxed (video + audio) external devices.
        for d in discover(&[AVCaptureDeviceTypeExternal], AVMediaTypeMuxed) {
            if !out.iter().any(|(o, _)| o.uniqueID() == d.uniqueID()) {
                out.push((d, "ios"));
            }
        }
    }
    out
}

fn find_device(id: &str) -> Result<Retained<AVCaptureDevice>, String> {
    allow_screen_capture_devices();
    unsafe { AVCaptureDevice::deviceWithUniqueID(&NSString::from_str(id)) }
        .filter(|d| unsafe { d.isConnected() })
        .ok_or_else(|| "That camera is not connected.".to_string())
}

/// Whether camera or iPhone/iPad `id` is still plugged in.
pub fn is_connected(id: &str) -> bool {
    find_device(id).is_ok()
}

/// Frame rate to run a format at: 30 when supported, else the closest below, else the lowest above.
fn format_fps(ranges: &[(f64, f64)]) -> f64 {
    if ranges.iter().any(|&(lo, hi)| lo <= TARGET_FPS + 0.01 && hi >= TARGET_FPS - 0.01) {
        return TARGET_FPS;
    }
    let below = ranges.iter().map(|r| r.1).filter(|&f| f < TARGET_FPS).fold(0.0, f64::max);
    if below > 0.0 { below } else { ranges.iter().map(|r| r.0).fold(f64::INFINITY, f64::min) }
}

/// Index of the best format for a target height: landscape (rotated Center Stage modes are never
/// what a webcam recording wants), 30 fps, then the exact height, the closest below, the closest
/// above; at equal height the widest. Formats are (w, h, fps).
fn pick_format(formats: &[(u32, u32, f64)], target: u32) -> Option<usize> {
    (0..formats.len()).min_by_key(|&i| {
        let (w, h, fps) = formats[i];
        let at30 = (fps - TARGET_FPS).abs() < 0.01;
        let side = if h == target { 0 } else if h < target { 1 } else { 2 };
        (w < h, !at30, side, h.abs_diff(target), std::cmp::Reverse(w))
    })
}

struct Resolved {
    format: Retained<AVCaptureDeviceFormat>,
    width: u32,
    height: u32,
    fps: f64,
    frame: CMTime,
}

fn format_info(f: &AVCaptureDeviceFormat) -> (u32, u32, f64, Vec<Retained<AVFrameRateRange>>) {
    let d = unsafe { CMVideoFormatDescriptionGetDimensions(&f.formatDescription()) };
    let ranges = unsafe { f.videoSupportedFrameRateRanges() }.to_vec();
    let fps = format_fps(&ranges.iter().map(|r| unsafe { (r.minFrameRate(), r.maxFrameRate()) }).collect::<Vec<_>>());
    (d.width.max(0) as u32, d.height.max(0) as u32, fps, ranges)
}

/// Pick the format once, before recording, so it never changes mid-session.
fn resolve_format(device: &AVCaptureDevice, height: u32) -> Option<Resolved> {
    let formats = unsafe { device.formats() }.to_vec();
    let infos: Vec<_> = formats.iter().map(|f| format_info(f)).collect();
    let i = pick_format(&infos.iter().map(|i| (i.0, i.1, i.2)).collect::<Vec<_>>(), height)?;
    let (width, height, fps, ranges) = &infos[i];
    // Exact frame duration: 1/30 when a range covers it, else the range's own (e.g. 1001/30000).
    let frame = if (*fps - TARGET_FPS).abs() < 0.01 {
        unsafe { CMTime::new(1, 30) }
    } else {
        let r = ranges.iter().find(|r| unsafe { (r.maxFrameRate() - fps).abs() < 0.01 || (r.minFrameRate() - fps).abs() < 0.01 })?;
        if unsafe { (r.maxFrameRate() - fps).abs() < 0.01 } { unsafe { r.minFrameDuration() } } else { unsafe { r.maxFrameDuration() } }
    };
    Some(Resolved { format: formats[i].clone(), width: *width, height: *height, fps: *fps, frame })
}

#[napi]
/// Webcams, Continuity Cameras, and iPhone/iPad screens connected over USB.
pub fn list_cameras() -> Vec<CameraDevice> {
    devices()
        .into_iter()
        .map(|(d, kind)| {
            let mut formats: Vec<CameraFormat> = Vec::new();
            for f in unsafe { d.formats() }.iter() {
                let (width, height, _, ranges) = format_info(&f);
                if width < height && kind != "ios" {
                    continue; // see pick_format
                }
                let fps = ranges.iter().map(|r| unsafe { r.maxFrameRate() }).fold(0.0, f64::max);
                match formats.iter_mut().find(|e| e.width == width && e.height == height) {
                    Some(e) => e.fps = e.fps.max(fps),
                    None => formats.push(CameraFormat { width, height, fps }),
                }
            }
            formats.sort_by_key(|f| std::cmp::Reverse((f.height, f.width)));
            CameraDevice {
                id: unsafe { d.uniqueID() }.to_string(),
                name: unsafe { d.localizedName() }.to_string(),
                kind: kind.into(),
                formats,
            }
        })
        .collect()
}

#[napi]
/// Call `onChange` whenever a camera or iPhone/iPad is plugged in or out (then re-list).
/// Delivered through the main run loop. A later call replaces the previous callback.
pub fn watch_cameras(on_change: ThreadsafeFunction<(), (), (), Status, false, true>) {
    static CALLBACK: Mutex<Option<ThreadsafeFunction<(), (), (), Status, false, true>>> = Mutex::new(None);
    static OBSERVE: Once = Once::new();
    *lock(&CALLBACK) = Some(on_change);
    allow_screen_capture_devices();
    OBSERVE.call_once(|| {
        let notify = RcBlock::new(|_: NonNull<NSNotification>| {
            if let Some(cb) = &*lock(&CALLBACK) {
                cb.call((), ThreadsafeFunctionCallMode::NonBlocking);
            }
        });
        let center = NSNotificationCenter::defaultCenter();
        for name in unsafe { [AVCaptureDeviceWasConnectedNotification, AVCaptureDeviceWasDisconnectedNotification] } {
            let token = unsafe { center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &notify) };
            std::mem::forget(token); // observe for the life of the process
        }
    });
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn check_access() -> Result<(), String> {
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(AVMediaTypeVideo.expect("AVMediaTypeVideo")) };
    match status {
        AVAuthorizationStatus::Authorized => Ok(()),
        _ => Err(missing(Permission::Camera).into()),
    }
}

/// The file is created on the first frame; catch a bad target before the camera starts.
fn check_dir(path: &Path) -> Result<(), String> {
    match path.parent() {
        _ if path.exists() => Err(format!("{} already exists.", path.display())),
        Some(dir) if dir.is_dir() => Ok(()),
        _ => Err(format!("The folder for {} does not exist.", path.display())),
    }
}

// ---------------------------------------------------------------------------------------------
// Sample sink: timing, pause, rotation, writing. Fed by the capture delegate (or tests).

struct Sink {
    clock: &'static SessionClock,
    video_path: PathBuf,
    fps: f64,
    bits_per_pixel: f64,
    /// Fixed output size (webcam: the chosen format). None = the first frame's size (iOS device).
    size: Option<(usize, usize)>,
    rotate: bool,
    /// Device audio goes here (created on the first audio sample).
    audio_path: Option<PathBuf>,
    capture_drops: AtomicU32,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    video: Option<VideoWriter>,
    audio: Option<AudioWriter>,
    audio_error: Option<String>,
    /// Host-time window [from, to) whose samples are dropped: the current or last pause.
    pause: (u64, u64),
    rotator: Option<Rotator>,
    deg: u32,
    rotations: Vec<Rotation>,
    error: Option<String>,
    /// The capture session's clock when known; sample times are on it (normally the host clock).
    sync: Option<Retained<CMClock>>,
}

// Everything mutable is behind the Mutex; CMClock is an immutable, thread-safe CF object.
unsafe impl Send for Sink {}
unsafe impl Sync for Sink {}

impl Sink {
    fn new(clock: &'static SessionClock, video_path: &Path, fps: f64, bits_per_pixel: f64, size: Option<(usize, usize)>, rotate: bool) -> Self {
        Self {
            clock,
            video_path: video_path.to_owned(),
            fps,
            bits_per_pixel,
            size,
            rotate,
            audio_path: None,
            capture_drops: AtomicU32::new(0),
            state: Mutex::new(State::default()),
        }
    }

    fn pause_at(&self, host_ns: u64) {
        lock(&self.state).pause = (host_ns, u64::MAX);
    }

    fn resume_at(&self, host_ns: u64) {
        let mut st = lock(&self.state);
        if st.pause.1 == u64::MAX {
            st.pause.1 = host_ns;
        }
    }

    /// Source time of a sample captured at `pts` (on the sync clock), or None when it is dropped:
    /// before the session started, while paused, or captured during a pause but delivered late.
    fn source_time(&self, st: &State, pts: CMTime) -> Option<f64> {
        let host = match &st.sync {
            Some(clock) => unsafe { CMSyncConvertTime(pts, clock, &CMClock::host_time_clock()) },
            None => pts,
        };
        let ns = clock::cm_ns(host)?;
        if ns >= st.pause.0 && ns < st.pause.1 {
            return None;
        }
        self.clock.source_secs(ns)
    }

    fn on_sample(&self, sb: &CMSampleBuffer) {
        let mut st = lock(&self.state);
        let Some(t) = self.source_time(&st, unsafe { sb.presentation_time_stamp() }) else { return };
        let Some(format) = (unsafe { sb.format_description() }) else { return };
        let media = unsafe { format.media_type() };
        if media == kCMMediaType_Video {
            if let Some(pb) = unsafe { sb.image_buffer() } {
                self.on_frame(&mut st, pb, t);
            }
        } else if media == kCMMediaType_Audio {
            let Some(path) = &self.audio_path else { return };
            let Some((samples, 2, rate)) = interleaved_f32(sb) else { return };
            if rate != AUDIO_RATE {
                return;
            }
            if st.audio.is_none() && st.audio_error.is_none() {
                match AudioWriter::new(path, AUDIO_RATE, 2) {
                    Ok(a) => st.audio = Some(a),
                    Err(e) => st.audio_error = Some(e),
                }
            }
            if let Some(audio) = st.audio.as_mut() {
                audio.push(t, &samples);
            }
        }
    }

    fn on_frame(&self, st: &mut State, pb: CFRetained<CVPixelBuffer>, t: f64) {
        let (w, h) = (CVPixelBufferGetWidth(&pb), CVPixelBufferGetHeight(&pb));
        if st.video.is_none() {
            if st.error.is_some() {
                return;
            }
            let (width, height) = self.size.unwrap_or((w, h));
            let spec = VideoSpec { width, height, fps: self.fps, bits_per_pixel: self.bits_per_pixel, realtime: true };
            match VideoWriter::new(&self.video_path, spec) {
                Ok(v) => st.video = Some(v),
                Err(e) => {
                    st.error = Some(e);
                    return;
                }
            }
        }
        let State { video: Some(video), rotator, deg, rotations, .. } = st else { return };
        let (cw, ch) = (video.spec.width, video.spec.height);
        let turned = self.rotate && w != h && (w, h) == (ch, cw);
        let frame = if turned {
            match rotate_into(rotator, &pb, video.pool().as_deref()) {
                Some(r) => r,
                None => {
                    video.dropped += 1;
                    return;
                }
            }
        } else {
            pb
        };
        let now = if turned { 90 } else { 0 };
        if video.frame(frame, Some(t)) && now != *deg {
            *deg = now;
            rotations.push(Rotation { t: video.last_time().unwrap_or(t), deg: now });
        }
    }

    /// Finalize the files. `end` = source time the recording stopped at.
    fn finish(&self, end: Option<f64>) -> Result<(VideoInfo, bool, Vec<Rotation>), String> {
        let mut st = lock(&self.state);
        let audio = st.audio.take();
        let Some(video) = st.video.take() else {
            if let Some(a) = audio {
                let _ = a.finish(0.0);
            }
            return Err(st.error.take().unwrap_or_else(|| "The camera did not deliver any video.".into()));
        };
        let end = end.or(video.last_time().map(|l| l + 1.0 / self.fps)).unwrap_or(0.0);
        let (width, height, frames) = (video.spec.width as u32, video.spec.height as u32, video.frames);
        let dropped = video.dropped + self.capture_drops.load(Ordering::Relaxed);
        let info = VideoInfo { width, height, fps: self.fps, duration: video.finish(end)?, frames, dropped };
        let audio = match audio {
            Some(a) => a.finish(end).inspect_err(|e| eprintln!("device audio: {e}")).is_ok(),
            None => {
                if let Some(e) = st.audio_error.take() {
                    eprintln!("device audio: {e}");
                }
                false
            }
        };
        Ok((info, audio, std::mem::take(&mut st.rotations)))
    }
}

/// Turn `src` 90° counter-clockwise into a buffer from `pool` (VideoToolbox, on the GPU).
fn rotate_into(rotator: &mut Option<Rotator>, src: &CVPixelBuffer, pool: Option<&CVPixelBufferPool>) -> Option<CFRetained<CVPixelBuffer>> {
    if rotator.is_none() {
        *rotator = Rotator::new();
    }
    let dst = pixel_buffer(pool?)?;
    rotator.as_ref()?.rotate(src, &dst).then_some(dst)
}

fn pixel_buffer(pool: &CVPixelBufferPool) -> Option<CFRetained<CVPixelBuffer>> {
    let mut out: *mut CVPixelBuffer = std::ptr::null_mut();
    #[allow(deprecated)]
    let status = unsafe { objc2_core_video::CVPixelBufferPoolCreatePixelBuffer(None, pool, NonNull::from(&mut out)) };
    NonNull::new(out).filter(|_| status == 0).map(|p| unsafe { CFRetained::from_raw(p) })
}

struct Rotator(NonNull<c_void>);

#[link(name = "VideoToolbox", kind = "framework")]
unsafe extern "C" {
    fn VTPixelRotationSessionCreate(allocator: *const c_void, session: *mut *mut c_void) -> i32;
    fn VTPixelRotationSessionRotateImage(session: *mut c_void, src: &CVPixelBuffer, dst: &CVPixelBuffer) -> i32;
    fn VTPixelRotationSessionInvalidate(session: *mut c_void);
    fn VTSessionSetProperty(session: *mut c_void, key: &CFString, value: *const c_void) -> i32;
    static kVTPixelRotationPropertyKey_Rotation: &'static CFString;
    static kVTRotation_CCW90: &'static CFString;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *mut c_void);
}

impl Rotator {
    fn new() -> Option<Self> {
        let mut s: *mut c_void = std::ptr::null_mut();
        unsafe {
            if VTPixelRotationSessionCreate(std::ptr::null(), &mut s) != 0 {
                return None;
            }
            let s = NonNull::new(s)?;
            let r = Rotator(s);
            let rotation: *const CFString = kVTRotation_CCW90;
            (VTSessionSetProperty(s.as_ptr(), kVTPixelRotationPropertyKey_Rotation, rotation.cast()) == 0).then_some(r)
        }
    }
    fn rotate(&self, src: &CVPixelBuffer, dst: &CVPixelBuffer) -> bool {
        unsafe { VTPixelRotationSessionRotateImage(self.0.as_ptr(), src, dst) == 0 }
    }
}

impl Drop for Rotator {
    fn drop(&mut self) {
        unsafe {
            VTPixelRotationSessionInvalidate(self.0.as_ptr());
            CFRelease(self.0.as_ptr());
        }
    }
}

unsafe impl Send for Rotator {}

// ---------------------------------------------------------------------------------------------
// AVCaptureSession plumbing

define_class!(
    // SAFETY: NSObject has no subclassing requirements and Delegate does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "StudioCaptureSampleDelegate"]
    #[ivars = Arc<Sink>]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for Delegate {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn did_output(&self, _output: &AVCaptureOutput, sb: &CMSampleBuffer, _connection: &AVCaptureConnection) {
            self.ivars().on_sample(sb);
        }

        #[unsafe(method(captureOutput:didDropSampleBuffer:fromConnection:))]
        fn did_drop(&self, _output: &AVCaptureOutput, _sb: &CMSampleBuffer, _connection: &AVCaptureConnection) {
            self.ivars().capture_drops.fetch_add(1, Ordering::Relaxed);
        }
    }

    // Audio uses the same captureOutput:didOutputSampleBuffer:fromConnection: selector.
    unsafe impl AVCaptureAudioDataOutputSampleBufferDelegate for Delegate {}
);

impl Delegate {
    fn new(sink: Arc<Sink>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(sink);
        unsafe { msg_send![super(this), init] }
    }
}

/// A running AVCaptureSession that feeds a Sink. Dropping it stops the camera.
struct Capture {
    session: Retained<AVCaptureSession>,
    device: Retained<AVCaptureDevice>,
    locked: bool,
    halted: bool,
    _delegate: Retained<Delegate>,
    queue: DispatchRetained<DispatchQueue>,
    sink: Arc<Sink>,
}

// AVCaptureSession and AVCaptureDevice may be used from any thread; Capture is only moved between
// threads, never shared.
unsafe impl Send for Capture {}

impl Capture {
    /// Build and start a session. `configure` adds outputs (inside begin/commitConfiguration).
    fn start(
        device: Retained<AVCaptureDevice>,
        sink: Sink,
        lock_format: Option<&Resolved>,
        configure: impl FnOnce(&AVCaptureSession, &Delegate, &DispatchQueue) -> Result<(), String>,
    ) -> Result<Self, String> {
        let session = unsafe { AVCaptureSession::new() };
        let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }.map_err(|e| ns_error(&e))?;
        let queue = DispatchQueue::new("studio.camera.samples", None);
        unsafe {
            session.beginConfiguration();
            if !session.canAddInput(&input) {
                session.commitConfiguration();
                return Err("The camera is in use and cannot be recorded right now.".into());
            }
            session.addInput(&input);
        }
        let delegate = Delegate::new(Arc::new(sink));
        let sink = delegate.ivars().clone();
        let mut locked = false;
        if let Some(f) = lock_format {
            // Hold the configuration lock for the whole recording: the format cannot change
            // mid-session, not even from another app.
            unsafe { device.lockForConfiguration() }.map_err(|e| ns_error(&e))?;
            locked = true;
            unsafe {
                device.setActiveFormat(&f.format);
                device.setActiveVideoMinFrameDuration(f.frame);
                device.setActiveVideoMaxFrameDuration(f.frame);
            }
        }
        let configured = configure(&session, &delegate, &queue);
        unsafe { session.commitConfiguration() };
        let capture = Capture { session, device, locked, halted: false, _delegate: delegate, queue, sink };
        configured?;
        unsafe { capture.session.startRunning() };
        if !unsafe { capture.session.isRunning() } {
            return Err("The camera did not start. Another app may be using it.".into());
        }
        // Known once running, before SESSION starts and frames start counting.
        lock(&capture.sink.state).sync = unsafe { capture.session.synchronizationClock() };
        Ok(capture)
    }

    /// Stop the session and wait for in-flight samples. Idempotent.
    fn halt(&mut self) {
        if std::mem::replace(&mut self.halted, true) {
            return;
        }
        unsafe {
            self.session.stopRunning();
            if self.locked {
                self.device.unlockForConfiguration();
            }
        }
        self.queue.exec_sync(|| {});
    }

    /// Stop and finalize the files, the last frame held until source time `end`.
    fn finish(mut self, end: f64) -> Result<(VideoInfo, bool, Vec<Rotation>), String> {
        self.halt();
        self.sink.finish(Some(end))
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.halt();
    }
}

fn add_video_output(session: &AVCaptureSession, delegate: &Delegate, queue: &DispatchQueue, size: Option<(usize, usize)>) -> Result<(), String> {
    let output = unsafe { AVCaptureVideoDataOutput::new() };
    unsafe {
        // NV12 at a fixed size: AVFoundation scales anything else, so the file never changes size.
        output.setVideoSettings(Some(&writer::nv12_attributes(size)));
        output.setAlwaysDiscardsLateVideoFrames(true);
        output.setSampleBufferDelegate_queue(Some(ProtocolObject::from_ref(delegate)), Some(queue));
        if !session.canAddOutput(&output) {
            return Err("The camera cannot deliver video right now.".into());
        }
        session.addOutput(&output);
    }
    Ok(())
}

pub struct CameraRecorder {
    capture: Capture,
}

impl CameraRecorder {
    /// Start recording device `device_id` to `path` (fragmented MP4), timestamps from clock::SESSION.
    pub fn start(device_id: &str, path: &Path) -> Result<Self, String> {
        Self::start_with(device_id, path, DEFAULT_HEIGHT)
    }

    /// Like `start`, at the format closest to `height` (720, 1080, 2160) at 30 fps.
    pub fn start_with(device_id: &str, path: &Path, height: u32) -> Result<Self, String> {
        check_access()?;
        check_dir(path)?;
        let device = find_device(device_id)?;
        if unsafe { device.hasMediaType(AVMediaTypeMuxed.expect("AVMediaTypeMuxed")) } {
            return Err("That is an iPhone or iPad screen, not a camera.".into());
        }
        let f = resolve_format(&device, height).ok_or("That camera reports no video formats.")?;
        let size = (f.width as usize, f.height as usize);
        let sink = Sink::new(&clock::SESSION, path, f.fps, 0.15, Some(size), false);
        let capture = Capture::start(device, sink, Some(&f), |s, d, q| add_video_output(s, d, q, Some(size)))?;
        Ok(Self { capture })
    }

    pub fn pause(&self) {
        self.capture.sink.pause_at(clock::now_ns());
    }

    pub fn resume(&self) {
        self.capture.sink.resume_at(clock::now_ns());
    }

    /// Stop and finalize the file, ending at source time `end` with the rest of the recording.
    pub fn stop(self, end: f64) -> Result<VideoInfo, String> {
        self.capture.finish(end).map(|(info, _, _)| info)
    }
}

/// iPhone/iPad screen and audio over USB, as a recording target (see the module docs).
pub struct DeviceRecorder {
    capture: Capture,
}

impl DeviceRecorder {
    /// Record the device screen to `video_path`, and its audio to `audio_path` when given.
    pub fn start(device_id: &str, video_path: &Path, audio_path: Option<&Path>) -> Result<Self, String> {
        check_access()?;
        check_dir(video_path)?;
        audio_path.map(check_dir).transpose()?;
        let device = find_device(device_id).map_err(|_| "That iPhone or iPad is not connected.".to_string())?;
        if !unsafe { device.hasMediaType(AVMediaTypeMuxed.expect("AVMediaTypeMuxed")) } {
            return Err("That device is not an iPhone or iPad screen.".into());
        }
        let fps = unsafe { device.activeFormat().videoSupportedFrameRateRanges() }
            .iter()
            .map(|r| unsafe { r.maxFrameRate() })
            .fold(0.0, f64::max);
        let mut sink = Sink::new(&clock::SESSION, video_path, if fps > 0.0 { fps } else { 60.0 }, 0.1, None, true);
        sink.audio_path = audio_path.map(Path::to_owned);
        let capture = Capture::start(device, sink, None, |session, delegate, queue| {
            add_video_output(session, delegate, queue, None)?;
            if audio_path.is_none() {
                return Ok(());
            }
            let audio = unsafe { AVCaptureAudioDataOutput::new() };
            unsafe {
                audio.setAudioSettings(Some(&writer::pcm_settings(AUDIO_RATE, 2)));
                audio.setSampleBufferDelegate_queue(Some(ProtocolObject::from_ref(delegate)), Some(queue));
                if session.canAddOutput(&audio) {
                    session.addOutput(&audio);
                }
            }
            Ok(())
        })?;
        Ok(Self { capture })
    }

    pub fn pause(&self) {
        self.capture.sink.pause_at(clock::now_ns());
    }

    pub fn resume(&self) {
        self.capture.sink.resume_at(clock::now_ns());
    }

    pub fn stop(self, end: f64) -> Result<DeviceInfo, String> {
        self.capture.finish(end).map(|(video, audio, rotations)| DeviceInfo { video, audio, rotations })
    }
}

// ---------------------------------------------------------------------------------------------
// Post-recording analysis

#[napi(object)]
pub struct CameraAnalysis {
    /// Absolute path of the grayscale person matte video (same timing as the camera).
    pub matte: String,
    /// Absolute path of the face track JSON: [{t, x, y, w, h}], normalized, top-left origin.
    pub faces: String,
    pub frames: u32,
    /// Face samples (about 10 per second) after gap filling; 0 when no face was ever seen.
    pub face_samples: u32,
}

#[napi(ts_return_type = "Promise<CameraAnalysis>")]
/// Person matte + face track for a camera video, on a background thread. Writes
/// `<outDir>/camera-matte.mp4` and `<outDir>/camera-faces.json` (atomically). Progress is 0..1.
/// Aborting the signal stops it and removes partial output; the promise then rejects.
pub fn analyze_camera<'env>(
    env: &'env Env,
    path: String,
    out_dir: String,
    #[napi(ts_arg_type = "(progress: number) => void")] on_progress: ThreadsafeFunction<f64, (), f64, Status, false, true>,
    signal: Option<AbortSignal>,
) -> napi::Result<PromiseRaw<'env, CameraAnalysis>> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(signal) = signal {
        let cancel = cancel.clone();
        signal.on_abort(move || cancel.store(true, Ordering::SeqCst));
    }
    unsafe extern "C" {
        fn pthread_set_qos_class_self_np(class: u32, relative_priority: i32) -> i32;
    }
    let (done, result) = napi::tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("camera-analysis".into())
        .spawn(move || {
            // QOS_CLASS_UTILITY: the editor's preview and export stay ahead of us.
            unsafe { pthread_set_qos_class_self_np(0x11, 0) };
            let _ = done.send(analyze::analyze(Path::new(&path), Path::new(&out_dir), &cancel, |p| {
                on_progress.call(p, ThreadsafeFunctionCallMode::NonBlocking);
            }));
        })
        .map_err(|e| Error::from_reason(e.to_string()))?;
    env.spawn_future(async move {
        let out = result.await.map_err(|_| Error::from_reason("camera analysis stopped unexpectedly"))?.map_err(Error::from_reason)?;
        Ok(CameraAnalysis {
            matte: out.matte.to_string_lossy().into_owned(),
            faces: out.faces.to_string_lossy().into_owned(),
            frames: out.frames,
            face_samples: out.face_samples,
        })
    })
}

#[cfg(test)]
mod tests;
