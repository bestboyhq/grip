---
name: capture
description: Screen, window, area, and iPhone/iPad recording. Use when changing the recorder: ScreenCaptureKit or CoreMediaIO setup, display handling, the recording session lifecycle, disk space checks, permissions, or keeping app UI out of the capture.
---

# Capture

Screen, window, area, and device recording.

- ScreenCaptureKit (macOS 12.3+) is the engine, and system audio needs macOS 13+.
  Show only the options the running OS supports.
- Capture at native pixel size and refresh rate across retina and non-retina, mixed-DPI multi-display setups, ultrawide, DisplayLink, fullscreen apps, and Spaces.
- Plan the downscale for sources above the encoder's maximum dimensions (ultrawide, 5K+) at capture setup.
- Our own UI stays out of the capture: recording widget, speaker notes and prompter, camera preview, area picker.
  System notifications and, optionally, desktop icons stay out too.
- Screenshots come from the same area picker: ⌘C copies the area, a drawing tool freezes it to annotate first.
  They leave out our UI and the cursor like recordings do, and carry their pixel density (144 dpi on Retina) so they paste at on-screen size.
- The camera preview sits in the corner of the recorded area where the video will put the camera; moving it moves the camera.
- One recording session exists at a time.
  Start, pause, resume, finish, cancel, and restart are idempotent and race-free under key spam and errors.
- Check free disk space before and during recording, warn early, and finish cleanly when it runs out.
- Window mode resizes the window to preset sizes precisely, focuses it before start, and follows it as it moves.
- iPhone and iPad over USB (CoreMediaIO) and iPhone Mirroring, including device rotation and device audio.
- Request screen recording, accessibility, microphone, and camera permissions just in time, each with a one-line reason, and recover from a revoked permission.

Done when every mode survives start/stop spam, a display unplugged mid-recording, and a full disk, and yields a playable file whose first frame is real content.
