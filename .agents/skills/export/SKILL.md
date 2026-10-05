---
name: export
description: Encoding, muxing, and delivering the final video. Use when changing VideoToolbox encoding, export progress, GIF export, batch export, or export destinations.
---

# Export

Encoding, muxing, and delivery of the final video.

- Hardware encoding through VideoToolbox (H.264, HEVC, ProRes), muxed with AVFoundation.
- The file is complete: every frame through the last keyframe, audio as long as video, playable in QuickTime, browsers, and social uploads.
- Progress is truthful from 0 to 100, finalization included.
  An export stuck at 95% is the classic failure, and long static stretches must still advance the encoder.
- Files over 2 GB, 4K ultrawide sources, speeds above 2x, and hundreds of cuts all export.
- Cancel stops at once and deletes the partial file.
- Memory stays flat regardless of duration.
- GIF export: per-scene palettes with dithering, loop count, and a size target.
- Destinations: file, clipboard, share link.
  Batch export asks for every destination first, then runs unattended in the background while the user keeps editing.

Done when a 2-hour 4K project exports without a stall, matches the preview frame for frame, and opens everywhere.
