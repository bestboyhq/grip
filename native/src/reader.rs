//! The one AVAssetReader decoder: transcription and the voice pass read audio files through it.

use std::path::Path;
use std::ptr::NonNull;

use objc2::rc::autoreleasepool;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{AVAssetReader, AVAssetReaderStatus, AVAssetReaderTrackOutput, AVMediaTypeAudio, AVURLAsset};
use objc2_avf_audio::{
    AVFormatIDKey, AVLinearPCMBitDepthKey, AVLinearPCMIsBigEndianKey, AVLinearPCMIsFloatKey, AVLinearPCMIsNonInterleaved,
    AVNumberOfChannelsKey, AVSampleRateKey,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

const LPCM: u32 = u32::from_be_bytes(*b"lpcm"); // kAudioFormatLinearPCM

/// Stream the first audio track of `path` as f32 at `rate` Hz, `channels` interleaved (AVAssetReader
/// mixes or splits channels to fit). Samples are placed by their timestamps (gaps become silence),
/// so frame index / rate is always file time. `sink` gets each block and the file duration in
/// seconds; an Err from it stops decoding.
pub fn decode(path: &Path, rate: usize, channels: usize, mut sink: impl FnMut(&[f32], f64) -> Result<(), String>) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("Audio file not found: {}", path.display()));
    }
    unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let asset = AVURLAsset::URLAssetWithURL_options(&url, None);
        #[allow(deprecated)] // the async loaders need a run loop; this runs on a worker thread
        let (tracks, duration) = (asset.tracksWithMediaType(AVMediaTypeAudio.unwrap()), asset.duration());
        let track = tracks.firstObject().ok_or("This recording has no audio track")?;
        let duration = (duration.value as f64 / duration.timescale.max(1) as f64).max(1.0 / rate as f64);

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
            NSNumber::numberWithDouble(rate as f64),
            NSNumber::numberWithUnsignedInt(channels as u32),
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
                let at = (pts.value as f64 / pts.timescale.max(1) as f64 * rate as f64).round().max(0.0) as usize;
                // A hole in the track (more than 10 ms): keep later samples at their real time.
                if at > written + rate / 100 {
                    let mut gap = (at - written) * channels;
                    while gap > 0 {
                        let n = gap.min(silence.len());
                        sink(&silence[..n], duration)?;
                        gap -= n;
                    }
                    written = at;
                }
                written += pcm.len() / channels;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// AAC priming must not shift time; stereo 48 kHz comes out mono 16 kHz (transcription) or stays
    /// stereo 48 kHz (the voice pass).
    #[test]
    fn decodes_on_source_time() {
        let dir = std::env::temp_dir().join(format!("studio-reader-test-{}", std::process::id()));
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
            for (rate, channels) in [(16_000usize, 1usize), (48_000, 2)] {
                let mut got = Vec::new();
                decode(path, rate, channels, |s, d| {
                    assert!((d - 2.0).abs() < 0.05, "duration {d}");
                    got.extend_from_slice(s);
                    Ok(())
                })
                .unwrap();
                let frames = got.len() / channels;
                assert!((frames as i64 - 2 * rate as i64).abs() < 400 * rate as i64 / 16_000, "{frames} frames from {}", path.display());
                let onset = got.iter().position(|v| v.abs() > 0.1).unwrap() / channels;
                let onset = onset as f64 / rate as f64;
                assert!((onset - 0.5).abs() < 0.01, "tone starts at {onset} in {}", path.display());
                let peak = got.iter().fold(0f32, |m, v| m.max(v.abs()));
                assert!(peak > 0.3 && peak < 0.8, "peak {peak}"); // a stereo downmix pans at -3 dB
            }
        }
        assert!(decode(&dir.join("missing.m4a"), 16_000, 1, |_, _| Ok(())).unwrap_err().contains("not found"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
