//! Recordings cut short by a crash, power loss, or kill -9. Their files end in movie fragments
//! that ffmpeg and AVFoundation read but the editor's demuxer stops before, so each one is cut
//! back to its last whole sample, remuxed (passthrough, no re-encode) into a regular MP4, then
//! probed into the project's sources.

use std::collections::HashMap;
use std::fs::File;
use std::os::unix::fs::FileExt;
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

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at.checked_add(4)?)?.try_into().ok()?))
}
fn be64(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(at..at.checked_add(8)?)?.try_into().ok()?))
}

/// The box at the start of `b`, which has `len` bytes left to the end of the file:
/// (type, header length, size). None when its header is torn or invalid.
fn header(b: &[u8], len: u64) -> Option<([u8; 4], u64, u64)> {
    let kind = b.get(4..8)?.try_into().ok()?;
    let (hdr, size) = match be32(b, 0)? {
        0 => (8, len), // runs to the end of the file
        1 => (16, be64(b, 8)?),
        n => (8, n as u64),
    };
    (size >= hdr).then_some((kind, hdr, size))
}

/// Child boxes of a box body: (type, offset of the child in `body`, its header length, its body).
fn children(body: &[u8]) -> Vec<([u8; 4], usize, usize, &[u8])> {
    let mut out = vec![];
    let mut at = 0;
    while let Some((kind, hdr, size)) = body.get(at..).and_then(|b| header(b, b.len() as u64))
        && let Some(child) = body.get(at + hdr as usize..at.saturating_add(size as usize))
    {
        out.push((kind, at, hdr as usize, child));
        at += size as usize;
    }
    out
}

/// The top-level box at `pos` of a file of `len` bytes, as `header`.
fn top(f: &File, pos: u64, len: u64) -> Option<([u8; 4], u64, u64)> {
    let mut b = [0u8; 16];
    let n = len.checked_sub(pos)?.min(16) as usize;
    f.read_exact_at(&mut b[..n], pos).ok()?;
    header(&b[..n], len - pos)
}

/// True when the file has top-level movie fragments: written but never finalized.
pub fn is_fragmented(path: &Path) -> bool {
    let Ok(f) = File::open(path) else { return false };
    let len = f.metadata().map_or(0, |m| m.len());
    let mut pos = 0u64;
    while let Some((kind, _, size)) = top(&f, pos, len) {
        if &kind == b"moof" {
            return true;
        }
        pos = pos.saturating_add(size);
    }
    false
}

/// Default sample size per track ID (trex), from a moov body.
fn default_sizes(moov: &[u8]) -> HashMap<u32, u32> {
    let mvex = children(moov).into_iter().filter(|c| &c.0 == b"mvex");
    let trex = mvex.flat_map(|c| children(c.3)).filter(|c| &c.0 == b"trex");
    trex.filter_map(|c| Some((be32(c.3, 4)?, be32(c.3, 16)?))).collect()
}

/// What of a movie fragment lies in the first `len` bytes of its file.
struct Fragment {
    /// Samples kept, whether that is all of them, and where their data ends.
    kept: u64,
    whole: bool,
    end: u64,
    /// The moof listing just the samples kept: shorter when some were dropped.
    moof: Vec<u8>,
}

/// Make the box at `at` in `b` `by` bytes shorter. None for a box with a 64-bit or open size.
fn shrink(b: &mut [u8], at: usize, by: usize) -> Option<()> {
    let size = (be32(b, at)? as usize).checked_sub(by).filter(|&s| s >= 8)?;
    b[at..at + 4].copy_from_slice(&(size as u32).to_be_bytes());
    Some(())
}

/// The samples of `moof` (the whole box, at `start` in a file of `len` bytes) whose data is all in
/// the file: each track keeps the samples before its first missing one. None when malformed.
fn fragment(moof: &[u8], start: u64, len: u64, sizes: &HashMap<u32, u32>) -> Option<Fragment> {
    let (_, hdr, _) = header(moof, moof.len() as u64)?;
    let mut out = Fragment { kept: 0, whole: true, end: 0, moof: moof.to_vec() };
    let mut cuts = vec![]; // (traf, trun, its header length, its bytes kept, samples kept): offsets in the moof
    let mut next = start; // a traf without a base offset continues after the previous one's data
    for (kind, at, traf_hdr, traf) in children(&moof[hdr as usize..]) {
        if &kind != b"traf" {
            continue;
        }
        let at = hdr as usize + at;
        let boxes = children(traf);
        let tfhd = boxes.iter().find(|b| &b.0 == b"tfhd")?.3;
        let flags = be32(tfhd, 0)? & 0xff_ffff;
        let base = match flags {
            f if f & 0x1 != 0 => be64(tfhd, 8)?,
            f if f & 0x2_0000 != 0 => start, // default-base-is-moof
            _ => next,
        };
        // Optional fields: base data offset, sample description index, duration, size.
        let size_at = 8 + 8 * (flags & 0x1) as usize + 4 * ((flags >> 1 & 1) + (flags >> 3 & 1)) as usize;
        let default = match flags & 0x10 {
            0 => *sizes.get(&be32(tfhd, 4)?)?,
            _ => be32(tfhd, size_at)?,
        } as u64;
        let (mut pos, mut cut) = (base, false);
        for (kind, run_at, run_hdr, trun) in boxes {
            if &kind != b"trun" {
                continue;
            }
            let flags = be32(trun, 0)? & 0xff_ffff;
            let count = be32(trun, 4)?;
            if flags & 0x1 != 0 {
                pos = base.saturating_add_signed(be32(trun, 8)? as i32 as i64);
            }
            // After the data offset and first sample flags, per sample: duration, size, flags,
            // composition offset, each there when its flag is set.
            let first = 8 + 4 * ((flags & 1) + (flags >> 2 & 1)) as usize;
            let entry = 4 * (flags & 0xf00).count_ones() as usize;
            let size_at = first + 4 * (flags >> 8 & 1) as usize;
            if trun.len() < first + count as usize * entry || (entry == 0 && default == 0) {
                return None;
            }
            let mut n = 0;
            while !cut && n < count {
                let size = match flags & 0x200 {
                    0 => default,
                    _ => be32(trun, size_at + n as usize * entry)? as u64,
                };
                cut = pos.saturating_add(size) > len;
                if !cut {
                    pos += size;
                    n += 1;
                }
            }
            if n < count {
                cuts.push((at, at + traf_hdr + run_at, run_hdr, run_hdr + first + n as usize * entry, n));
            }
            if n > 0 {
                out.kept += n as u64;
                out.end = out.end.max(pos);
            }
        }
        next = if cut { u64::MAX } else { pos };
    }
    // Readers ignore a trun whose box holds more entries than its count, so the entries of the
    // samples dropped go, and the trun, its traf, and the moof get shorter.
    for (traf, trun, run_hdr, keep, n) in cuts.into_iter().rev() {
        let by = (be32(&out.moof, trun)? as usize).checked_sub(keep)?;
        out.moof.drain(trun + keep..trun + keep + by);
        for at in [0, traf, trun] {
            shrink(&mut out.moof, at, by)?;
        }
        out.moof[trun + run_hdr + 4..][..4].copy_from_slice(&n.to_be_bytes());
        out.whole = false;
    }
    Some(out)
}

/// Cut a file torn mid-fragment back to its last whole sample, in place: AVFoundation refuses a
/// fragment that points past the end of the file ("Invalid sample cursor"). A fragment whose moof
/// is torn or has no whole sample is dropped, one whose data was cut keeps its whole samples, and
/// the torn tail goes: only bytes no reader can use. Idempotent, so a crash mid-way is repaired
/// by the next try.
fn trim(path: &Path) -> Result<(), String> {
    let f = File::options().read(true).write(true).open(path).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let read = |from: u64, to: u64| {
        let mut b = vec![0u8; (to - from) as usize];
        f.read_exact_at(&mut b, from).map(|_| b).map_err(|e| e.to_string())
    };
    // Bytes to keep, and the boxes to write at `pos` once the file is cut there: the moof of the
    // fragment cut short (the box after it is at `next`) and the box its samples end in.
    let (mut pos, mut next, mut keep, mut sizes, mut head) = (0u64, 0u64, 0u64, None, vec![]);
    let no_header = "It was cut off before its header was written";
    while let Some((kind, hdr, size)) = top(&f, pos, len)
        && let Some(end) = pos.checked_add(size).filter(|&end| end <= len)
        && (size < 64 << 20 || !matches!(&kind, b"moov" | b"moof")) // read whole: a few KB, never this big
    {
        if &kind == b"moov" {
            sizes = Some(default_sizes(&read(pos + hdr, end)?));
        } else if &kind == b"moof" {
            let Some(frag) =
                fragment(&read(pos, end)?, pos, len, sizes.as_ref().ok_or(no_header)?).filter(|f| f.kept > 0)
            else {
                break;
            };
            keep = keep.max(frag.end);
            if !frag.whole {
                (head, next) = (frag.moof, end);
                break; // the rest is the torn tail
            }
        }
        keep = keep.max(end);
        (pos, next) = (end, end);
    }
    if sizes.is_none() {
        return Err(no_header.into());
    }
    // The box the samples kept end in (the torn mdat after their moof) now ends with them, and
    // starts right where the moof does.
    let at = pos + head.len() as u64;
    if keep > at {
        let (kind, hdr, _) = top(&f, next, len).ok_or("Damaged movie fragment")?;
        let size = keep - at;
        head.extend(match (hdr, u32::try_from(size)) {
            (16, _) => [&1u32.to_be_bytes()[..], &kind, &size.to_be_bytes()].concat(),
            (_, Ok(size)) => [&size.to_be_bytes()[..], &kind].concat(),
            _ => [&[0; 4][..], &kind].concat(), // over 4 GB with a 32-bit header: to the end of the file
        });
    }
    // Cut first: a crash before the write leaves a file this repairs the same way.
    f.set_len(keep).and_then(|_| f.write_all_at(&head, pos)).map_err(|e| e.to_string())
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
            && let Err(e) = trim(&path).and_then(|_| remux(&path))
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

#[cfg(test)]
mod tests {
    use super::super::synthetic::Pattern;
    use super::super::tests::decodes;
    use super::*;
    use crate::writer::{AudioWriter, VideoSpec, VideoWriter};
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    /// Every packet in decode order, edit lists ignored: (byte offset, size).
    fn packets(file: &Path) -> Vec<(u64, u64)> {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-ignore_editlist", "1", "-of", "csv=p=0", "-show_entries", "packet=size,pos"])
            .arg(file)
            .output()
            .unwrap();
        let csv = String::from_utf8_lossy(&out.stdout);
        csv.lines().filter_map(|l| l.split_once(',').and_then(|(s, p)| Some((p.parse().ok()?, s.parse().ok()?)))).collect()
    }

    /// Top-level boxes: (type, offset, end).
    fn boxes(file: &Path) -> Vec<([u8; 4], u64, u64)> {
        let f = File::open(file).unwrap();
        let len = f.metadata().unwrap().len();
        let (mut out, mut pos) = (vec![], 0);
        while let Some((kind, _, size)) = top(&f, pos, len) {
            out.push((kind, pos, pos + size));
            pos += size;
        }
        out
    }

    /// What a crash leaves, 5 s in fragments of about 1 s: our writer's files (each fragment's moof
    /// after its samples) and ffmpeg's (moof first), video and audio. (bundle name, file, moof last).
    fn crashed(dir: &Path) -> Vec<(&'static str, PathBuf, bool)> {
        fs::create_dir_all(dir).unwrap();
        let screen = dir.join("writer.mp4");
        let spec = VideoSpec { width: 320, height: 180, fps: 30.0, bits_per_pixel: 0.3, realtime: false };
        let mut video = VideoWriter::new(&screen, spec).unwrap();
        let pattern = Pattern::new(320, 180);
        let system = dir.join("writer.m4a");
        let mut audio = AudioWriter::new(&system, 48_000.0, 2).unwrap();
        for i in 0..235u64 {
            if i < 150 {
                assert!(video.frame(pattern.frame(i).unwrap(), Some(i as f64 / 30.0)));
            }
            let tone: Vec<f32> = (0..2048).map(|k| ((i * 1024 + k / 2) as f32 * 0.06).sin() * 0.3).collect();
            audio.push(i as f64 * 1024.0 / 48_000.0, &tone);
            std::thread::sleep(Duration::from_millis(2));
        }
        std::thread::sleep(Duration::from_millis(500));
        std::mem::forget((video, audio)); // no finish(): what a crash or power loss leaves on disk
        let ffmpeg = |input: &str, codec: &[&str], out: &Path| {
            let frag = ["-movflags", "+frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000"];
            let ok = Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-f", "lavfi", "-i", input])
                .args(codec)
                .args(frag)
                .arg(out)
                .status()
                .unwrap();
            assert!(ok.success());
            // A crash never lets it finish: no last fragment (whose short final AAC sample
            // AVFoundation leaves out) and no index.
            let last = boxes(out).iter().rfind(|b| &b.0 == b"moof").unwrap().1;
            File::options().write(true).open(out).unwrap().set_len(last).unwrap();
        };
        let camera = dir.join("ffmpeg.mp4");
        ffmpeg("testsrc2=s=320x180:r=30:d=5", &["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30"], &camera);
        let mic = dir.join("ffmpeg.m4a");
        ffmpeg("sine=f=440:d=5:sample_rate=48000", &["-ac", "2", "-c:a", "aac"], &mic);
        vec![("screen.mp4", screen, true), ("system.m4a", system, true), ("camera.mp4", camera, false), ("mic.m4a", mic, false)]
    }

    #[test]
    fn repairs_files_torn_at_any_byte() {
        let root = std::env::temp_dir().join("studio-recover-tests");
        let _ = fs::remove_dir_all(&root);
        let mut files = vec![];
        for (name, file, moof_last) in crashed(&root.join("fixtures")) {
            let (packets, boxes) = (packets(&file), boxes(&file));
            let len = boxes.last().unwrap().2;
            let moofs = boxes.iter().filter(|b| &b.0 == b"moof").count();
            assert!(moofs >= 3 && packets.len() >= 60, "{name}: {moofs} fragments, {} packets", packets.len());
            // Torn inside and at the edges of every box, and inside the first fragment's samples.
            let mut cuts: Vec<u64> = boxes.iter().flat_map(|&(_, a, b)| [a, a + 9, (a + b) / 2, b - 1]).collect();
            cuts.extend(packets[..2].iter().flat_map(|&(at, size)| [at + size / 2, at + size]));
            cuts.extend([0, len]);
            cuts.retain(|&c| c <= len);
            cuts.sort();
            cuts.dedup();
            files.push((name, file, moof_last, packets, boxes, cuts));
        }
        for k in 0..files.iter().map(|f| f.5.len()).max().unwrap() {
            let bundle = root.join(format!("Torn {k} #1 ✨ café.studio"));
            let sources = bundle.join("sources");
            fs::create_dir_all(&sources).unwrap();
            let mut expect = vec![];
            for (name, file, moof_last, packets, boxes, cuts) in &files {
                let len = cuts[k % cuts.len()];
                let path = sources.join(name);
                fs::copy(file, &path).unwrap();
                File::options().write(true).open(&path).unwrap().set_len(len).unwrap();
                // A sample survives when its data and the moof (or moov) that lists it are whole:
                // the moof next to the box holding the data, after it for our writer, before for ffmpeg.
                let listed_by = |at: u64| {
                    let i = boxes.iter().position(|b| b.1 <= at && at < b.2).unwrap();
                    let lists = |b: &&([u8; 4], u64, u64)| &b.0 == b"moof" || &b.0 == b"moov";
                    let by = if *moof_last { boxes[i..].iter().find(lists) } else { boxes[..i].iter().rfind(lists) };
                    by.map_or(u64::MAX, |b| b.2)
                };
                let whole = packets.iter().take_while(|&&(at, size)| at + size <= len && listed_by(at) <= len);
                // Cut before its first fragment, a file has nothing for a repair to save.
                let whole = is_fragmented(&path).then(|| whole.map(|p| p.1).collect::<Vec<_>>());
                expect.push((name, path, len, whole));
            }
            assert_eq!(repair(&bundle), Ok(()), "{}", bundle.display());
            for (name, path, len, whole) in expect {
                let Some(whole) = whole else {
                    assert_eq!(fs::metadata(&path).unwrap().len(), len, "{name} torn at {len}: left alone");
                    continue;
                };
                let kept: Vec<u64> = packets(&path).iter().map(|p| p.1).collect();
                assert!(kept == whole, "{name} torn at {len}: kept {} of {} whole samples", kept.len(), whole.len());
                assert!(!is_fragmented(&path), "{name} torn at {len}: a regular MP4");
                if !kept.is_empty() {
                    assert!(decodes(&path), "{name} torn at {len}: decodes");
                    let file = path.to_str().unwrap();
                    let avfoundation = match name.ends_with(".mp4") {
                        true => probe_video(&path, file, 1.0).is_some(),
                        false => probe_audio(&path, file).is_some(),
                    };
                    assert!(avfoundation, "{name} torn at {len}: AVFoundation (QuickTime) reads it");
                }
            }
            assert_eq!(fs::read_dir(&sources).unwrap().count(), 4, "no temporary file left");
        }
    }
}
