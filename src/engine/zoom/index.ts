// Owner: auto-zoom. Camera direction: zoom items (source time) -> the zoom camera (View) and the
// glass loupe in OUTPUT time, plus generateAutoZooms (clicks and typing -> Zoom items).
//
// The camera is three critically damped springs (center x, center y, log scale) chasing a target.
// prepareZoom steps them exactly (closed form per step) at 120 Hz in output time; viewAt only reads
// those samples, so a frame is a pure function of (project, t) and matches one rendered in sequence.
// Output time means cuts and speed changes never shift or stretch an animation, and a cut that
// lands mid-animation blends into the next state.
//
// Screen rect assumption (layout.ts belongs to the compositor): layoutAt(...).screen.rect is where
// the recording sits, in unzoomed output px. It may change over time and may be larger than
// the output. Zoomed views stay inside it, so they never show background past the screen edge.
// On outputs narrower than that rect (9:16, or 1:1 from a landscape screen) the rest view scales up
// until the screen covers the output height and follows the cursor. If the layout already makes the
// screen cover the output, that base scale is 1 and the camera only pans.
// A zoom level is magnification of the whole screen (2 = the screen twice as big as when it is shown
// whole), so on those narrow outputs a zoom only adds what the base view does not already give:
// scale = max(base, level). Multiplying instead would put a 2x zoom on a 9:16 output at ~6.7x.
// All of this happens in the screen's viewport (layoutAt(...).screen.viewport): the whole output, or
// the screen's own panel in split layouts. The camera is stepped in viewport space (the center is the
// content point at the viewport's center) and viewAt turns that into the output-wide View.

import { uid, type Project, type Rect, type Sources, type Style, type Zoom } from '../../shared/project.ts'
import type { InputEvent } from '../../shared/events.ts'
import { mapRange, toOutput, type TimeMap } from '../../shared/timemap.ts'
import type { Loupe, SceneInput, View } from '../scene.ts'
import { screenAt, type prepareLayout, type ScreenPlace } from '../layout.ts'
import { cursorPoint, type prepareCursor } from '../motion/index.ts'
import { springDuration, springProgress, mix, type SpringConfig } from '../motion/spring.ts'
import { typingSegments, type Segment } from '../input/index.ts'

const DT = 1 / 120 // s between camera samples
const SPRING: SpringConfig = { stiffness: 100, damping: 20, mass: 1 } // critical: no overshoot, settles in ~0.9 s
const LAG = 0.2 // s a critical spring trails a moving target (2 / omega); following aims this far ahead
const BRIDGE = 1 // s: a shorter gap between zooms pans across instead of zooming out and back in
const DEAD_ZONE = 0.5 // the cursor roams this fraction of the half view before the camera pans
const FOCUS_ZONE = 0.4 // clicked elements and typing stay this close to the center, so they show whole
const EDGE_ZONE = 0.85 // the cursor never gets closer to the frame edge than this
const LEAD = 0.6 // s: zooms and framing start this long before a click or typing (spring is ~98% there)
const KEEP = 1 // s: a clicked element stays framed this long after the click
const HOLD = 2 // s: an auto zoom holds this long after its last click or keystroke
const MERGE_GAP = 2 // s: auto zooms closer than this merge; zooming out and back in that fast looks erratic
const MIN_AUTO = 1.2 // s: shorter auto zooms (clipped by the recording's ends) are dropped
const FAR_JUMPS_PER_S = 0.5 // an auto zoom panning a half view more often than this is erratic: skipped
const LOUPE_SPRING: SpringConfig = { stiffness: 300, damping: 2 * Math.sqrt(300), mass: 1 } // ~0.5 s fades
const LOUPE_FADE = springDuration(LOUPE_SPRING)
const LOUPE_RADIUS = 180 // units
const AT_START = 1e-3 // s: a zoom starting this close to output 0 starts zoomed in

type Pt = { x: number; y: number }
interface Span {
  a: number // output seconds
  b: number
  zoom: Zoom
}
/** Something to keep framed (a click or a typing stretch) at screen px (x, y). */
interface Focus {
  t0: number // source seconds the activity starts
  t1: number // and ends (= t0 for a click)
  x: number
  y: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** Clicks and typing stretches with where they happen. Typing happens where the last click before it
 *  focused a field; typing with no click before it has no known place and is left out. */
function focuses(events: InputEvent[], typing: Segment[], screen: NonNullable<Sources['screen']>): Focus[] {
  const clicks = events.filter(
    (e): e is Extract<InputEvent, { button: unknown }> => e.type === 'down' && e.x >= 0 && e.y >= 0 && e.x <= screen.width && e.y <= screen.height,
  )
  const out: Focus[] = clicks.map((c) => ({ t0: c.t, t1: c.t, x: c.x, y: c.y }))
  for (const g of typing) {
    const c = clicks.findLast((c) => c.t <= g.start)
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

/** Non-overlapping spans of the camera's zoom: the latest-starting zoom wins where zooms overlap, and
 *  gaps shorter than BRIDGE belong to the zoom before them, so the camera pans to the next one. */
// ponytail: O(pieces^2) sweep, fine for hundreds of zooms; use a heap of active pieces if thousands.
function spans(zooms: Zoom[], map: TimeMap): Span[] {
  const ps = pieces(zooms, map)
  const cuts = [...new Set(ps.flatMap((p) => [p.a, p.b]))].sort((x, y) => x - y)
  const out: Span[] = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]
    const b = cuts[i + 1]
    const win = ps.findLast((p) => p.a <= a && p.b >= b)
    if (!win) continue
    const last = out.at(-1)
    if (last && a - last.b < BRIDGE) {
      last.b = a
      if (last.zoom === win.zoom) {
        last.b = b
        continue
      }
    }
    out.push({ a, b, zoom: win.zoom })
  }
  return out
}

/** Scale at which the screen covers a viewport narrower than it (cut to `b`, the part clear of the
 *  rounded corners); 1 otherwise. The aspect test uses the screen itself: a large corner radius
 *  must not make a screen as wide as the output look wider. */
function baseScale(vp: Rect, r: Rect, b: Rect): number {
  return vp.w / vp.h < (r.w / r.h) * 0.98 ? Math.max(1, vp.h / b.h) : 1
}

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

/** Move center c the least so that p lies within (rx, ry) of it. */
const keep = (c: Pt, p: Pt, rx: number, ry: number): Pt => ({ x: clamp(c.x, p.x - rx, p.x + rx), y: clamp(c.y, p.y - ry, p.y + ry) })

/** Exact one-step update of the spring over dt: [h, g, h', g'] where displacement after dt is
 *  d * h + v * g and velocity d * h' + v * g' (linear in the initial state, closed form). */
function springStep(dt: number): [number, number, number, number] {
  const e = 1e-5
  const h = (t: number) => 1 - springProgress(t, SPRING)
  const g = (t: number) => springProgress(t, SPRING, 1) - springProgress(t, SPRING)
  return [h(dt), g(dt), (h(dt + e) - h(dt - e)) / (2 * e), (g(dt + e) - g(dt - e)) / (2 * e)]
}

export function prepareZoom(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>, cursor: ReturnType<typeof prepareCursor>, path = zoomPath(input, map, layout, cursor)) {
  const { width: W, height: H } = input
  const loupes = pieces(input.project.zooms.filter((z) => z.enabled && z.mode === 'loupe'), map)
  return { W, H, map, layout, cursor, loupes, ...path }
}

let last: { events: InputEvent[]; cursor: Float32Array; key: string; path: ZoomPath } | null = null

/** The camera samples: plain data, a function of the output size, the zooms, the clips' timing, the
 *  events, the cursor path, and where the layout puts the screen over time. Edits that leave all of
 *  that alone (background, cursor size, captions, masks, a camera corner) reuse the last samples. */
// ponytail: one cached result, recomputed whole when its inputs change (~90 ms per 2 hours, in the
// preview's worker); resume from the first changed second if zoom edits must land faster.
export function zoomPath(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>, cursor: ReturnType<typeof prepareCursor>) {
  const { project, events, width, height } = input
  const screens = Object.values(layout.targets).map((s) => [s.screen, s.screenRadius, s.viewport])
  const key = JSON.stringify([width, height, project.sources.screen ?? null, project.zooms, map.clips.map((c) => [c.start, c.end, c.speed]), layout.changes, screens])
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
  if (!screen) return { n, data: new Float32Array(0), jumps: new Map<number, number>() }

  // The screen layer at t; where the layout hides the screen, the last one seen.
  let layer: ScreenPlace = screenAt(layout, 0) ?? { screen: { x: 0, y: 0, w: W, h: H }, screenRadius: 0, viewport: { x: 0, y: 0, w: W, h: H } }
  const layerAt = (t: number) => (layer = screenAt(layout, t) ?? layer)
  const toPx = (r: Rect, x: number, y: number): Pt => ({ x: r.x + (x * r.w) / screen.width, y: r.y + (y * r.h) / screen.height })
  const cursorPt = (t: number, r: Rect): Pt | null => {
    const c = cursorPoint(cur, clamp(t, 0, map.duration))
    // Off the captured area (another display): nothing to follow.
    return c && c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h ? { x: c.x, y: c.y } : null
  }

  // Output-time windows during which a click or typing place must stay framed.
  const frames: Array<{ a: number; b: number; p: Pt }> = []
  for (const f of focusesOf(events, screen)) {
    const outs = f.t1 > f.t0 ? mapRange(map, f.t0, f.t1) : ((o) => (o === null ? [] : [[o, o]]))(toOutput(map, f.t0))
    for (const [a, b] of outs) frames.push({ a: a - LEAD, b: b + KEEP, p: toPx(screenAt(layout, a)?.screen ?? layer.screen, f.x, f.y) })
  }
  frames.sort((p, q) => p.a - q.a)

  const cam = spans(enabled.filter((z) => z.mode !== 'loupe'), map)
  const data = new Float32Array(3 * (n + 1))
  const jumps = new Map<number, number>()
  const [h, g, dh, dg] = springStep(DT)
  const pos = [0, 0, 0] // x, y, log scale
  const vel = [0, 0, 0]
  let aim: Pt | null = null // where the follow camera wants its center
  let prev: Span | null = null
  let si = 0
  let fi = 0
  for (let k = 0; k <= n; k++) {
    const t = k * DT
    const { screen: r, screenRadius: radius, viewport: vp } = layerAt(t)
    const bounds = inner(r, radius)
    const ts = clamp(t, AT_START, map.duration - 1e-6) // a zoom starting at 0 or running to the end covers that frame
    while (si < cam.length && cam[si].b <= ts) si++
    const span = si < cam.length && cam[si].a <= ts ? cam[si] : null
    const zoom = span?.zoom
    const s = Math.max(baseScale(vp, r, bounds), zoom ? zoom.level : 1)

    let c: Pt = { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 }
    if (zoom?.target.kind === 'point') c = aim = { x: r.x + zoom.target.x * r.w, y: r.y + zoom.target.y * r.h }
    else if (zoom || s > 1) {
      // Follow: the cursor roams a dead zone, focus places stay central, the cursor stays in frame.
      // Everything is read LAG ahead so the trailing spring lands on time.
      const tl = t + LAG
      const cp = cursorPt(tl, r)
      while (fi < frames.length && frames[fi].b < tl) fi++
      if (span && span !== prev) {
        // Entering a zoom: aim at its first click or typing place, else at the cursor.
        aim = frames.find((f) => f.b >= span.a && f.a <= span.a + LEAD + 0.4)?.p ?? cp ?? aim
      }
      const hw = vp.w / (2 * s)
      const hh = vp.h / (2 * s)
      c = aim ?? { x: r.x + r.w / 2, y: r.y + r.h / 2 }
      if (cp) c = keep(c, cp, DEAD_ZONE * hw, DEAD_ZONE * hh)
      for (let i = fi; i < frames.length && frames[i].a <= tl; i++) if (frames[i].b >= tl) c = keep(c, frames[i].p, FOCUS_ZONE * hw, FOCUS_ZONE * hh)
      if (cp) c = keep(c, cp, EDGE_ZONE * hw, EDGE_ZONE * hh)
      c = aim = clampCenter(c, bounds, s, vp)
    }
    c = clampCenter(c, bounds, s, vp)
    const target = [c.x, c.y, Math.log(s)]

    const leaving = k > 0 && span !== prev
    if (k === 0 || (leaving && (zoom ? zoom.instant : prev!.zoom.instant))) {
      // First frame, or an instant zoom cutting in or out: jump, no animation.
      if (k > 0) jumps.set(k - 1, zoom ? span!.a : prev!.b)
      for (let i = 0; i < 3; i++) (pos[i] = target[i]), (vel[i] = 0)
    }
    for (let i = 0; i < 3; i++) {
      data[3 * k + i] = pos[i]
      const d = pos[i] - target[i]
      pos[i] = target[i] + d * h + vel[i] * g
      vel[i] = d * dh + vel[i] * dg
    }
    prev = span
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
  const scale = Math.exp(at(2))
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
  return clamp(Math.log2(v.scale / baseScale(s.viewport, s.screen, inner(s.screen, s.screenRadius))), 0, 1)
}

export function loupeAt(z: ReturnType<typeof prepareZoom>, t: number): Loupe | null {
  const piece = z.loupes.findLast((p) => p.a <= t && t < p.b + (p.zoom.instant ? 0 : LOUPE_FADE))
  const r = piece && screenAt(z.layout, t)?.screen
  if (!piece || !r) return null
  const { a, b, zoom } = piece
  const fadeIn = zoom.instant || a < AT_START ? 1 : springProgress(t - a, LOUPE_SPRING)
  const fadeOut = t < b ? 0 : springProgress(t - b, LOUPE_SPRING)
  const p = fadeIn * (1 - fadeOut)
  const radius = (LOUPE_RADIUS * Math.min(z.W, z.H)) / 1080
  let c: Pt = { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  if (zoom.target.kind === 'point') c = { x: r.x + zoom.target.x * r.w, y: r.y + zoom.target.y * r.h }
  else {
    const cur = cursorPoint(z.cursor, t)
    if (cur) c = cur
  }
  // Keep the lens over the screen, so it never magnifies background.
  const inside = (v: number, lo: number, size: number) => (2 * radius <= size ? clamp(v, lo + radius, lo + size - radius) : lo + size / 2)
  return { x: inside(c.x, r.x, r.w), y: inside(c.y, r.y, r.h), radius, scale: mix(1, Math.max(1, zoom.level), p), opacity: p }
}

/** Auto zooms (source time) from clicks and typing: merge activity close in time, start LEAD before
 *  it, hold HOLD after it, and skip stretches that would pan erratically. Each zoom follows the
 *  cursor; viewAt frames its clicks and typing. `typing` defaults to the input domain's detector. */
export function generateAutoZooms(events: InputEvent[], sources: Sources, autoZoom: Style['autoZoom'], typing: Segment[] = typingSegments(events)): Zoom[] {
  const screen = sources.screen
  if (!autoZoom.enabled || !screen) return []
  const level = Math.max(1, autoZoom.level)
  const groups: Array<{ start: number; end: number; points: Pt[] }> = []
  for (const f of focuses(events, typing, screen)) {
    const g = groups.at(-1)
    if (g && f.t0 - LEAD - g.end < MERGE_GAP) {
      g.end = Math.max(g.end, f.t1 + HOLD)
      g.points.push(f)
    } else groups.push({ start: f.t0 - LEAD, end: f.t1 + HOLD, points: [f] })
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
  return groups
    .map((g) => ({ ...g, start: Math.max(0, g.start), end: Math.min(sources.duration, g.end) }))
    .filter((g) => g.end - g.start >= MIN_AUTO && !erratic(g))
    .map((g): Zoom => ({ id: uid(), start: g.start, end: g.end, level, target: { kind: 'cursor' }, auto: true, enabled: true }))
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
