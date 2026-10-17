---
name: auto-zoom
description: Turning clicks and typing into zoom ranges and cursor follow. Use when changing automatic or manual zooms, cursor follow, the glass loupe, or zoomed text sharpness.
---

# Auto-zoom

Turning clicks and typing into camera direction.

- Generate zoom ranges from clicks and typing as ordinary timeline items the user edits or disables.
- A zoomed view follows the cursor through a dead zone, panning only as the cursor nears the edge.
- Manual zooms set target, level, and duration, animated or instant.
- A zoom that starts on the first frame starts zoomed in.
- Vertical output follows the cursor continuously, since the frame is narrower than the source.
- Glass loupe magnifies a region in place when a full zoom would move too much of the screen.
  It has no outline; its rim is the edge: the magnification holds almost to it, then the content slows to a stop and curls along the rim with color fringes.
  A bevel that squeezes the frame around the lens back to 1x crams too much into a sliver, which aliases into streaks.
  The rim rounds toward the viewer: it shades darker on the side turned from the light, and a hairline of light catches the edge.
  Broad specular crescents make the lens read as plastic.
  The frame dims lightly, most right around the lens and fading further away, so the lens lifts off the screen without darkening the whole frame.
- A loupe pops in and out in about a fifth of a second, smeared by motion blur, and what it shows blurs while it glides or magnifies like the rest of the frame.
- New zooms, manual and automatic, take the type, loupe size, and Liquid the user last picked on any zoom, in every project.
- A loupe appears by growing its magnification from 1 with its content opaque; fading its content in shows the screen twice, magnified over unmagnified.
- Zooms may overlap, and none of them wins: overlapping zooms combine.
  The camera takes the deepest level on and keeps every targeted point, and the followed cursor, in frame; it backs out to fit them, never past the shallowest zoom on.
  A loupe over a full zoom magnifies the zoomed view.
  Loupes on different targets show as separate lenses; loupes on one target share one lens at the largest size and deepest level.
- Loupes back to back, or less than a second apart, share one lens: it glides to the next target and eases into the next level, size, and shape.
  Fading one lens out and the next in at another spot reads as two unrelated effects.
- Zoomed text stays sharp: capture at native resolution, and past the source pixel density upscale with a local super-resolution model trained on UI text.

Done when the zoomed view moves smoothly, keeps the cursor in frame, and keeps every clicked element whole.
