---
name: auto-zoom
description: Turning clicks and typing into zoom ranges and cursor follow. Use when changing automatic or manual zooms, cursor follow, the glass loupe, or zoomed text sharpness.
---

# Auto-zoom

Turning clicks and typing into camera direction.

- Generate zoom ranges from clicks and typing as ordinary timeline items the user edits or disables.
  A press holds its zoom until it is released, so a drag stays zoomed in from the press to the drop.
- A zoomed view follows the cursor through a dead zone, panning only as the cursor nears the edge.
- Manual zooms set target, level, and duration, animated or instant.
- A zoom that starts on the first frame starts zoomed in.
- Vertical output follows the cursor continuously, since the frame is narrower than the source.
- Glass loupe magnifies a region in place when a full zoom would move too much of the screen.
  It has no outline; its rim is the edge: the magnification holds almost to it, then the content slows to a stop short of the rim and turns back, so the outer bevel mirrors what lies just inside.
  In the last part of the bevel the content curls back several times faster, so every line that reaches the rim ends in a hook, the way it does in thick glass.
  Content that stands still at the rim smears every stroke that reaches it into a streak to the edge.
  A bevel that squeezes the frame around the lens back to 1x crams too much into a sliver, which aliases into streaks.
  The bevel splits the colors by a share of how far it bends the content; splitting the shown radius instead tears them into rainbows where the content turns back.
  The glass is clear up to its rim and ends in a crisp cut.
  A bevel that blurs what it bends, a wide blur laid over the outer bevel, or an edge that fades into the screen reads as frost on the glass: milky over light UI, smoky over dark.
  White added at the rim rings every dark window, and a rim that lets the screen under it show through shows it twice, a ghost beside what the glass bends.
  The rim rounds toward the viewer: it shades darker and a little warmer on the side turned from the light, and a thin, faint line of light catches the arc facing it.
  That line made brighter or longer reads as an outline.
  An outline all around rings flat UI: darkened, a gray one over light UI; lit, a white one over dark.
  The light comes from straight above, where the window's and the camera's shadows say it is; a lens lit from a corner casts its shadow at odds with theirs.
  Broad specular crescents make the lens read as plastic.
  The lens casts a wide, soft shadow away from the light, darkest under its lower rim and gone two radii out, so it lifts off the screen.
  The shadow's reach follows the brightness of what it falls on: wide on a light page, a contact shadow at the rim on a dark one.
  A wide shadow on dark UI has a handful of levels to cross, and an export shows them as rings tens of px wide (the `banding` skill).
  A dark shadow packed into a short reach reads as a heavy gray crescent, and a faint one leaves the lens flat on the screen.
  That shadow sets the lens off, so the frame around it keeps its brightness.
  A dim that fades out with distance darkens the frame more under a big lens than a small one, and its faint ramp bands into rings in every export.
  Supersampling the rim's curl changes a few hundred pixels of a frame, which does not earn its taps.
- A loupe following the cursor keeps it on the magnifying flat top through the fastest flick: the lens aims ahead by its spring's lag, and a cursor that reaches the edge of what the flat top shows carries the lens along.
  A lens that trails a flick hides the cursor under its glass, then curls it back in at the rim, which reads as a stutter.
- A loupe pops in and out in about a fifth of a second, smeared by motion blur, and what it shows blurs while it glides or magnifies like the rest of the frame.
- A loupe keeps its round shape by default; Liquid, which stretches the glass along its motion, is the user's pick.
- New zooms, manual and automatic, take the type, loupe size, and Liquid the user last picked on any zoom, in every project.
- A loupe appears by growing its magnification from 1 with its content opaque; fading its content in shows the screen twice, magnified over unmagnified.
- Zooms may overlap, and none of them wins: overlapping zooms combine.
  The camera takes the deepest level on and keeps every targeted point, and the followed cursor, in frame; it backs out to fit them, never past the shallowest zoom on.
- Zoomed in, a change of zooms (back to back, or one coming on or off over another) glides the camera to the new framing: it eases in and out, longer the further the framing moves.
  A spring as stiff as a snappy zoom in, given that change as one step, whips a pan across the zoomed screen half way in a tenth of a second, which reads as a jump.
- A zoom on the cursor taking over from one that already followed it carries on from where the view was.
  Re-aiming at the cursor there lurches the view across the seam for no reason the viewer can see.
- A view that starts following the cursor from a framing elsewhere glides to it, and holds the cursor in frame only once it is in view.
  Pulling the view to the cursor at once snaps it across the screen in a single frame.
  A loupe over a full zoom magnifies the zoomed view.
  Loupes on different targets show as separate lenses; loupes on one target share one lens at the largest size and deepest level.
- Loupes back to back, or less than a second apart, share one lens: it glides to the next target and eases into the next level, size, and shape.
  Fading one lens out and the next in at another spot reads as two unrelated effects.
- Zoomed text stays sharp: capture at native resolution, and past the source pixel density upscale with a local super-resolution model trained on UI text.

Done when the zoomed view moves smoothly, keeps the cursor in frame, and keeps every clicked element whole.
