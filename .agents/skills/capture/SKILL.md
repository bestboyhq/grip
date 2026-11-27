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
- Screen pixels are sRGB, and the screen track says so.
  ScreenCaptureKit labels its frames with BT.709's curve: written as labeled, or converted from that label, the file plays washed out in QuickTime (gray 128 shows as 139).
- Our own UI stays out of the capture: recording widget, speaker notes and prompter, camera preview, area picker.
  System notifications and, optionally, desktop icons stay out too.
- The picker opens at once (shortcut or menu bar click) and freezes every display under it; the freeze ends when a countdown starts.
  Its overlays and toolbar show first, click-through and never key, so menus and hover states stay for the capture, and they take the mouse once the frozen frame is in.
  ScreenCaptureKit takes about 100 ms to shoot a display: waiting for that before showing anything made every open take 200 ms, and 450 ms the first time after launch.
  The capture leaves out only what of ours is on screen when it lists the content, so the overlays show before it starts.
- Area picking opens with nothing selected: windows move between recordings, and a restored area followed by a quick ↩ records the wrong place.
  The last area shows outlined and tagged: a click picks it again, a drag inside it draws a new one, and its aspect lock carries over.
- Screenshots come from the same area picker and are cut from that frozen frame: ⌘C copies the area, a drawing tool annotates it first, and drawn shapes drag to another place.
  Picking a display or a window, ⌘C copies it without drawing; a window comes alone, as macOS takes it: nothing in front of it, clear corners, no shadow.
  The overlay under the pointer holds the keyboard, so ↩ and ⌘C reach the display the user is looking at.
  They leave out our UI and the cursor like recordings do, and carry their pixel density (144 dpi on Retina) so they paste at on-screen size.
- An area held or pushed against a display's edge steps the screen back, so a window at the edge can get a margin.
  Past the edge shows the desktop picture alone, mirrored, with shadows that cross the edge fading out.
  A screenshot takes it; a recording stays on the screen, since the editor adds room around it.
- A resize that slows down picks up the editor's glass lens (`src/engine/gpu/glass.wgsl`) under the pointer, leaning a little toward the area's middle, with the pointer still on the pixel it magnifies.
  A loupe beside the pointer that flips sides as the pointer crosses the area's middle jumps around while the user aims.
- Sizing an area shows a crosshair everywhere, and moving it shows the move cursor, set on every element while the drag lasts.
  The body holds the pointer during a drag, and Chromium then shows the body's arrow, not the cursor of the handle under it.
- While an area drags, the sides it moves measure in to the first content (`src/windows/area/measure.ts`): a blue line with its length in pixels, as near the pointer as that content allows.
  Content is a step between two pixels, never a soft shadow or a gradient.
  A resized side measures only the stretch of it the lens shows, lens up or not, and with the lens up the line and its length show only inside it.
  The user looks into the glass: a line to content further along the side lands outside it and reads as a stray.
  Only the dragged sides measure, and nothing snaps: lines on all four sides are noise, and a magnet fights the user's hand.
- The camera preview is for the person recording, never a layout: it starts under the camera, at the top center of the display, so looking at yourself is looking into the lens.
  It drags anywhere, settles back under the camera when dropped near it, and fades while the pointer is over it.
  Each display keeps where it was dropped; where the video puts the camera is an edit.
- One recording session exists at a time.
  Start, pause, resume, finish, cancel, and restart are idempotent and race-free under key spam and errors.
- Check free disk space before and during recording, warn early, and finish cleanly when it runs out.
- Each track is one file that grows by a movie fragment a second (`native/src/writer.rs`), crash-safe without a file per segment.
  A 3-hour recording kept as tens of thousands of segment files is slow to copy, back up, and upload.
- Window mode resizes the window to preset sizes precisely, focuses it before start, and follows it as it moves.
- iPhone and iPad over USB (CoreMediaIO) and iPhone Mirroring, including device rotation and device audio.
- Request screen recording, accessibility, microphone, and camera permissions just in time, each with a one-line reason, and recover from a revoked permission.

Done when every mode survives start/stop spam, a display unplugged mid-recording, and a full disk, and yields a playable file whose first frame is real content.
