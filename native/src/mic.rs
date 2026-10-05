//! Owner: capture (follows the audio skill). Microphones: listing, the toolbar level meter, and
//! recording to sources/mic.m4a on the master clock. A plain AVCaptureSession: no automatic gain
//! control and no voice processing, so the level is the user's. A mono mic stays mono.
#![cfg_attr(test, allow(dead_code))] // napi exports are only referenced from JS

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use dispatch2::{DispatchQueue, DispatchRetained};
use napi::bindgen_prelude::spawn_blocking;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use objc2::rc::Retained;
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
use crate::clock::SESSION;
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

#[napi]
pub fn list_microphones() -> Vec<Microphone> {
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

/// Records one microphone to an AAC file stamped by clock::SESSION. Pauses drop samples there.
pub struct MicRecorder {
    capture: Capture,
    writer: Arc<Mutex<Option<AudioWriter>>>,
    zero_run: Arc<AtomicU64>, // consecutive samples of digital silence
    pub name: String,
    pub built_in: bool,
}

impl MicRecorder {
    pub fn start(id: Option<&str>, path: &Path) -> Result<Self, String> {
        let device = device(id)?;
        let ch = channels(&device);
        let writer = Arc::new(Mutex::new(Some(AudioWriter::new(path, RATE, ch)?)));
        let zero_run = Arc::new(AtomicU64::new(0));
        let (w, z) = (writer.clone(), zero_run.clone());
        let on_pcm: OnPcm = Box::new(move |host_ns, samples| {
            if samples.iter().all(|s| *s == 0.0) {
                z.fetch_add((samples.len() / ch) as u64, Ordering::Relaxed);
            } else {
                z.store(0, Ordering::Relaxed);
            }
            if let Some(t) = SESSION.source_secs(host_ns)
                && let Some(w) = w.lock().unwrap().as_mut()
            {
                w.push(t, samples);
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
        Ok(Self { capture, writer, zero_run, name, built_in })
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

    /// Stop and finalize, padded to `end`. Returns the channel count.
    pub fn finish(self, end: f64) -> Result<usize, String> {
        drop(self.capture);
        let w = self.writer.lock().unwrap().take().ok_or("Microphone already stopped")?;
        let ch = w.channels;
        w.finish(end).map(|_| ch)
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

/// Meter `micId` (default mic when absent) at ~30 Hz until `stopMicMonitor`. Replaces a running meter.
#[napi]
pub async fn start_mic_monitor(
    mic_id: Option<String>,
    on_level: ThreadsafeFunction<MicLevel, (), MicLevel, napi::Status, false>,
) -> napi::Result<()> {
    spawn_blocking(move || -> Result<(), String> {
        stop_mic_monitor();
        let device = device(mic_id.as_deref())?;
        let ch = channels(&device);
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
        *MONITOR.lock().unwrap() = Some(Capture::start(device, ch, on_pcm)?);
        Ok(())
    })
    .await
    .map_err(|e| napi::Error::from_reason(e.to_string()))?
    .map_err(napi::Error::from_reason)
}

#[napi]
pub fn stop_mic_monitor() {
    let old = MONITOR.lock().unwrap().take();
    drop(old); // stops the session outside the lock
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listing_needs_no_permission_and_missing_mic_fails_cleanly() {
        for m in list_microphones() {
            assert!(!m.id.is_empty() && !m.name.is_empty());
        }
        let err = MicRecorder::start(Some("no-such-mic"), Path::new("/tmp/studio-mic-test.m4a")).err().unwrap();
        assert!(err == missing(Permission::Microphone) || err == "The selected microphone is not connected.", "{err}");
        assert!(!err.contains('\n'));
        assert!(!Path::new("/tmp/studio-mic-test.m4a").exists());
    }
}
