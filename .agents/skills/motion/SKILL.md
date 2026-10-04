---
name: motion
description: Animation engine: springs, cursor smoothing, motion blur. Use when changing how anything moves over time: cursor, zoom, layout transitions, or overlays.
---

# Motion

The animation engine behind cursor, zoom, layout, and overlay movement.

- Springs are physically based (mass, stiffness, damping) and evaluated in closed form at time t.
  Rest detection uses both displacement and velocity so slow springs finish, and degenerate inputs such as zero mass are clamped.
- Cursor smoothing removes jitter while passing exactly through every click position.
- Cursor tilt on fast moves, loop back to the start position at the end, and hide when idle.
- Motion blur follows the actual per-frame motion of the cursor and the zoom camera.
- An animation interrupted by a cut blends into the next state.

Done when rendering any frame in isolation matches rendering it in sequence, pixel for pixel.
