use super::*;
use std::process::Command;

/// A mic track as Grip records one: AAC from AudioWriter, here of synthetic speech (macOS `say`)
/// after 0.6 s of quiet, all over steady noise 30 dB under the voice. Returns its path.
fn mic(dir: &Path, name: &str, noise: f32) -> PathBuf {
    let speech = dir.join(format!("{name}.aiff"));
    let text = "Hello, this is a test of the voice pass. Every word should stay exactly where it was said.";
    assert!(Command::new("say").args(["-v", "Samantha", "-o"]).arg(&speech).arg(text).status().unwrap().success());
    let mut x = vec![0f32; RATE * 6 / 10];
    decode(&speech, RATE, 1, |s, _| {
        x.extend_from_slice(s);
        Ok(())
    })
    .unwrap();
    let mut seed = 7u32;
    for v in x.iter_mut() {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        *v = *v * 0.5 + noise * ((seed >> 8) as f32 / (1 << 23) as f32 - 1.0);
    }
    let path = dir.join(format!("{name} #1 ✨.m4a"));
    let mut w = AudioWriter::offline(&path, RATE as f64, 1, 128_000.0).unwrap();
    w.push(0.0, &x);
    w.finish(x.len() as f64 / RATE as f64).unwrap();
    path
}

fn read(path: &Path) -> Vec<f32> {
    let mut x = Vec::new();
    decode(path, RATE, 1, |s, _| {
        x.extend_from_slice(s);
        Ok(())
    })
    .unwrap();
    x
}

fn rms_db(x: &[f32]) -> f64 {
    db(x.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64)
}

fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("studio-voice-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn voice_track_keeps_time_and_length_and_drops_noise() {
    let dir = tmp("pass");
    let mic = mic(&dir, "mic", 0.02);
    let out = dir.join("mic-voice.m4a");
    let a = run(&mic, &out, 1, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(a.chain, VOICE_CHAIN);
    assert!(!dir.join("mic-voice.m4a.partial.m4a").exists());
    let (x, y) = (read(&mic), read(&out));
    assert!((x.len() as i64 - y.len() as i64).abs() <= 2048, "{} frames in, {} out", x.len(), y.len());

    // Same timing: the voice lines up with the mic to the sample, over a stretch of speech.
    let (from, len) = (RATE, RATE * 2);
    let lag = (-200i64..=200)
        .max_by(|&p, &q| {
            let corr = |l: i64| (from..from + len).map(|i| x[i] as f64 * y[(i as i64 + l) as usize] as f64).sum::<f64>();
            corr(p).total_cmp(&corr(q))
        })
        .unwrap();
    // The 80 Hz high-pass leads the lows by a fraction of a millisecond; a real slip is a frame or more.
    assert!(lag.abs() <= 8, "voice is {lag} samples off the mic");

    // The quiet before the speech: noise down by close to the full reduction.
    let quiet = RATE / 10..RATE / 2;
    let drop = rms_db(&x[quiet.clone()]) - rms_db(&y[quiet]);
    assert!(drop > REDUCTION_DB as f64 - 4.0, "noise down {drop:.1} dB");
    let lufs = a.lufs.expect("speech loudness");
    assert!((-45.0..-15.0).contains(&lufs), "speech at {lufs} LUFS");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn chunk_seams_are_inaudible() {
    let dir = tmp("seams");
    let mic = mic(&dir, "mic", 0.02);
    let cleaned = |chunk: usize, threads: usize| {
        let mut out = Vec::new();
        sweep(&mic, 1, chunk, threads, &AtomicBool::new(false), |_| {}, |_, dn| {
            out.extend_from_slice(dn);
            Ok(())
        })
        .unwrap();
        out
    };
    let (whole, seamed) = (cleaned(60 * RATE, 1), cleaned(RATE, 3));
    assert_eq!(whole.len(), seamed.len());
    let diff: Vec<f32> = whole.iter().zip(&seamed).map(|(a, b)| a - b).collect();
    let (signal, error) = (rms_db(&whole), rms_db(&diff));
    // A chunk primed on 2 s converges to within ~40 dB of the uncut run: two cleanings, no click.
    assert!(signal - error > 30.0, "seams leave an error {:.1} dB under the voice", signal - error);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn deesser_shelf_only_cuts() {
    for g in [0.0, -0.5, -3.0, -6.0, -12.0] {
        let k = Coefs::highshelf(5500.0, 0.7, g).0;
        for f in (20..20_000).step_by(37) {
            let w = std::f64::consts::TAU * f as f64 / RATE as f64;
            let re = |c0: f64, c1: f64, c2: f64| c0 + c1 * w.cos() + c2 * (2.0 * w).cos();
            let im = |c1: f64, c2: f64| -c1 * w.sin() - c2 * (2.0 * w).sin();
            let mag = re(k[0], k[1], k[2]).hypot(im(k[1], k[2])) / re(1.0, k[3], k[4]).hypot(im(k[3], k[4]));
            assert!(mag <= 1.0 + 1e-9, "{g} dB shelf boosts {f} Hz by {mag}");
        }
    }
}

#[test]
fn loudness_matches_bs1770() {
    // A 997 Hz sine at full scale reads -3.01 LUFS per channel: mono heard on two channels reads 0.
    for (amp, want) in [(1.0f32, 0.0), (0.1, -20.0)] {
        for ch in [1usize, 2] {
            let mut m = Meter::new(ch);
            for i in 0..5 * RATE {
                let v = amp * (std::f32::consts::TAU * 997.0 * i as f32 / RATE as f32).sin();
                m.push(&[v, v][..ch]);
            }
            let got = integrated(&m.blocks, &vec![1.0; m.blocks.len()]).unwrap();
            assert!((got - want).abs() < 0.05, "{ch} ch at {amp}: {got:.2} LUFS, want {want}");
        }
    }
}

#[test]
fn leveler_never_lifts_a_pause() {
    // 3 s of speech at -17 dB, 3 s of pause (room tone at -57 dB), 3 s of speech at -35 dB; target -25 dB.
    let blocks = 90;
    let speech: Vec<f32> = (0..blocks).map(|b| if (30..60).contains(&b) { 0.0 } else { 1.0 }).collect();
    let plan = Plan { mix: 0.0, level_target: Some(-25.0), level_strength: 0.5, deess_threshold: None, speech };
    let mut chain = Chain::new(1, &plan);
    let amp = |b: usize| if b < 30 { 0.1 } else if b < 60 { 0.001 } else { 0.01257 };
    let x: Vec<f32> = (0..blocks * BLOCK).map(|i| amp(i / BLOCK) * if i % 2 == 0 { 1.0 } else { -1.0 } * 1.414).collect();
    chain.push(&x, &x);
    chain.finish();
    let g = &chain.gains;
    assert!(g[29] < -2.0, "loud speech comes down: {:.1} dB", g[29]);
    assert!(g[31..60].iter().all(|&v| v <= g[30] + 0.01), "a pause never rises: {:?}", &g[30..60]);
    assert!(g[89] > 2.0, "soft speech comes up: {:.1} dB", g[89]);
}


#[test]
fn speech_detector_hears_the_voice_not_the_noise() {
    let dir = tmp("vad");
    let mic = mic(&dir, "mic", 0.02);
    let mut vad = Vad::new().unwrap();
    let x = read(&mic);
    for c in x.chunks(7_777) {
        vad.push(c).unwrap(); // odd blocks: windows straddle pushes
    }
    let p = vad.frames(x.len() / HOP);
    let mean = |r: std::ops::Range<usize>| p[r.clone()].iter().sum::<f32>() / r.len() as f32;
    let (quiet, talk) = (mean(5..50), mean(100..300)); // 50-500 ms of noise; 1-3 s of speech
    assert!(quiet < 0.2 && talk > 0.7, "speech probability {quiet:.2} in the noise, {talk:.2} in the voice");
    std::fs::remove_dir_all(&dir).unwrap();
}

