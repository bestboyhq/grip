---
name: motion
description: Animation engine: the one ease-out curve, springs for followers, cursor smoothing, motion blur. Use when changing how anything moves over time: cursor, zoom, layout transitions, or overlays.
---

# Motion

The animation engine behind cursor, zoom, layout, and overlay movement.

- Every timed move and fade on screen runs on one curve, CSS ease-out, `cubic-bezier(0, 0, 0.58, 1)` (`easeOut` in `spring.ts`).
  That covers camera zooms and pans, loupes, the cursor's press, fades, cut, and loop, layout changes, masks, click effects, keystrokes, captions, and drawings.
  A fade out runs the same curve toward its end, as CSS does, so it leaves fast and settles.
  Mixed curves make one video feel like several: a zoom that snaps in and drifts out, or a lens on a clock of its own.
  The onboarding preview of a setting plays the same curve as the video it shows.
- Springs move only followers, which have no start or end: the camera tracking the cursor, a loupe riding it, and the cursor's tilt.
  A follower that takes over from a timed move starts at the move's speed, so the hand-off never kinks.
  Springs are physically based (mass, stiffness, damping) and evaluated in closed form at time t.
  Rest detection uses both displacement and velocity so slow springs finish, and degenerate inputs such as zero mass are clamped.
- Cursor smoothing removes jitter while passing exactly through every click position.
- Cursor tilt on fast moves, loop back to the start position at the end, and hide when idle.
- A press shrinks the cursor to 0.8 in 0.15 s, and the release brings it back in 0.2 s from wherever the press got to.
  A double click presses again from where the first release was, so the cursor never jumps.
- Motion blur follows the actual per-frame motion of the cursor, the zoom camera, and the loupe lenses.
- An animation interrupted by a cut blends into the next state.

Done when rendering any frame in isolation matches rendering it in sequence, pixel for pixel.
