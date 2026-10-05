//! Owner: capture. The recording session: screen (ScreenCaptureKit or the synthetic source),
//! system audio, mic, camera, and input events, all stamped by clock::SESSION and written
//! crash-safe into `<bundle>/sources/`.
//!
//! One session at a time: idle -> starting -> recording <-> paused -> stopping -> idle.
//! Every call is idempotent: in the wrong state it is a no-op that returns the current state,
//! so key spam and racing callers (toolbar, shortcut, auto-stop on a full disk or a lost display)
//! are safe. Only start/stop/cancel/restart block, and never while holding the session lock.
#![cfg_attr(test, allow(dead_code))] // napi exports are only referenced from JS

pub mod recover;
pub mod sck;
pub mod synthetic;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use napi::bindgen_prelude::spawn_blocking;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use objc2_core_foundation::CFRetained;
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{
    NSArray, NSNumber, NSURL, NSURLVolumeAvailableCapacityForImportantUsageKey, NSURLVolumeAvailableCapacityKey,
};

use crate::camera::{CameraRecorder, DeviceRecorder, Rotation};
use crate::clock::{self, SESSION};
use crate::input::{CaptureGeometry, InputRecorder};
use crate::mic::{self, MicRecorder};
use crate::writer::{AudioWriter, VideoSpec, VideoWriter};

const GB: u64 = 1 << 30;
/// Refuse to start below this much free space.
const MIN_FREE_START: u64 = GB;
/// Warn once below this.
const WARN_FREE: u64 = 3 * GB;
/// Stop and save below this, leaving room to finalize the files.
const STOP_FREE: u64 = 300 << 20;
/// Files a recording writes into `sources/`; cancel deletes exactly these.
const FILES: [&str; 5] = ["screen.mp4", "system.m4a", "mic.m4a", "camera.mp4", "events.jsonl"];

#[napi(string_enum = "lowercase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RecState {
    Idle,
    Starting,
    Recording,
    Paused,
    Stopping,
}

#[napi(object)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// What to record. An area rect is in points relative to its display's top-left corner. A window
/// `frame` (global points) moves and resizes the window there first, which needs Accessibility.
/// A device is an iPhone or iPad over USB (listCameras kind 'ios'); its audio is the system track.
#[napi(discriminant = "kind", discriminant_case = "lowercase")]
#[derive(Clone, Debug)]
pub enum Target {
    Display {
        display_id: u32,
    },
    Window {
        window_id: u32,
        frame: Option<Rect>,
    },
    Area {
        display_id: u32,
        rect: Rect,
    },
    Device {
        device_id: String,
    },
    /// Scrolling test pattern and a tone: for tests and agents without Screen Recording permission.
    Synthetic {
        width: Option<u32>,
        height: Option<u32>,
    },
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct StartOptions {
    /// The `.grip` bundle; files go to `<bundleDir>/sources/`.
    pub bundle_dir: String,
    pub target: Target,
    pub camera_id: Option<String>,
    pub mic_id: Option<String>,
    pub system_audio: bool,
    /// Frames per second; default the display refresh rate, capped at 60.
    pub fps: Option<f64>,
    /// Leave the desktop icons out of display and area recordings.
    pub hide_desktop_icons: Option<bool>,
}

/// Matches VideoSource in src/shared/project.ts.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct VideoSourceInfo {
    pub file: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub scale: f64,
    /// iPhone/iPad rotation changes (see camera::Rotation).
    pub rotations: Option<Vec<Rotation>>,
}

/// Matches AudioSource in src/shared/project.ts.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct AudioSourceInfo {
    pub file: String,
    pub channels: u32,
    pub sample_rate: f64,
}

/// Matches Sources in src/shared/project.ts.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct RecordingSources {
    pub duration: f64,
    pub screen: Option<VideoSourceInfo>,
    pub camera: Option<VideoSourceInfo>,
    pub mic: Option<AudioSourceInfo>,
    pub system: Option<AudioSourceInfo>,
    pub events: Option<String>,
}

#[napi(discriminant = "type", discriminant_case = "lowercase")]
#[derive(Clone, Debug)]
#[allow(clippy::large_enum_variant)] // a handful per recording
pub enum RecordingEvent {
    State {
        state: RecState,
    },
    /// The recording goes on, but something needs the user's attention. Sent once per code.
    /// Codes: camera, input, mic, mic-disconnected, mic-silent, disk-low, finish (a track failed to save).
    Warning {
        code: String,
        message: String,
    },
    /// Files are finalized. reason: user, disk-full, source-lost, error.
    Finished {
        bundle_dir: String,
        reason: String,
        message: Option<String>,
        sources: RecordingSources,
    },
    /// cancel() deleted the recording; the bundle can go.
    Cancelled {
        bundle_dir: String,
    },
}

pub type Emit = Arc<dyn Fn(RecordingEvent) + Send + Sync>;

/// Free bytes on the volume of `dir`. "Important usage" counts purgeable space on APFS but
/// reads 0 on some other volumes (HFS+, disk images), so take the larger of the two.
fn free_bytes(dir: &Path) -> Option<u64> {
    let url = NSURL::from_directory_path(dir)?;
    let keys = unsafe { [NSURLVolumeAvailableCapacityForImportantUsageKey, NSURLVolumeAvailableCapacityKey] };
    let values = url.resourceValuesForKeys_error(&NSArray::from_slice(&keys)).ok()?;
    keys.iter().filter_map(|k| Some(values.objectForKey(k)?.downcast::<NSNumber>().ok()?.as_i64().max(0) as u64)).max()
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / GB as f64)
}

/// Writers and capture state shared with the source callbacks and the monitor thread.
pub struct Tracks {
    video: Mutex<Option<VideoWriter>>,
    system: Mutex<Option<AudioWriter>>,
    geometry: Arc<Mutex<CaptureGeometry>>,
    /// Output pixel size of screen.mp4.
    size: (usize, usize),
    target: Target,
    lost: Mutex<Option<String>>,
}

impl Tracks {
    pub fn video(&self, pb: CFRetained<CVPixelBuffer>, host_ns: u64) {
        let t = SESSION.source_secs(host_ns);
        if let Some(v) = self.video.lock().unwrap().as_mut() {
            v.frame(pb, t);
        }
    }

    pub fn system_audio(&self, host_ns: u64, samples: &[f32], channels: usize, rate: f64) {
        let Some(t) = SESSION.source_secs(host_ns) else { return };
        if let Some(a) = self.system.lock().unwrap().as_mut()
            && a.channels == channels
            && a.rate == rate
        {
            a.push(t, samples);
        }
    }

    /// The source stopped on its own; the monitor finalizes the recording. First reason wins.
    pub fn lose(&self, why: String) {
        self.lost.lock().unwrap().get_or_insert(why);
    }
}

impl synthetic::Sink for Tracks {
    fn video(&self, pb: CFRetained<CVPixelBuffer>, host_ns: u64) {
        Tracks::video(self, pb, host_ns)
    }
    fn system_audio(&self, host_ns: u64, samples: &[f32]) {
        Tracks::system_audio(self, host_ns, samples, 2, 48_000.0)
    }
}

enum Source {
    Sck(sck::Stream),
    Synthetic(synthetic::Source),
    /// Writes screen.mp4 and system.m4a itself, at the device's own size and rate.
    Device(DeviceRecorder),
}

impl Source {
    /// Stop delivering. A device finalizes its files here, until `end`.
    fn stop(self, end: f64) -> Option<Result<crate::camera::DeviceInfo, String>> {
        match self {
            Source::Sck(s) => s.stop(),
            Source::Synthetic(s) => s.stop(),
            Source::Device(d) => return Some(d.stop(end)),
        }
        None
    }
}

struct Recording {
    opts: StartOptions,
    emit: Emit,
    dir: PathBuf,
    tracks: Arc<Tracks>,
    fps: f64,
    scale: f64,
    source: Option<Source>,
    mic: Arc<Mutex<Option<MicRecorder>>>,
    camera: Option<CameraRecorder>,
    input: Option<InputRecorder>,
    monitor: Option<(Arc<AtomicBool>, JoinHandle<()>)>,
    paused_at: Option<f64>,
}

// SAFETY: every field is reached only through the SLOT mutex (or is itself synchronized), so
// Objective-C handles inside (stream, recorders) are never used from two threads at once.
unsafe impl Send for Recording {}

impl Recording {
    fn open(opts: StartOptions, emit: Emit) -> Result<Self, String> {
        let bundle = PathBuf::from(&opts.bundle_dir);
        if !bundle.is_dir() {
            return Err(format!("The project folder does not exist: {}", bundle.display()));
        }
        let dir = bundle.join("sources");
        fs::create_dir_all(&dir).map_err(|e| format!("Cannot write to {}: {e}", dir.display()))?;
        if FILES.iter().any(|f| dir.join(f).exists()) {
            return Err("This project already has a recording.".into());
        }
        let free = free_bytes(&dir).unwrap_or(u64::MAX);
        if free < MIN_FREE_START {
            return Err(format!("Not enough disk space to record: {} free, at least 1 GB is needed.", gb(free)));
        }
        SESSION.start(0); // nothing stamps until the screen source is running
        let (plan, sck) = match opts.target {
            Target::Synthetic { width, height } => {
                let (w, h) =
                    (width.unwrap_or(1920).max(16) as usize & !1, height.unwrap_or(1080).max(16) as usize & !1);
                let geometry = CaptureGeometry { x: 0.0, y: 0.0, w: w as f64, h: h as f64, scale: 1.0 };
                (sck::Plan { width: w, height: h, fps: opts.fps.unwrap_or(30.0).clamp(1.0, 60.0), geometry }, None)
            }
            // The device writes its own screen.mp4 (camera.rs); its size comes with the first frame.
            Target::Device { .. } => (sck::Plan { width: 0, height: 0, fps: 0.0, geometry: Default::default() }, None),
            ref t => {
                let hide_icons = opts.hide_desktop_icons.unwrap_or(false);
                let (filter, config, plan) = sck::prepare(t, opts.fps, opts.system_audio, hide_icons)?;
                (plan, Some((filter, config)))
            }
        };
        let video = match opts.target {
            Target::Device { .. } => None,
            _ => {
                let (width, height, fps) = (plan.width, plan.height, plan.fps);
                let spec = VideoSpec { width, height, fps, bits_per_pixel: 0.12, realtime: true };
                Some(VideoWriter::new(&dir.join("screen.mp4"), spec)?)
            }
        };
        let tracks = Arc::new(Tracks {
            video: Mutex::new(video),
            system: Mutex::new(None),
            geometry: Arc::new(Mutex::new(plan.geometry)),
            size: (plan.width, plan.height),
            target: opts.target.clone(),
            lost: Mutex::new(None),
        });
        let mut rec = Recording {
            fps: plan.fps,
            scale: plan.geometry.scale,
            opts,
            emit,
            dir,
            tracks,
            source: None,
            mic: Arc::new(Mutex::new(None)),
            camera: None,
            input: None,
            monitor: None,
            paused_at: None,
        };
        // From here on a failure undoes everything started so far and deletes its files.
        match rec.start_parts(sck, plan.width, plan.height) {
            Ok(()) => Ok(rec),
            Err(e) => {
                rec.cancel();
                Err(e)
            }
        }
    }

    fn start_parts(
        &mut self,
        sck: Option<(
            objc2::rc::Retained<objc2_screen_capture_kit::SCContentFilter>,
            objc2::rc::Retained<objc2_screen_capture_kit::SCStreamConfiguration>,
        )>,
        width: usize,
        height: usize,
    ) -> Result<(), String> {
        let device = match &self.opts.target {
            Target::Device { device_id } => Some(device_id.clone()),
            _ => None,
        };
        if self.opts.system_audio && device.is_none() {
            *self.tracks.system.lock().unwrap() = Some(AudioWriter::new(&self.dir.join("system.m4a"), 48_000.0, 2)?);
        }
        // Mic, camera, and input start first (devices warm up); they stamp nothing until SESSION starts.
        if let Some(id) = &self.opts.mic_id {
            match MicRecorder::start(Some(id), &self.dir.join("mic.m4a")) {
                Ok(m) => *self.mic.lock().unwrap() = Some(m),
                Err(e) => self.warn("mic", format!("Recording without the microphone. {e}")),
            }
        }
        if let Some(id) = &self.opts.camera_id {
            match CameraRecorder::start(id, &self.dir.join("camera.mp4")) {
                Ok(c) => self.camera = Some(c),
                Err(e) => self.warn("camera", format!("Recording without the camera: {e}")),
            }
        }
        // The pointer and keys are the Mac's: an iPhone or iPad screen has none of them.
        if device.is_none() {
            match InputRecorder::start(&self.dir, self.tracks.geometry.clone()) {
                Ok(r) => {
                    if let Some(why) = r.warning() {
                        self.warn("input", why.into());
                    }
                    self.input = Some(r);
                }
                Err(e) => self.warn("input", format!("The cursor, clicks, and keys are not recorded: {e}")),
            }
        }
        self.source = Some(match (sck, device) {
            (Some((filter, config)), _) => {
                Source::Sck(sck::Stream::start(&filter, &config, self.tracks.clone(), self.opts.system_audio)?)
            }
            (None, Some(id)) => {
                let audio = self.opts.system_audio.then(|| self.dir.join("system.m4a"));
                Source::Device(DeviceRecorder::start(&id, &self.dir.join("screen.mp4"), audio.as_deref())?)
            }
            (None, None) => Source::Synthetic(synthetic::Source::start(
                self.tracks.clone(),
                width,
                height,
                self.fps,
                self.opts.system_audio,
            )),
        });
        SESSION.start(clock::now_ns());
        self.monitor = Some(self.spawn_monitor());
        Ok(())
    }

    fn warn(&self, code: &str, message: String) {
        (self.emit)(RecordingEvent::Warning { code: code.into(), message });
    }

    fn pause(&mut self) {
        let now = clock::now_ns();
        self.paused_at = SESSION.source_secs(now);
        SESSION.pause(now);
        if let Some(c) = &self.camera {
            c.pause();
        }
        if let Some(Source::Device(d)) = &self.source {
            d.pause();
        }
    }

    fn resume(&mut self) {
        SESSION.resume(clock::now_ns());
        self.paused_at = None;
        if let Some(c) = &self.camera {
            c.resume();
        }
        if let Some(Source::Device(d)) = &self.source {
            d.resume();
        }
        // The screen may have changed while paused without sending a frame since: show it now.
        if let (Some(t), Some(v)) = (SESSION.source_secs(clock::now_ns()), self.tracks.video.lock().unwrap().as_mut()) {
            v.append(t);
        }
    }

    /// Heartbeat for still screens, plus everything that ends a recording on its own.
    fn spawn_monitor(&self) -> (Arc<AtomicBool>, JoinHandle<()>) {
        let quit = Arc::new(AtomicBool::new(false));
        let (s, tracks, mic, emit, dir) =
            (quit.clone(), self.tracks.clone(), self.mic.clone(), self.emit.clone(), self.dir.clone());
        let handle = thread::spawn(move || {
            let mut warned: Vec<&str> = vec![];
            let mut warn = |code: &'static str, message: String| {
                if !warned.contains(&code) {
                    warned.push(code);
                    emit(RecordingEvent::Warning { code: code.into(), message });
                }
            };
            for tick in 0u64.. {
                thread::sleep(Duration::from_millis(100));
                if s.load(Ordering::SeqCst) {
                    return;
                }
                if let Some(t) = SESSION.source_secs(clock::now_ns())
                    && let Some(v) = tracks.video.lock().unwrap().as_mut()
                {
                    v.heartbeat(t);
                }
                if tick % 5 != 0 {
                    continue;
                }
                if let Some(why) = sck::lost(&tracks.target) {
                    tracks.lose(why.into());
                }
                let write_error = tracks
                    .video
                    .lock()
                    .unwrap()
                    .as_ref()
                    .and_then(|v| v.error())
                    .or_else(|| tracks.system.lock().unwrap().as_ref().and_then(|a| a.error()));
                let free = free_bytes(&dir);
                let end = if free.is_some_and(|f| f < STOP_FREE) {
                    Some(("disk-full", "The disk is almost full, so the recording was stopped and saved.".to_string()))
                } else if let Some(why) = tracks.lost.lock().unwrap().clone() {
                    Some(("source-lost", format!("{why} The recording was saved.")))
                } else {
                    write_error.map(|e| ("error", format!("Writing the recording failed: {e}")))
                };
                if let Some((reason, message)) = end {
                    // Stop from another thread: stopping joins this one.
                    thread::spawn(move || self::stop(reason, Some(message)));
                    return;
                }
                if let Some(f) = free.filter(|f| *f < WARN_FREE) {
                    warn(
                        "disk-low",
                        format!(
                            "Disk space is low ({} free). The recording stops and saves itself before the disk is full.",
                            gb(f)
                        ),
                    );
                }
                if let Some(m) = mic.lock().unwrap().as_ref() {
                    if let Some(e) = m.error() {
                        warn("mic", format!("The microphone track could not be written: {e}"));
                    } else if !m.connected() {
                        warn(
                            "mic-disconnected",
                            format!(
                                "The microphone \"{}\" was disconnected. The recording goes on without it.",
                                m.name
                            ),
                        );
                    } else if m.silent() {
                        let why = if m.built_in { " Is the lid closed?" } else { " Is it muted?" };
                        warn("mic-silent", format!("The microphone \"{}\" is sending no sound.{why}", m.name));
                    }
                }
            }
        });
        (quit, handle)
    }

    fn stop_monitor(&mut self) {
        if let Some((stop, handle)) = self.monitor.take() {
            stop.store(true, Ordering::SeqCst);
            let _ = handle.join();
        }
    }

    /// Stop everything and finalize the files. Returns the sources and the final reason/message.
    fn finish(mut self, reason: &str, message: Option<String>) -> (RecordingSources, String, Option<String>) {
        // Freeze the clock first: every track drops what arrives from here on, so all end together.
        let now = clock::now_ns();
        let end = self.paused_at.or_else(|| SESSION.source_secs(now)).unwrap_or(0.0);
        SESSION.pause(now);
        // Stopped right after starting: give the source a moment to deliver its first frame.
        for _ in 0..50 {
            if self.tracks.video.lock().unwrap().as_ref().is_none_or(|v| v.has_frame()) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        self.stop_monitor();
        let device = self.source.take().and_then(|s| s.stop(end));
        let rel = |f: &str| format!("sources/{f}");
        let mut problems: Vec<String> = vec![];
        let events = match self.input.take().map(|i| i.stop()) {
            Some(Ok(())) if self.dir.join("events.jsonl").exists() => Some(rel("events.jsonl")),
            Some(Err(e)) => {
                problems.push(format!("Input events: {e}"));
                None
            }
            _ => None,
        };
        let camera = match self.camera.take().map(|c| c.stop(end)) {
            Some(Ok(v)) => Some(VideoSourceInfo {
                file: rel("camera.mp4"),
                width: v.width,
                height: v.height,
                fps: v.fps,
                scale: 1.0,
                rotations: None,
            }),
            Some(Err(e)) => {
                problems.push(format!("Camera: {e}"));
                None
            }
            None => None,
        };
        let audio = |r: Result<usize, String>, f: &str, problems: &mut Vec<String>| match r {
            Ok(ch) => Some(AudioSourceInfo { file: rel(f), channels: ch as u32, sample_rate: mic::RATE }),
            Err(e) => {
                problems.push(format!("{f}: {e}"));
                None
            }
        };
        let taken = self.mic.lock().unwrap().take();
        let mic = taken.and_then(|m| audio(m.finish(end), "mic.m4a", &mut problems));
        let taken = self.tracks.system.lock().unwrap().take();
        let mut system = taken.and_then(|a| {
            let ch = a.channels;
            audio(a.finish(end).map(|_| ch), "system.m4a", &mut problems)
        });
        let taken = self.tracks.video.lock().unwrap().take();
        let (w, h) = self.tracks.size;
        let video = |width, height, fps, scale, rotations| VideoSourceInfo {
            file: rel("screen.mp4"),
            width,
            height,
            fps,
            scale,
            rotations,
        };
        let (screen, duration) = match (device, taken.map(|v| v.finish(end))) {
            (Some(Ok(d)), _) => {
                if d.audio {
                    system = Some(AudioSourceInfo { file: rel("system.m4a"), channels: 2, sample_rate: mic::RATE });
                }
                let v = d.video;
                let rotations = (!d.rotations.is_empty()).then_some(d.rotations);
                (Some(video(v.width, v.height, v.fps, 1.0, rotations)), v.duration)
            }
            (None, Some(Ok(d))) => (Some(video(w as u32, h as u32, self.fps, self.scale, None)), d),
            (Some(Err(e)), _) | (None, Some(Err(e))) => {
                problems.push(e);
                (None, end)
            }
            (None, None) => (None, end),
        };
        SESSION.start(0);
        let sources = RecordingSources { duration, screen, camera, mic, system, events };
        match (sources.screen.is_some(), problems.is_empty()) {
            (true, true) => (sources, reason.to_string(), message),
            (true, false) => {
                self.warn("finish", format!("Some tracks could not be saved. {}", problems.join(" ")));
                (sources, reason.to_string(), message)
            }
            // A writer that failed mid-way (disk full) left its fragments: make them whole.
            (false, _) => match self.dir.parent().map(recover::recover) {
                Some(Ok(s)) => {
                    let why = format!("Writing the recording failed, so it ends early. {}", problems.join(" "));
                    (s, "error".into(), Some(why))
                }
                _ => (sources, "error".into(), Some(format!("Nothing was recorded. {}", problems.join(" ")))),
            },
        }
    }

    /// Stop everything and delete what was recorded.
    fn cancel(mut self) {
        self.stop_monitor();
        let _ = self.source.take().and_then(|s| s.stop(0.0));
        if let Some(i) = self.input.take() {
            let _ = i.stop();
        }
        if let Some(c) = self.camera.take() {
            let _ = c.stop(0.0);
        }
        if let Some(m) = self.mic.lock().unwrap().take() {
            m.cancel();
        }
        if let Some(a) = self.tracks.system.lock().unwrap().take() {
            a.cancel();
        }
        if let Some(v) = self.tracks.video.lock().unwrap().take() {
            v.cancel();
        }
        SESSION.start(0);
        for f in FILES {
            let _ = fs::remove_file(self.dir.join(f));
        }
        let _ = fs::remove_dir_all(self.dir.join("cursors"));
    }
}

struct Slot {
    state: RecState,
    rec: Option<Recording>,
}

static SLOT: Mutex<Slot> = Mutex::new(Slot { state: RecState::Idle, rec: None });

fn slot() -> MutexGuard<'static, Slot> {
    SLOT.lock().unwrap_or_else(|e| e.into_inner())
}

fn set(s: &mut Slot, state: RecState, emit: &Emit) -> RecState {
    s.state = state;
    emit(RecordingEvent::State { state });
    state
}

pub fn state() -> RecState {
    slot().state
}

pub fn start(opts: StartOptions, emit: Emit) -> Result<RecState, String> {
    {
        let mut s = slot();
        if s.state != RecState::Idle {
            return Ok(s.state);
        }
        set(&mut s, RecState::Starting, &emit);
    }
    let r = Recording::open(opts, emit.clone());
    let mut s = slot();
    match r {
        Ok(rec) => {
            s.rec = Some(rec);
            Ok(set(&mut s, RecState::Recording, &emit))
        }
        Err(e) => {
            set(&mut s, RecState::Idle, &emit);
            Err(e)
        }
    }
}

pub fn pause() -> RecState {
    let mut s = slot();
    if s.state != RecState::Recording {
        return s.state;
    }
    let rec = s.rec.as_mut().expect("recording");
    rec.pause();
    let emit = rec.emit.clone();
    set(&mut s, RecState::Paused, &emit)
}

pub fn resume() -> RecState {
    let mut s = slot();
    if s.state != RecState::Paused {
        return s.state;
    }
    let rec = s.rec.as_mut().expect("recording");
    rec.resume();
    let emit = rec.emit.clone();
    set(&mut s, RecState::Recording, &emit)
}

/// Take the running recording out of the slot, moving to `next`. None when nothing is running.
fn take(next: RecState) -> Result<Recording, RecState> {
    let mut s = slot();
    if !matches!(s.state, RecState::Recording | RecState::Paused) {
        return Err(s.state);
    }
    let rec = s.rec.take().expect("recording");
    set(&mut s, next, &rec.emit);
    Ok(rec)
}

/// Finalize the recording. None when there was nothing to stop.
pub fn stop(reason: &str, message: Option<String>) -> Option<RecordingSources> {
    let rec = take(RecState::Stopping).ok()?;
    let (emit, bundle_dir) = (rec.emit.clone(), rec.opts.bundle_dir.clone());
    let (sources, reason, message) = rec.finish(reason, message);
    emit(RecordingEvent::Finished { bundle_dir, reason, message, sources: sources.clone() });
    set(&mut slot(), RecState::Idle, &emit);
    Some(sources)
}

/// Discard the recording and its files.
pub fn cancel() -> RecState {
    match take(RecState::Stopping) {
        Ok(rec) => {
            let (emit, bundle_dir) = (rec.emit.clone(), rec.opts.bundle_dir.clone());
            rec.cancel();
            emit(RecordingEvent::Cancelled { bundle_dir });
            set(&mut slot(), RecState::Idle, &emit)
        }
        Err(state) => state,
    }
}

/// Discard the recording and start over with the same options.
pub fn restart() -> Result<RecState, String> {
    let rec = match take(RecState::Starting) {
        Ok(rec) => rec,
        Err(state) => return Ok(state),
    };
    let (opts, emit) = (rec.opts.clone(), rec.emit.clone());
    rec.cancel();
    let r = Recording::open(opts, emit.clone());
    let mut s = slot();
    match r {
        Ok(rec) => {
            s.rec = Some(rec);
            Ok(set(&mut s, RecState::Recording, &emit))
        }
        Err(e) => {
            set(&mut s, RecState::Idle, &emit);
            Err(e)
        }
    }
}

// ---- napi ----

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> napi::Result<T> {
    spawn_blocking(f).await.map_err(|e| napi::Error::from_reason(e.to_string()))?.map_err(napi::Error::from_reason)
}

#[napi]
pub fn recording_state() -> RecState {
    state()
}

/// Start recording. Resolves with the state once capture runs, rejects with a one-line reason.
/// `onEvent` receives state changes, warnings, and the finished recording (also when it ends on its own).
#[napi]
pub async fn start_recording(
    options: StartOptions,
    on_event: ThreadsafeFunction<RecordingEvent, (), RecordingEvent, napi::Status, false>,
) -> napi::Result<RecState> {
    let on_event = Arc::new(on_event);
    let emit: Emit = Arc::new(move |e| {
        on_event.call(e, ThreadsafeFunctionCallMode::NonBlocking);
    });
    blocking(move || start(options, emit)).await
}

#[napi]
pub fn pause_recording() -> RecState {
    pause()
}

#[napi]
pub fn resume_recording() -> RecState {
    resume()
}

/// Stop and finalize. Resolves with the sources (null when nothing was recording).
#[napi]
pub async fn stop_recording() -> napi::Result<Option<RecordingSources>> {
    blocking(|| Ok(stop("user", None))).await
}

#[napi]
pub async fn cancel_recording() -> napi::Result<RecState> {
    blocking(|| Ok(cancel())).await
}

#[napi]
pub async fn restart_recording() -> napi::Result<RecState> {
    blocking(restart).await
}

#[napi]
pub fn list_displays() -> Vec<sck::Display> {
    sck::displays()
}

#[napi]
pub async fn list_windows() -> napi::Result<Vec<sck::Window>> {
    blocking(sck::windows).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::serial;
    use std::process::Command;
    use std::time::Instant;

    /// A fresh bundle with a hostile name.
    fn bundle(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("studio-capture-tests/{tag} #1 ✨ café.grip"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn events() -> (Emit, Arc<Mutex<Vec<RecordingEvent>>>) {
        let log = Arc::new(Mutex::new(vec![]));
        let l = log.clone();
        (Arc::new(move |e| l.lock().unwrap().push(e)), log)
    }

    fn synthetic(dir: &Path, audio: bool) -> StartOptions {
        StartOptions {
            bundle_dir: dir.to_string_lossy().into(),
            target: Target::Synthetic { width: Some(1280), height: Some(720) },
            camera_id: None,
            mic_id: None,
            system_audio: audio,
            fps: Some(30.0),
            hide_desktop_icons: None,
        }
    }

    fn probe(file: &Path, entries: &str) -> String {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-of", "csv=p=0", "-show_entries", entries])
            .arg(file)
            .output()
            .expect("ffprobe");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn duration(file: &Path) -> f64 {
        probe(file, "format=duration").parse().unwrap_or(0.0)
    }

    /// Decodes every frame, start to end, without a single error.
    pub(super) fn decodes(file: &Path) -> bool {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0"])
            .arg(file)
            .output()
            .unwrap();
        let frames: u64 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0);
        let ok = out.status.success() && out.stderr.is_empty() && frames > 0;
        if !ok {
            eprintln!("{}: {frames} frames, {}", file.display(), String::from_utf8_lossy(&out.stderr));
        }
        ok
    }

    fn sleep(s: f64) {
        thread::sleep(Duration::from_secs_f64(s));
    }

    #[test]
    fn records_pauses_and_stops_into_playable_gapless_files() {
        let _g = serial();
        let dir = bundle("pause");
        let (emit, log) = events();
        assert_eq!(start(synthetic(&dir, true), emit.clone()), Ok(RecState::Recording));
        sleep(1.5);
        assert_eq!(pause(), RecState::Paused);
        assert_eq!(pause(), RecState::Paused, "idempotent");
        sleep(1.0);
        assert_eq!(resume(), RecState::Recording);
        sleep(1.0);
        let s = stop("user", None).expect("stopped");
        assert_eq!(state(), RecState::Idle);
        assert!(stop("user", None).is_none(), "second stop is a no-op");

        assert!((s.duration - 2.5).abs() < 0.25, "pause removed from the timeline: {}", s.duration);
        let screen = dir.join("sources/screen.mp4");
        let system = dir.join("sources/system.m4a");
        assert_eq!(probe(&screen, "stream=codec_name,width,height"), "hevc,1280,720");
        assert!((duration(&screen) - s.duration).abs() < 0.05, "{} vs {}", duration(&screen), s.duration);
        assert!((duration(&system) - s.duration).abs() < 0.05, "tracks end together: {}", duration(&system));
        assert!(decodes(&screen) && decodes(&system));
        // No hole where the pause was: frames keep coming at 30 fps.
        let mut pts: Vec<f64> = probe(&screen, "packet=pts_time").lines().filter_map(|l| l.parse().ok()).collect();
        pts.sort_by(f64::total_cmp);
        let gap = pts.windows(2).map(|w| w[1] - w[0]).fold(0.0, f64::max);
        assert!(gap < 0.2, "largest frame gap {gap}");
        assert!(pts.len() > 60, "{} frames", pts.len());

        // Input events ran on the session clock: the pointer is there from the start, nothing
        // lands in the pause or after the end.
        assert_eq!(s.events.as_deref(), Some("sources/events.jsonl"));
        let text = fs::read_to_string(dir.join("sources/events.jsonl")).unwrap();
        let ev: Vec<serde_json::Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        let first_move = ev.iter().find(|e| e["type"] == "move").expect("pointer position").clone();
        assert!(first_move["t"].as_f64().unwrap() < 0.1, "{first_move}");
        assert!(ev.iter().all(|e| e["t"].as_f64().unwrap() <= s.duration), "events end with the recording");
        let s = s.screen.unwrap();
        assert_eq!((s.file.as_str(), s.width, s.height, s.fps), ("sources/screen.mp4", 1280, 720, 30.0));
        let log = log.lock().unwrap();
        // The input recorder's permission warning reaches the recorder UI as a recording warning.
        use crate::permissions::{Permission, PermissionStatus, permission_status};
        let keys = [Permission::InputMonitoring, Permission::Accessibility]
            .iter()
            .any(|p| permission_status(*p) == PermissionStatus::Granted);
        let warned = log.iter().find_map(|e| match e {
            RecordingEvent::Warning { code, message } if code == "input" => Some(message.clone()),
            _ => None,
        });
        assert_eq!(warned.is_some(), !keys, "{warned:?}");
        assert!(warned.is_none_or(|m| m.contains("Input Monitoring") && !m.contains('\n')));
        assert!(matches!(log.iter().rev().find(|e| matches!(e, RecordingEvent::Finished { .. })),
            Some(RecordingEvent::Finished { reason, .. }) if reason == "user"));
    }

    #[test]
    fn still_screen_keeps_duration_and_starts_with_real_content() {
        let _g = serial();
        let dir = bundle("still");
        let file = dir.join("screen.mp4");
        let pattern = synthetic::Pattern::new(640, 360);
        let spec = VideoSpec { width: 640, height: 360, fps: 30.0, bits_per_pixel: 0.12, realtime: true };
        let mut v = VideoWriter::new(&file, spec).unwrap();
        // The only frame arrives before the clock starts, like ScreenCaptureKit's first frame.
        v.frame(pattern.frame(0).unwrap(), None);
        for i in 1..30 {
            v.heartbeat(i as f64 * 0.1); // the monitor's 100 ms tick, 5x faster than real time
            sleep(0.02);
        }
        assert_eq!(v.finish(3.0), Ok(3.0));
        assert!((duration(&file) - 3.0).abs() < 0.05, "{}", duration(&file));
        assert!(decodes(&file));
        let frames = probe(&file, "packet=pts_time").lines().count();
        assert!(frames >= 6, "repeated at least every 0.5 s: {frames}");
        // The first frame is the pattern (white page, dark text), not black.
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(&file)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
                "-f",
                "null",
                "-",
            ])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        let yavg: f64 =
            text.split("YAVG=").nth(1).and_then(|s| s.split_whitespace().next()?.parse().ok()).unwrap_or(0.0);
        assert!(yavg > 150.0, "first frame luma {yavg}: {text}");
    }

    /// Child half of `kill_9_leaves_playable_files`: records until killed.
    #[test]
    #[ignore]
    fn child_records_until_killed() {
        let Ok(dir) = std::env::var("STUDIO_CHILD_BUNDLE") else { return };
        let (emit, _) = events();
        start(synthetic(Path::new(&dir), true), emit).unwrap();
        loop {
            sleep(1.0);
        }
    }

    #[test]
    fn kill_9_leaves_playable_files() {
        let _g = serial();
        let dir = bundle("kill9");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "capture::tests::child_records_until_killed", "--ignored", "--nocapture"])
            .env("STUDIO_CHILD_BUNDLE", &dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let t0 = Instant::now();
        while !dir.join("sources/screen.mp4").exists() && t0.elapsed() < Duration::from_secs(10) {
            sleep(0.05);
        }
        sleep(3.5);
        child.kill().unwrap(); // SIGKILL: no chance to finalize
        child.wait().unwrap();
        for f in ["sources/screen.mp4", "sources/system.m4a"] {
            let file = dir.join(f);
            let d = duration(&file);
            assert!(d >= 2.0, "{f}: lost at most ~1 s, kept {d}");
            assert!(decodes(&file), "{f} decodes");
            assert!(recover::is_fragmented(&file), "{f} was cut mid-fragment");
        }
        // Recovery turns them into regular files the editor reads to the end.
        let s = recover::recover(&dir).unwrap();
        assert!(s.duration >= 2.0, "{}", s.duration);
        let screen = s.screen.unwrap();
        assert_eq!((screen.width, screen.height, screen.fps), (1280, 720, 30.0));
        assert_eq!(s.system.map(|a| (a.channels, a.sample_rate)), Some((2, 48_000.0)));
        for f in ["sources/screen.mp4", "sources/system.m4a"] {
            let file = dir.join(f);
            assert!(!recover::is_fragmented(&file) && decodes(&file) && duration(&file) >= 2.0, "{f} recovered");
        }
        assert!(!dir.join("sources/screen.recovering.mp4").exists());
    }

    #[test]
    fn start_stop_spam_is_safe() {
        let _g = serial();
        let root = bundle("spam");
        let (emit, log) = events();
        let n = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let threads: Vec<_> = (0..6)
            .map(|k| {
                let (emit, root, n) = (emit.clone(), root.clone(), n.clone());
                thread::spawn(move || {
                    for i in 0..25usize {
                        match (k * 7 + i * 13) % 6 {
                            0 | 1 => {
                                let dir = root.join(format!("{}.grip", n.fetch_add(1, Ordering::SeqCst)));
                                fs::create_dir_all(&dir).unwrap();
                                let _ = start(synthetic(&dir, k % 2 == 0), emit.clone());
                            }
                            2 => {
                                stop("user", None);
                            }
                            3 => {
                                pause();
                                resume();
                            }
                            4 => {
                                cancel();
                            }
                            _ => {
                                let _ = restart();
                            }
                        }
                        sleep(0.02 * (i % 4) as f64);
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().expect("no panic");
        }
        stop("user", None);
        assert_eq!(state(), RecState::Idle);

        let log = log.lock().unwrap();
        // State changes are emitted under the session lock, so the log is the true sequence.
        let mut prev = RecState::Idle;
        for e in log.iter() {
            if let RecordingEvent::State { state } = e {
                use RecState::*;
                let ok = matches!(
                    (prev, *state),
                    (Idle, Starting)
                        | (Starting, Recording)
                        | (Starting, Idle)
                        | (Recording, Paused)
                        | (Paused, Recording)
                        | (Recording | Paused, Stopping)
                        | (Recording | Paused, Starting)
                        | (Stopping, Idle)
                );
                assert!(ok, "{prev:?} -> {state:?}");
                prev = *state;
            }
        }
        let finished: Vec<_> = log
            .iter()
            .filter_map(|e| match e {
                RecordingEvent::Finished { bundle_dir, sources, .. } => Some((bundle_dir.clone(), sources.clone())),
                _ => None,
            })
            .collect();
        assert!(!finished.is_empty(), "some recordings finished");
        for (b, s) in &finished {
            assert!(s.screen.is_some(), "{b}");
            assert!(decodes(&Path::new(b).join("sources/screen.mp4")), "{b} playable");
        }
        // Every bundle is either a finished recording or empty (cancelled, restarted, refused).
        for entry in fs::read_dir(&root).unwrap() {
            let b = entry.unwrap().path();
            let kept = finished.iter().any(|(f, _)| Path::new(f) == b);
            assert_eq!(kept, b.join("sources/screen.mp4").exists(), "{}", b.display());
        }
    }

    #[test]
    fn missing_screen_permission_fails_with_one_clean_line() {
        let _g = serial();
        if objc2_core_graphics::CGPreflightScreenCaptureAccess() {
            return; // this machine granted it; the denied path cannot be exercised here
        }
        let dir = bundle("denied");
        let (emit, _) = events();
        let main = objc2_core_graphics::CGMainDisplayID();
        for target in [
            Target::Display { display_id: main },
            Target::Window { window_id: 1, frame: None },
            Target::Area { display_id: main, rect: Rect { x: 0.0, y: 0.0, w: 400.0, h: 300.0 } },
        ] {
            let opts = StartOptions { target, ..synthetic(&dir, true) };
            let err = start(opts, emit.clone()).unwrap_err();
            assert_eq!(err, crate::permissions::missing(crate::permissions::Permission::Screen));
            assert_eq!(state(), RecState::Idle);
            assert_eq!(fs::read_dir(dir.join("sources")).map_or(0, |d| d.count()), 0, "nothing left behind");
        }
        assert_eq!(sck::windows().unwrap_err(), crate::permissions::missing(crate::permissions::Permission::Screen));
        assert!(!sck::displays().is_empty(), "displays list without permission");
    }

    /// Moving a window needs Accessibility; without it the reason is one line, and nothing moves.
    #[test]
    fn window_placement_without_accessibility_fails_cleanly() {
        use crate::permissions::{Permission, PermissionStatus, missing, permission_status};
        if permission_status(Permission::Accessibility) == PermissionStatus::Granted {
            return; // granted here: the denied path cannot be exercised
        }
        let err = sck::place_window(1, Rect { x: 0.0, y: 0.0, w: 800.0, h: 600.0 }).unwrap_err();
        assert_eq!(err, missing(Permission::Accessibility));
    }

    /// An iPhone or iPad target that is not there fails in one line and leaves nothing behind.
    #[test]
    fn missing_device_fails_cleanly() {
        let _g = serial();
        let dir = bundle("device");
        let (emit, log) = events();
        let target = Target::Device { device_id: "no-such-iphone".into() };
        let err = start(StartOptions { target, ..synthetic(&dir, true) }, emit).unwrap_err();
        assert!(!err.is_empty() && !err.contains('\n'), "{err}");
        assert_eq!(state(), RecState::Idle);
        assert_eq!(fs::read_dir(dir.join("sources")).map_or(0, |d| d.count()), 0, "nothing left behind");
        assert!(!log.lock().unwrap().iter().any(|e| matches!(e, RecordingEvent::Warning { code, .. } if code == "input")));
    }

    /// Small disk images: refused below 1 GB free; a disk that fills up mid-recording ends it cleanly.
    #[test]
    fn full_disk_refuses_to_start_and_stops_cleanly() {
        let _g = serial();
        let root = std::env::temp_dir().join("studio-capture-tests/disk");
        let detach = |mnt: &Path| {
            for force in [false, false, false, true] {
                let args: &[&str] = if force { &["detach", "-quiet", "-force"] } else { &["detach", "-quiet"] };
                if Command::new("hdiutil").args(args).arg(mnt).status().is_ok_and(|s| s.success()) {
                    return;
                }
                sleep(0.5);
            }
        };
        for stale in ["small", "big"] {
            if root.join(stale).join(".").exists()
                && fs::read_dir(root.join(stale)).is_ok_and(|mut d| d.next().is_some())
            {
                detach(&root.join(stale));
            }
        }
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let mount = |size: &str, name: &str| -> Option<PathBuf> {
            let image = root.join(format!("{name}.sparseimage"));
            let mnt = root.join(name);
            let run = |args: &[&str], path: &Path| {
                Command::new("hdiutil").args(args).arg(path).status().is_ok_and(|s| s.success())
            };
            let created =
                run(&["create", "-quiet", "-size", size, "-fs", "HFS+", "-type", "SPARSE", "-volname", name], &image);
            let attached = created
                && Command::new("hdiutil")
                    .args(["attach", "-quiet", "-nobrowse", "-mountpoint"])
                    .arg(&mnt)
                    .arg(&image)
                    .status()
                    .is_ok_and(|s| s.success());
            attached.then_some(mnt)
        };
        let Some(small) = mount("200m", "small") else { return }; // no hdiutil here: skip
        let dir = small.join("Tiny #1.grip");
        fs::create_dir_all(&dir).unwrap();
        let (emit, _) = events();
        let err = start(synthetic(&dir, false), emit).unwrap_err();
        detach(&small);
        assert!(err.starts_with("Not enough disk space to record"), "{err}");
        assert_eq!(state(), RecState::Idle);

        let big = mount("1500m", "big").expect("mount");
        let dir = big.join("Full #1.grip");
        fs::create_dir_all(&dir).unwrap();
        let (emit, log) = events();
        start(synthetic(&dir, true), emit).unwrap();
        sleep(1.0);
        // Something else eats the disk until ~200 MB are left.
        let free = free_bytes(&dir).unwrap();
        fs::File::create(big.join("filler")).unwrap().set_len(free - (200 << 20)).unwrap();
        let t0 = Instant::now();
        while state() != RecState::Idle && t0.elapsed() < Duration::from_secs(10) {
            sleep(0.1);
        }
        let warned =
            log.lock().unwrap().iter().any(|e| matches!(e, RecordingEvent::Warning { code, .. } if code == "disk-low"));
        let finished = log.lock().unwrap().iter().find_map(|e| match e {
            RecordingEvent::Finished { reason, sources, .. } => Some((reason.clone(), sources.clone())),
            _ => None,
        });
        let ok = finished.as_ref().is_some_and(|(r, s)| r == "disk-full" && s.screen.is_some())
            && decodes(&dir.join("sources/screen.mp4"))
            && decodes(&dir.join("sources/system.m4a"));
        eprintln!("disk full after {:?}: {finished:?}", t0.elapsed());
        detach(&big);
        assert!(warned, "warned early, below 3 GB free");
        assert!(ok, "{finished:?}");
    }

    #[test]
    fn drift_correction_keeps_audio_on_the_clock_for_an_hour() {
        // Device clocks 300 ppm fast and 200 ppm slow, 10 ms buffers, one hour.
        for ppm in [300.0, -200.0] {
            let rate = 48_000.0;
            let (mut written, mut device) = (0i64, 0u64);
            for _ in 0..(3600 * 100) {
                let t = device as f64 / (rate * (1.0 + ppm / 1e6));
                let (pad, skip, nudge) =
                    crate::writer::align(written as u64, (t * rate).round() as i64, 480, rate, device > 0);
                written += (pad + 480 - skip) as i64 + nudge as i64;
                device += 480;
            }
            let off = (written as f64 - device as f64 / (1.0 + ppm / 1e6)) / rate;
            assert!(off.abs() < 0.0015, "{ppm} ppm: {off} s off after an hour");
        }
    }
}
