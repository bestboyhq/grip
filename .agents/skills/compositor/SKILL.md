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
- Video stays undithered, but a ramp drawn over it, like the loupe's shadow, must raise the dither mark too, or flat UI under it bands into rings in the preview.
  The encoder strips that dither, so an export stays smooth only under a ramp that steps a level every few px: a faint one spread over hundreds of px bands into rings tens of px wide.
- Rounded corners and shadows are antialiased on light and dark backgrounds at every scale.
- The inset is a band between the frame's edge and the recording: the recording's own edge stretched out, or a color at an opacity.
  The recording inside it keeps corners concentric with the frame's (`radius - inset`), the same corners ink clips to.
  A see-through band shows the background and shadow under it, so only an opaque edge band counts as video for the dither mark.
- Output aspect ratios: auto, 16:9, 9:16, 4:5, 1:1, and custom.
  Auto hugs the framed recording (inset, device) with the padding even on every side (`hugRatio`).
  An output shaped to the recording alone leaves the padding thicker at the sides and makes the rest framing zoom in over it.
- Crop with a shape offers Cover and Fit.
  Cover cuts the recording to the shape that fills the output up to its padding (`coverRatio`), not to the bare shape.
  Fit keeps the whole recording and sets the output aspect instead, so the background fills the rest.
- Sensitive-data masks blur or pixelate and take their color from what they cover; highlight masks dim the rest.
  Masks stay locked to content through zooms.
- The keystroke overlay draws each key as its own keycap with the macOS symbol and name.
  A repeated shortcut counts only the presses made so far: a ×3 badge on the first of three presses gives the ending away.
- Click effects: swell, wave, circle, focus ring.
  All four live on the screen's glass, so they are drawn in the screen pass, not on the overlay canvas: the loupe and motion blur carry them, and the cursor stays sharp above them.
  A crest narrower than a few times its refraction folds text into rainbow noise and reads as a ring drawn over the UI; keep crests broad so text bends and swells.
  Lighting on a crest can only darken white UI, so it shows as a gray ring; the swell is unlit.
- A click or shortcut cut out with the dead time before it still shows over the footage kept after the cut, as that footage showed it before the cut (`carryToOutput`).
  Dropping it with its press erases what the user saw in footage they kept.
  The click effect plays on mid-animation, since the cut changes the picture under it anyway; the shortcut label enters at the cut, so the stack of labels lasting across it slides instead of jumping.
- Device mockups match each model: bezel, corner radius, Dynamic Island, portrait and landscape.

Done when a frame grab of any export holds up at 200% zoom with no banding, aliasing, or misaligned layers.
