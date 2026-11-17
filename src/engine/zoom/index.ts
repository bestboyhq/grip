// Owner: auto-zoom. Camera direction: zoom items (source time) -> the zoom camera (View) and the
// glass loupe in OUTPUT time, plus generateAutoZooms (clicks and typing -> Zoom items).
//
// The camera is three critically damped springs (center x, center y, scale) chasing a target.
// Springing scale itself, not its log, front-loads a zoom in (it pops in, then lands softly on the
// content) and eases a zoom out away from the content before it opens up.
// A change of zooms while zoomed in (back to back, or one coming on or off over another) glides the
// target to the new framing, eased in and out, instead of stepping it: a spring that stiff turns a
// step across the zoomed screen into a whip pan.
// prepareZoom steps them exactly (closed form per step) at 120 Hz in output time; viewAt only reads
// those samples, so a frame is a pure function of (project, t) and matches one rendered in sequence.
// Output time means cuts and speed changes never shift or stretch an animation, and a cut that
// lands mid-animation blends into the next state.
//
// Screen rect assumption (layout.ts belongs to the compositor): layoutAt(...).screen.rect is where
// the recording sits, in unzoomed output px, and .visible the part of it that shows (all of it, or
// the crop). They may change over time and may be larger than the output. Zoomed views stay inside
// the visible part, so they never show background past the screen edge or past the crop.
// On outputs narrower than that rect (9:16, or 1:1 from a landscape screen) the rest view scales up
// until the screen covers the output height and follows the cursor. If the layout already makes the
// screen cover the output, that base scale is 1 and the camera only pans.
// A zoom level is magnification of the whole screen (2 = the screen twice as big as when it is shown
// whole), so on those narrow outputs a zoom only adds what the base view does not already give:
// scale = max(base, level). Multiplying instead would put a 2x zoom on a 9:16 output at ~6.7x.
// All of this happens in the screen's viewport (layoutAt(...).screen.viewport): the whole output, or
// the screen's own panel in split layouts. The camera is stepped in viewport space (the center is the
// content point at the viewport's center) and viewAt turns that into the output-wide View.
// The picture-in-picture camera is drawn over the zoomed screen, unzoomed: the follow camera keeps
// the cursor and clicked elements out from under it (layout's pipCameraAt, as it sits once stepped
// back for the zoom). This happens while stepping, so viewAt stays a cheap lookup.
// Zooms may overlap, and none of them wins: the camera takes the deepest level of the zooms on, and
// keeps every point they target framed (like a clicked element) and, while any of them follows the
// cursor, the cursor too. When those do not fit at that level it backs out just enough, never past
// the shallowest zoom on. Loupes on at once are separate lenses, but loupes on one target share one.

import { uid, type Project, type Rect, type Sources, type Style, type Zoom, type ZoomLook } from '../../shared/project.ts'
import type { InputEvent } from '../../shared/events.ts'
import type { Edit } from '../../shared/edits.ts'
import { mapRange, toOutput, type TimeMap } from '../../shared/timemap.ts'
import type { Loupe, SceneInput, View } from '../scene.ts'
import { frameOf, pipCameraAt, screenAt, type prepareLayout, type ScreenPlace } from '../layout.ts'
import { cursorPoint, type prepareCursor } from '../motion/index.ts'
import { easeOut, springProgress, mix, type SpringConfig } from '../motion/spring.ts'
import { idleSegments, typingSegments, type Segment } from '../input/index.ts'

const DT = 1 / 120 // s between camera samples
/** Camera springs per screen animation style, all critical (no overshoot), for following the cursor
 *  between moves: a critical spring trails a moving target by 2 / omega s, so following aims that far
 *  ahead. Every move to a new framing runs on the ease-out curve instead, PACE times as long in the style. */
const SPRINGS: Record<Style['screenAnimation'], SpringConfig> = {
  focused: { stiffness: 196, damping: 28, mass: 1 },
  smooth: { stiffness: 49, damping: 14, mass: 1 },
}
const PACE: Record<Style['screenAnimation'], number> = { focused: 1, smooth: 2 }
const BRIDGE = 1 // s: a shorter gap between zooms pans across instead of zooming out and back in
/** A change of framing (zooming in or out, one zoom into the next, re-centering) moves the camera there
 *  on the ease-out curve: this long, plus this much per view it moves, at most this. */
const GLIDE = { min: 0.4, perView: 0.4, max: 1.5 } // s
const moveTime = (views: number) => Math.min(GLIDE.min + GLIDE.perView * views, GLIDE.max)
/** s the camera takes to zoom in to `level` from rest, or out to rest from it, at `pace`. */
const zoomTime = (level: number, pace: number) => pace * moveTime(Math.abs(Math.log2(Math.max(level, 1e-3))) / 2)
const DEAD_ZONE = 0.5 // the cursor roams this fraction of the half view before the camera pans
const FOCUS_ZONE = 0.4 // clicked elements and typing stay this close to the center, so they show whole
const EDGE_ZONE = 0.85 // the cursor never gets closer to the frame edge than this
const WALL_ZONE = 0.95 // ...and when a fast flick outruns the trailing spring, never past this
const CAMERA_CLEAR = 28 // screen points x cursor size (about a cursor's height, magnified with it by the
// zoom) the cursor and clicked elements keep from a picture-in-picture camera
/** s: the camera sets off for a click or typing this long before it (PACE times that in a slower style),
 *  and an auto zoom starts this long before its first. The cursor leads, and the move lands through the
 *  action. A camera that is there by the click moves together with the cursor, then everything stands
 *  still for a beat before the click. */
const LEAD = 0.28
const KEEP = 1 // s: a clicked element stays framed this long after the click
const HOLD = 2 // s: auto zooms group as if each held this long after its last click or keystroke, or a press's release
/** s: ...but one zooms out this soon after it, once it has shown its framing for MIN_HOLD. Held longer,
 *  the view stays on a dialog the click just closed, while what the click did shows elsewhere. */
const OUT = 0.4
/** After an auto zoom, a cursor that sets off within HOLD to point at something gets a glass lens that
 *  follows it there: it rests (still this long, s) at least `away` screen points from the last action,
 *  within HOLD of setting off. The lens holds `hold` s once the cursor rests; `size` in LOUPE_SIZE units. */
const POINT = { rest: 1, away: 60, hold: 1.3, size: 240 }
/** An auto lens magnifies at least this much, whatever the auto zoom level: a full zoom at 1.5x shows a
 *  whole dialog, but a lens at 1.5x bends the screen without making anything easier to read. */
const LENS_MIN = 2
const autoLevel = (level: number, mode: Zoom['mode']) => (mode === 'loupe' ? Math.max(LENS_MIN, level) : level)
const MERGE_GAP = 2 // s: auto zooms closer than this merge; zooming out and back in that fast looks erratic
const MIN_AUTO = 1.2 // s: shorter auto zooms (clipped by the recording's ends) are dropped
const FAR_JUMPS_PER_S = 0.5 // an auto zoom panning a half view more often than this is erratic: skipped
/** s a lens at `level` takes to open out of what it shows: as long as the camera takes to zoom in that
 *  far, on the same curve. It closes back into it a fifth faster, and its glass grows from LOUPE_SEED of
 *  its radius together with its magnification. */
const lensIn = (level: number) => zoomTime(level, PACE.focused)
const lensOut = (level: number) => 0.8 * lensIn(level)
const LOUPE_SEED = 0.4
const LOUPE_GLIDE = lensIn(2) // s: one loupe glides into the next's target, level, size, and shape
const LOUPE_FOLLOW: SpringConfig = { stiffness: 120, damping: 2 * 0.65 * Math.sqrt(120), mass: 1 } // follows the cursor softly, a little overshoot
const LOUPE_LEAD = LOUPE_FOLLOW.damping / LOUPE_FOLLOW.stiffness // s: the follow spring trails a steady glide by this, so it aims that far ahead
const LOUPE_TOP = 0.85 // the flat top's share of the lens radius (shaders.wgsl BEVEL): only it shows the content magnified
const LOUPE_WALL = 0.7 // the cursor never gets further from the lens center than this share of what the flat top shows
/** Loupe lens radius in units (Zoom.size): what fits depends on what it shows, a button or a paragraph.
 *  At 540 (half of 1080) the lens spans the frame's short side; past it, the frame crops the lens. */
export const LOUPE_SIZE = { min: 60, max: 600, initial: 350 }
/** The look of `z` for new zooms: a loupe's mode, size, and shape, or nothing for a full zoom (the default). */
export const lookOf = (z: ZoomLook): ZoomLook =>
  z.mode === 'loupe' ? { mode: 'loupe', ...(z.size ? { size: z.size } : {}), ...(z.liquid ? { liquid: true } : {}) } : {}
const LOUPE_STRETCH = 0.08 // a liquid lens grows this much longer along its motion per radius/s of speed
const LOUPE_MAX_STRETCH = 0.35
const AT_START = 1e-3 // s: a zoom starting this close to output 0 starts zoomed in

type Pt = { x: number; y: number }
interface Span {
  a: number // output seconds
  b: number
  zoom: Zoom
}
interface Seg {
  a: number // output seconds
  b: number
  zooms: Zoom[] // on over [a, b], in start order
}
/** Something to keep framed (a click or a typing stretch) at screen px (x, y). */
interface Focus {
  t0: number // source seconds the activity starts
  t1: number // and ends (= t0 for a click)
  x: number
  y: number
  up?: number // source seconds a click's press is released: an auto zoom holds through a drag
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** Clicks, with when each press is released, and typing stretches, with where they happen. Typing
 *  happens where the last click before it focused a field; typing with no click before it has no known
 *  place and is left out. */
function focuses(events: InputEvent[], typing: Segment[], screen: NonNullable<Sources['screen']>): Focus[] {
  const clicks: Focus[] = []
  const pressed = new Map<string, Focus>() // by button, until its release
  for (const e of events) {
    if (e.type === 'up') {
      const c = pressed.get(e.button)
      if (c) c.up = e.t
      pressed.delete(e.button)
    }
    if (e.type !== 'down') continue
    pressed.delete(e.button) // a press off the screen holds nothing
    if (e.x < 0 || e.y < 0 || e.x > screen.width || e.y > screen.height) continue
    const c: Focus = { t0: e.t, t1: e.t, x: e.x, y: e.y }
    clicks.push(c)
    pressed.set(e.button, c)
  }
  const out = [...clicks]
  for (const g of typing) {
    const c = clicks.findLast((c) => c.t0 <= g.start)
    if (c) out.push({ t0: g.start, t1: g.end, x: c.x, y: c.y })
  }
  return out.sort((p, q) => p.t0 - q.t0)
}

/** focuses() with the input domain's typing, once per events array (replaced, never edited in place)
 *  and screen size: a 2-hour recording has a million events to look through. */
const focused = new WeakMap<InputEvent[], { w: number; h: number; value: Focus[] }>()
function focusesOf(events: InputEvent[], screen: NonNullable<Sources['screen']>): Focus[] {
  const f = focused.get(events)
  if (f?.w === screen.width && f.h === screen.height) return f.value
  const value = focuses(events, typingSegments(events), screen)
  focused.set(events, { w: screen.width, h: screen.height, value })
  return value
}

/** Zoom items -> output-time pieces in output order, contiguous pieces of one zoom joined. */
function pieces(zooms: Zoom[], map: TimeMap): Span[] {
  const out: Span[] = []
  for (const zoom of zooms) {
    for (const [a, b] of mapRange(map, zoom.start, zoom.end)) {
      const last = out.at(-1)
      if (last?.zoom === zoom && a - last.b < 1e-9) last.b = b
      else out.push({ a, b, zoom })
    }
  }
  return out.sort((p, q) => p.a - q.a)
}

/** Output-time stretches over which the same zooms are on, in order: every zoom on is listed, none
 *  wins. A gap shorter than BRIDGE keeps the zooms before it, so the camera pans to the next ones
 *  instead of zooming out and back in. */
// ponytail: O(pieces^2) sweep, fine for hundreds of zooms; use a heap of active pieces if thousands.
function segments(zooms: Zoom[], map: TimeMap): Seg[] {
  const ps = pieces(zooms, map)
  const cuts = [...new Set(ps.flatMap((p) => [p.a, p.b]))].sort((x, y) => x - y)
  const out: Seg[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]
    const b = cuts[i + 1]
    const on = ps.filter((p) => p.a <= a && p.b >= b).map((p) => p.zoom)
    if (!on.length) continue
    const last = out.at(-1)
    if (last && a - last.b < BRIDGE) {
      last.b = a
      if (on.length === last.zooms.length && on.every((z, k) => z === last.zooms[k])) {
        last.b = b
        continue
      }
    }
    out.push({ a, b, zooms: on })
  }
  return out
}

/** The largest scale at which every point lies within its zone (a fraction of the half view) of one
 *  center of viewport vp; Infinity when nothing limits it. */
function fitScale(hold: Array<{ p: Pt; zone: number }>, vp: Rect): number {
  let s = Infinity
  for (const u of hold) {
    for (const v of hold) {
      const dx = u.p.x - v.p.x
      const dy = u.p.y - v.p.y
      if (dx > 0) s = Math.min(s, ((u.zone + v.zone) * vp.w) / (2 * dx))
      if (dy > 0) s = Math.min(s, ((u.zone + v.zone) * vp.h) / (2 * dy))
    }
  }
  return s
}

/** Whether moving from the zooms of `from` to those of `to` cuts instead of animating: something
 *  instant comes on, or with nothing coming on, something instant goes off. */
function cutsTo(from: Zoom[], to: Zoom[]): boolean {
  const on = to.filter((z) => !from.includes(z))
  return on.length ? on.some((z) => z.instant) : from.some((z) => !to.includes(z) && z.instant)
}

/** Scale at which the screen `r` covers a viewport narrower than it (cut to `b`, the part clear of the
 *  rounded corners); 1 otherwise. Narrower takes two tests. The aspect test uses the screen itself: a
 *  large corner radius must not make a screen as wide as the output look wider. The room test uses the
 *  frame `f` around it (inset, device): an output shaped to its even padding, as Auto and a Cover crop
 *  make it, has as much room above and below as at the sides, and keeps that padding. */
function baseScale(vp: Rect, r: Rect, f: Rect, b: Rect): number {
  const narrower = vp.w / vp.h < (r.w / r.h) * 0.98 && vp.h - f.h - (vp.w - f.w) > 0.02 * vp.h
  return narrower ? Math.max(1, vp.h / b.h) : 1
}

/** How far scale s magnifies past the rest framing `base`: 0 at rest, 1 at twice that or more. */
const magnified = (s: number, base: number) => clamp(Math.log2(s / base), 0, 1)

/** The part of the screen a zoomed view may show: inset so its corners stay clear of the rounded ones
 *  (a view corner inside a corner of radius r needs an inset of r * (1 - 1/sqrt 2) on both edges). */
function inner(r: Rect, radius: number): Rect {
  const i = 0.3 * radius
  return { x: r.x + i, y: r.y + i, w: r.w - 2 * i, h: r.h - 2 * i }
}

/** Nearest center at scale s whose view of viewport vp stays inside rect r (and always inside vp). */
function clampCenter(c: Pt, r: Rect, s: number, vp: Rect): Pt {
  const axis = (v: number, lo: number, size: number, view: number, from: number, full: number) =>
    view <= size ? clamp(v, lo + view / 2, lo + size - view / 2) : clamp(lo + size / 2, from + view / 2, from + full - view / 2)
  return { x: axis(c.x, r.x, r.w, vp.w / s, vp.x, vp.w), y: axis(c.y, r.y, r.h, vp.h / s, vp.y, vp.h) }
}

/** What zooms zs frame on screen rect r of viewport vp: the points they target, the deepest level on
 *  backed out until those and the followed cursor cp fit (never past the shallowest zoom, nor under
 *  the rest scale b0), and the middle of the points. */
function framing(zs: Zoom[], r: Rect, vp: Rect, b0: number, cp: Pt | null) {
  const points = zs.flatMap((z) => (z.target.kind === 'point' ? [{ x: r.x + z.target.x * r.w, y: r.y + z.target.y * r.h }] : []))
  let s = b0
  if (zs.length) {
    const hold = points.map((p) => ({ p, zone: FOCUS_ZONE }))
    if (cp && hold.length) hold.push({ p: cp, zone: EDGE_ZONE })
    const levels = zs.map((z) => z.level)
    s = Math.max(b0, clamp(fitScale(hold, vp), Math.min(...levels), Math.max(...levels)))
  }
  const mid: Pt | null = points.length
    ? { x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2, y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2 }
    : null
  return { points, s, mid }
}

/** Seconds the camera glides from scale `from` to scale s with its center moving `off` viewport px. */
function glideTime(off: number[], from: number, s: number, vp: Rect): number {
  // How far the framing moves, in views: the pan as the view sees it on the way (at the scale half
  // way), or the zoom (doubling the magnification moves the frame's edges half a view).
  const halfway = (s + from) / 2
  const views = Math.max(Math.hypot((off[0] * halfway) / vp.w, (off[1] * halfway) / vp.h), Math.abs(Math.log2(from / s)) / 2)
  return moveTime(views)
}

/** The middle of the click and typing places from frames[i] on that one view frames together: the run
 *  of them, in order and before output time `end`, that fits within the focus zone of its middle at
 *  half view (hw, hh). Framing the clicks ahead keeps a dialog whole while its fields are filled in,
 *  where centering on each click would pan at every one and cut off what lies above or below it. */
function together(frames: Array<{ a: number; p: Pt }>, i: number, end: number, hw: number, hh: number): Pt {
  let [x0, x1, y0, y1] = [frames[i].p.x, frames[i].p.x, frames[i].p.y, frames[i].p.y]
  for (let j = i + 1; j < frames.length && frames[j].a < end; j++) {
    const { x, y } = frames[j].p
    if (Math.max(x1, x) - Math.min(x0, x) > 2 * FOCUS_ZONE * hw || Math.max(y1, y) - Math.min(y0, y) > 2 * FOCUS_ZONE * hh) break
    ;[x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)]
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
}

/** Move center c the least so that p lies within (rx, ry) of it. */
const keep = (c: Pt, p: Pt, rx: number, ry: number): Pt => ({ x: clamp(c.x, p.x - rx, p.x + rx), y: clamp(c.y, p.y - ry, p.y + ry) })

/** Move center c the least, along one axis and within `bounds`, so that content point p shows
 *  outside the corner camera `cam` (output px) grown by m, on its side facing the viewport's center.
 *  Unchanged when p is clear already, or when no pan clears it (the view is against the screen
 *  corner under the camera). `hold`, the previous aim, keeps the pan steady: p stays on the side of
 *  the camera the aim had it on, and the aim holds while it clears p by up to m more, so a cursor
 *  jittering at the camera's edge (with a clicked field pulling the view the other way) neither
 *  shakes the view nor flips it from one side of the camera to the other. */
function clear(c: Pt, p: Pt, hold: Pt | null, cam: Rect, m: number, s: number, vp: Rect, bounds: Rect): Pt {
  const mx = vp.x + vp.w / 2
  const my = vp.y + vp.h / 2
  // The side of the frame the camera sits on, and its inner edges grown by m.
  const sx = cam.x + cam.w / 2 > mx ? 1 : -1
  const sy = cam.y + cam.h / 2 > my ? 1 : -1
  const ex = sx > 0 ? cam.x - m : cam.x + cam.w + m
  const ey = sy > 0 ? cam.y - m : cam.y + cam.h + m
  // How far p shows past each edge with the view centered at v (past both: under the camera).
  const pastX = (v: Pt) => sx * (mx + (p.x - v.x) * s - ex)
  const pastY = (v: Pt) => sy * (my + (p.y - v.y) * s - ey)
  const q = clampCenter(c, bounds, s, vp) // where the view will be
  const dx = pastX(q)
  const dy = pastY(q)
  if (dx <= 0 || dy <= 0) return c
  // The least pan along each axis that clears p, where the bounds allow it.
  const x = q.x + (sx * dx) / s
  const y = q.y + (sy * dy) / s
  const k = clampCenter({ x, y }, bounds, s, vp)
  const okX = Math.abs(k.x - x) < 1e-6
  const okY = Math.abs(k.y - y) < 1e-6
  const hx = hold ? pastX(hold) : dx
  const hy = hold ? pastY(hold) : dy
  if (okX && (!okY || hx <= hy)) return { x: hx <= 0 && hx >= -m ? hold!.x : x, y: c.y }
  return okY ? { x: c.x, y: hy <= 0 && hy >= -m ? hold!.y : y } : c
}

/** Exact one-step update of the spring over dt: [h, g, h', g'] where displacement after dt is
 *  d * h + v * g and velocity d * h' + v * g' (linear in the initial state, closed form). */
function springStep(dt: number, spring: SpringConfig): [number, number, number, number] {
  const e = 1e-5
  const h = (t: number) => 1 - springProgress(t, spring)
  const g = (t: number) => springProgress(t, spring, 1) - springProgress(t, spring)
  return [h(dt), g(dt), (h(dt + e) - h(dt - e)) / (2 * e), (g(dt + e) - g(dt - e)) / (2 * e)]
}

export function prepareZoom(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>, cursor: ReturnType<typeof prepareCursor>, path = zoomPath(input, map, layout, cursor)) {
  const { width: W, height: H } = input
  const unit = Math.min(W, H) / 1080
  const loupes = lenses(input.project.zooms.filter((z) => z.enabled && z.mode === 'loupe'), map, layout, unit).map((run) => lens(run, layout, cursor, unit))
  return { W, H, map, layout, cursor, loupes, ...path }
}

/** Lens radius of loupe z, px. */
const radiusOf = (z: Zoom, unit: number) => clamp(Number(z.size) || LOUPE_SIZE.initial, LOUPE_SIZE.min, LOUPE_SIZE.max) * unit

/** Loupe pieces -> the pieces of each lens, in start order. Loupes on at once are separate lenses,
 *  except loupes on one target (the cursor, or points closer than a lens radius), which share one.
 *  A loupe that starts as a lens ends, or less than BRIDGE after, takes that lens over, so the glass
 *  glides to it instead of fading out and back in. */
function lenses(zooms: Zoom[], map: TimeMap, layout: ReturnType<typeof prepareLayout>, unit: number): Span[][] {
  const out: Array<{ run: Span[]; end: number }> = []
  const spot = (p: Span) => {
    const r = p.zoom.target.kind === 'point' ? screenAt(layout, p.a)?.screen : null
    return r && p.zoom.target.kind === 'point' ? { x: r.x + p.zoom.target.x * r.w, y: r.y + p.zoom.target.y * r.h } : null
  }
  const same = (p: Span, q: Span) => {
    if (p.zoom.target.kind !== 'point' || q.zoom.target.kind !== 'point') return p.zoom.target.kind === q.zoom.target.kind
    const u = spot(p)
    const v = spot(q)
    return !!u && !!v && Math.hypot(u.x - v.x, u.y - v.y) < Math.min(radiusOf(p.zoom, unit), radiusOf(q.zoom, unit))
  }
  for (const p of pieces(zooms, map)) {
    const on = out.find((l) => l.end > p.a + 1e-9 && same(l.run.findLast((q) => q.b > p.a + 1e-9)!, p))
    const free = out.filter((l) => l.end <= p.a + 1e-9 && p.a - l.end < BRIDGE).sort((x, y) => y.end - x.end)[0]
    const l = on ?? free
    if (l) {
      l.run.push(p)
      l.end = Math.max(l.end, p.b)
    } else out.push({ run: [p], end: p.b })
  }
  return out.map((l) => l.run)
}

const LENS = 7 // floats per lens sample

/** One lens, every DT from its start through its fade out: x, y and velocity x, y (unzoomed px,
 *  px/s), level, radius (px), and liquid (0 rigid, 1 liquid), stepped like the camera so any frame
 *  reads it in isolation. It takes the deepest level and largest size of its loupes on, and stays
 *  rigid while any of them is; through a short gap it holds the last ones. It follows the cursor on
 *  a soft spring aimed ahead and never lets it off the flat top; a fixed point holds still. Into the
 *  next loupe it glides to that one's target and eases into its level, size, and shape; into or out
 *  of an instant one it jumps. It centers on the cursor even at the screen's edge, so the lens may
 *  overhang into the background. */
function lens(run: Span[], layout: ReturnType<typeof prepareLayout>, cursor: ReturnType<typeof prepareCursor>, unit: number) {
  const a = run[0].a
  const last = run.reduce((x, y) => (y.b >= x.b ? y : x))
  const b = last.b
  const close = last.zoom.instant ? 0 : lensOut(last.zoom.level)
  const n = Math.ceil((b + close - a) / DT) + 1
  const path = new Float32Array(LENS * n)
  const jumps = new Map<number, number>()
  const follow = springStep(DT, LOUPE_FOLLOW)
  const pos = [0, 0, 0, 0, 0] // x, y, log level, radius, liquid
  const vel = [0, 0, 0, 0, 0]
  let glide: { t0: number; off: number[] } | null = null // into the next loupe: how far off its target the lens set out
  const aimed = [0, 0] // the target's x, y one step before
  let aim: Pt | null = null
  let now: Pt | null = null // the cursor at t, while the lens follows it
  let caught = false // the cursor got onto the flat top since the lens began following it
  let started = false
  let next = 0
  let on: Span[] = [] // the loupes covering t
  let held: Span[] = [] // the ones the lens shows: those, or the last ones on (a gap, the fade out)
  for (let k = 0; k < n; k++) {
    const t = a + k * DT
    while (next < run.length && run[next].a <= t) on = [...on, run[next++]] // a new array: `held` may be the old one
    on = on.filter((p) => p.b > t)
    const was = held
    held = on.length ? on : held.length ? held : [run[next - 1]]
    const { zoom } = held.at(-1)!
    const s = screenAt(layout, t)
    now = null
    if (s) {
      const { screen: r, visible: v } = s
      const inside = (p: Pt) => ({ x: clamp(p.x, v.x, v.x + v.w), y: clamp(p.y, v.y, v.y + v.h) })
      const c: Pt = zoom.target.kind === 'point' ? { x: r.x + zoom.target.x * r.w, y: r.y + zoom.target.y * r.h } : (cursorPoint(cursor, t + LOUPE_LEAD) ?? aim ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 })
      aim = inside(c)
      const p = zoom.target.kind === 'point' ? null : cursorPoint(cursor, t)
      now = p && inside(p)
    }
    if (!aim) continue
    const zs = held.map((p) => p.zoom)
    const level = Math.max(1, ...zs.map((z) => z.level))
    const target = [aim.x, aim.y, Math.log(level), Math.max(...zs.map((z) => radiusOf(z, unit))), zs.every((z) => z.liquid) ? 1 : 0]
    const changed = was.length !== held.length || held.some((p) => !was.includes(p))
    if (!started || (changed && cutsTo(was.map((p) => p.zoom), zs))) {
      // The first sample, or an instant loupe cutting in or out: jump, no animation.
      const into = held.find((p) => !was.includes(p))
      if (started) jumps.set(k - 1, into ? into.a : was.find((p) => !held.includes(p))!.b)
      started = true
      pos.splice(0, 5, ...target)
      vel.fill(0)
      glide = null
    } else if (changed) glide = { t0: t, off: pos.map((p, o) => p - target[o]) }
    const u = glide ? (t - glide.t0) / LOUPE_GLIDE : 1
    if (glide) {
      // Into the next loupe on the ease-out curve, from where the lens is, its target moving with the cursor.
      // The last step lands on the target with the curve at rest, so the follow spring takes over at the
      // target's own speed; the speed of that step instead carries the lens past it and back.
      const left = 1 - easeOut(u)
      for (let o = 0; o < 5; o++) {
        const p = target[o] + glide.off[o] * left
        vel[o] = u < 1 ? (p - pos[o]) / DT : o < 2 ? (target[o] - aimed[o]) / DT : 0
        pos[o] = p
      }
    }
    if (now) {
      // A flick outruns the spring. Past the flat top the cursor would vanish under the glass and then
      // curl back in at the rim, so once on it, the lens carries it along at the wall instead.
      const wall = (LOUPE_WALL * LOUPE_TOP * pos[3]) / Math.exp(pos[2])
      const dx = pos[0] - now.x
      const dy = pos[1] - now.y
      const d = Math.hypot(dx, dy)
      caught ||= d <= wall
      if (caught && d > wall) (pos[0] = now.x + (dx * wall) / d), (pos[1] = now.y + (dy * wall) / d)
    } else caught = false
    path.set([pos[0], pos[1], vel[0], vel[1], Math.exp(pos[2]), pos[3], pos[4]], LENS * k)
    // Between glides the lens follows the cursor on a soft spring; its level, size, and shape hold.
    if (!glide) {
      for (let o = 0; o < 2; o++) {
        const [h, g, dh, dg] = follow
        const d = pos[o] - target[o]
        pos[o] = target[o] + d * h + vel[o] * g
        vel[o] = d * dh + vel[o] * dg
      }
      pos.splice(2, 3, ...target.slice(2))
    }
    if (u >= 1) glide = null
    aimed.splice(0, 2, target[0], target[1])
  }
  const open = run[0].zoom.instant || a < AT_START ? 0 : lensIn(run[0].zoom.level)
  return { a, b, open, close, path, jumps }
}

let last: { events: InputEvent[]; cursor: Float32Array; key: string; path: ZoomPath } | null = null

/** The camera samples: plain data, a function of the output size, the zooms, the clips' timing, the
 *  events, the cursor path, and where the layout puts the screen and the corner camera over time (the
 *  view keeps the cursor out from under the camera). Edits that leave all of that alone (background,
 *  cursor size, captions, masks) reuse the last samples. */
// ponytail: one cached result, recomputed whole when its inputs change (~90 ms per 2 hours, in the
// preview's worker); resume from the first changed second if zoom edits must land faster.
export function zoomPath(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>, cursor: ReturnType<typeof prepareCursor>) {
  const { project, events, width, height } = input
  const screens = Object.values(layout.targets).map((s) => [s.screen, s.visible, s.screenRadius, s.viewport, s.camera, s.pip, s.cameraOpacity])
  const camera = !!project.sources.camera && [project.style.camera.position, project.style.camera.visible]
  const key = JSON.stringify([width, height, project.sources.screen ?? null, project.style.screenAnimation, project.zooms, map.clips.map((c) => [c.start, c.end, c.speed]), layout.changes, screens, camera])
  if (last?.events !== events || last.cursor !== cursor.x || last.key !== key) last = { events, cursor: cursor.x, key, path: simulate(input, map, layout, cursor) }
  return last.path
}

export type ZoomPath = ReturnType<typeof simulate>

function simulate(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>, cursor: ReturnType<typeof prepareCursor>) {
  const { project, events, width: W, height: H } = input
  const screen = project.sources.screen
  // The camera follows the cursor even where the cursor is not drawn.
  // cursorPoint ignores visibility (style or idle hide), so a hidden cursor is still followed.
  const cur = cursor
  const enabled = project.zooms.filter((z) => z.enabled)
  const n = Math.ceil(map.duration / DT)
  const spring = SPRINGS[project.style.screenAnimation] ?? SPRINGS.focused
  const pace = PACE[project.style.screenAnimation] ?? PACE.focused
  const omega = Math.sqrt(spring.stiffness / spring.mass)
  const lag = 2 / omega
  const lead = pace * LEAD
  if (!screen) return { n, data: new Float32Array(0), jumps: new Map<number, number>() }

  // The screen layer at t; where the layout hides the screen, the last one seen.
  const full = { x: 0, y: 0, w: W, h: H }
  let layer: ScreenPlace = screenAt(layout, 0) ?? { screen: full, visible: full, screenRadius: 0, viewport: full }
  const layerAt = (t: number) => (layer = screenAt(layout, t) ?? layer)
  const toPx = (r: Rect, x: number, y: number): Pt => ({ x: r.x + (x * r.w) / screen.width, y: r.y + (y * r.h) / screen.height })
  const cursorPt = (t: number, r: Rect): Pt | null => {
    const c = cursorPoint(cur, clamp(t, 0, map.duration))
    // Off the shown area (another display, or cropped away): nothing to follow.
    return c && c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h ? { x: c.x, y: c.y } : null
  }

  // Output-time windows during which a click or typing place must stay framed.
  const frames: Array<{ a: number; b: number; p: Pt }> = []
  for (const f of focusesOf(events, screen)) {
    const outs = f.t1 > f.t0 ? mapRange(map, f.t0, f.t1) : ((o) => (o === null ? [] : [[o, o]]))(toOutput(map, f.t0))
    for (const [a, b] of outs) frames.push({ a: a - lead, b: b + KEEP, p: toPx(screenAt(layout, a)?.screen ?? layer.screen, f.x, f.y) })
  }
  frames.sort((p, q) => p.a - q.a)

  const cam = segments(enabled.filter((z) => z.mode !== 'loupe'), map)
  // A slower style starts zooming in that much earlier, so every style is as far in by the click.
  cam.forEach((s, i) => {
    if (!s.zooms.some((z) => z.instant) && s.a > AT_START) s.a = Math.max(s.a - (lead - LEAD), i ? cam[i - 1].b : 0)
  })
  const data = new Float32Array(3 * (n + 1))
  const jumps = new Map<number, number>()
  const [h, g, dh, dg] = springStep(DT, spring)
  const pos = [0, 0, 0] // x, y, scale
  const vel = [0, 0, 0]
  const target = [0, 0, 0] // what the springs chase
  const goal = [0, 0, 0] // the framing the camera was headed for at the last step
  const step = [0, 0, 0] // and how far it moved over that step
  let glide: { t0: number; dur: number; off: number[]; from: number } | null = null
  let aim: Pt | null = null // where the follow camera wants its center
  let caught = false // the cursor has been in view since the camera began following it
  let prev: Seg | null = null
  let si = 0
  let entered = 0 // frames whose window has opened
  let run: Pt | null = null // the middle of the places the view frames now
  for (let k = 0; k <= n; k++) {
    const t = k * DT
    const place = layerAt(t)
    const { screen: r, visible: shown, screenRadius: radius, viewport: vp } = place
    const bounds = inner(shown, radius)
    const ts = clamp(t, AT_START, map.duration - 1e-6) // a zoom starting at 0 or running to the end covers that frame
    while (si < cam.length && cam[si].b <= ts) si++
    const seg = si < cam.length && cam[si].a <= ts ? cam[si] : null
    const zs = seg?.zooms ?? []
    const b0 = baseScale(vp, shown, frameOf(layout, place), bounds)
    const follow = zs.length ? zs.some((z) => z.target.kind !== 'point') : b0 > 1
    // Everything is read lag ahead so the trailing spring lands on time.
    const tl = t + lag
    const cp = follow ? cursorPt(tl, shown) : null
    const { points, s, mid } = framing(zs, r, vp, b0, cp)
    let recenter = false // the view sets off for a new place

    let c: Pt = { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 }
    if (!follow && mid) c = aim = mid
    else if (follow) {
      // Follow: the cursor roams a dead zone, focus places and targeted points stay central, all stay
      // out from under a picture-in-picture camera, and the cursor stays in frame above all.
      const hw = vp.w / (2 * s)
      const hh = vp.h / (2 * s)
      if (seg && seg !== prev && !prev?.zooms.some((z) => z.target.kind !== 'point')) {
        // The camera starts following the cursor: aim at the first click or typing place and the ones
        // after it that fit, else at the cursor. A zoom taking over from one that followed it already
        // carries on from where it was.
        const first = frames.findIndex((f) => f.b >= seg.a && f.a <= seg.a + lead + 0.4)
        run = first >= 0 ? together(frames, first, seg.b, hw, hh) : null
        aim = run ?? cp ?? aim
      }
      c = aim ?? mid ?? { x: shown.x + shown.w / 2, y: shown.y + shown.h / 2 }
      // Click and typing places open their windows in order. One outside the focus zone, of the view or
      // of the run of places it frames, moves the action there: the view re-centers on it and the places
      // after it that fit, setting off as its window opens, LEAD before the click. Nudged only to the zone's
      // edge, or left where it is because a view clamped at the screen's edge happens to reach it, a dialog
      // opened from a corner button stays at the frame's side.
      const far = (p: Pt) => [c, run].some((q) => q && (Math.abs(p.x - q.x) > FOCUS_ZONE * hw || Math.abs(p.y - q.y) > FOCUS_ZONE * hh))
      for (let f; (f = frames[entered]) && f.a <= t; entered++) {
        if (seg && far(f.p)) (c = run = together(frames, entered, seg.b, hw, hh)), (recenter = true)
      }
      // The latest place open holds the view; a newer one releases it. Between places the cursor roams a
      // dead zone; while one holds the view, the cursor on its way there only has to stay in frame.
      const spot = entered && frames[entered - 1].b >= tl ? frames[entered - 1].p : null
      if (cp && !spot) c = keep(c, cp, DEAD_ZONE * hw, DEAD_ZONE * hh)
      const focus = spot ? [spot, ...points] : points // targeted points, which the level makes room for, go last
      for (const p of focus) c = keep(c, p, FOCUS_ZONE * hw, FOCUS_ZONE * hh)
      // The camera as it will sit once the view gets there (it steps back while zoomed in).
      const pip = pipCameraAt(layout, tl, magnified(s, b0))
      if (pip) {
        const m = CAMERA_CLEAR * (screen.scale || 1) * (r.w / screen.width) * Math.max(1, project.style.cursor.size) * s
        for (const p of focus) c = clear(c, p, aim, pip, m, s, vp, bounds)
        if (cp) c = clear(c, cp, aim, pip, m, s, vp, bounds)
      }
      if (cp) c = keep(c, cp, EDGE_ZONE * hw, EDGE_ZONE * hh)
      c = aim = clampCenter(c, bounds, s, vp)
    }
    while (entered < frames.length && frames[entered].a <= t) entered++ // not following, places pass unframed
    c = clampCenter(c, bounds, s, vp)

    const cut = k === 0 || (seg !== prev && cutsTo(prev?.zooms ?? [], zs))
    const next = [c.x, c.y, s]
    // A framing moved on from where the last one was headed: zooming in or out, one zoom into the next,
    // or re-centering on a new place. A zoom taking over the same framing carries on as one.
    const moved = Math.hypot(c.x - goal[0] - step[0], c.y - goal[1] - step[1]) > 0.5 || Math.abs(s - goal[2] - step[2]) > 1e-4
    for (let i = 0; i < 3; i++) (step[i] = cut ? 0 : next[i] - goal[i]), (goal[i] = next[i])
    if (cut) glide = null
    else if ((seg !== prev || recenter) && moved) {
      // Move there from where the camera is. Its center keeps the offset, gliding away, so following
      // the cursor carries on throughout.
      const off = [pos[0] - c.x, pos[1] - c.y]
      glide = { t0: t, dur: pace * glideTime(off, pos[2], s, vp), off, from: pos[2] }
    }
    const u = glide ? (t - glide.t0) / glide.dur : 1
    if (glide) {
      // On the ease-out curve, as a zoom about the one point of the screen that stays put, in log scale:
      // every view on the way lies between the first and the last, so the screen flows under the camera
      // and never meets its edge. A clamp to the screen each step pinned the view to the corner it
      // zoomed toward within a few frames, and the rest of the move only spread out from there.
      const left = 1 - easeOut(u) // 0 from u = 1: the move's last step lands on the framing
      const s0 = glide.from
      const v = s * (s0 / s) ** left
      const at = (a: number, b: number) => (Math.abs(s - s0) < 1e-4 ? b + (a - b) * left : ((b * s - a * s0) / (s - s0)) * (1 - s0 / v) + (a * s0) / v)
      next.splice(0, 3, at(c.x + glide.off[0], c.x), at(c.y + glide.off[1], c.y), v)
    }
    for (let i = 0; i < 3; i++) target[i] = next[i]

    if (cut || glide) {
      // First frame, or an instant zoom cutting in or out: jump, no animation. A move is the curve's alone.
      // The curve comes to rest on the framing, so the springs take over at the framing's own speed;
      // the speed of the move's last step instead carries the view past it and back.
      if (cut && k > 0) jumps.set(k - 1, seg ? seg.a : prev!.b)
      for (let i = 0; i < 3; i++) (vel[i] = cut ? 0 : step[i] / DT), (pos[i] = target[i])
    }
    const now = follow ? cursorPt(t, shown) : null
    if (now) {
      // Never let the cursor out of view once it is in: a fast flick drags the view along. A view that
      // starts following from a framing elsewhere glides to the cursor instead of snapping to it. Mid
      // move the view may still show past the screen's edge, on its way in or out.
      const v = pos[2]
      const rx = (WALL_ZONE * vp.w) / (2 * v)
      const ry = (WALL_ZONE * vp.h) / (2 * v)
      caught ||= Math.abs(now.x - pos[0]) <= rx && Math.abs(now.y - pos[1]) <= ry
      const p = caught ? keep({ x: pos[0], y: pos[1] }, now, rx, ry) : { x: pos[0], y: pos[1] }
      const w = glide ? p : clampCenter(p, bounds, v, vp)
      pos[0] = w.x
      pos[1] = w.y
    } else caught = false
    for (let i = 0; i < 3; i++) {
      data[3 * k + i] = pos[i]
      if (glide) continue
      const d = pos[i] - target[i]
      pos[i] = target[i] + d * h + vel[i] * g
      vel[i] = d * dh + vel[i] * dg
    }
    if (u >= 1) glide = null
    prev = seg
  }
  return { n, data, jumps }
}

export function viewAt(z: ReturnType<typeof prepareZoom>, t: number): View {
  const { W, H, data, n } = z
  if (!data.length) return { center: { x: W / 2, y: H / 2 }, scale: 1 }
  const tc = clamp(t, 0, n * DT)
  const k = Math.min(Math.floor(tc / DT), n)
  const k1 = Math.min(k + 1, n)
  const jump = z.jumps.get(k)
  // An instant cut inside this step: hold the sample on the matching side instead of blending.
  const [i, j, w] = jump === undefined ? [k, k1, tc / DT - k] : tc < jump ? [k, k, 0] : [k1, k1, 0]
  const at = (o: number) => mix(data[3 * i + o], data[3 * j + o], w)
  const scale = at(2)
  const vp = screenAt(z.layout, tc)?.viewport ?? { x: 0, y: 0, w: W, h: H }
  // Never show past the viewport's edge, even mid-animation.
  const x = clamp(at(0), vp.x + vp.w / (2 * scale), vp.x + vp.w - vp.w / (2 * scale))
  const y = clamp(at(1), vp.y + vp.h / (2 * scale), vp.y + vp.h - vp.h / (2 * scale))
  // Viewport space -> output: the content at the viewport's center lands there, not at the output's.
  return { center: { x: x - (vp.x + vp.w / 2 - W / 2) / scale, y: y - (vp.y + vp.h / 2 - H / 2) / scale }, scale }
}

/** How far view v (the view at t) is zoomed in past the rest framing at t: 0 at rest, 1 at twice
 *  that or more. Layout uses it to step a corner camera back while the content is magnified. */
export function zoomAmount(z: ReturnType<typeof prepareZoom>, t: number, v: View): number {
  const s = screenAt(z.layout, t)
  if (!s) return 0
  return magnified(v.scale, baseScale(s.viewport, s.visible, frameOf(z.layout, s), inner(s.visible, s.screenRadius)))
}

/** The lenses showing at t, in start order (later ones over earlier ones). */
export function loupesAt(z: ReturnType<typeof prepareZoom>, t: number): Loupe[] {
  if (!screenAt(z.layout, t)) return []
  return z.loupes.map((lens) => lensAt(lens, t)).filter((l): l is Loupe => !!l)
}

/** For motion blur: each lens showing at t (loupesAt's order) at the shutter times ts. Where it is
 *  not on yet, or anymore, it sits where it is at t, unmagnified and clear, as good as not there. */
export function loupesAcross(z: ReturnType<typeof prepareZoom>, t: number, ts: number[]): Loupe[][] {
  if (!screenAt(z.layout, t)) return []
  return z.loupes.flatMap((lens) => {
    const at = lensAt(lens, t)
    return at ? [ts.map((x) => lensAt(lens, x) ?? { ...at, scale: 1, opacity: 0, stretch: { x: 0, y: 0 } })] : []
  })
}

function lensAt(lens: ReturnType<typeof prepareZoom>['loupes'][number], t: number): Loupe | null {
  const { a, b, path } = lens
  if (t < a || t >= b + lens.close) return null
  const fadeIn = lens.open ? easeOut((t - a) / lens.open) : 1
  const fadeOut = t < b ? 0 : lens.close ? easeOut((t - b) / lens.close) : 1
  const p = fadeIn * (1 - fadeOut)
  const n = path.length / LENS
  const x = clamp((t - a) / DT, 0, n - 1)
  const k = Math.min(Math.floor(x), n - 2)
  const jump = lens.jumps.get(k)
  // An instant switch inside this step: hold the sample on the matching side instead of blending.
  const [i, j, w] = jump === undefined ? [k, k + 1, x - k] : t < jump ? [k, k, 0] : [k + 1, k + 1, 0]
  const at = (o: number) => mix(path[LENS * i + o], path[LENS * j + o], w)
  const vx = at(2), vy = at(3), radius = at(5)
  const speed = Math.hypot(vx, vy)
  const e = at(6) * Math.min(LOUPE_MAX_STRETCH, (LOUPE_STRETCH * speed) / radius)
  const stretch = e > 0 ? { x: (vx / speed) * e, y: (vy / speed) * e } : { x: 0, y: 0 }
  // The glass grows with the magnification: a full-size lens that magnifies in a few frames shows up at
  // once, and the motion blur swirls what it shows.
  return { x: at(0), y: at(1), radius: radius * mix(LOUPE_SEED, 1, p), scale: at(4) ** p, opacity: p, stretch }
}

/** Auto zooms (source time) from clicks and typing: merge activity close in time, start LEAD before
 *  it, hold HOLD after it (after a press's release, so a drag stays zoomed, and to the end when that
 *  leaves too little to zoom out), and skip stretches that would pan erratically. Each zoom follows the cursor with `look`; viewAt frames its clicks
 *  and typing. `typing` defaults to the input domain's detector. */
export function generateAutoZooms(events: InputEvent[], sources: Sources, autoZoom: Style['autoZoom'], look: ZoomLook = {}, typing: Segment[] = typingSegments(events)): Zoom[] {
  const screen = sources.screen
  if (!autoZoom.enabled || !screen) return []
  const level = Math.max(1, autoZoom.level)
  const groups: Array<{ start: number; end: number; points: Focus[] }> = []
  for (const f of focuses(events, typing, screen)) {
    const g = groups.at(-1)
    const end = (f.up ?? f.t1) + HOLD
    if (g && f.t0 - LEAD - g.end < MERGE_GAP) {
      g.end = Math.max(g.end, end)
      g.points.push(f)
    } else groups.push({ start: f.t0 - LEAD, end, points: [f] })
  }
  const erratic = (g: (typeof groups)[number]) => {
    // A jump to a place outside the half view means a big pan; many of them read as shaky.
    let far = 0
    for (let i = 1; i < g.points.length; i++) {
      const dx = Math.abs(g.points[i].x - g.points[i - 1].x)
      const dy = Math.abs(g.points[i].y - g.points[i - 1].y)
      if (dx > screen.width / (2 * level) || dy > screen.height / (2 * level)) far++
    }
    return far >= 2 && far / (g.end - g.start) > FAR_JUMPS_PER_S
  }
  const D = sources.duration
  const shape = lookOf(look)
  const out = zoomTime(level, PACE.smooth) // an auto zoom ending closer than this to the recording's end holds to it, so the video never ends mid-move
  const kept = groups
    .map((g) => ({ ...g, done: g.end - HOLD, start: Math.max(0, g.start), end: g.end > D - out ? D : g.end }))
    .filter((g) => g.end - g.start >= MIN_AUTO && !erratic(g))
    .map((g) => {
      const end = Math.max(g.done + OUT, g.points[0].t0 + MIN_HOLD)
      return { ...g, end: end > D - out ? D : end }
    })
  const zooms = kept.map((g): Zoom => ({ id: uid(), start: g.start, end: g.end, level: autoLevel(level, shape.mode), target: { kind: 'cursor' }, auto: true, enabled: true, ...shape }))

  const rests = idleSegments(events, POINT.rest, D)
  const away = POINT.away * (screen.scale || 1)
  const lens = { ...shape, mode: 'loupe' as const }
  let j = 0 // rests that end before a zoom's last action matter to no later zoom either
  const lenses = kept.flatMap((g, i): Zoom[] => {
    const next = kept[i + 1]?.start ?? D
    const last = g.points.at(-1)!
    while (j < rests.length && rests[j].end <= g.done) j++
    // The cursor waits where the last action left it, then sets off: it points at the first place it
    // rests away from there.
    let off = g.done
    for (let k = j; k < rests.length && rests[k].start < next && off <= g.end + HOLD; k++) {
      const { start, end, at } = rests[k]
      if (start < g.done || !at || Math.hypot(at.x - last.x, at.y - last.y) < away) {
        off = Math.max(off, end)
        continue
      }
      const a = Math.max(g.end + zoomTime(level, PACE.focused), off) // once the camera is out
      const b = Math.min(start + POINT.hold, next)
      const shown = at.x >= 0 && at.y >= 0 && at.x <= screen.width && at.y <= screen.height
      if (start - off > HOLD || !shown || b - a < MIN_AUTO) return []
      return [{ id: uid(), start: a, end: b > D - lensOut(autoLevel(level, 'loupe')) ? D : b, level: autoLevel(level, 'loupe'), target: { kind: 'cursor' }, auto: true, enabled: true, ...lens, size: lens.size ?? POINT.size }]
    }
    return []
  })
  return [...zooms, ...lenses].sort((a, b) => a.start - b.start)
}

/** Set the auto zoom defaults (the inspector, a preset) and bring the auto zooms along: turned on or
 *  off (generated with `look` when turned on with none), and moved to a new level. Mutates `p`. */
export function setAutoZoom(p: Project, events: InputEvent[], autoZoom: Style['autoZoom'], look: ZoomLook = {}) {
  const was = p.style.autoZoom
  p.style.autoZoom = { ...autoZoom }
  const autos = p.zooms.filter((z) => z.auto)
  if (autoZoom.enabled && !was.enabled && !autos.length) p.zooms.push(...generateAutoZooms(events, p.sources, autoZoom, look))
  for (const z of autos) {
    if (autoZoom.enabled !== was.enabled) z.enabled = autoZoom.enabled
    if (autoZoom.level !== was.level) z.level = autoLevel(autoZoom.level, z.mode)
  }
}

/** The first open after recording or import: generate the auto zooms once (when auto zoom is on
 *  and the project has no zooms yet), then mark the project so zooms the user deletes never come
 *  back. Mutates `p`; returns whether it changed. */
export function autoZoomOnce(p: Project, events: InputEvent[]): boolean {
  if (p.autoZoomed) return false
  if (!p.zooms.length) p.zooms = generateAutoZooms(events, p.sources, p.style.autoZoom)
  p.autoZoomed = true
  return true
}

// ---- What an agent's zooms get wrong, with the edits that fix it ----

const MIN_HOLD = 1 // s: a zoom shows its framing this long once in, or it reads as a flinch
const GLIDE_HOLD = 0.5 // s: ...and this long once the camera glides to it from another zoom's framing
const ON_CUT = 0.02 // s: a zoom starting or ending this close to a cut moves with it

export interface ZoomProblem {
  id: string // the zoom to change
  message: string
  fix: Edit[] // output seconds, on the timeline as it is
}

const s2 = (t: number) => Math.round(t * 100) / 100
const floor2 = (t: number) => Math.floor(t * 100 + 1e-6) / 100
const ceil2 = (t: number) => Math.ceil(t * 100 - 1e-6) / 100

/** How the zooms of `p` would look wrong on timeline `m` with layout `layout`, each with the edits
 *  (src/shared/edits.ts) that fix it: a zoom that never plays, one that leaves before it shows
 *  anything, the camera moving while a cut jumps the picture, the video ending mid zoom-out, and a
 *  zoom the camera glides to from the one before but leaves before it holds still. The camera is
 *  checked per zoomed stretch (zooms less than BRIDGE apart glide from one to the next instead of
 *  zooming out and back in), a loupe per piece. At most one problem per stretch: its fix changes
 *  what the others would be. */
// ponytail: loupes that share a lens or glide to the next are checked one by one; group them like lenses() if that misleads.
// ponytail: only glides between single zooms on points are checked; overlapping zooms and ones following the cursor pass.
export function zoomProblems(p: Project, m: TimeMap, layout: ReturnType<typeof prepareLayout>): ZoomProblem[] {
  const out: ZoomProblem[] = []
  const D = m.duration
  const jumps = m.clips.flatMap((c, i) => (i && Math.abs(m.clips[i - 1].end - c.start) > 1e-6 ? [m.outStarts[i]] : []))
  const pace = PACE[p.style.screenAnimation] ?? PACE.focused
  const lead = pace * LEAD
  const on = p.zooms.filter((z) => z.enabled)
  for (const z of on) {
    if (!mapRange(m, z.start, z.end).length) out.push({ id: z.id, message: `Zoom ${z.id} never plays: its part of the recording is cut out.`, fix: [{ type: 'remove_zoom', id: z.id }] })
  }

  type Stretch = { a: number; b: number; first: Zoom; last: Zoom; lastA: number }
  const stretches = (ps: Span[], bridge: number) =>
    ps.reduce<Stretch[]>((acc, s) => {
      const r = acc.at(-1)
      if (r && bridge > 0 && s.a - r.b < bridge) {
        if (s.b > r.b) Object.assign(r, { b: s.b, last: s.zoom, lastA: s.a })
      } else acc.push({ a: s.a, b: s.b, first: s.zoom, last: s.zoom, lastA: s.a })
      return acc
    }, [])
  // ponytail: a zoom's move in and out is timed by its level alone; one that also pans from the rest framing moves a little longer.
  const camera = stretches(pieces(on.filter((z) => z.mode !== 'loupe'), m), BRIDGE).map((r) => ({ ...r, what: 'zooms', early: lead - LEAD, settle: zoomTime(r.first.level, pace) - (lead - LEAD), leave: zoomTime(r.last.level, pace) }))
  const glass = stretches(pieces(on.filter((z) => z.mode === 'loupe'), m), 0).map((r) => ({ ...r, what: 'loupe', early: 0, settle: lensIn(r.first.level), leave: lensOut(r.last.level) }))

  // The glides inside the camera's stretches, timed the way simulate times them.
  const framed = (zs: Zoom[], t: number) => {
    const at = screenAt(layout, t)
    if (!at) return null
    const bounds = inner(at.visible, at.screenRadius)
    const f = framing(zs, at.screen, at.viewport, baseScale(at.viewport, at.visible, frameOf(layout, at), bounds), null)
    return { c: clampCenter(f.mid!, bounds, f.s, at.viewport), s: f.s, vp: at.viewport }
  }
  const segs = segments(on.filter((z) => z.mode !== 'loupe'), m)
  const glides = segs.flatMap((g, i) => {
    const prev = segs[i - 1]
    const zs = [...(prev?.zooms ?? []), ...g.zooms]
    if (!prev || g.a - prev.b > 1e-9 || prev.zooms.length > 1 || g.zooms.length > 1 || cutsTo(prev.zooms, g.zooms) || zs.some((z) => z.target.kind !== 'point')) return []
    const from = framed(prev.zooms, g.a)
    const to = framed(g.zooms, g.a)
    if (!from || !to) return []
    const dur = pace * glideTime([from.c.x - to.c.x, from.c.y - to.c.y], from.s, to.s, to.vp)
    return [{ a: g.a, b: Math.min(g.b, D), dur, zoom: g.zooms[0], prev: prev.zooms[0], prevA: prev.a, last: segs[i + 1]?.a !== g.b }]
  })

  for (const r of [...camera, ...glass]) {
    const atStart = r.a < AT_START
    const early = atStart || r.first.instant ? 0 : r.early
    const inEnd = atStart || r.first.instant ? r.a : r.a + r.settle
    const toEnd = r.b > D - ON_CUT
    const leave = toEnd || r.last.instant ? 0 : r.leave
    const name = r.first === r.last ? `Zoom ${r.first.id}` : `Zooms ${r.first.id} to ${r.last.id}`
    const look = r.what === 'loupe' ? 'The loupe' : 'The camera'
    /** End the stretch at `end` (output seconds): set its last zoom's end, or drop that zoom when the end comes before it. */
    const endAt = (end: number): Edit[] => {
      if (r.last !== r.first && end < r.b && end < r.lastA + MIN_HOLD) return [{ type: 'remove_zoom', id: r.last.id }]
      const e: Edit = { type: 'set_zoom', id: r.last.id, end }
      if (r.last === r.first && end - inEnd < MIN_HOLD) e.start = Math.max(0, floor2(end - MIN_HOLD - r.settle))
      return [e]
    }
    const into = jumps.find((c) => c > r.a - early + ON_CUT && c < inEnd)
    const outOf = jumps.find((c) => c >= r.b - ON_CUT && c < r.b + leave)
    const hold = Math.min(r.b, D) - inEnd
    if (into !== undefined) {
      out.push({
        id: r.first.id,
        message: `${name}: ${look.toLowerCase()} moves in over ${s2(r.a - early)}-${s2(inEnd)} s, and the cut at ${s2(into)} s jumps the picture mid-move. Start it on the cut.`,
        fix: [{ type: 'set_zoom', id: r.first.id, start: ceil2(into + early) }],
      })
    } else if (outOf !== undefined) {
      out.push({
        id: r.last.id,
        message: `${name}: ${look.toLowerCase()} moves out over ${s2(r.b)}-${s2(r.b + leave)} s, and the cut at ${s2(outOf)} s jumps the picture mid-move. It has to be out before the cut.`,
        fix: endAt(floor2(outOf - r.leave)),
      })
    } else if (!toEnd && r.b + leave > D) {
      out.push({ id: r.last.id, message: `${name}: the video ends at ${s2(D)} s while ${look.toLowerCase()} is still moving out. End it at the video's end, so the video ends zoomed in.`, fix: endAt(s2(D)) })
    } else if (hold < MIN_HOLD - 1e-6) {
      const end = inEnd + MIN_HOLD
      out.push({
        id: r.last.id,
        message: `${name}: ${look.toLowerCase()} is in at ${s2(inEnd)} s and leaves at ${s2(Math.min(r.b, D))} s, so it holds only ${s2(Math.max(0, hold))} s and reads as a flinch. Hold it at least ${MIN_HOLD} s.`,
        fix: end + r.leave > D ? endAt(s2(D)) : endAt(ceil2(end)),
      })
    } else if (r.what === 'zooms') {
      const g = glides.find((g) => g.a > r.a && g.a < r.b && g.b - g.a - g.dur < GLIDE_HOLD - 1e-6)
      if (g) out.push({ id: g.zoom.id, message: `Zoom ${g.zoom.id}: the camera glides to it from zoom ${g.prev.id} over ${s2(g.a)}-${s2(g.a + g.dur)} s and moves on at ${s2(g.b)} s, so it holds only ${s2(Math.max(0, g.b - g.a - g.dur))} s. Hold it at least ${GLIDE_HOLD} s.`, fix: glideFix(g, r.leave) })
    }
  }
  return out

  /** Lengthen glide g's zoom: end it later when it is the stretch's last and nothing is in the way,
   *  else start it earlier, ending the zoom before it there or dropping that one when too little is left. */
  function glideFix(g: (typeof glides)[number], leave: number): Edit[] {
    const need = g.dur + GLIDE_HOLD
    const end = ceil2(g.a + need)
    const next = camera.find((r) => r.a > g.b)
    if (g.last && end + leave <= D && !jumps.some((c) => c >= g.b - ON_CUT && c < end + leave) && !(next && next.a - end < BRIDGE)) return [{ type: 'set_zoom', id: g.zoom.id, end }]
    const start = floor2(g.b - need)
    const prev = pieces([g.prev], m).at(-1)!
    if (start - g.prevA < MIN_HOLD) return [{ type: 'remove_zoom', id: g.prev.id }, { type: 'set_zoom', id: g.zoom.id, start }]
    return [...(prev.b > start ? [{ type: 'set_zoom' as const, id: g.prev.id, end: start }] : []), { type: 'set_zoom', id: g.zoom.id, start }]
  }
}
