---
name: auto-zoom
description: Turning clicks and typing into zoom ranges and cursor follow. Use when changing automatic or manual zooms, cursor follow, the glass loupe, or zoomed text sharpness.
---

# Auto-zoom

Turning clicks and typing into camera direction.

- Generate zoom ranges from clicks and typing as ordinary timeline items the user edits or disables.
  A press holds its zoom until it is released, so a drag stays zoomed in from the press to the drop.
- An auto zoom pulls out 0.4 s after its last click, keystroke, or release, once it has shown its framing for 1 s.
  Held 2 s, the view stays on the spot of a dialog its submit just closed, while what the submit did shows elsewhere.
  Clicks still join one zoom as if each held 2 s: pulling out and back in between clicks a few seconds apart looks erratic.
- After an auto zoom, a cursor that sets off within 2 s and comes to rest elsewhere is pointing at what the action did: a glass lens follows it there and holds 1.3 s once it rests.
  The lens gives way to the next zoom, and is left out when that leaves it too short to read.
  A cursor that waits where it clicked, nudges a little, or wanders on gets no lens; a lens after every move is noise.
  An auto lens magnifies 2x at least, whatever the auto zoom level: at 1.5x a full zoom still frames a whole dialog, but a lens only bends the screen.
- A zoomed view follows the cursor through a dead zone, panning only as the cursor nears the edge.
- A click or typing place outside the middle of the view, or away from the places the view frames now, moves the action there: the view glides to center it, together with the places after it that fit in one view, and lands by the click.
  A view clamped at the screen's edge can reach a place at the side of its frame; judged from the view alone, that place counts as framed.
  While a place holds the view, the cursor on its way there only has to stay in frame.
  Nudged only far enough to bring it in, a dialog opened from a corner button stays at the side of the frame and cut, and the camera reads as lagging.
  Centering each click on its own pans at every field of a form.
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
- A loupe opens out of what it shows as the camera zooms in, half way in about 0.12 s on the same spring, and closes back into it a fifth faster.
  Its glass grows from 0.4 of its radius together with its magnification.
  Motion blur smears the lens, and what it shows blurs while it glides or magnifies like the rest of the frame.
  A full-size lens that magnifies in a few frames shows up at once, on a clock of its own, and the motion blur swirls what it shows: it reads as a glitch, not glass.
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
