---
name: audio
description: Microphone, system, device, and music audio from capture to mix. Use when changing audio capture, A/V sync, time-stretch for speed changes, the voice chain, the mixer, or waveforms.
---

# Audio

Microphone, system, device, and music audio, from capture to mix.

- Automatic gain control is off; mic level is the user's choice.
- A mono mic plays centered on both channels, a stereo mic stays stereo, and export always writes two channels.
- Detect a built-in mic muted by a closed lid, a missing device, and a disconnected last-used device, and tell the user once.
- One master clock drives screen, camera, mic, and system audio, with drift correction for long recordings.
- Speed changes use a pitch-preserving time-stretch that sounds natural at 1.2x, above 2x, while scrubbing, and in preview above 1x.
  A naive stretch sounds robotic at 1.2x and distorts after speed changes.
- Voice chain: DeepFilterNet3 noise reduction held to 30 dB, an 80 Hz high-pass, a de-esser, and a slow leveler, run once per recording on device into a voice track beside the mic (native/src/voice.rs, electron/audio.ts).
  The mixer plays that track with a static gain to -14 LUFS, then the true-peak limiter, so quiet phrases stay audible and the mix never clips.
  Measured on 12 real takes and 18 with real typing and fan noise (DNSMOS P.835, PESQ, STOI): RNNoise with a 3:1 compressor scored no better than the raw mic.
  Leave the compressor out: its make-up gain raises the room under the voice and sharpens S sounds; the slow leveler evens phrases without either.
  Hold noise reduction to 30 dB: more scores no better and costs intelligibility, and a strength picked per take from its noise level did no better than the fixed limit.
  Tell speech from everything else with Silero VAD: RNNoise's voice probability and DeepFilterNet's own SNR estimate both take typing for speech.
  Set the boost from the voice track's speech loudness only: a mic that caught just room tone and trackpad clicks gets no boost.
  De-ess with a dynamic shelf, which only cuts: subtracting a filtered band adds energy back near the split and sharpens S sounds instead.
  Give each DeepFilterNet3 chunk a fresh model: one reused after init() keeps stale delay lines and comes out a frame off for good.
- Mixer: volume and mute per track and per clip, background music synced to the timeline, click sounds.
- Waveforms load lazily and render hours-long tracks without stalling.
  A waveform draws the track as it plays: an enhanced mic as its voice track, raw when enhance is off.

Done when after hundreds of cuts and speed changes, the export sounds identical to the preview and stays in sync to the frame.
