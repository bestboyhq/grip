//! Owner: audio. The voice pass: the mic as "Enhance voice" plays it, made once per recording on device.
//! DeepFilterNet3 takes the noise down by up to 30 dB, then an 80 Hz high-pass, a de-esser, and a slow
//! leveler; Silero VAD tells speech from everything else for the leveler, the de-esser, and the
//! loudness. The voice is written next to the mic as AAC at its natural level, with its speech
//! loudness, so the mixer only adds the static gain to -14 LUFS and the true-peak limiter
//! (src/engine/audio/mix.ts). Why each stage, and what was left out: .agents/skills/audio/SKILL.md.
//!
//! JS: `analyzeVoice(micPath, outPath, channels, onProgress, signal?) -> Promise<VoiceAnalysis>`.
//! Two streaming passes over the file (analysis, then render) keep memory flat at any length.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, mpsc};

use df::tract::{DfParams, DfTract, RuntimeParams};
use napi::bindgen_prelude::{AbortSignal, PromiseRaw};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, Status};
use napi_derive::napi;
use ndarray::Array2;
use ort::session::Session;
use ort::value::Tensor;

use crate::reader::decode;
use crate::writer::AudioWriter;

/// Bump whenever the pass sounds different: projects made with another one are redone on open.
pub const VOICE_CHAIN: u32 = 1;

const RATE: usize = 48_000;
const HOP: usize = 480; // DeepFilterNet's frame, 10 ms
const BLOCK: usize = RATE / 10; // 100 ms: levels, speech, loudness
/// DeepFilterNet runs on CHUNK frames per thread, each primed on the WARM frames before it (its state
/// settles within a second) and crossfaded with the previous chunk over FADE frames.
const CHUNK: usize = 20 * RATE;
const WARM: usize = 2 * RATE;
const FADE: usize = HOP;
/// Noise comes down by at most this much: more scores no better (DNSMOS) and costs intelligibility (STOI).
const REDUCTION_DB: f32 = 30.0;
const BITRATE: f64 = 192_000.0; // per channel: a second AAC generation stays transparent
const CANCELLED: &str = "Voice enhancement cancelled";
/// Below the editor's UI and audio, but on any core: utility class would park the model on the
/// efficiency cores and take 2.4x as long.
const QOS_CLASS_DEFAULT: u32 = 0x15;

unsafe extern "C" {
    fn pthread_set_qos_class_self_np(class: u32, relative_priority: i32) -> i32;
}

#[napi(object)]
pub struct VoiceAnalysis {
    /// Absolute path of the voice track: AAC, the mic's timing and channels, at its natural level.
    pub file: String,
    /// The VOICE_CHAIN that made it.
    pub chain: u32,
    /// Speech loudness of the voice track as heard (LUFS; a mono track plays on both channels).
    /// None when the take holds no speech: the mixer then leaves it unboosted.
    pub lufs: Option<f64>,
}

/// The VOICE_CHAIN of this build: a project's voice track made by another one is redone.
#[napi]
pub fn voice_chain() -> u32 {
    VOICE_CHAIN
}

#[napi(ts_return_type = "Promise<VoiceAnalysis>")]
/// The voice track of the mic at `micPath` (`channels` 1 or 2), written to `outPath` (atomically) on a
/// background thread; a 6-minute take takes about 5 s. Progress is 0..1. Aborting the signal stops it
/// and removes partial output; the promise then rejects with "Voice enhancement cancelled".
pub fn analyze_voice<'env>(
    env: &'env Env,
    mic_path: String,
    out_path: String,
    channels: u32,
    #[napi(ts_arg_type = "(progress: number) => void")] on_progress: ThreadsafeFunction<f64, (), f64, Status, false, true>,
    signal: Option<AbortSignal>,
) -> napi::Result<PromiseRaw<'env, VoiceAnalysis>> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(signal) = signal {
        let cancel = cancel.clone();
        signal.on_abort(move || cancel.store(true, Ordering::SeqCst));
    }
    let (done, result) = napi::tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("voice-pass".into())
        .spawn(move || {
            unsafe { pthread_set_qos_class_self_np(QOS_CLASS_DEFAULT, 0) };
            let ch = (channels as usize).clamp(1, 2);
            let _ = done.send(run(Path::new(&mic_path), Path::new(&out_path), ch, &cancel, |p| {
                on_progress.call(p, ThreadsafeFunctionCallMode::NonBlocking);
            }));
        })
        .map_err(|e| Error::from_reason(e.to_string()))?;
    env.spawn_future(async move { result.await.map_err(|_| Error::from_reason("voice enhancement stopped unexpectedly"))?.map_err(Error::from_reason) })
}

fn run(mic: &Path, out: &Path, ch: usize, cancel: &AtomicBool, progress: impl Fn(f64)) -> Result<VoiceAnalysis, String> {
    let partial = PathBuf::from(format!("{}.partial.m4a", out.display()));
    let cleaned = PathBuf::from(format!("{}.cleaned.f32", out.display()));
    // A pass cut short (quit, crash) starts over.
    let _ = std::fs::remove_file(&partial);
    let _ = std::fs::remove_file(&cleaned);
    let result = passes(mic, &partial, &cleaned, ch, cancel, progress);
    let _ = std::fs::remove_file(&cleaned);
    let lufs = result.inspect_err(|_| {
        let _ = std::fs::remove_file(&partial);
    })?;
    std::fs::rename(&partial, out).map_err(|e| format!("Could not save the voice track: {e}"))?;
    Ok(VoiceAnalysis { file: out.to_string_lossy().into_owned(), chain: VOICE_CHAIN, lufs })
}

/// Pass 1 cleans the take (saving the cleaned voice to `cleaned`) and measures what it needs; pass 2
/// renders the chain into `partial`. Returns the voice's speech loudness.
fn passes(mic: &Path, partial: &Path, cleaned: &Path, ch: usize, cancel: &AtomicBool, progress: impl Fn(f64)) -> Result<Option<f64>, String> {
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get()).saturating_sub(2).clamp(1, 8);
    progress(0.0);
    let mut stats = Stats::new(ch)?;
    let mut save = BufWriter::new(File::create(cleaned).map_err(|e| format!("Could not save the cleaned voice: {e}"))?);
    sweep(mic, ch, CHUNK, threads, cancel, |p| progress(p * 0.8), |raw, dn| {
        let bytes: Vec<u8> = dn.iter().flat_map(|v| v.to_le_bytes()).collect();
        save.write_all(&bytes).map_err(|e| format!("Could not save the cleaned voice: {e}"))?;
        stats.push(raw, dn)
    })?;
    save.flush().map_err(|e| format!("Could not save the cleaned voice: {e}"))?;
    drop(save);
    let plan = stats.plan();

    let mut writer = AudioWriter::offline(partial, RATE as f64, ch, BITRATE * ch as f64)?;
    let mut chain = Chain::new(ch, &plan);
    let mut written = 0usize;
    let mut write = |y: &[f32], writer: &mut AudioWriter| {
        writer.push(written as f64 / RATE as f64, y);
        written += y.len() / ch;
    };
    let rendered = replay(mic, cleaned, ch, cancel, |p| progress(0.8 + p * 0.2), |raw, dn| {
        let y = chain.push(raw, dn);
        write(&y, &mut writer);
        Ok(())
    });
    if let Err(e) = rendered {
        writer.cancel();
        return Err(e);
    }
    let y = chain.finish();
    write(&y, &mut writer);
    writer.finish(written as f64 / RATE as f64)?;
    progress(1.0);
    Ok(chain.loudness())
}

// ---------------------------------------------------------------------------------------------
// DeepFilterNet3 over a whole file, in parallel chunks

fn params() -> &'static DfParams {
    static P: OnceLock<DfParams> = OnceLock::new();
    P.get_or_init(DfParams::default) // the embedded DeepFilterNet3 model, unpacked once
}

/// A DeepFilterNet3 instance at full strength, with the thresholds its reference CLI uses.
fn model(ch: usize) -> Result<DfTract, String> {
    let rp = RuntimeParams::default_with_ch(ch).with_atten_lim(100.0).with_thresholds(-15.0, 35.0, 35.0);
    DfTract::new(params().clone(), &rp).map_err(|e| format!("Could not load the voice model: {e}"))
}

/// Cleaned frames [a, b + FADE) of interleaved `input`, whose first frame is file frame `at`, from a
/// fresh model. Frames past the input are silence.
fn clean(df: &mut DfTract, input: &[f32], at: usize, a: usize, b: usize, ch: usize) -> Result<Vec<f32>, String> {
    let delay = df.fft_size - df.hop_size + df.lookahead * df.hop_size; // STFT plus lookahead
    let want = b + FADE - at; // output frames from `at`
    let mut out = vec![0f32; (b + FADE - a) * ch];
    let (mut noisy, mut enh) = (Array2::<f32>::zeros((ch, HOP)), Array2::<f32>::zeros((ch, HOP)));
    let frames_in = input.len() / ch;
    for f in 0..(want + delay).div_ceil(HOP) {
        for j in 0..HOP {
            let i = f * HOP + j;
            for c in 0..ch {
                noisy[[c, j]] = if i < frames_in { input[i * ch + c] } else { 0.0 };
            }
        }
        df.process(noisy.view(), enh.view_mut()).map_err(|e| format!("Voice model failed: {e}"))?;
        // Output frame f*HOP + j is input frame f*HOP + j - delay.
        let t0 = (f * HOP) as isize - delay as isize + at as isize; // file frame of enh[.., 0]
        for j in 0..HOP {
            let t = t0 + j as isize;
            if t >= a as isize && (t as usize) < b + FADE {
                let o = (t as usize - a) * ch;
                for c in 0..ch {
                    out[o + c] = enh[[c, j]];
                }
            }
        }
    }
    Ok(out)
}

/// One chunk for a worker: frames [a, b), from interleaved `input` whose first frame is file frame `at`.
struct Job {
    input: Vec<f32>,
    at: usize,
    a: usize,
    b: usize,
}

/// A chunk done: its raw frames [a, b) and cleaned frames [a, b + FADE).
type Done = Result<(Vec<f32>, Vec<f32>), String>;

/// Decode `path` and clean it `chunk` frames at a time on `threads` threads, handing `consume` each
/// chunk in order: raw frames and cleaned frames (crossfaded across chunk seams). Returns the file's
/// length in frames. Workers take the next chunk as soon as they are free and a few chunks at most are
/// in flight, so memory stays flat. A chunk's output depends only on the file (each gets a fresh
/// model), so a file cleans the same way on any machine.
fn sweep(
    path: &Path,
    ch: usize,
    chunk: usize,
    threads: usize,
    cancel: &AtomicBool,
    progress: impl Fn(f64),
    mut consume: impl FnMut(&[f32], &[f32]) -> Result<(), String>,
) -> Result<usize, String> {
    // Input a chunk needs past its end: the crossfade and the model's lookahead (3 frames for DFN3).
    let reach = FADE + 4 * HOP;
    let window = threads + 2;
    std::thread::scope(|s| {
        let (job_tx, job_rx) = mpsc::channel::<(usize, Job)>();
        let job_rx = Arc::new(Mutex::new(job_rx));
        let (done_tx, done_rx) = mpsc::channel::<(usize, Done)>();
        for _ in 0..threads {
            let (jobs, done) = (job_rx.clone(), done_tx.clone());
            s.spawn(move || {
                unsafe { pthread_set_qos_class_self_np(QOS_CLASS_DEFAULT, 0) };
                loop {
                    let next = jobs.lock().ok().and_then(|rx| rx.recv().ok());
                    let Some((k, job)) = next else { break };
                    // A fresh model per chunk (30 ms against 0.5 s of work): one reused after init()
                    // keeps stale delay lines and comes out a frame off for good.
                    let r = model(ch).and_then(|mut df| clean(&mut df, &job.input, job.at, job.a, job.b, ch)).map(|dn| {
                        let raw = job.input[(job.a - job.at) * ch..(job.b - job.at) * ch].to_vec();
                        (raw, dn)
                    });
                    if done.send((k, r)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(done_tx);

        let mut buf: Vec<f32> = Vec::new(); // decoded frames from file frame `buf_at`
        let mut buf_at = 0usize;
        let mut next = 0usize; // first frame of the next chunk to hand out
        let (mut sent, mut used) = (0usize, 0usize); // chunks handed out, chunks consumed
        let mut ready = std::collections::BTreeMap::<usize, Done>::new();
        let mut tail: Vec<f32> = Vec::new(); // the last consumed chunk's cleaned frames past its end
        let mut consumed_to = 0usize; // file frame consumed so far
        let mut duration = 0f64; // seconds, from the decoder

        // Hand out every chunk whose input is in, consume finished ones in order; with `end` known,
        // run to completion. Waits only when the window is full or nothing else can happen.
        let mut pump = |buf: &mut Vec<f32>, buf_at: &mut usize, end: Option<usize>, duration: f64| -> Result<(), String> {
            loop {
                if cancel.load(Ordering::Relaxed) {
                    return Err(CANCELLED.into());
                }
                let have = *buf_at + buf.len() / ch;
                let total = end.unwrap_or(usize::MAX);
                while sent - used < window && next < total {
                    let b = (next + chunk).min(total);
                    if end.is_none() && b + reach > have {
                        break;
                    }
                    let at = next.saturating_sub(WARM);
                    let input = buf[(at - *buf_at) * ch..((b + reach).min(have) - *buf_at) * ch].to_vec();
                    job_tx.send((sent, Job { input, at, a: next, b })).map_err(|_| "Voice model stopped".to_string())?;
                    sent += 1;
                    next = b;
                    // Keep only what the next chunk's warm-up needs.
                    let keep = next.saturating_sub(WARM).max(*buf_at);
                    buf.drain(..(keep - *buf_at) * ch);
                    *buf_at = keep;
                }
                while let Ok((k, r)) = done_rx.try_recv() {
                    ready.insert(k, r);
                }
                while let Some(r) = ready.remove(&used) {
                    let (raw, mut dn) = r?;
                    for (i, t) in tail.iter().enumerate() {
                        let w = ((i / ch) as f32 + 0.5) / FADE as f32;
                        dn[i] = t * (1.0 - w) + dn[i] * w;
                    }
                    tail = dn.split_off(raw.len());
                    consume(&raw, &dn)?;
                    used += 1;
                    consumed_to += raw.len() / ch;
                    if duration > 0.0 {
                        progress((consumed_to as f64 / (duration * RATE as f64)).min(1.0));
                    }
                }
                let more_input_helps = end.is_none() && sent - used < window;
                if used == sent && (more_input_helps || next >= total) {
                    return Ok(());
                }
                if more_input_helps && ready.is_empty() && sent - used < threads {
                    return Ok(()); // workers have spare capacity: decode more first
                }
                let (k, r) = done_rx.recv().map_err(|_| "Voice model crashed".to_string())?;
                ready.insert(k, r);
            }
        };

        decode(path, RATE, ch, |samples, d| {
            duration = d;
            buf.extend_from_slice(samples);
            if buf.len() / ch >= chunk + WARM + reach {
                pump(&mut buf, &mut buf_at, None, duration)?;
            }
            Ok(())
        })?;
        let total = buf_at + buf.len() / ch;
        pump(&mut buf, &mut buf_at, Some(total), duration)?;
        Ok(total)
    })
}

/// Decode `path` again and hand `consume` its raw frames beside the cleaned frames pass 1 saved to
/// `cleaned` (f32, interleaved, same length): the render pass, without running the model twice.
fn replay(
    path: &Path,
    cleaned: &Path,
    ch: usize,
    cancel: &AtomicBool,
    progress: impl Fn(f64),
    mut consume: impl FnMut(&[f32], &[f32]) -> Result<(), String>,
) -> Result<(), String> {
    let mut file = BufReader::new(File::open(cleaned).map_err(|e| format!("Could not read the cleaned voice: {e}"))?);
    let (mut bytes, mut dn, mut done) = (Vec::new(), Vec::new(), 0usize);
    decode(path, RATE, ch, |raw, duration| {
        if cancel.load(Ordering::Relaxed) {
            return Err(CANCELLED.into());
        }
        bytes.resize(raw.len() * 4, 0);
        file.read_exact(&mut bytes).map_err(|e| format!("Could not read the cleaned voice: {e}"))?;
        dn.clear();
        dn.extend(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])));
        consume(raw, &dn)?;
        done += raw.len() / ch;
        progress((done as f64 / (duration * RATE as f64)).min(1.0));
        Ok(())
    })
}

// ---------------------------------------------------------------------------------------------
// Biquads (RBJ cookbook), float64 state

#[derive(Clone, Copy)]
struct Coefs([f64; 5]); // b0 b1 b2 a1 a2, normalized

impl Coefs {
    fn highpass(f: f64, q: f64) -> Self {
        let w = std::f64::consts::TAU * f / RATE as f64;
        let (c, al) = (w.cos(), w.sin() / (2.0 * q));
        let a0 = 1.0 + al;
        Coefs([(1.0 + c) / 2.0 / a0, -(1.0 + c) / a0, (1.0 + c) / 2.0 / a0, -2.0 * c / a0, (1.0 - al) / a0])
    }
    fn highshelf(f: f64, q: f64, gain_db: f64) -> Self {
        let a = 10f64.powf(gain_db / 40.0);
        let w = std::f64::consts::TAU * f / RATE as f64;
        let (c, al) = (w.cos(), w.sin() / (2.0 * q));
        let sq = 2.0 * a.sqrt() * al;
        let b0 = a * ((a + 1.0) + (a - 1.0) * c + sq);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * c);
        let b2 = a * ((a + 1.0) + (a - 1.0) * c - sq);
        let a0 = (a + 1.0) - (a - 1.0) * c + sq;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * c);
        let a2 = (a + 1.0) - (a - 1.0) * c - sq;
        Coefs([b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0])
    }
}

#[derive(Clone, Copy, Default)]
struct Biquad([f64; 4]); // x1 x2 y1 y2

impl Biquad {
    fn run(&mut self, k: &Coefs, x: f64) -> f64 {
        let [b0, b1, b2, a1, a2] = k.0;
        let [x1, x2, y1, y2] = self.0;
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        self.0 = [x, x1, y, y1];
        y
    }
}

// ---------------------------------------------------------------------------------------------
// Loudness: ITU-R BS.1770 K-weighting at 48 kHz, 100 ms blocks (as src/engine/audio/dsp.ts)

const K_SHELF: Coefs = Coefs([1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]);
const K_HIGHPASS: Coefs = Coefs([1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621]);

/// Channel-summed K-weighted mean square of each 100 ms, as heard: a mono track counts twice.
struct Meter {
    k: Vec<[Biquad; 2]>,
    acc: f64,
    n: usize,
    blocks: Vec<f64>,
}

impl Meter {
    fn new(ch: usize) -> Self {
        Meter { k: vec![[Biquad::default(); 2]; ch], acc: 0.0, n: 0, blocks: Vec::new() }
    }
    fn push(&mut self, frame: &[f32]) {
        let weight = if frame.len() == 1 { 2.0 } else { 1.0 };
        for (c, &x) in frame.iter().enumerate() {
            let [shelf, hp] = &mut self.k[c];
            let v = hp.run(&K_HIGHPASS, shelf.run(&K_SHELF, x as f64));
            self.acc += v * v * weight;
        }
        self.n += 1;
        if self.n == BLOCK {
            self.blocks.push(self.acc / BLOCK as f64);
            (self.acc, self.n) = (0.0, 0);
        }
    }
}

fn lufs(p: f64) -> f64 {
    -0.691 + 10.0 * p.log10()
}

/// BS.1770 gated loudness of 100 ms blocks (400 ms windows, 75% overlap), counting only windows that
/// are mostly speech; under about a second of them counts as no speech (a click mistaken for a word).
fn integrated(blocks: &[f64], speech: &[f32]) -> Option<f64> {
    let mut wins = Vec::new();
    for i in 3..blocks.len().min(speech.len()) {
        if speech[i - 3] + speech[i - 2] + speech[i - 1] + speech[i] >= 2.0 {
            wins.push((blocks[i - 3] + blocks[i - 2] + blocks[i - 1] + blocks[i]) / 4.0);
        }
    }
    if wins.len() < 10 {
        return None;
    }
    let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
    let abs: Vec<f64> = wins.into_iter().filter(|&p| lufs(p) > -70.0).collect();
    if abs.is_empty() {
        return None;
    }
    let rel = lufs(mean(&abs)) - 10.0;
    let gated: Vec<f64> = abs.into_iter().filter(|&p| lufs(p) > rel).collect();
    Some(lufs(mean(&gated)))
}

/// EBU loudness range (Tech 3342) of 100 ms blocks: P95 - P10 of the gated 3 s loudness, in LU.
fn loudness_range(blocks: &[f64]) -> f64 {
    let st: Vec<f64> = blocks.windows(30).map(|w| lufs(w.iter().sum::<f64>() / 30.0 + 1e-12)).filter(|&l| l > -70.0).collect();
    if st.is_empty() {
        return 0.0;
    }
    let mean = lufs(st.iter().map(|l| 10f64.powf((l + 0.691) / 10.0)).sum::<f64>() / st.len() as f64);
    let mut g: Vec<f64> = st.into_iter().filter(|&l| l > mean - 20.0).collect();
    g.sort_by(f64::total_cmp);
    let p = |q: f64| g[((q * g.len() as f64) as usize).min(g.len() - 1)];
    p(0.95) - p(0.10)
}

fn db(ms: f64) -> f64 {
    10.0 * (ms + 1e-12).log10()
}

fn percentile(v: &mut [f64], q: f64) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    let i = ((q * v.len() as f64) as usize).min(v.len() - 1);
    Some(*v.select_nth_unstable_by(i, f64::total_cmp).1)
}

// ---------------------------------------------------------------------------------------------
// Pass 1: what the take needs

/// Sidechain of the de-esser: energy envelopes of the 4.5 kHz+ band and of the whole signal.
struct Sidechain {
    hp: [Biquad; 2],
    k: Coefs,
    eh: f64,
    ex: f64,
    attack: f64,
    release: f64,
}

impl Sidechain {
    fn new() -> Self {
        let follow = |seconds: f64| 1.0 - (-1.0 / (seconds * RATE as f64)).exp();
        let k = Coefs::highpass(4500.0, std::f64::consts::FRAC_1_SQRT_2);
        Sidechain { hp: [Biquad::default(); 2], k, eh: 0.0, ex: 0.0, attack: follow(0.0005), release: follow(0.04) }
    }
    /// The band's share of the energy, in dB, after one more sample.
    fn push(&mut self, x: f64) -> f64 {
        let h = self.hp[0].run(&self.k, x);
        let h = self.hp[1].run(&self.k, h);
        let (ph, px) = (h * h, x * x);
        self.eh += (ph - self.eh) * if ph > self.eh { self.attack } else { self.release };
        self.ex += (px - self.ex) * if px > self.ex { self.attack } else { self.release };
        10.0 * ((self.eh + 1e-12) / (self.ex + 1e-12)).log10()
    }
}

/// Silero VAD v5 (MIT, native/models): the probability that each 32 ms of the raw take holds speech.
/// It hears 16 kHz, decimated from the 48 kHz take by a windowed-sinc low-pass.
struct Vad {
    session: Session,
    state: Vec<f32>, // [2, 1, 128]
    context: [f32; 64], // the last 64 samples of the previous window, as the model expects
    pending: Vec<f32>, // 16 kHz samples not yet heard
    taps: Vec<f32>, // decimation filter
    history: Vec<f32>, // ring of the last VAD_TAPS input samples (48 kHz), oldest at `pos`
    pos: usize,
    phase: usize,
    probs: Vec<f32>,
}

const SILERO: &[u8] = include_bytes!("../models/silero_vad_16k_op15.onnx");
const VAD_WINDOW: usize = 512; // samples at 16 kHz: 32 ms
const VAD_TAPS: usize = 48;

impl Vad {
    fn new() -> Result<Self, String> {
        let err = |e: ort::Error| format!("Could not load the speech detector: {e}");
        let session = Session::builder().map_err(err)?.with_intra_threads(1).map_err(|e| err(e.into()))?.commit_from_memory(SILERO).map_err(err)?;
        // Low-pass at 7 kHz (under 16 kHz's Nyquist), Blackman-windowed.
        let fc = 7_000.0 / RATE as f64;
        let taps = (0..VAD_TAPS)
            .map(|i| {
                let n = i as f64 - (VAD_TAPS - 1) as f64 / 2.0;
                let sinc = if n == 0.0 { 2.0 * fc } else { (std::f64::consts::TAU * fc * n).sin() / (std::f64::consts::PI * n) };
                let x = std::f64::consts::TAU * i as f64 / (VAD_TAPS - 1) as f64;
                (sinc * (0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos())) as f32
            })
            .collect();
        Ok(Vad { session, state: vec![0.0; 256], context: [0.0; 64], pending: Vec::new(), taps, history: vec![0.0; VAD_TAPS], pos: 0, phase: 0, probs: Vec::new() })
    }

    /// Hear more of the take (48 kHz mono).
    fn push(&mut self, x: &[f32]) -> Result<(), String> {
        for &v in x {
            self.history[self.pos] = v;
            self.pos = (self.pos + 1) % VAD_TAPS;
            self.phase = (self.phase + 1) % 3;
            if self.phase == 0 {
                let (new, old) = self.history.split_at(self.pos);
                self.pending.push(old.iter().chain(new).zip(&self.taps).map(|(h, t)| h * t).sum());
            }
        }
        while self.pending.len() >= VAD_WINDOW {
            let mut input = Vec::with_capacity(64 + VAD_WINDOW);
            input.extend_from_slice(&self.context);
            input.extend_from_slice(&self.pending[..VAD_WINDOW]);
            let err = |e: ort::Error| format!("Speech detection failed: {e}");
            let out = self
                .session
                .run(ort::inputs![
                    "input" => Tensor::from_array(([1usize, 64 + VAD_WINDOW], input)).map_err(err)?,
                    "state" => Tensor::from_array(([2usize, 1, 128], self.state.clone())).map_err(err)?,
                    "sr" => Tensor::from_array(((), vec![16_000i64])).map_err(err)?
                ])
                .map_err(err)?;
            self.probs.push(out["output"].try_extract_tensor::<f32>().map_err(err)?.1[0]);
            self.state = out["stateN"].try_extract_tensor::<f32>().map_err(err)?.1.to_vec();
            self.context.copy_from_slice(&self.pending[VAD_WINDOW - 64..VAD_WINDOW]);
            self.pending.drain(..VAD_WINDOW);
        }
        Ok(())
    }

    /// Speech probability of each 10 ms frame (the window over its center), for `frames` frames.
    fn frames(&self, frames: usize) -> Vec<f32> {
        let window = VAD_WINDOW * 3; // in 48 kHz frames
        (0..frames).map(|f| self.probs.get((f * HOP + HOP / 2) / window).or(self.probs.last()).copied().unwrap_or(0.0)).collect()
    }
}

/// Levels of every 100 ms and speech of every 10 ms, gathered in one pass over the raw and cleaned take.
struct Stats {
    ch: usize,
    vad: Vad,
    voice_ms: Vec<f64>, // mean square per block, cleaned and high-passed: the leveler's input
    ratios: Vec<f64>, // de-esser sidechain reading every 10 ms
    meter: Meter, // cleaned voice, for its loudness range
    hp: Vec<Biquad>,
    hpk: Coefs,
    side: Sidechain,
    acc: f64, // voice mean square of the current block, so far
    frame: usize,
}

impl Stats {
    fn new(ch: usize) -> Result<Self, String> {
        Ok(Stats {
            ch,
            vad: Vad::new()?,
            voice_ms: Vec::new(),
            ratios: Vec::new(),
            meter: Meter::new(ch),
            hp: vec![Biquad::default(); ch],
            hpk: Coefs::highpass(80.0, std::f64::consts::FRAC_1_SQRT_2),
            side: Sidechain::new(),
            acc: 0.0,
            frame: 0,
        })
    }

    fn push(&mut self, raw: &[f32], dn: &[f32]) -> Result<(), String> {
        let ch = self.ch;
        let mono: Vec<f32> = raw.chunks_exact(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect();
        self.vad.push(&mono)?;
        let mut v = [0f32; 2];
        for d in dn.chunks_exact(ch) {
            let mut vm = 0f64;
            for c in 0..ch {
                v[c] = self.hp[c].run(&self.hpk, d[c] as f64) as f32;
                vm += v[c] as f64 / ch as f64;
            }
            self.meter.push(&v[..ch]);
            let ratio = self.side.push(vm);
            if self.frame % HOP == 0 {
                self.ratios.push(ratio);
            }
            self.acc += vm * vm;
            self.frame += 1;
            if self.frame % BLOCK == 0 {
                self.voice_ms.push(self.acc / BLOCK as f64);
                self.acc = 0.0;
            }
        }
        Ok(())
    }

    /// This take's settings: the leveler's target (its median speech level) and strength (more when
    /// its loudness range is wide), the de-esser's threshold (8 dB over its usual top-band share), and
    /// the speech of every 100 ms for the leveler and the loudness.
    fn plan(&self) -> Plan {
        let frames = self.vad.frames(self.frame.div_ceil(HOP));
        let speech: Vec<f32> = frames.chunks(BLOCK / HOP).map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
        let mut voiced: Vec<f64> = self.voice_ms.iter().zip(&speech).filter(|(_, s)| **s > 0.6).map(|(m, _)| db(*m)).collect();
        let mut ratios: Vec<f64> = self.ratios.iter().zip(&frames).filter(|(_, p)| **p > 0.6).map(|(r, _)| *r).collect();
        Plan {
            mix: 10f32.powf(-REDUCTION_DB / 20.0),
            level_target: percentile(&mut voiced, 0.5),
            level_strength: if loudness_range(&self.meter.blocks) > 8.0 { 0.6 } else { 0.4 },
            deess_threshold: percentile(&mut ratios, 0.5).map(|m| m + 8.0),
            speech,
        }
    }
}

struct Plan {
    /// Share of the raw take mixed back into the cleaned one: noise drops by at most REDUCTION_DB.
    mix: f32,
    /// The leveler moves the voice `level_strength` of the way to its median speech level (dB).
    level_target: Option<f64>,
    level_strength: f64,
    /// The de-esser acts when the 4.5 kHz+ band's share rises past this (dB).
    deess_threshold: Option<f64>,
    /// Speech probability of every 100 ms.
    speech: Vec<f32>,
}

// ---------------------------------------------------------------------------------------------
// Pass 2: the chain

const DEESS_MAX_DB: f64 = 6.0;
const LEVEL_WINDOW: usize = 15; // blocks: 1.5 s
const LEVEL_MAX_DB: f64 = 6.0;

/// Mix, high-pass, de-esser, leveler, and the loudness meter, streaming. The leveler needs the level
/// of the block after the one it plays, so output trails input by up to two blocks; finish() flushes.
struct Chain {
    ch: usize,
    mix: f32,
    hp: Vec<Biquad>,
    hpk: Coefs,
    side: Sidechain,
    deess_threshold: Option<f64>,
    deess_gain: f64,
    shelf: Vec<Biquad>,
    shelf_k: Coefs,
    frame: usize,
    // leveler
    target: Option<f64>,
    strength: f64,
    speech: Vec<f32>,
    pending: Vec<f32>, // de-essed frames not yet leveled
    pending_at: usize, // file frame of pending[0]
    block_ms: Vec<f64>, // mid mean square of each complete block
    acc: (f64, usize),
    gains: Vec<f64>, // dB per block
    level: f64,
    glide: f64,
    meter: Meter,
}

impl Chain {
    fn new(ch: usize, plan: &Plan) -> Self {
        Chain {
            ch,
            mix: plan.mix,
            hp: vec![Biquad::default(); ch],
            hpk: Coefs::highpass(80.0, std::f64::consts::FRAC_1_SQRT_2),
            side: Sidechain::new(),
            deess_threshold: plan.deess_threshold,
            deess_gain: 0.0,
            shelf: vec![Biquad::default(); ch],
            shelf_k: Coefs::highshelf(5500.0, 0.7, 0.0),
            frame: 0,
            target: plan.level_target,
            strength: plan.level_strength,
            speech: plan.speech.clone(),
            pending: Vec::new(),
            pending_at: 0,
            block_ms: Vec::new(),
            acc: (0.0, 0),
            gains: Vec::new(),
            level: plan.level_target.unwrap_or(0.0),
            glide: 0.0,
            meter: Meter::new(ch),
        }
    }

    /// Cleaned and raw frames in; the frames that are done out.
    fn push(&mut self, raw: &[f32], dn: &[f32]) -> Vec<f32> {
        let ch = self.ch;
        let smooth = 1.0 - (-1.0 / (0.002 * RATE as f64)).exp();
        for (r, d) in raw.chunks_exact(ch).zip(dn.chunks_exact(ch)) {
            let mut y = [0f64; 2];
            let mut mid = 0f64;
            for c in 0..ch {
                let m = d[c] * (1.0 - self.mix) + r[c] * self.mix;
                y[c] = self.hp[c].run(&self.hpk, m as f64);
                mid += y[c] / ch as f64;
            }
            // De-esser: when the 4.5 kHz+ band's share jumps past the threshold, a 5.5 kHz shelf dips.
            // A shelf only ever cuts; subtracting a filtered band adds energy back near the split.
            let ratio = self.side.push(mid);
            if let Some(thr) = self.deess_threshold {
                let over = ratio - thr;
                let want = if over > 0.0 { (over * 0.75).min(DEESS_MAX_DB) } else { 0.0 };
                self.deess_gain += (want - self.deess_gain) * smooth;
                if self.frame % 32 == 0 {
                    self.shelf_k = Coefs::highshelf(5500.0, 0.7, -self.deess_gain);
                }
                mid = 0.0;
                for c in 0..ch {
                    y[c] = self.shelf[c].run(&self.shelf_k, y[c]);
                    mid += y[c] / ch as f64;
                }
            }
            self.frame += 1;
            for c in 0..ch {
                self.pending.push(y[c] as f32);
            }
            self.acc.0 += mid * mid;
            self.acc.1 += 1;
            if self.acc.1 == BLOCK {
                self.block_ms.push(self.acc.0 / BLOCK as f64);
                self.acc = (0.0, 0);
                self.gain_for(self.block_ms.len() - 1);
            }
        }
        // Blocks whose next block's gain is known can be leveled.
        let ready = self.gains.len().saturating_sub(1) * BLOCK;
        self.level_out(ready)
    }

    /// Slow leveler: a 1.5 s speech level that holds through pauses (room tone is never pumped up),
    /// moved `strength` of the way to the voice's median, within +-6 dB, gliding over ~0.7 s.
    fn gain_for(&mut self, b: usize) {
        if let Some(target) = self.target {
            let lo = b.saturating_sub(LEVEL_WINDOW - 1);
            let talk: Vec<f64> = (lo..=b).filter(|&i| self.speech.get(i).is_some_and(|&s| s > 0.6)).map(|i| self.block_ms[i]).collect();
            if talk.len() >= 3 {
                self.level = db(talk.iter().sum::<f64>() / talk.len() as f64);
            }
            let want = ((target - self.level) * self.strength).clamp(-LEVEL_MAX_DB, LEVEL_MAX_DB);
            self.glide += (want - self.glide) * 0.15;
        }
        self.gains.push(self.glide);
    }

    /// Level and emit pending frames up to file frame `until` (gains interpolated across block centers).
    fn level_out(&mut self, until: usize) -> Vec<f32> {
        let ch = self.ch;
        let n = until.saturating_sub(self.pending_at).min(self.pending.len() / ch);
        let mut out: Vec<f32> = self.pending.drain(..n * ch).collect();
        let last = self.gains.len().saturating_sub(1);
        for (k, frame) in out.chunks_exact_mut(ch).enumerate() {
            let p = (self.pending_at + k) as f64 / BLOCK as f64 - 0.5;
            let b = p.max(0.0).floor() as usize;
            let f = (p - b as f64).clamp(0.0, 1.0);
            let g = self.gains.get(b.min(last)).copied().unwrap_or(0.0) * (1.0 - f) + self.gains.get((b + 1).min(last)).copied().unwrap_or(0.0) * f;
            let g = 10f64.powf(g / 20.0) as f32;
            for v in frame.iter_mut() {
                *v *= g;
            }
            self.meter.push(frame);
        }
        self.pending_at += n;
        out
    }

    /// Everything still held back, once the input ended.
    fn finish(&mut self) -> Vec<f32> {
        if self.acc.1 > 0 {
            self.block_ms.push(self.acc.0 / self.acc.1 as f64);
            self.acc = (0.0, 0);
            self.gain_for(self.block_ms.len() - 1);
        }
        self.level_out(usize::MAX)
    }

    /// Speech loudness of everything emitted, as heard.
    fn loudness(&self) -> Option<f64> {
        integrated(&self.meter.blocks, &self.speech)
    }
}

#[cfg(test)]
mod tests;
