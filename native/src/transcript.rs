//! Owner: transcript. On-device speech to text with NVIDIA Parakeet TDT 0.6B v3 (25 European
//! languages, keeps filler words, word timings) through parakeet-rs and ONNX Runtime.
//!
//! JS: `transcribe(path, { modelDir }, onProgress, signal?) -> Promise<TranscriptWord[]>`.
//! Word times are seconds into the audio file, which is source time for the mic track.
//! The model files are downloaded by electron/transcript.ts.

#![cfg_attr(test, allow(dead_code))] // napi registers the exports outside of test builds

use std::path::Path;
use std::ptr::NonNull;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use napi::bindgen_prelude::{AbortSignal, AsyncTask};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, Status, Task};
use napi_derive::napi;
use objc2::rc::autoreleasepool;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{AVAssetReader, AVAssetReaderStatus, AVAssetReaderTrackOutput, AVMediaTypeAudio, AVURLAsset};
use objc2_avf_audio::{
    AVFormatIDKey, AVLinearPCMBitDepthKey, AVLinearPCMIsBigEndianKey, AVLinearPCMIsFloatKey, AVLinearPCMIsNonInterleaved,
    AVNumberOfChannelsKey, AVSampleRateKey,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};
use parakeet_rs::{ParakeetTDT, TimedToken, TimestampMode, Transcriber};

const RATE: usize = 16_000;
/// Parakeet's full-attention encoder slows down and degrades past a few minutes, and it drops
/// speech cut at a window edge. So it hears CHUNK-sample windows that overlap by OVERLAP, and the
/// windows are stitched at a pause inside the overlap (see `merge`).
const CHUNK: usize = 60 * RATE;
const OVERLAP: usize = 10 * RATE;
/// One encoder frame (8x subsampled 10 ms hops): the timing resolution of the model.
const FRAME: f64 = 0.08;
const LPCM: u32 = u32::from_be_bytes(*b"lpcm"); // kAudioFormatLinearPCM
const CANCELLED: &str = "Transcription cancelled";

#[napi(object)]
#[derive(Clone, Debug, PartialEq)]
pub struct TranscriptWord {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[napi(object)]
pub struct TranscribeOptions {
    /// Folder with encoder-model.int8.onnx, decoder_joint-model.int8.onnx and vocab.txt.
    pub model_dir: String,
}

pub struct Transcribe {
    path: String,
    model_dir: String,
    cancel: Arc<AtomicBool>,
    progress: ThreadsafeFunction<f64, (), f64, Status, false>,
}

impl Task for Transcribe {
    type Output = Vec<TranscriptWord>;
    type JsValue = Vec<TranscriptWord>;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let progress = |p: f64| {
            self.progress.call(p, ThreadsafeFunctionCallMode::NonBlocking);
        };
        run(Path::new(&self.path), Path::new(&self.model_dir), &self.cancel, progress).map_err(Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, words: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(words)
    }
}

/// Transcribe the first audio track of `path`. `onProgress` gets 0..1; aborting `signal` stops
/// within one chunk and rejects with "Transcription cancelled".
#[napi(ts_return_type = "Promise<Array<TranscriptWord>>")]
pub fn transcribe(
    path: String,
    opts: TranscribeOptions,
    #[napi(ts_arg_type = "(progress: number) => void")] on_progress: ThreadsafeFunction<f64, (), f64, Status, false>,
    signal: Option<AbortSignal>,
) -> AsyncTask<Transcribe> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(s) = &signal {
        let c = cancel.clone();
        s.on_abort(move || c.store(true, Ordering::Relaxed));
    }
    AsyncTask::with_optional_signal(Transcribe { path, model_dir: opts.model_dir, cancel, progress: on_progress }, signal)
}

fn run(path: &Path, model_dir: &Path, cancel: &AtomicBool, progress: impl Fn(f64)) -> Result<Vec<TranscriptWord>, String> {
    // CPU with 4 threads (the default), which leaves cores for the editor. Measured on Apple silicon,
    // 115 s of speech: CPU 4.4 s, CoreML 11.6 s (dynamic shapes defeat it, and it logs leaks).
    // Loaded on the first window, so a file without audio fails fast and costs no model load.
    let mut model: Option<ParakeetTDT> = None;
    let mut words = Vec::new();
    let mut hear = |samples: &[f32], offset: usize, words: &mut Vec<TranscriptWord>| -> Result<(), String> {
        if model.is_none() {
            model = Some(ParakeetTDT::from_pretrained(model_dir, None).map_err(|e| format!("Could not load the speech model: {e}"))?);
        }
        let r = model
            .as_mut()
            .unwrap()
            .transcribe_samples(samples.to_vec(), RATE as u32, 1, Some(TimestampMode::Tokens))
            .map_err(|e| format!("Speech recognition failed: {e}"))?;
        let start = offset as f64 / RATE as f64;
        let mut new = group_words(&r.tokens, start);
        snap_to_pauses(&mut new, samples, start);
        merge(words, new, start, OVERLAP as f64 / RATE as f64);
        Ok(())
    };
    let mut buf: Vec<f32> = Vec::with_capacity(CHUNK);
    let mut offset = 0; // file sample index of buf[0]
    progress(0.0);
    decode(path, |samples, duration| {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        buf.extend_from_slice(samples);
        while buf.len() >= CHUNK {
            hear(&buf[..CHUNK], offset, &mut words)?;
            buf.drain(..CHUNK - OVERLAP);
            offset += CHUNK - OVERLAP;
            progress((offset as f64 / RATE as f64 / duration).min(0.99));
            if cancel.load(Ordering::Relaxed) {
                return Err(CANCELLED.into());
            }
        }
        Ok(())
    })?;
    if cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED.into());
    }
    // The tail the last full window did not reach (or the whole file when it is shorter than one).
    // Under 100 ms there is no word to hear.
    if buf.len() >= RATE / 10 && (offset == 0 || buf.len() > OVERLAP) {
        hear(&buf, offset, &mut words)?;
    }
    for w in &mut words {
        (w.start, w.end) = ((w.start * 1000.0).round() / 1000.0, (w.end * 1000.0).round() / 1000.0); // ms is plenty
    }
    progress(1.0);
    Ok(words)
}

/// Stream the first audio track of `path` as 16 kHz mono f32. Samples are placed by their
/// timestamps (gaps become silence), so sample index / 16000 is always file time.
/// `sink` gets each block and the file duration in seconds; an Err from it stops decoding.
fn decode(path: &Path, mut sink: impl FnMut(&[f32], f64) -> Result<(), String>) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("Audio file not found: {}", path.display()));
    }
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let asset = AVURLAsset::URLAssetWithURL_options(&url, None);
        #[allow(deprecated)] // the async loaders need a run loop; this runs on a worker thread
        let (tracks, duration) = (asset.tracksWithMediaType(AVMediaTypeAudio.unwrap()), asset.duration());
        let track = tracks.firstObject().ok_or("This recording has no audio track")?;
        let duration = (duration.value as f64 / duration.timescale.max(1) as f64).max(1.0 / RATE as f64);

        let keys = [
            AVFormatIDKey.unwrap(),
            AVSampleRateKey.unwrap(),
            AVNumberOfChannelsKey.unwrap(),
            AVLinearPCMBitDepthKey.unwrap(),
            AVLinearPCMIsFloatKey.unwrap(),
            AVLinearPCMIsBigEndianKey.unwrap(),
            AVLinearPCMIsNonInterleaved.unwrap(),
        ];
        let values = [
            NSNumber::numberWithUnsignedInt(LPCM),
            NSNumber::numberWithDouble(RATE as f64),
            NSNumber::numberWithUnsignedInt(1),
            NSNumber::numberWithUnsignedInt(32),
            NSNumber::numberWithBool(true),
            NSNumber::numberWithBool(false),
            NSNumber::numberWithBool(false),
        ];
        let values: Vec<&AnyObject> = values.iter().map(|v| -> &AnyObject { v }).collect();
        let settings = NSDictionary::from_slices(&keys, &values);
        let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&track, Some(&settings));
        let reader = AVAssetReader::assetReaderWithAsset_error(&asset)
            .map_err(|e| format!("Could not read {}: {}", path.display(), e.localizedDescription()))?;
        if !reader.canAddOutput(&output) {
            return Err(format!("Could not decode the audio in {}", path.display()));
        }
        reader.addOutput(&output);
        if !reader.startReading() {
            let why = reader.error().map(|e| e.localizedDescription().to_string()).unwrap_or_default();
            return Err(format!("Could not read {}: {why}", path.display()));
        }

        let mut written = 0usize;
        let silence = [0f32; 4096];
        loop {
            let step = autoreleasepool(|_| -> Result<bool, String> {
                let Some(sample) = output.copyNextSampleBuffer() else { return Ok(false) };
                let Some(block) = sample.data_buffer() else { return Ok(true) };
                let len = block.data_length();
                let mut pcm = vec![0f32; len / 4];
                if len >= 4 && block.copy_data_bytes(0, pcm.len() * 4, NonNull::new_unchecked(pcm.as_mut_ptr().cast())) != 0 {
                    return Err(format!("Could not decode the audio in {}", path.display()));
                }
                let pts = sample.presentation_time_stamp();
                let at = (pts.value as f64 / pts.timescale.max(1) as f64 * RATE as f64).round().max(0.0) as usize;
                // A hole in the track (more than 10 ms): keep later samples at their real time.
                if at > written + RATE / 100 {
                    let mut gap = at - written;
                    while gap > 0 {
                        let n = gap.min(silence.len());
                        sink(&silence[..n], duration)?;
                        gap -= n;
                    }
                    written = at;
                }
                written += pcm.len();
                sink(&pcm, duration)?;
                Ok(true)
            });
            match step {
                Ok(true) => {}
                Ok(false) => break,
                Err(e) => {
                    reader.cancelReading();
                    return Err(e);
                }
            }
        }
        if reader.status() == AVAssetReaderStatus::Failed {
            let why = reader.error().map(|e| e.localizedDescription().to_string()).unwrap_or_default();
            return Err(format!("Could not read {}: {why}", path.display()));
        }
    }
    Ok(())
}

/// Opening marks glue to the word after them; every other lone punctuation mark to the word before.
const OPENING: &str = "¿¡«“„‘‚([{\"'";

/// SentencePiece tokens -> words. A token that starts with a space (▁) starts a word; punctuation
/// joins its word without moving the word's end, so a late "." does not stretch the timing.
/// Repeated words are kept: a stutter is something the user may want to cut.
fn group_words(tokens: &[TimedToken], offset: f64) -> Vec<TranscriptWord> {
    let mut out: Vec<TranscriptWord> = Vec::new();
    let mut opening = String::new();
    let mut boundary = true;
    for t in tokens {
        let text = t.text.trim();
        if text.is_empty() || text == "<unk>" {
            boundary = true;
            continue;
        }
        let starts = boundary || t.text.starts_with(' ') || out.is_empty();
        boundary = false;
        let punct = !text.chars().any(char::is_alphanumeric);
        let (start, end) = (offset + t.start as f64, offset + t.end as f64);
        if punct && (out.is_empty() || (starts && text.chars().all(|c| OPENING.contains(c)))) {
            opening.push_str(text);
            boundary = true;
        } else if punct {
            out.last_mut().unwrap().text.push_str(if starts { t.text.as_str() } else { text });
        } else if starts {
            out.push(TranscriptWord { start, end, text: std::mem::take(&mut opening) + text });
        } else if let Some(w) = out.last_mut() {
            w.text.push_str(text);
            w.end = w.end.max(end);
        }
    }
    if let Some(w) = out.last_mut() {
        w.text.push_str(&opening);
    }
    // A token with duration 0 ends where it starts; give every word at least one frame.
    for i in 0..out.len() {
        let next = out.get(i + 1).map_or(f64::INFINITY, |n| n.start);
        let w = &mut out[i];
        w.end = w.end.max((w.start + FRAME).min(next)).max(w.start);
    }
    out
}

/// Parakeet's word edges can be off by 300 ms around pauses: full attention lets it emit a word
/// before it is spoken, and a sentence's last token often spans the silence after it. Cuts between
/// words must not clip speech, so where the audio has a clear pause near the gap between two words,
/// move both edges onto that pause. Inside continuous speech the model's timing stays.
fn snap_to_pauses(words: &mut [TranscriptWord], samples: &[f32], offset: f64) {
    const HOP: usize = RATE / 100; // 10 ms frames
    const NEAR: f64 = 0.3;
    if words.is_empty() || samples.len() < HOP {
        return;
    }
    let db: Vec<f32> =
        samples.chunks(HOP).map(|c| 10.0 * (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32 + 1e-10).log10()).collect();
    // Calibrate to this recording: a pause is 40 dB under its loud speech (codec noise in digital
    // silence sits around -80 dBFS), and clearly above its noise floor (a room hum, a fan).
    let mut sorted = db.clone();
    sorted.sort_by(f32::total_cmp);
    let (floor, loud) = (sorted[sorted.len() / 10], sorted[sorted.len() * 95 / 100]);
    let quiet = (loud - 40.0).max(floor + 10.0);
    let mut pauses = Vec::new(); // quiet runs of 100 ms or more, in seconds
    let mut from = None;
    for (i, &d) in db.iter().chain([f32::INFINITY].iter()).enumerate() {
        match (d < quiet, from) {
            (true, None) => from = Some(i),
            (false, Some(f)) => {
                if i - f >= 10 {
                    pauses.push((offset + f as f64 / 100.0, offset + i as f64 / 100.0));
                }
                from = None;
            }
            _ => {}
        }
    }
    let original = words.to_vec();
    let end = offset + samples.len() as f64 / RATE as f64;
    // Gap i sits before word i: from the window start before the first word, to the window end
    // after the last. A pause and a gap pair up only when each lines up best with the other.
    let gaps: Vec<(f64, f64)> = (0..=words.len())
        .map(|i| (if i == 0 { offset } else { original[i - 1].end }, original.get(i).map_or(end, |w| w.start)))
        .collect();
    let near = |g: &(f64, f64), p: &(f64, f64)| p.0 < g.1 + NEAR && p.1 > g.0 - NEAR;
    // How well two intervals line up: their overlap, or minus the distance between them.
    let fit = |g: &(f64, f64), p: &(f64, f64)| g.1.min(p.1) - g.0.max(p.0);
    let nearest = |of: &(f64, f64), among: &[(f64, f64)]| {
        among.iter().enumerate().filter(|(_, x)| near(of, x) && near(x, of)).max_by(|(_, x), (_, y)| fit(of, x).total_cmp(&fit(of, y))).map(|(i, _)| i)
    };
    // Each matched pair pins model time to audio time at both edges of the pause; words between two
    // pins stretch linearly, so a phrase the model placed 300 ms early lands on its speech, whole.
    let mut pins = vec![(offset, offset)];
    for (i, g) in gaps.iter().enumerate() {
        let Some(p) = nearest(g, &pauses) else { continue };
        if nearest(&pauses[p], &gaps) != Some(i) {
            continue;
        }
        for pin in [(g.0, pauses[p].0), (g.1, pauses[p].1)] {
            let last = pins[pins.len() - 1];
            if pin.0 >= last.0 && pin.1 >= last.1 {
                pins.push(pin);
            }
        }
    }
    if pins[pins.len() - 1].0 < end {
        pins.push((end, end));
    }
    // Interpolate between the pins around model time `t`. At a pin shared by a word end and the next
    // word start (a zero-length gap), an end takes the pin before the pause, a start the one after.
    let warp = |t: f64, start: bool| {
        let k = pins.partition_point(|p| if start { p.0 <= t } else { p.0 < t }).clamp(1, pins.len() - 1);
        let ((m0, t0), (m1, t1)) = (pins[k - 1], pins[k]);
        if m1 - m0 < 1e-9 { if start { t1 } else { t0 } } else { t0 + (t - m0) / (m1 - m0) * (t1 - t0) }
    };
    for (w, o) in words.iter_mut().zip(original) {
        (w.start, w.end) = (warp(o.start, true), warp(o.end, false));
        // A word squeezed to nothing was spoken too quietly to see: trust the model for it.
        if w.end - w.start < FRAME / 2.0 {
            *w = o;
        }
    }
}

/// Stitch a window's words onto the transcript so far. The window starts at `start`; the previous
/// one heard until `start + overlap`. Each is unreliable near its own edge, so cut at the widest
/// pause that ends a word in the middle half of the overlap, and take each word (by its midpoint)
/// from the old window before the cut and from the new one after it.
fn merge(out: &mut Vec<TranscriptWord>, new: Vec<TranscriptWord>, start: f64, overlap: f64) {
    if out.is_empty() {
        return out.extend(new);
    }
    let (lo, hi) = (start + overlap * 0.25, start + overlap * 0.75);
    let mut cut = (lo + hi) / 2.0;
    let mut widest = f64::NEG_INFINITY;
    for (i, w) in out.iter().enumerate() {
        if w.end < lo || w.end > hi {
            continue;
        }
        let gap = out.get(i + 1).map_or(hi, |n| n.start) - w.end;
        if gap > widest {
            widest = gap;
            cut = (w.end + gap.max(0.0) / 2.0).min(hi);
        }
    }
    let mid = |w: &TranscriptWord| (w.start + w.end) / 2.0;
    out.retain(|w| mid(w) < cut);
    out.extend(new.into_iter().filter(|w| mid(w) >= cut));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn tok(text: &str, start: f32, end: f32) -> TimedToken {
        TimedToken { text: text.into(), start, end }
    }
    fn texts(w: &[TranscriptWord]) -> Vec<&str> {
        w.iter().map(|w| w.text.as_str()).collect()
    }

    #[test]
    fn groups_tokens_into_words() {
        let t = [
            tok(" H", 0.0, 0.08),
            tok("i", 0.08, 0.16),
            tok("!", 0.8, 0.88), // late punctuation must not stretch the word
            tok(" Um", 1.0, 1.2),
            tok(",", 1.2, 1.2),
            tok(" ¿", 2.0, 2.0),
            tok("Qué", 2.0, 2.3),
            tok(" the", 3.0, 3.1),
            tok(" the", 3.2, 3.2), // stutter kept; zero duration gets one frame
            tok(" Bonjour", 4.0, 4.4),
            tok(" !", 4.4, 4.5),
        ];
        let w = group_words(&t, 10.0);
        assert_eq!(texts(&w), ["Hi!", "Um,", "¿Qué", "the", "the", "Bonjour !"]);
        assert_eq!(w[0].start, 10.0);
        assert!((w[0].end - 10.16).abs() < 1e-5);
        assert!((w[4].end - w[4].start - FRAME).abs() < 1e-5);
    }

    #[test]
    fn snaps_word_edges_onto_pauses() {
        // Speech: "Hi" "um" "so today name." "Then" "first," "you click", silence around each.
        let runs = [(0.62, 1.0), (1.23, 1.52), (1.75, 3.0), (3.5, 4.0), (4.2, 4.67), (4.89, 5.6)];
        let samples: Vec<f32> = (0..6 * RATE)
            .map(|i| i as f64 / RATE as f64)
            .map(|t| if runs.iter().any(|&(a, b)| t >= a && t < b) { (t * 300.0 * std::f64::consts::TAU).sin() as f32 * 0.3 } else { 0.0005 })
            .collect();
        // What Parakeet reported (early starts, late ends), in a window that starts at 5 s.
        let w = |start: f64, end: f64, text: &str| TranscriptWord { start: start + 5.0, end: end + 5.0, text: text.into() };
        let mut words = vec![
            w(0.32, 0.64, "Hi!"),
            w(1.12, 1.36, "Um,"),
            w(1.76, 2.0, "so"),
            w(2.0, 2.8, "today"),
            w(2.8, 3.3, "name."), // the pause after it must not go to the zero gap before it
            w(3.4, 3.8, "Then"),
            w(4.11, 4.35, "first,"),
            w(4.75, 4.99, "you"), // nor this pause to the zero gap after the short "you"
            w(4.99, 5.31, "click"),
        ];
        snap_to_pauses(&mut words, &samples, 5.0);
        let got: Vec<(f64, f64)> = words.iter().map(|w| (((w.start - 5.0) * 100.0).round(), ((w.end - 5.0) * 100.0).round())).collect();
        // Edges sit on the pauses; words inside one stretch of speech keep their relative timing.
        let want = [(62., 100.), (123., 152.), (175., 194.), (194., 259.), (259., 300.), (350., 400.), (420., 467.), (489., 519.), (519., 560.)];
        assert_eq!(got, want);
    }

    #[test]
    fn merge_keeps_every_word_once_across_windows() {
        // Ground truth: a word every 0.5 s (0.3 s long) from 0 to 120 s, with a 0.6 s pause at 52 s.
        let truth: Vec<TranscriptWord> = (0..240)
            .map(|i| i as f64 * 0.5 + if i as f64 * 0.5 >= 52.0 { 0.6 } else { 0.0 })
            .map(|s| TranscriptWord { start: s, end: s + 0.3, text: format!("w{s:.1}") })
            .collect();
        let window = |a: f64, b: f64, jitter: f64| -> Vec<TranscriptWord> {
            // What one window hears: words fully inside, minus the one at each cut edge, timed a bit off.
            truth
                .iter()
                .filter(|w| (a == 0.0 || w.start >= a + 0.2) && w.end <= b - 0.2)
                .map(|w| TranscriptWord { start: w.start + jitter, end: w.end + jitter, ..w.clone() })
                .collect()
        };
        let mut out = Vec::new();
        merge(&mut out, window(0.0, 60.0, 0.0), 0.0, 10.0);
        merge(&mut out, window(50.0, 110.0, 0.04), 50.0, 10.0);
        merge(&mut out, window(100.0, 130.0, -0.04), 100.0, 10.0);
        assert_eq!(texts(&out), texts(&truth));
    }

    /// AVAssetReader decode: AAC priming must not shift time, stereo 48 kHz must come out mono 16 kHz.
    #[test]
    fn decodes_to_16k_mono_on_source_time() {
        let dir = std::env::temp_dir().join(format!("studio-transcript-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 0.5 s of silence, 1 s of a 440 Hz tone, 0.5 s of silence; 48 kHz stereo 16-bit WAV.
        let (rate, n) = (48_000u32, 96_000usize);
        let mut pcm = Vec::with_capacity(n * 4);
        for i in 0..n {
            let t = i as f64 / rate as f64;
            let v = if (0.5..1.5).contains(&t) { (t * 440.0 * std::f64::consts::TAU).sin() * 0.5 } else { 0.0 };
            let s = ((v * 32767.0) as i16).to_le_bytes();
            pcm.extend_from_slice(&[s[0], s[1], s[0], s[1]]);
        }
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        for v in [16u32, 1 | (2 << 16), rate, rate * 4, 4 | (16 << 16)] {
            wav.extend_from_slice(&v.to_le_bytes());
        }
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
        wav.extend_from_slice(&pcm);
        let wav_path = dir.join("tone #1 ✨.wav");
        let m4a_path = dir.join("tone #1 ✨.m4a");
        std::fs::write(&wav_path, wav).unwrap();
        let ok = Command::new("afconvert").args(["-f", "m4af", "-d", "aac"]).arg(&wav_path).arg(&m4a_path).status().unwrap();
        assert!(ok.success());

        for path in [&wav_path, &m4a_path] {
            let mut got = Vec::new();
            decode(path, |s, d| {
                assert!((d - 2.0).abs() < 0.05, "duration {d}");
                got.extend_from_slice(s);
                Ok(())
            })
            .unwrap();
            assert!((got.len() as i64 - 32_000).abs() < 400, "{} samples from {}", got.len(), path.display());
            let onset = got.iter().position(|v| v.abs() > 0.1).unwrap() as f64 / RATE as f64;
            assert!((onset - 0.5).abs() < 0.01, "tone starts at {onset} in {}", path.display());
            let peak = got.iter().fold(0f32, |m, v| m.max(v.abs()));
            assert!(peak > 0.3 && peak < 0.8, "peak {peak}"); // stereo downmix pans at -3 dB
        }
        assert!(decode(&dir.join("missing.m4a"), |_, _| Ok(())).unwrap_err().contains("not found"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The real model on real speech, filler words kept. Needs the downloaded model:
    /// `STUDIO_MODEL_DIR=<userData>/models/parakeet-tdt-0.6b-v3-int8 cargo test --release -- --ignored`
    #[test]
    #[ignore]
    fn transcribes_speech_with_fillers() {
        let model = std::env::var("STUDIO_MODEL_DIR").expect("STUDIO_MODEL_DIR");
        let dir = std::env::temp_dir().join(format!("studio-transcribe-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let speech = dir.join("speech #1 ✨.aiff");
        let text = "[[slnc 1000]] Hello, um, this is a test of the speech model. [[slnc 1500]] Uh, it keeps filler words.";
        assert!(Command::new("say").args(["-v", "Samantha", "-o"]).arg(&speech).arg(text).status().unwrap().success());
        let cancel = AtomicBool::new(false);
        let words = run(&speech, Path::new(&model), &cancel, |_| {}).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        let said: Vec<String> = words.iter().map(|w| w.text.to_lowercase().replace(|c: char| !c.is_alphanumeric(), "")).collect();
        assert_eq!(&said[..4], ["hello", "um", "this", "is"], "{said:?}");
        assert!(said.iter().any(|w| w == "uh" || w == "ah"), "{said:?}");
        assert!(words[0].start > 0.9 && words[0].start < 1.3, "speech starts after 1 s of silence: {:?}", words[0]);
        assert!(words.windows(2).all(|p| p[0].start <= p[1].start && p[0].end <= p[1].start + 1e-9));
    }
}
