---
name: camera
description: Webcam capture, camera layouts, and on-device camera effects. Use when changing camera formats, picture-in-picture, split screen, background removal, face tracking, or color grading.
---

# Camera

Webcam capture, layout, and on-device effects.

- Pick the format (720p, 1080p, 4K at 30 fps) before recording starts, and keep the camera running until it ends.
  A mid-session format change letterboxes the picture, and a restart desyncs it from the mic.
- Layouts are timeline items: picture-in-picture, fullscreen, hidden, and split screen (side by side, or stacked for vertical video).
  Every layout change animates.
- Shape, aspect ratio, corner radius, shadow, mirror, and crop, with the radius correct for non-square shapes and the edge inset independent of project padding.
- On-device effects: background removal, face tracking that keeps the face centered, hide during silence, and color grading with presets and `.cube` LUTs.

Done when an hour-long recording keeps lips in sync with the mic within one frame, in every layout.
