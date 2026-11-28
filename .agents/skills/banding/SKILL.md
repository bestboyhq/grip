---
name: banding
description: Banding, a soft ramp that comes out stepped or in rings. Use when drawing or changing a shadow, glow, dim, or gradient, when one looks stepped in an export, or when encoding README and site media.
---

# Banding

A soft ramp bands when it spreads a few 8-bit levels over many pixels: each level becomes a flat band, and an eye reads the bands as rings.

## Why it happens

- Every delivery format keeps 8 bits or fewer.
  H.264 keeps 219 levels of luma, and a GIF keeps 256 colors per scene.
- The compositor works in 16-bit float and dithers by half a level in its final pass.
  The preview and a PNG keep that dither, so a ramp is smooth there and proves nothing about an export.
- Every video encoder strips the dither.
  Measured: noise of two levels in 2 px grains does not survive H.264 at the site's quality (crf 26), and at crf 20 it costs several times the bytes and still leaves bands.
  A stronger dither is not a fix.
- A ramp that multiplies crosses as many levels as the content under it is bright.
  A shadow of strength 0.55 crosses 137 levels on a white page and 9 on a dark one.
- A step shows by its contrast, `2.4 / (level + 14)` of the light for one level in sRGB.
  That is 8% at level 17 and 1% at level 226, so banding is a dark-content problem.
  A ramp on a light page can step every 30 px unseen.

## Rules

- Size the ramp to its levels: it steps a level every few px, or it is not drawn.
  The lens shadow's rule is 2 units of blur for each level it darkens (`SHADOW_STEP` in `src/engine/gpu/glass.wgsl`).
- A ramp that can fall on any content reads that content and sizes itself per pixel, as `fs_lensshadow` does with `zoomed(u)`.
  It stays wide and soft on a light page and becomes a contact shadow on a dark one.
- A ramp with a fixed reach is tight: the frame's shadow blurs over 30 units and the camera's over 22, a level every 9 units at worst on a dark wallpaper.
- An effect that only dims uses a flat dim with an antialiased edge, not one that fades with distance.
- A GIF dithers between palette colors, and its rules live in the `export` skill.

## Check

1. Export the change as MP4 from a project with dark content and one with light content.
   `npx electron scripts/readme/make.ts hero` and `scripts/readme/export.ts hero` give both themes of one take.
2. Encode it as the site does (`site/media.sh`), since a re-encode at web quality is where bands grow.
3. Run `node scripts/bands.ts <file> <seconds>` at each moment the ramp shows.
   It prints the longest staircase and where it starts, and exits 1.
4. Look at every hit, with the dark levels stretched: `ffmpeg -i frame.png -vf colorlevels=rimax=0.16:gimax=0.16:bimax=0.16 out.png`.
   A hit is a place to look.
   A gradient inside the recorded page and a wallpaper in a GIF's palette also hit, and they are not the ramp you drew.

Done when `scripts/bands.ts` finds no staircase in the ramp you drew, on dark and on light content, in the MP4 at web quality, in the README's AVIF, and in the GIF.
