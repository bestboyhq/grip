---
name: compositor
description: GPU composition of each output frame. Use when changing backgrounds, padding, corners, shadows, aspect ratios, device mockups, masks, or overlay rendering (cursor, click effects, keystrokes, captions).
---

# Compositor

GPU composition of each output frame.

- One render graph: background, then the padded, rounded, shadowed screen with optional device mockup, then camera, masks, and overlays (cursor, click effects, keystrokes, captions).
- New projects start plain: the recording edge to edge, with no background, padding, corners, or shadow.
  Picking a background while none would show adds padding so it does.
- Backgrounds: wallpapers, gradients, colors, images, blur, with gradients dithered so they show no banding.
- Rounded corners and shadows are antialiased on light and dark backgrounds at every scale.
- Output aspect ratios: auto, 16:9, 9:16, 4:5, 1:1, and custom.
- Sensitive-data masks blur or pixelate and take their color from what they cover; highlight masks dim the rest.
  Masks stay locked to content through zooms.
- The keystroke overlay draws each key as its own keycap with the macOS symbol and name.
- Click effects: swell, wave, circle, focus ring.
  All four live on the screen's glass, so they are drawn in the screen pass, not on the overlay canvas: the loupe and motion blur carry them, and the cursor stays sharp above them.
  A crest narrower than a few times its refraction folds text into rainbow noise and reads as a ring drawn over the UI; keep crests broad so text bends and swells.
  Lighting on a crest can only darken white UI, so it shows as a gray ring; the swell is unlit.
- Device mockups match each model: bezel, corner radius, Dynamic Island, portrait and landscape.

Done when a frame grab of any export holds up at 200% zoom with no banding, aliasing, or misaligned layers.
