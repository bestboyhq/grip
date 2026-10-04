//! Post-recording camera analysis, on device: Vision person segmentation per frame -> a grayscale
//! matte video with the camera's exact frame times, and a face track. Offline, so the face track
//! is smoothed zero-phase (centered), with no lag behind the face.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use objc2::rc::Retained;
use objc2_av_foundation::*;
use objc2_core_video::{
    kCVPixelFormatType_OneComponent8, CVPixelBuffer, CVPixelBufferGetBaseAddressOfPlane,
    CVPixelBufferGetBytesPerRowOfPlane, CVPixelBufferGetHeight, CVPixelBufferGetHeightOfPlane, CVPixelBufferGetWidth,
    CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSArray, NSURL};
use objc2_vision::{
    VNDetectFaceRectanglesRequest, VNFaceObservation, VNGeneratePersonSegmentationRequest,
    VNGeneratePersonSegmentationRequestQualityLevel, VNRequest, VNSequenceRequestHandler,
};

use crate::writer::{ns_error, nv12_attributes, VideoSpec, VideoWriter};

const FACE_INTERVAL: f64 = 0.1; // seconds between face samples (10 Hz)
const FACE_SIGMA: f64 = 0.25; // seconds, Gaussian smoothing of the face track

pub struct Output {
    pub matte: PathBuf,
    pub faces: PathBuf,
    pub frames: u32,
    pub face_samples: u32,
}

/// Normalized rect, origin top-left of the (unmirrored) camera frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct Face {
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn analyze(path: &Path, out_dir: &Path, cancel: &AtomicBool, mut progress: impl FnMut(f64)) -> Result<Output, String> {
    let matte = out_dir.join("camera-matte.mp4");
    let faces = out_dir.join("camera-faces.json");
    let tmp_matte = out_dir.join(".camera-matte.partial.mp4");
    let tmp_faces = out_dir.join(".camera-faces.partial.json");
    let result = run(path, &tmp_matte, cancel, &mut progress).and_then(|(frames, track)| {
        let json = serde_json::to_string(&track).map_err(|e| e.to_string())?;
        std::fs::write(&tmp_faces, json).map_err(|e| format!("Could not write the face track: {e}"))?;
        std::fs::rename(&tmp_matte, &matte).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp_faces, &faces).map_err(|e| e.to_string())?;
        Ok(Output { matte, faces, frames, face_samples: track.len() as u32 })
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_matte);
        let _ = std::fs::remove_file(&tmp_faces);
    }
    result
}

#[allow(deprecated)] // synchronous AVAsset properties: fine on our own background thread
fn run(path: &Path, matte_path: &Path, cancel: &AtomicBool, progress: &mut impl FnMut(f64)) -> Result<(u32, Vec<Face>), String> {
    if !path.is_file() {
        return Err("The camera recording is missing.".into());
    }
    let url = NSURL::from_file_path(path).ok_or("invalid camera path")?;
    let asset = unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) };
    let track = unsafe { asset.tracksWithMediaType(AVMediaTypeVideo.expect("AVMediaTypeVideo")) }
        .firstObject()
        .ok_or("The camera file has no video track.")?;
    let range = unsafe { track.timeRange() };
    let (start, length) = unsafe { (range.start.seconds(), range.duration.seconds()) };
    let fps = match unsafe { track.nominalFrameRate() } as f64 {
        f if f > 0.0 => f,
        _ => 30.0,
    };
    let total = (length * fps).max(1.0);

    let reader = unsafe { AVAssetReader::assetReaderWithAsset_error(&asset) }.map_err(|e| ns_error(&e))?;
    let output = unsafe { AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&nv12_attributes(None))) };
    unsafe {
        output.setAlwaysCopiesSampleData(false);
        reader.addOutput(&output);
        if !reader.startReading() {
            return Err(reader.error().map(|e| ns_error(&e)).unwrap_or("Could not read the camera video.".into()));
        }
    }

    // One sequence handler + one stateful request across frames gives temporally stable mattes.
    // ponytail: one sequential pass (75-100 fps at 720p on Apple silicon, ~20 min per recorded
    // hour); split into parallel chunks with their own handlers if long recordings need it sooner.
    let handler = unsafe { VNSequenceRequestHandler::new() };
    let segment = unsafe { VNGeneratePersonSegmentationRequest::new() };
    let detect = unsafe { VNDetectFaceRectanglesRequest::new() };
    unsafe {
        segment.setQualityLevel(VNGeneratePersonSegmentationRequestQualityLevel::Balanced);
        segment.setOutputPixelFormat(kCVPixelFormatType_OneComponent8);
    }
    let seg_only: Retained<NSArray<VNRequest>> = NSArray::from_slice(&[&*segment as &VNRequest]);
    let seg_faces: Retained<NSArray<VNRequest>> = NSArray::from_slice(&[&*segment as &VNRequest, &*detect as &VNRequest]);

    let _ = std::fs::remove_file(matte_path); // a leftover from a run cut short by quitting
    let mut writer: Option<VideoWriter> = None;
    let fail = |writer: Option<VideoWriter>, e: String| {
        unsafe { reader.cancelReading() };
        if let Some(w) = writer {
            w.cancel();
        }
        Err(e)
    };
    let mut raw: Vec<(f64, Option<Rect>)> = Vec::new();
    let mut seen: Option<Rect> = None;
    let mut next_face = f64::NEG_INFINITY;
    let mut frames = 0u32;
    let mut reported = 0.0;
    while let Some(sb) = unsafe { output.copyNextSampleBuffer() } {
        if cancel.load(Ordering::SeqCst) {
            return fail(writer, "Camera analysis was cancelled.".into());
        }
        let Some(frame) = (unsafe { sb.image_buffer() }) else { continue };
        let t = unsafe { sb.presentation_time_stamp().seconds() };
        let want_face = t >= next_face;
        let requests = if want_face { &seg_faces } else { &seg_only };
        if let Err(e) = unsafe { handler.performRequests_onCVPixelBuffer_error(requests, &frame) } {
            return fail(writer, format!("Vision failed: {}", ns_error(&e)));
        }
        let Some(mask) = unsafe { segment.results() }.and_then(|r| r.firstObject()).map(|o| unsafe { o.pixelBuffer() }) else {
            return fail(writer, "Vision returned no person matte.".into());
        };
        if writer.is_none() {
            let (width, height) = (CVPixelBufferGetWidth(&mask), CVPixelBufferGetHeight(&mask));
            let spec = VideoSpec { width, height, fps, bits_per_pixel: 0.05, realtime: false };
            match VideoWriter::new(matte_path, spec) {
                Ok(w) => writer = Some(w),
                Err(e) => return fail(None, e),
            }
        }
        let w = writer.as_mut().expect("writer");
        let Some(out) = w.pool().and_then(|p| super::pixel_buffer(&p)) else {
            return fail(writer, "Out of memory for the matte.".into());
        };
        if !matte_to_nv12(&mask, &out) || !w.frame(out, Some(t)) {
            let e = w.error().unwrap_or("Could not write the matte.".into());
            return fail(writer, e);
        }
        if want_face {
            next_face = t + FACE_INTERVAL - 0.5 / fps;
            let found = primary_face(unsafe { detect.results() }.as_deref(), seen);
            seen = found.or(seen);
            raw.push((t, found));
        }
        frames += 1;
        let p = (frames as f64 / total).min(1.0);
        if p - reported >= 0.01 {
            reported = p;
            progress(p);
        }
    }
    if unsafe { reader.status() } != AVAssetReaderStatus::Completed {
        let e = unsafe { reader.error() }.map(|e| ns_error(&e)).unwrap_or("Could not read the camera video.".into());
        return fail(writer, e);
    }
    let w = writer.ok_or("The camera video has no frames.")?;
    w.finish(start + length)?;
    progress(1.0);
    Ok((frames, smooth_faces(&raw, FACE_SIGMA)))
}

/// Y = matte (video range 16..235), chroma neutral: a gray picture whose luma is the alpha.
fn matte_to_nv12(src: &CVPixelBuffer, dst: &CVPixelBuffer) -> bool {
    let (w, h) = (CVPixelBufferGetWidth(src), CVPixelBufferGetHeight(src));
    if (w, h) != (CVPixelBufferGetWidth(dst), CVPixelBufferGetHeight(dst)) {
        return false;
    }
    let lut: [u8; 256] = std::array::from_fn(|m| (16 + (m * 219 + 127) / 255) as u8);
    unsafe {
        if CVPixelBufferLockBaseAddress(src, CVPixelBufferLockFlags::ReadOnly) != 0 {
            return false;
        }
        if CVPixelBufferLockBaseAddress(dst, CVPixelBufferLockFlags(0)) != 0 {
            CVPixelBufferUnlockBaseAddress(src, CVPixelBufferLockFlags::ReadOnly);
            return false;
        }
        // OneComponent8 is a single plane; the plane-0 accessors return its base and stride.
        let (s, ss) = (objc2_core_video::CVPixelBufferGetBaseAddress(src) as *const u8, objc2_core_video::CVPixelBufferGetBytesPerRow(src));
        let (y, ys) = (CVPixelBufferGetBaseAddressOfPlane(dst, 0) as *mut u8, CVPixelBufferGetBytesPerRowOfPlane(dst, 0));
        let (uv, uvs, uvh) = (
            CVPixelBufferGetBaseAddressOfPlane(dst, 1) as *mut u8,
            CVPixelBufferGetBytesPerRowOfPlane(dst, 1),
            CVPixelBufferGetHeightOfPlane(dst, 1),
        );
        let ok = !s.is_null() && !y.is_null() && !uv.is_null();
        if ok {
            for row in 0..h {
                let from = std::slice::from_raw_parts(s.add(row * ss), w);
                let to = std::slice::from_raw_parts_mut(y.add(row * ys), w);
                for (d, &m) in to.iter_mut().zip(from) {
                    *d = lut[m as usize];
                }
            }
            std::ptr::write_bytes(uv, 128, uvs * uvh);
        }
        CVPixelBufferUnlockBaseAddress(dst, CVPixelBufferLockFlags(0));
        CVPixelBufferUnlockBaseAddress(src, CVPixelBufferLockFlags::ReadOnly);
        ok
    }
}

fn iou(a: Rect, b: Rect) -> f64 {
    let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    if w <= 0.0 || h <= 0.0 {
        return 0.0;
    }
    let i = w * h;
    i / (a.w * a.h + b.w * b.h - i)
}

/// The face to follow: the one overlapping the face we followed so far, else the largest.
fn primary_face(observations: Option<&NSArray<VNFaceObservation>>, previous: Option<Rect>) -> Option<Rect> {
    let faces: Vec<Rect> = observations?
        .iter()
        .map(|o| {
            let b = unsafe { o.boundingBox() }; // normalized, origin bottom-left
            Rect { x: b.origin.x, y: 1.0 - b.origin.y - b.size.height, w: b.size.width, h: b.size.height }
        })
        .collect();
    let by = |f: &dyn Fn(&Rect) -> f64| faces.iter().copied().max_by(|a, b| f(a).total_cmp(&f(b)));
    if let Some(p) = previous {
        if let Some(best) = by(&|r| iou(*r, p)).filter(|r| iou(*r, p) > 0.2) {
            return Some(best);
        }
    }
    by(&|r| r.w * r.h)
}

/// Fill gaps (hold the last face, lead-in from the first) and smooth with a centered Gaussian.
/// Empty when no face was ever found.
pub fn smooth_faces(raw: &[(f64, Option<Rect>)], sigma: f64) -> Vec<Face> {
    let Some(first) = raw.iter().find_map(|r| r.1) else { return Vec::new() };
    let mut last = first;
    let filled: Vec<(f64, Rect)> = raw
        .iter()
        .map(|&(t, r)| {
            last = r.unwrap_or(last);
            (t, last)
        })
        .collect();
    let round = |v: f64, k: f64| (v * k).round() / k;
    let mut lo = 0;
    filled
        .iter()
        .map(|&(t, _)| {
            while filled[lo].0 < t - 3.0 * sigma {
                lo += 1;
            }
            let (mut sum, mut acc) = (0.0, [0.0; 4]);
            for &(tj, r) in filled[lo..].iter().take_while(|(tj, _)| *tj <= t + 3.0 * sigma) {
                let k = (-(tj - t).powi(2) / (2.0 * sigma * sigma)).exp();
                sum += k;
                for (a, v) in acc.iter_mut().zip([r.x, r.y, r.w, r.h]) {
                    *a += k * v;
                }
            }
            let [x, y, w, h] = acc.map(|a| round(a / sum, 1e4));
            Face { t: round(t, 1e3), x, y, w, h }
        })
        .collect()
}
