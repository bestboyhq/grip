//! Recordings cut short by a crash, power loss, or kill -9. Their files end in movie fragments
//! that ffmpeg and AVFoundation read but the editor's demuxer stops before, so each one is
//! remuxed (passthrough, no re-encode) into a regular MP4, then probed into the project's sources.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use napi::bindgen_prelude::spawn_blocking;
use napi_derive::napi;
use objc2_av_foundation::{
    AVAssetExportPresetPassthrough, AVAssetExportSession, AVAssetExportSessionStatus, AVFileTypeMPEG4,
    AVMediaTypeAudio, AVMediaTypeVideo, AVURLAsset,
};
use objc2_core_graphics::{CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayMode, CGMainDisplayID};
use objc2_core_media::{CMAudioFormatDescriptionGetStreamBasicDescription, CMFormatDescription};
use objc2_foundation::NSURL;

use crate::writer::ns_error;
use super::{AudioSourceInfo, RecordingSources, VideoSourceInfo};

/// True when the file has top-level movie fragments: written but never finalized.
pub fn is_fragmented(path: &Path) -> bool {
    let Ok(mut f) = File::open(path) else { return false };
    let len = f.metadata().map_or(0, |m| m.len());
    let mut pos = 0u64;
    let mut head = [0u8; 16];
    while pos + 8 <= len {
        if f.seek(SeekFrom::Start(pos)).is_err() || f.read_exact(&mut head[..8]).is_err() {
            return false;
        }
        if &head[4..8] == b"moof" {
            return true;
        }
        let size = match u32::from_be_bytes(head[..4].try_into().unwrap()) as u64 {
            0 => return false, // runs to the end of the file
            1 => {
                if f.read_exact(&mut head[8..16]).is_err() {
                    return false;
                }
                u64::from_be_bytes(head[8..16].try_into().unwrap())
            }
            n => n,
        };
        if size < 8 {
            return false;
        }
        pos += size;
    }
    false
}

fn asset(path: &Path) -> Option<objc2::rc::Retained<AVURLAsset>> {
    let url = NSURL::from_file_path(path)?;
    Some(unsafe { AVURLAsset::URLAssetWithURL_options(&url, None) })
}

/// Rewrite `path` as a regular MP4 with the same samples, replacing it only when that succeeded.
fn remux(path: &Path) -> Result<(), String> {
    let tmp = path.with_extension(format!("recovering.{}", path.extension().and_then(|e| e.to_str()).unwrap_or("mp4")));
    let _ = std::fs::remove_file(&tmp);
    let asset = asset(path).ok_or("Bad path")?;
    let export =
        unsafe { AVAssetExportSession::exportSessionWithAsset_presetName(&asset, AVAssetExportPresetPassthrough) }
            .ok_or("This file cannot be recovered")?;
    let out = NSURL::from_file_path(&tmp).ok_or("Bad path")?;
    unsafe {
        export.setOutputURL(Some(&out));
        export.setOutputFileType(AVFileTypeMPEG4);
    }
    let (tx, rx) = mpsc::channel();
    let done = RcBlock::new(move || {
        let _ = tx.send(());
    });
    unsafe { export.exportAsynchronouslyWithCompletionHandler(&done) };
    // Passthrough copies at disk speed; hours of 4K take minutes.
    rx.recv_timeout(Duration::from_secs(3600)).map_err(|_| "Timed out recovering the recording".to_string())?;
    if unsafe { export.status() } != AVAssetExportSessionStatus::Completed {
        let _ = std::fs::remove_file(&tmp);
        return Err(unsafe { export.error() }.map_or("Recovery failed".into(), |e| ns_error(&e)));
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[allow(deprecated)] // the synchronous AVAsset getters are fine on this background thread
fn probe_video(path: &Path, file: &str, scale: f64) -> Option<(VideoSourceInfo, f64)> {
    let asset = asset(path)?;
    let track = unsafe { asset.tracksWithMediaType(AVMediaTypeVideo?) }.firstObject()?;
    let size = unsafe { track.naturalSize() };
    let fps = unsafe { track.nominalFrameRate() } as f64;
    let duration = unsafe { asset.duration().seconds() };
    (size.width > 0.0 && duration > 0.0).then(|| {
        let info = VideoSourceInfo {
            file: file.into(),
            width: size.width as u32,
            height: size.height as u32,
            fps: if fps > 0.0 { fps.round().min(60.0) } else { 30.0 },
            scale,
            rotations: None,
        };
        (info, duration)
    })
}

#[allow(deprecated)]
fn probe_audio(path: &Path, file: &str) -> Option<AudioSourceInfo> {
    let asset = asset(path)?;
    let track = unsafe { asset.tracksWithMediaType(AVMediaTypeAudio?) }.firstObject()?;
    let formats = unsafe { track.formatDescriptions() };
    let fd = formats.firstObject()?;
    // SAFETY: an audio track's format descriptions are CMAudioFormatDescriptions.
    let fd: &CMFormatDescription = unsafe { &*(&*fd as *const objc2::runtime::AnyObject).cast() };
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(fd).as_ref() }?;
    Some(AudioSourceInfo { file: file.into(), channels: asbd.mChannelsPerFrame, sample_rate: asbd.mSampleRate })
}

/// Make the files of an interrupted recording in `<bundle>/sources/` whole again. Every file is
/// tried; the first failure is returned. One repair at a time: launch recovery and opening the
/// same bundle may ask at once, and the second finds the files already whole.
pub fn repair(bundle: &Path) -> Result<(), String> {
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
    let dir = bundle.join("sources");
    let mut first = Ok(());
    for f in ["screen.mp4", "system.m4a", "mic.m4a", "camera.mp4"] {
        let path = dir.join(f);
        if is_fragmented(&path)
            && let Err(e) = remux(&path)
        {
            first = first.and(Err(format!("{f}: {e}")));
        }
    }
    first
}

/// Make an interrupted recording whole again and describe it.
pub fn recover(bundle: &Path) -> Result<RecordingSources, String> {
    repair(bundle)?;
    let dir = bundle.join("sources");
    let rel = |f: &str| format!("sources/{f}");
    // The display's backing scale was not saved; the main display's is the best guess.
    let main = CGMainDisplayID();
    let scale = CGDisplayCopyDisplayMode(main)
        .map_or(2.0, |m| CGDisplayMode::pixel_width(Some(&m)) as f64 / CGDisplayBounds(main).size.width);
    let (screen, duration) = probe_video(&dir.join("screen.mp4"), &rel("screen.mp4"), scale)
        .ok_or("No screen recording could be recovered.")?;
    Ok(RecordingSources {
        duration,
        screen: Some(screen),
        camera: probe_video(&dir.join("camera.mp4"), &rel("camera.mp4"), 1.0).map(|(v, _)| v),
        mic: probe_audio(&dir.join("mic.m4a"), &rel("mic.m4a")),
        system: probe_audio(&dir.join("system.m4a"), &rel("system.m4a")),
        events: dir.join("events.jsonl").exists().then(|| rel("events.jsonl")),
    })
}

/// A recording a crash or power loss cut short ends in movie fragments that the editor's demuxer
/// stops before: rewrite each such file as a regular MP4 (passthrough, no re-encode). Files that
/// are already whole are left alone. Rejects with the first file that could not be repaired.
#[napi]
pub async fn repair_recording(bundle_dir: String) -> napi::Result<()> {
    spawn_blocking(move || repair(Path::new(&bundle_dir)))
        .await
        .map_err(|e| napi::Error::from_reason(e.to_string()))?
        .map_err(napi::Error::from_reason)
}
