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
- Voice chain: noise reduction, then loudness normalization, then a limiter, so the mix never clips.
  Measure loudness on speech only: a mic that caught just room tone and trackpad clicks otherwise reads as a very quiet voice and gets the full boost, clicks included.
- Mixer: volume and mute per track and per clip, background music synced to the timeline, click sounds.
- Waveforms load lazily and render hours-long tracks without stalling.

Done when after hundreds of cuts and speed changes, the export sounds identical to the preview and stays in sync to the frame.
