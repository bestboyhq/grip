//! Owner: capture (follows the audio skill). Microphones: listing, the toolbar level meter,
//! recording to sources/mic.m4a on the master clock, and voiceover takes the editor records while
//! the video plays. A plain AVCaptureSession: no automatic gain control and no voice processing, so
//! the level is the user's. A mono mic stays mono.
#![cfg_attr(test, allow(dead_code))] // napi exports are only referenced from JS

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use dispatch2::{DispatchQueue, DispatchRetained};
use napi::Env;
use napi::bindgen_prelude::{PromiseRaw, spawn_blocking};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, DefinedClass, define_class, msg_send};
use objc2_av_foundation::{
    AVCaptureAudioDataOutput, AVCaptureAudioDataOutputSampleBufferDelegate, AVCaptureConnection, AVCaptureDevice,
    AVCaptureDeviceDiscoverySession, AVCaptureDeviceInput, AVCaptureDevicePosition, AVCaptureDeviceTypeExternal,
    AVCaptureDeviceTypeMicrophone, AVCaptureOutput, AVCaptureSession, AVMediaTypeAudio,
};
use objc2_core_media::{CMAudioFormatDescriptionGetStreamBasicDescription, CMSampleBuffer};
use objc2_foundation::{NSArray, NSString};

use crate::writer::{AudioWriter, interleaved_f32, ns_error, pcm_settings};
use crate::clock::{SessionClock, now_ns};
use crate::permissions::{Permission, PermissionStatus, missing, permission_status};

pub const RATE: f64 = 48_000.0;
const BUILT_IN: i32 = i32::from_be_bytes(*b"bltn"); // kAudioDeviceTransportTypeBuiltIn

#[napi(object)]
pub struct Microphone {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub is_built_in: bool,
}

fn audio() -> &'static objc2_av_foundation::AVMediaType {
    unsafe { AVMediaTypeAudio }.expect("AVMediaTypeAudio")
}

/// Off the JS thread, like listCameras: device discovery can take AVFoundation a while.
#[napi]
pub async fn list_microphones() -> napi::Result<Vec<Microphone>> {
    spawn_blocking(|| autoreleasepool(|_| microphones())).await.map_err(|e| napi::Error::from_reason(e.to_string()))
}

fn microphones() -> Vec<Microphone> {
    let default =
        unsafe { AVCaptureDevice::defaultDeviceWithMediaType(audio()) }.map(|d| unsafe { d.uniqueID() }.to_string());
    let types =
        NSArray::from_slice(&[unsafe { AVCaptureDeviceTypeMicrophone }, unsafe { AVCaptureDeviceTypeExternal }]);
    let session = unsafe {
        AVCaptureDeviceDiscoverySession::discoverySessionWithDeviceTypes_mediaType_position(
            &types,
            Some(audio()),
            AVCaptureDevicePosition::Unspecified,
        )
    };
    let mut out: Vec<Microphone> = vec![];
    for d in unsafe { session.devices() }.iter() {
        let id = unsafe { d.uniqueID() }.to_string();
        if out.iter().any(|m| m.id == id) {
            continue;
        }
        out.push(Microphone {
            is_default: default.as_deref() == Some(id.as_str()),
            is_built_in: unsafe { d.transportType() } == BUILT_IN,
            name: unsafe { d.localizedName() }.to_string(),
            id,
        });
    }
    out
}

/// The requested mic, or the system default. Errors are one plain line for the user.
fn device(id: Option<&str>) -> Result<Retained<AVCaptureDevice>, String> {
    match permission_status(Permission::Microphone) {
        PermissionStatus::Granted => {}
        _ => return Err(missing(Permission::Microphone).into()),
    }
    let found = match id {
        Some(id) => unsafe { AVCaptureDevice::deviceWithUniqueID(&NSString::from_str(id)) },
        None => unsafe { AVCaptureDevice::defaultDeviceWithMediaType(audio()) },
    };
    found.filter(|d| unsafe { d.isConnected() }).ok_or_else(|| match id {
        Some(_) => "The selected microphone is not connected.".into(),
        None => "No microphone is connected.".into(),
    })
}

/// Native channel count, capped at stereo: a mono mic records mono.
fn channels(d: &AVCaptureDevice) -> usize {
    let fd = unsafe { d.activeFormat().formatDescription() };
    let ch =
        unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&fd).as_ref() }.map_or(1, |a| a.mChannelsPerFrame);
    ch.clamp(1, 2) as usize
}

/// (host time ns of the first sample, interleaved float samples)
type OnPcm = Box<dyn Fn(u64, &[f32]) + Send + Sync>;
/// (source seconds a stretch of about 33 ms starts at, its linear peak 0..1): what a recorder writes,
/// as it writes it.
pub type OnLevel = Box<dyn Fn(f64, f64) + Send + Sync>;

define_class!(
    // SAFETY: NSObject has no subclassing requirements and Delegate does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "StudioMicDelegate"]
    #[ivars = OnPcm]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl AVCaptureAudioDataOutputSampleBufferDelegate for Delegate {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn did_output(&self, _output: &AVCaptureOutput, sb: &CMSampleBuffer, _c: &AVCaptureConnection) {
            let pts = unsafe { sb.presentation_time_stamp() };
            if let (Some(ns), Some((samples, _, _))) = (crate::clock::cm_ns(pts), interleaved_f32(sb)) {
                (self.ivars())(ns, &samples);
            }
        }
    }
);

/// A running capture session on one microphone; stops when dropped.
struct Capture {
    session: Retained<AVCaptureSession>,
    device: Retained<AVCaptureDevice>,
    _output: Retained<AVCaptureAudioDataOutput>,
    _delegate: Retained<Delegate>,
    _queue: DispatchRetained<DispatchQueue>,
}

// SAFETY: AVCaptureSession is thread-safe; the other fields are only kept alive.
unsafe impl Send for Capture {}

impl Capture {
    fn start(device: Retained<AVCaptureDevice>, channels: usize, on_pcm: OnPcm) -> Result<Self, String> {
        let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }
            .map_err(|e| format!("Cannot use the microphone: {}", ns_error(&e)))?;
        let session = unsafe { AVCaptureSession::new() };
        let output = unsafe { AVCaptureAudioDataOutput::new() };
        unsafe { output.setAudioSettings(Some(&pcm_settings(RATE, channels))) };
        let delegate = Delegate::alloc().set_ivars(on_pcm);
        let delegate: Retained<Delegate> = unsafe { msg_send![super(delegate), init] };
        let queue = DispatchQueue::new("studio.mic", None);
        unsafe { output.setSampleBufferDelegate_queue(Some(ProtocolObject::from_ref(&*delegate)), Some(&queue)) };
        unsafe {
            if !session.canAddInput(&input) || !session.canAddOutput(&output) {
                return Err("The microphone is in use by another app or unavailable.".into());
            }
            session.addInput(&input);
            session.addOutput(&output);
            session.startRunning();
        }
        if !unsafe { session.isRunning() } {
            return Err("The microphone did not start.".into());
        }
        Ok(Self { session, device, _output: output, _delegate: delegate, _queue: queue })
    }

    fn connected(&self) -> bool {
        unsafe { self.device.isConnected() }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        unsafe { self.session.stopRunning() };
    }
}

/// Records one microphone to an AAC file stamped by `clock` (clock::SESSION for a recording). Samples
/// before the clock starts and while it is paused are dropped.
pub struct MicRecorder {
    capture: Capture,
    writer: Arc<Mutex<Option<AudioWriter>>>,
    zero_run: Arc<AtomicU64>, // consecutive samples of digital silence
    pub name: String,
    pub built_in: bool,
    pub channels: usize,
}

impl MicRecorder {
    pub fn start(id: Option<&str>, path: &Path, clock: &'static SessionClock, on_level: Option<OnLevel>) -> Result<Self, String> {
        let device = device(id)?;
        let ch = channels(&device);
        let writer = Arc::new(Mutex::new(Some(AudioWriter::new(path, RATE, ch)?)));
        let zero_run = Arc::new(AtomicU64::new(0));
        let (w, z) = (writer.clone(), zero_run.clone());
        let level = on_level.map(|f| (f, Mutex::new((0f32, f64::NAN)))); // peak so far, and where it started
        let on_pcm: OnPcm = Box::new(move |host_ns, samples| {
            if samples.iter().all(|s| *s == 0.0) {
                z.fetch_add((samples.len() / ch) as u64, Ordering::Relaxed);
            } else {
                z.store(0, Ordering::Relaxed);
            }
            let Some(t) = clock.source_secs(host_ns) else { return };
            if let Some(w) = w.lock().unwrap().as_mut() {
                w.push(t, samples);
            }
            if let Some((f, acc)) = &level {
                let mut a = acc.lock().unwrap();
                if a.1.is_nan() {
                    a.1 = t;
                }
                a.0 = samples.iter().fold(a.0, |m, s| m.max(s.abs()));
                let end = t + (samples.len() / ch) as f64 / RATE;
                if end - a.1 >= 0.033 {
                    f(a.1, a.0.min(1.0) as f64);
                    *a = (0.0, end);
                }
            }
        });
        let name = unsafe { device.localizedName() }.to_string();
        let built_in = unsafe { device.transportType() } == BUILT_IN;
        let capture = match Capture::start(device, ch, on_pcm) {
            Ok(c) => c,
            Err(e) => {
                if let Some(w) = writer.lock().unwrap().take() {
                    w.cancel();
                }
                let _ = std::fs::remove_file(path);
                return Err(e);
            }
        };
        Ok(Self { capture, writer, zero_run, name, built_in, channels: ch })
    }

    pub fn connected(&self) -> bool {
        self.capture.connected()
    }

    /// True after 3 s of exact digital silence: a muted interface, or a built-in mic under a closed lid.
    pub fn silent(&self) -> bool {
        self.zero_run.load(Ordering::Relaxed) as f64 > RATE * 3.0
    }

    pub fn error(&self) -> Option<String> {
        self.writer.lock().unwrap().as_ref().and_then(|w| w.error())
    }

    /// Stop and finalize, padded to `end`. Returns the duration.
    pub fn finish(self, end: f64) -> Result<f64, String> {
        drop(self.capture);
        let w = self.writer.lock().unwrap().take().ok_or("Microphone already stopped")?;
        w.finish(end)
    }

    pub fn cancel(self) {
        drop(self.capture);
        if let Some(w) = self.writer.lock().unwrap().take() {
            w.cancel();
        }
    }
}

// ---- Toolbar level meter ----

#[napi(object)]
#[derive(Clone, Copy)]
pub struct MicLevel {
    /// Linear 0..1 over the last ~33 ms.
    pub peak: f64,
    pub rms: f64,
}

static MONITOR: Mutex<Option<Capture>> = Mutex::new(None);
/// Taken on the JS thread by every start and stop. Opening a mic takes a while, so a start keeps
/// its meter only if no later start or stop came meanwhile: otherwise the mic stays on for good.
static MONITOR_GEN: AtomicU64 = AtomicU64::new(0);

/// Meter `micId` (default mic when absent) at ~30 Hz until `stopMicMonitor`. Replaces a running meter.
#[napi(ts_return_type = "Promise<void>")]
pub fn start_mic_monitor<'env>(
    env: &'env Env,
    mic_id: Option<String>,
    on_level: ThreadsafeFunction<MicLevel, (), MicLevel, napi::Status, false>,
) -> napi::Result<PromiseRaw<'env, ()>> {
    let generation = MONITOR_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let acc = Mutex::new((0f32, 0f64, 0usize, 0u64)); // peak, sum of squares, samples, window start
    let on_pcm: OnPcm = Box::new(move |host_ns, samples| {
        let mut a = acc.lock().unwrap();
        if a.3 == 0 {
            a.3 = host_ns;
        }
        for s in samples {
            a.0 = a.0.max(s.abs());
            a.1 += (*s as f64) * (*s as f64);
        }
        a.2 += samples.len();
        if host_ns.saturating_sub(a.3) >= 33_000_000 {
            let level = MicLevel { peak: a.0.min(1.0) as f64, rms: (a.1 / a.2.max(1) as f64).sqrt().min(1.0) };
            on_level.call(level, ThreadsafeFunctionCallMode::NonBlocking);
            *a = (0.0, 0.0, 0, host_ns);
        }
    });
    env.spawn_future(async move {
        spawn_blocking(move || open_monitor(generation, mic_id.as_deref(), on_pcm))
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?
            .map_err(napi::Error::from_reason)
    })
}

/// The meter for start `generation`, unless a later start or stop superseded it.
fn open_monitor(generation: u64, id: Option<&str>, on_pcm: OnPcm) -> Result<(), String> {
    let current = || MONITOR_GEN.load(Ordering::SeqCst) == generation;
    if !current() {
        return Ok(());
    }
    let device = device(id)?;
    let ch = channels(&device);
    let capture = Capture::start(device, ch, on_pcm)?;
    let mut slot = MONITOR.lock().unwrap();
    let old = if current() { slot.replace(capture) } else { Some(capture) };
    drop(slot);
    drop(old); // stops the session outside the lock
    Ok(())
}

#[napi]
pub fn stop_mic_monitor() {
    let old = {
        let mut slot = MONITOR.lock().unwrap();
        MONITOR_GEN.fetch_add(1, Ordering::SeqCst);
        slot.take()
    };
    drop(old); // stops the session outside the lock
}

// ---- Voiceover takes ----
// The editor records a take while the video plays (electron/voiceover.ts). The mic opens during the
// countdown and writes nothing until roll_take names the host time of take second 0: the moment the
// video starts being heard, so every word lands where it was spoken.

static TAKE_CLOCK: SessionClock = SessionClock::new();
static TAKE: Mutex<Option<MicRecorder>> = Mutex::new(None);
/// Taken on the JS thread by every open, finish, and cancel: a take whose mic opened after a later
/// one of them is cancelled, as with the meter.
static TAKE_GEN: AtomicU64 = AtomicU64::new(0);

#[napi(object)]
pub struct TakeMic {
    pub name: String,
    pub channels: u32,
}

#[napi(object)]
pub struct TakeLevel {
    /// Take seconds the stretch starts at.
    pub t: f64,
    /// Linear 0..1 over its ~33 ms.
    pub peak: f64,
}

/// Open `micId` (the default mic when absent) to record a take to `path`, replacing one still open.
/// Once it rolls, `onLevel` hears what it records about 30 times a second. Rejects with one plain
/// line when the mic can't open, or "Voiceover cancelled" after a cancel.
#[napi(ts_return_type = "Promise<TakeMic>")]
pub fn open_take<'env>(
    env: &'env Env,
    mic_id: Option<String>,
    path: String,
    on_level: ThreadsafeFunction<TakeLevel, (), TakeLevel, napi::Status, false>,
) -> napi::Result<PromiseRaw<'env, TakeMic>> {
    let generation = TAKE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    TAKE_CLOCK.start(0);
    let level: OnLevel = Box::new(move |t, peak| {
        on_level.call(TakeLevel { t, peak }, ThreadsafeFunctionCallMode::NonBlocking);
    });
    env.spawn_future(async move {
        spawn_blocking(move || open(generation, mic_id.as_deref(), Path::new(&path), level))
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?
            .map_err(napi::Error::from_reason)
    })
}

fn open(generation: u64, id: Option<&str>, path: &Path, level: OnLevel) -> Result<TakeMic, String> {
    let rec = MicRecorder::start(id, path, &TAKE_CLOCK, Some(level))?;
    let mic = TakeMic { name: rec.name.clone(), channels: rec.channels as u32 };
    let mut slot = TAKE.lock().unwrap();
    let (old, err) = if TAKE_GEN.load(Ordering::SeqCst) == generation { (slot.replace(rec), None) } else { (Some(rec), Some("Voiceover cancelled")) };
    drop(slot);
    if let Some(old) = old {
        old.cancel();
    }
    err.map_or(Ok(mic), |e| Err(e.into()))
}

/// Start writing the open take: its second 0 is host time `atMs` (milliseconds, the clock of
/// `hostNowMs`). Samples captured before it are dropped.
#[napi]
pub fn roll_take(at_ms: f64) {
    TAKE_CLOCK.start((at_ms * 1e6).max(1.0) as u64);
}

/// Stop the take and finalize its file. Resolves with its duration in seconds.
#[napi(ts_return_type = "Promise<number>")]
pub fn finish_take<'env>(env: &'env Env) -> napi::Result<PromiseRaw<'env, f64>> {
    let rec = take_take();
    let end = TAKE_CLOCK.source_secs(now_ns()).unwrap_or(0.0);
    TAKE_CLOCK.start(0);
    env.spawn_future(async move {
        let rec = rec.ok_or_else(|| napi::Error::from_reason("No voiceover is recording."))?;
        spawn_blocking(move || rec.finish(end))
            .await
            .map_err(|e| napi::Error::from_reason(e.to_string()))?
            .map_err(napi::Error::from_reason)
    })
}

/// Stop the take and remove its file.
#[napi]
pub fn cancel_take() {
    if let Some(rec) = take_take() {
        rec.cancel();
    }
    TAKE_CLOCK.start(0);
}

fn take_take() -> Option<MicRecorder> {
    let mut slot = TAKE.lock().unwrap();
    TAKE_GEN.fetch_add(1, Ordering::SeqCst);
    slot.take()
}

/// Host time in milliseconds: the clock a renderer's performance.now() is offset from.
#[napi]
pub fn host_now_ms() -> f64 {
    now_ns() as f64 / 1e6
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::SESSION;

    #[test]
    fn listing_needs_no_permission_and_missing_mic_fails_cleanly() {
        for m in microphones() {
            assert!(!m.id.is_empty() && !m.name.is_empty());
        }
        let err = MicRecorder::start(Some("no-such-mic"), Path::new("/tmp/studio-mic-test.m4a"), &SESSION, None).err().unwrap();
        assert!(err == missing(Permission::Microphone) || err == "The selected microphone is not connected.", "{err}");
        assert!(!err.contains('\n'));
        assert!(!Path::new("/tmp/studio-mic-test.m4a").exists());
    }

    #[test]
    fn a_stop_while_the_meter_opens_keeps_the_mic_off() {
        let generation = MONITOR_GEN.fetch_add(1, Ordering::SeqCst) + 1; // start_mic_monitor on the JS thread
        stop_mic_monitor();
        open_monitor(generation, None, Box::new(|_, _| {})).unwrap();
        assert!(MONITOR.lock().unwrap().is_none());
    }
}
