//! Camera tests without camera hardware or permissions: synthetic sample buffers go through the
//! same Sink the capture delegate feeds, and the files are decoded back with AVFoundation.

use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::atomic::AtomicBool;

use objc2_av_foundation::*;
use objc2_core_foundation::{CFDictionary, CFRetained};
use objc2_core_media::{CMSampleBuffer, CMSampleTimingInfo, CMTime, CMTimeFlags, CMVideoFormatDescriptionCreateForImageBuffer};
use objc2_core_video::*;
use objc2_foundation::NSURL;

use super::analyze::{self, Rect};
use crate::writer::{self, nv12_attributes, VideoSpec, VideoWriter};
use super::*;

/// A scratch folder per test, removed afterwards. Hostile on purpose: '#', emoji, accents, spaces.
struct Dir(PathBuf);

impl Dir {
    fn new(test: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("studio camera #{} ✨ café {test}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Dir(dir)
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A flat NV12 frame: luma `y` on the left half, `y2` on the right half.
fn frame(w: usize, h: usize, y: u8, y2: u8) -> CFRetained<CVPixelBuffer> {
    let attrs = nv12_attributes(None);
    let mut out: *mut CVPixelBuffer = std::ptr::null_mut();
    let attrs: &CFDictionary = unsafe { &*(&*attrs as *const _ as *const CFDictionary) };
    let status = unsafe { CVPixelBufferCreate(None, w, h, writer::NV12, Some(attrs), NonNull::from(&mut out)) };
    assert_eq!(status, 0);
    let pb = unsafe { CFRetained::from_raw(NonNull::new(out).unwrap()) };
    unsafe {
        CVPixelBufferLockBaseAddress(&pb, CVPixelBufferLockFlags(0));
        let (base, stride) = (CVPixelBufferGetBaseAddressOfPlane(&pb, 0) as *mut u8, CVPixelBufferGetBytesPerRowOfPlane(&pb, 0));
        for row in 0..h {
            let line = std::slice::from_raw_parts_mut(base.add(row * stride), w);
            line[..w / 2].fill(y);
            line[w / 2..].fill(y2);
        }
        let uv = CVPixelBufferGetBaseAddressOfPlane(&pb, 1) as *mut u8;
        std::ptr::write_bytes(uv, 128, CVPixelBufferGetBytesPerRowOfPlane(&pb, 1) * CVPixelBufferGetHeightOfPlane(&pb, 1));
        CVPixelBufferUnlockBaseAddress(&pb, CVPixelBufferLockFlags(0));
    }
    pb
}

/// What the capture delegate receives: a frame stamped with its host capture time.
fn sample(pb: &CVPixelBuffer, host_ns: u64) -> CFRetained<CMSampleBuffer> {
    let mut format = std::ptr::null();
    assert_eq!(unsafe { CMVideoFormatDescriptionCreateForImageBuffer(None, pb, NonNull::from(&mut format)) }, 0);
    let format = unsafe { CFRetained::from_raw(NonNull::new(format as *mut _).unwrap()) };
    let timing = CMSampleTimingInfo {
        duration: unsafe { objc2_core_media::kCMTimeInvalid },
        presentationTimeStamp: CMTime { value: host_ns as i64, timescale: 1_000_000_000, flags: CMTimeFlags::Valid, epoch: 0 },
        decodeTimeStamp: unsafe { objc2_core_media::kCMTimeInvalid },
    };
    let mut out = std::ptr::null_mut();
    let status = unsafe {
        CMSampleBuffer::create_for_image_buffer(None, pb, true, None, std::ptr::null_mut(), &format, NonNull::from(&timing), NonNull::from(&mut out))
    };
    assert_eq!(status, 0);
    unsafe { CFRetained::from_raw(NonNull::new(out).unwrap()) }
}

/// A decoded frame: (pts seconds, (w, h), mean luma of the left half, top quarter, bottom quarter,
/// lower middle (where a webcam subject sits), left edge).
type Frame = (f64, (usize, usize), f64, f64, f64, f64, f64);

#[allow(deprecated)]
fn decode(path: &Path) -> Vec<Frame> {
    let url = NSURL::from_file_path(path).unwrap();
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&url, None);
        let track = asset.tracksWithMediaType(AVMediaTypeVideo.unwrap()).firstObject().expect("video track");
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset).unwrap();
        let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&nv12_attributes(None)));
        reader.addOutput(&output);
        assert!(reader.startReading());
        let mut out = Vec::new();
        while let Some(sb) = output.copyNextSampleBuffer() {
            let pb = sb.image_buffer().unwrap();
            let (w, h) = (CVPixelBufferGetWidth(&pb), CVPixelBufferGetHeight(&pb));
            CVPixelBufferLockBaseAddress(&pb, CVPixelBufferLockFlags::ReadOnly);
            let (base, stride) = (CVPixelBufferGetBaseAddressOfPlane(&pb, 0) as *const u8, CVPixelBufferGetBytesPerRowOfPlane(&pb, 0));
            let mean = |x0: usize, x1: usize, y0: usize, y1: usize| {
                let mut sum = 0.0;
                for y in y0..y1 {
                    for x in x0..x1 {
                        sum += *base.add(y * stride + x) as f64;
                    }
                }
                sum / ((x1 - x0) * (y1 - y0)) as f64
            };
            let left = mean(w / 8, w / 2 - w / 8, h / 4, h - h / 4);
            let top = mean(w / 4, w - w / 4, h / 16, h / 4);
            let bottom = mean(w / 4, w - w / 4, h - h / 4, h - h / 16);
            let (middle, edge) = (mean(w * 2 / 5, w * 3 / 5, h / 2, h * 9 / 10), mean(0, w / 16, h / 2, h * 9 / 10));
            CVPixelBufferUnlockBaseAddress(&pb, CVPixelBufferLockFlags::ReadOnly);
            out.push((sb.presentation_time_stamp().seconds(), (w, h), left, top, bottom, middle, edge));
        }
        assert_eq!(reader.status(), AVAssetReaderStatus::Completed);
        out
    }
}

#[allow(deprecated)]
fn duration(path: &Path) -> f64 {
    let url = NSURL::from_file_path(path).unwrap();
    unsafe { AVURLAsset::URLAssetWithURL_options(&url, None).duration().seconds() }
}

/// Presentation times of the stored samples, or of the frames a decoder outputs (what analysis sees).
#[allow(deprecated)]
fn sample_times(path: &Path, decoded: bool) -> Vec<f64> {
    let url = NSURL::from_file_path(path).unwrap();
    unsafe {
        let asset = AVURLAsset::URLAssetWithURL_options(&url, None);
        let track = asset.tracksWithMediaType(AVMediaTypeVideo.unwrap()).firstObject().expect("video track");
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset).unwrap();
        let settings = decoded.then(|| nv12_attributes(None));
        let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, settings.as_deref());
        reader.addOutput(&output);
        assert!(reader.startReading());
        let mut out = Vec::new();
        while let Some(sb) = output.copyNextSampleBuffer() {
            if sb.num_samples() > 0 {
                out.push(sb.presentation_time_stamp().seconds());
            }
        }
        out
    }
}

const MS: u64 = 1_000_000;

/// The skill's bar: an hour-long recording stays in sync within a frame. Every frame keeps the
/// time it was captured at (no frame counting), so a camera running at 29.97 instead of 30 fps
/// and pauses along the way cause no drift. One hour of tiny frames, timestamps checked exactly.
#[test]
fn an_hour_with_pauses_has_no_drift() {
    let _g = crate::clock::serial(); // one encoder at a time
    static CLOCK: SessionClock = SessionClock::new();
    let dir = Dir::new("hour");
    let path = dir.file("camera.mp4");
    let sink = Sink::new(&CLOCK, &path, 30.0, 0.15, Some((64, 64)), false);
    let pb = frame(64, 64, 100, 100);
    let t0: u64 = 7_000_000 * MS;
    CLOCK.start(t0);
    let period_ns = |k: u64| k * 1_001_000_000_000 / 30_000; // 29.97 fps capture clock
    let (mut paused_ns, mut expected) = (0u64, Vec::new());
    let mut k = 0u64;
    let minutes20 = 1200 * 1000 * MS;
    while period_ns(k) < 3600 * 1000 * MS {
        // A 7 s pause every 20 minutes of recording.
        if k > 0 && period_ns(k) / minutes20 != period_ns(k - 1) / minutes20 {
            let wall = t0 + period_ns(k) + paused_ns;
            sink.pause_at(wall);
            CLOCK.pause(wall);
            CLOCK.resume(wall + 7000 * MS);
            sink.resume_at(wall + 7000 * MS);
            paused_ns += 7000 * MS;
        }
        sink.on_sample(&sample(&pb, t0 + period_ns(k) + paused_ns));
        expected.push(period_ns(k) as f64 / 1e9);
        k += 1;
    }
    let (info, _, _) = sink.finish(None).unwrap();
    assert_eq!((info.frames as usize, info.dropped), (expected.len(), 0));
    let stored = sample_times(&path, false);
    assert_eq!(stored.len(), expected.len());
    let worst = stored.iter().zip(&expected).skip(1).map(|(a, b)| (a - b).abs()).fold(0.0, f64::max);
    assert!(worst < 1.0 / 90_000.0, "worst timestamp error {worst} s over an hour");
}

#[test]
fn picks_30fps_then_exact_height() {
    let formats = [(640, 480, 30.0), (1280, 720, 30.0), (1920, 1080, 15.0), (1552, 1552, 30.0), (3840, 2160, 30.0), (1440, 1080, 30.0)];
    assert_eq!(pick_format(&formats, 720), Some(1));
    assert_eq!(pick_format(&formats, 2160), Some(4));
    // 1080p only at 15 fps: a 30 fps format wins; 1440x1080 is exact height at 30.
    assert_eq!(pick_format(&formats, 1080), Some(5));
    // No 4K: the largest below.
    assert_eq!(pick_format(&formats[..4], 2160), Some(3));
    // Never a portrait mode, even when it is closer.
    assert_eq!(pick_format(&[(1080, 1920, 30.0), (1920, 1080, 30.0)], 2160), Some(1));
    assert_eq!(format_fps(&[(1.0, 60.0)]), 30.0);
    assert_eq!(format_fps(&[(29.97, 29.97), (15.0, 15.0)]), 29.97);
    assert_eq!(format_fps(&[(60.0, 60.0)]), 60.0);
}

#[test]
fn camera_frames_follow_the_session_clock_and_pauses() {
    let _g = crate::clock::serial(); // one encoder at a time
    static CLOCK: SessionClock = SessionClock::new();
    let dir = Dir::new("camera");
    let path = dir.file("camera.mp4");
    let sink = Sink::new(&CLOCK, &path, 30.0, 0.15, Some((320, 180)), false);
    let t0: u64 = 5_000_000 * MS; // arbitrary host time
    let at = |ns: u64, y: u8| sink.on_sample(&sample(&frame(320, 180, y, y), ns));
    let period = 1000 * MS / 30;

    at(t0 - 50 * MS, 250); // before the session starts: dropped
    CLOCK.start(t0);
    for k in 0..30 {
        at(t0 + 10 * MS + k * period, 20 + k as u8 * 3); // t = 0.010 .. 0.977
    }
    let paused = t0 + 1000 * MS;
    sink.pause_at(paused);
    CLOCK.pause(paused);
    at(paused + 100 * MS, 250); // while paused: dropped
    let resumed = paused + 500 * MS;
    CLOCK.resume(resumed);
    sink.resume_at(resumed);
    at(paused + 400 * MS, 250); // captured during the pause, delivered after it: dropped
    for k in 0..30 {
        at(resumed + 5 * MS + k * period, 110 + k as u8 * 3); // t = 1.005 .. 1.972
    }
    let end = CLOCK.source_secs(resumed + 1000 * MS);
    assert_eq!(end, Some(2.0));
    let (info, audio, rotations) = sink.finish(end).unwrap();
    assert_eq!((info.width, info.height, info.frames, info.dropped), (320, 180, 60, 0));
    assert!(!audio && rotations.is_empty());

    let frames = decode(&path);
    assert_eq!(frames.len(), 60);
    assert_eq!(frames[0].0, 0.0, "the first frame opens the file at source time 0");
    for (k, f) in frames.iter().enumerate().skip(1) {
        let expect = if k < 30 { 0.010 + k as f64 / 30.0 } else { 1.005 + (k - 30) as f64 / 30.0 };
        assert!((f.0 - expect).abs() < 1e-4, "frame {k} at {} expected {expect}", f.0);
    }
    for (k, f) in frames.iter().enumerate() {
        let y = if k < 30 { 20 + k * 3 } else { 110 + (k - 30) * 3 } as f64;
        assert!((f.2 - y).abs() < 3.0, "frame {k} luma {} expected {y}: wrong frame order", f.2);
    }
    assert!((duration(&path) - 2.0).abs() < 0.01, "track spans the session: {}", duration(&path));
}

#[test]
fn device_rotation_is_undone_and_recorded_with_gapless_audio() {
    let _g = crate::clock::serial(); // one encoder at a time
    static CLOCK: SessionClock = SessionClock::new();
    let dir = Dir::new("device");
    let (video, audio) = (dir.file("screen.mp4"), dir.file("system.m4a"));
    let mut sink = Sink::new(&CLOCK, &video, 60.0, 0.1, None, true);
    sink.audio_path = Some(audio.clone());
    let t0: u64 = 9_000_000 * MS;
    CLOCK.start(t0);
    let period = 1000 * MS / 60;
    // Portrait for 0.5 s, landscape (dark left, bright right) for 0.5 s, portrait again.
    for k in 0..90u64 {
        let landscape = (30..60).contains(&k);
        let pb = if landscape { frame(320, 180, 40, 200) } else { frame(180, 320, 120, 120) };
        sink.on_sample(&sample(&pb, t0 + 3 * MS + k * period));
    }
    // Audio: 1024-frame buffers with jitter, then a 100 ms dropout.
    let format = writer::pcm_format(AUDIO_RATE, 2).unwrap();
    let chunk = 1024u64;
    let mut pos = 0u64; // samples
    while pos < 72_000 {
        let jitter = if (pos / chunk).is_multiple_of(2) { 0 } else { MS / 2 };
        let host = t0 + 20 * MS + pos * 1_000_000_000 / AUDIO_RATE as u64 + jitter;
        let samples: Vec<f32> = (0..chunk as usize * 2).map(|i| ((i / 2) as f32 * 0.05).sin() * 0.5).collect();
        let pts = CMTime { value: host as i64, timescale: 1_000_000_000, flags: CMTimeFlags::Valid, epoch: 0 };
        sink.on_sample(&writer::pcm_buffer(&format, &samples, pts).unwrap());
        pos += if pos == 24 * chunk { chunk + 4800 } else { chunk };
    }
    let (info, has_audio, rotations) = sink.finish(Some(1.6)).unwrap();
    assert!(has_audio);
    assert_eq!((info.width, info.height, info.frames, info.duration), (180, 320, 90, 1.6));
    assert_eq!(rotations.len(), 2, "{rotations:?}");
    assert_eq!(rotations[0].deg, 90);
    assert!((rotations[0].t - (3.0 + 30.0 * 1000.0 / 60.0) / 1000.0).abs() < 1e-3, "{rotations:?}");
    assert_eq!(rotations[1].deg, 0);

    let frames = decode(&video);
    assert_eq!(frames.len(), 92, "the last frame repeated twice to hold it until the end");
    assert!((duration(&video) - 1.6).abs() < 0.01, "{}", duration(&video));
    assert!(frames.iter().all(|f| f.1 == (180, 320)), "constant size");
    // Turned counter-clockwise: the landscape's bright right half is now on top.
    let turned = &frames[45];
    assert!(turned.3 > 180.0 && turned.4 < 60.0, "top {} bottom {}", turned.3, turned.4);
    assert!((frames[10].3 - 120.0).abs() < 4.0);

    // 1.6 s of audio from t = 0: leading silence, dropout filled, jitter absorbed, padded to the end.
    let d = duration(&audio);
    assert!((d - 1.6).abs() < 0.03, "audio duration {d}");
}

#[test]
fn a_crash_leaves_a_playable_file() {
    let _g = crate::clock::serial(); // one encoder at a time
    let dir = Dir::new("crash");
    let path = dir.file("crash.mp4");
    let spec = VideoSpec { width: 320, height: 180, fps: 30.0, bits_per_pixel: 0.15, realtime: false };
    let mut w = VideoWriter::new(&path, spec).unwrap();
    for k in 0..120 {
        assert!(w.frame(frame(320, 180, (k * 2) as u8, 0), Some(k as f64 / 30.0)));
    }
    std::thread::sleep(std::time::Duration::from_millis(500));
    std::mem::forget(w); // no finish(): what a crash or power loss leaves on disk
    let frames = decode(&path);
    assert!(frames.len() >= 60, "only {} of 120 frames survived", frames.len());
}

#[test]
fn analysis_matches_camera_timing_and_cleans_up_on_cancel() {
    let _g = crate::clock::serial(); // one encoder at a time
    let dir = Dir::new("analysis");
    let input = dir.file("camera.mp4");
    let spec = VideoSpec { width: 640, height: 360, fps: 30.0, bits_per_pixel: 0.15, realtime: false };
    let mut w = VideoWriter::new(&input, spec).unwrap();
    for k in 0..45 {
        w.frame(frame(640, 360, 60 + k as u8, 180), Some(0.004 + k as f64 / 30.0));
    }
    w.finish(1.5).unwrap();
    let out = input.parent().unwrap().join("analysis");
    std::fs::create_dir_all(&out).unwrap();

    let mut reports = Vec::new();
    let r = analyze::analyze(&input, &out, &AtomicBool::new(false), |p| reports.push(p)).unwrap();
    assert_eq!(r.frames, 45);
    assert_eq!(reports.last(), Some(&1.0));
    let camera: Vec<f64> = decode(&input).iter().map(|f| f.0).collect();
    let matte = decode(&r.matte);
    assert_eq!(matte.iter().map(|f| f.0).collect::<Vec<_>>(), camera, "matte frames at the camera's frame times");
    assert!((duration(&r.matte) - duration(&input)).abs() < 1e-3);
    assert_eq!(std::fs::read_to_string(&r.faces).unwrap(), "[]", "no face in a flat picture");

    std::fs::remove_file(&r.matte).unwrap();
    let e = analyze::analyze(&input, &out, &AtomicBool::new(true), |_| {}).err().unwrap();
    assert!(e.contains("cancelled"));
    assert_eq!(std::fs::read_dir(&out).unwrap().count(), 1, "only the earlier faces file remains");
}

/// A real webcam-style clip of a person: `STUDIO_PERSON_VIDEO=<file.mp4> cargo test real_person`.
/// Skipped without it (no such clip ships with the repo).
#[test]
fn analysis_of_a_real_person_finds_the_face_and_the_body() {
    let _g = crate::clock::serial(); // one encoder at a time
    let Ok(input) = std::env::var("STUDIO_PERSON_VIDEO") else { return eprintln!("STUDIO_PERSON_VIDEO not set: skipped") };
    let dir = Dir::new("person");
    let r = analyze::analyze(Path::new(&input), &dir.0, &AtomicBool::new(false), |_| {}).unwrap();
    let camera = sample_times(Path::new(&input), true);
    assert_eq!(r.frames as usize, camera.len());
    let matte = decode(&r.matte);
    assert_eq!(matte.len(), camera.len(), "one matte frame per camera frame");
    for (m, c) in matte.iter().zip(&camera).skip(1) {
        assert!((m.0 - c).abs() < 1e-4, "matte at {} vs camera at {c}", m.0);
    }
    // The person fills the lower middle; the background at the edge is cut away.
    let (middle, edge) = matte.iter().fold((0.0, 0.0), |a, m| (a.0 + m.5, a.1 + m.6));
    let (middle, edge) = (middle / matte.len() as f64, edge / matte.len() as f64);
    println!("{} frames, matte luma middle {middle:.0} edge {edge:.0}, {} face samples", r.frames, r.face_samples);
    assert!(middle > 180.0 && edge < 40.0, "middle {middle} edge {edge}");
    let faces: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&r.faces).unwrap()).unwrap();
    let duration = camera.last().unwrap() - camera[0];
    assert!((faces.len() as f64 - duration * 10.0).abs() < 3.0, "about 10 face samples a second: {}", faces.len());
    for f in &faces {
        let (x, y, w, h) = (f["x"].as_f64().unwrap(), f["y"].as_f64().unwrap(), f["w"].as_f64().unwrap(), f["h"].as_f64().unwrap());
        let (cx, cy) = (x + w / 2.0, y + h / 2.0);
        assert!((0.35..0.65).contains(&cx) && (0.15..0.6).contains(&cy) && (0.1..0.5).contains(&w), "face {f}");
    }
}

#[test]
fn face_track_is_gap_filled_and_smoothed_without_lag() {
    let r = |x: f64| Some(Rect { x, y: 0.2, w: 0.2, h: 0.3 });
    assert!(analyze::smooth_faces(&[(0.0, None), (0.1, None)], 0.25).is_empty());
    // Jittery samples around x = 0.4, a gap, then a step to x = 0.6 at t = 3 s.
    let raw: Vec<(f64, Option<Rect>)> = (0..60)
        .map(|i| {
            let t = i as f64 * 0.1;
            let x = if t < 3.0 { 0.4 + if i % 2 == 0 { 0.02 } else { -0.02 } } else { 0.6 };
            (t, if (40..44).contains(&i) || i == 0 { None } else { r(x) })
        })
        .collect();
    let out = analyze::smooth_faces(&raw, 0.25);
    assert_eq!(out.len(), 60);
    assert!((out[0].x - 0.4).abs() < 0.01, "lead-in filled from the first face");
    assert!(out[5..20].iter().all(|f| (f.x - 0.4).abs() < 0.005), "jitter smoothed");
    assert_eq!(out[42].x, 0.6, "gap holds the last face");
    // Zero phase: the step is centered on 2.95 s (between the last old and first new sample).
    let mid = out.iter().find(|f| f.x >= 0.5).unwrap().t;
    assert!((mid - 3.0).abs() < 0.051, "step crosses the midpoint at {mid}");
    assert_eq!(out[59].x, 0.6);
}

#[test]
fn recording_fails_cleanly_without_a_camera() {
    let dir = Dir::new("fail");
    let e = CameraRecorder::start("no-such-camera", &dir.file("never.mp4")).err().expect("must fail");
    println!("{e}");
    assert!(!e.is_empty() && !e.contains('\n'), "one line: {e}");
    let e = DeviceRecorder::start("no-such-device", &dir.file("never.mp4"), Some(&dir.file("never.m4a"))).err().expect("must fail");
    println!("{e}");
    assert!(!e.is_empty() && !e.contains('\n'), "one line: {e}");
    let e = CameraRecorder::start("x", Path::new("/no/such/dir/camera.mp4")).err().unwrap();
    assert!(!e.is_empty());
}

#[test]
fn lists_devices() {
    for d in list_cameras() {
        assert!(["built-in", "external", "continuity", "ios"].contains(&d.kind.as_str()));
        println!("{} [{}] {:?}", d.name, d.kind, d.formats.iter().map(|f| (f.width, f.height, f.fps)).collect::<Vec<_>>());
    }
}

#[test]
fn capture_outputs_accept_our_settings_and_route_samples_to_the_sink() {
    let _g = crate::clock::serial(); // one encoder at a time
    static CLOCK: SessionClock = SessionClock::new();
    let dir = Dir::new("wiring");
    let sink = Arc::new(Sink::new(&CLOCK, &dir.file("camera.mp4"), 30.0, 0.15, Some((320, 180)), false));
    let delegate = Delegate::new(sink.clone());
    let queue = DispatchQueue::new("studio.camera.test", None);
    let session = unsafe { AVCaptureSession::new() };
    // Unsupported settings keys would throw here (no camera or permission needed).
    add_video_output(&session, &delegate, &queue, Some((320, 180))).unwrap();
    add_video_output(&session, &delegate, &queue, None).unwrap();
    let audio = unsafe { AVCaptureAudioDataOutput::new() };
    unsafe {
        audio.setAudioSettings(Some(&writer::pcm_settings(AUDIO_RATE, 2)));
        audio.setSampleBufferDelegate_queue(Some(ProtocolObject::from_ref(&*delegate)), Some(&queue));
    }

    // AVFoundation calls the delegate through the Objective-C runtime.
    let output = unsafe { AVCaptureVideoDataOutput::new() };
    let connection = unsafe { AVCaptureConnection::initWithInputPorts_output(AVCaptureConnection::alloc(), &NSArray::new(), &output) };
    CLOCK.start(1_000 * MS);
    let sb = sample(&frame(320, 180, 100, 100), 1_010 * MS);
    unsafe {
        let _: () = msg_send![&*delegate, captureOutput: &*output, didOutputSampleBuffer: &*sb, fromConnection: &*connection];
        let _: () = msg_send![&*delegate, captureOutput: &*output, didDropSampleBuffer: &*sb, fromConnection: &*connection];
    }
    assert_eq!(lock(&sink.state).video.as_ref().map(|v| v.frames), Some(1));
    assert_eq!(sink.capture_drops.load(Ordering::Relaxed), 1);
    let (info, _, _) = sink.finish(Some(0.5)).unwrap();
    assert_eq!((info.frames, info.dropped), (1, 1));
}

