import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createProject, type CameraPosition, type Clip, type Project, type Zoom } from '../../shared/project.ts'
import { parseEvents, type InputEvent } from '../../shared/events.ts'
import { prepare, sceneAt, type View } from '../scene.ts'
import { layoutAt } from '../layout.ts'
import { cursorPoint as cursorAt } from '../motion/index.ts'
import { autoZoomOnce, generateAutoZooms, lookOf, loupesAt, setAutoZoom, viewAt } from './index.ts'

const SCREEN = { file: 'sources/screen.mp4', width: 2880, height: 1800, fps: 30, scale: 2 }
const CAMERA = { file: 'sources/camera.mp4', width: 1280, height: 720, fps: 30, scale: 1 }
const zoom = (z: Partial<Zoom>): Zoom => ({ id: Math.random().toString(36).slice(2), start: 0, end: 1, level: 2, target: { kind: 'cursor' }, enabled: true, ...z })
const point = (x: number, y: number) => ({ kind: 'point' as const, x, y })

/** Cursor moves at 120 Hz through [t, x, y] waypoints (screen px), linear in between. */
function moves(path: Array<[number, number, number]>): InputEvent[] {
  const out: InputEvent[] = []
  for (let i = 0; i + 1 < path.length; i++) {
    const [t0, x0, y0] = path[i]
    const [t1, x1, y1] = path[i + 1]
    for (let t = t0; t < t1; t += 1 / 120) {
      const p = (t - t0) / (t1 - t0)
      out.push({ t, type: 'move', x: x0 + (x1 - x0) * p, y: y0 + (y1 - y0) * p })
    }
  }
  return out
}

function setup(zooms: Zoom[], events: InputEvent[] = [], o: { width?: number; height?: number; duration?: number; clips?: Clip[]; project?: Project } = {}) {
  const project = o.project ?? createProject('t', { duration: o.duration ?? 20, screen: SCREEN, events: 'sources/events.jsonl' })
  project.zooms = zooms
  if (o.clips) project.clips = o.clips
  const p = prepare({ project, events, transcript: null, width: o.width ?? 1920, height: o.height ?? 1200 })
  const view = (t: number) => viewAt(p.zoom, t)
  const screen = (t: number) => layoutAt(p.layout, t).screen!.rect
  /** No background shows: every corner of the view lies inside the shown screen's rounded rect. */
  const covered = (t: number, W = 1920, H = 1200) => {
    const { visible: r, radius } = layoutAt(p.layout, t).screen!
    const v = visible(view(t), W, H)
    return [[v.x0, v.y0], [v.x1, v.y0], [v.x0, v.y1], [v.x1, v.y1]].every(([x, y]) => {
      const cx = Math.min(Math.max(x, r.x + radius), r.x + r.w - radius)
      const cy = Math.min(Math.max(y, r.y + radius), r.y + r.h - radius)
      return x >= r.x - 0.5 && x <= r.x + r.w + 0.5 && y >= r.y - 0.5 && y <= r.y + r.h + 0.5 && Math.hypot(x - cx, y - cy) <= radius + 0.5
    })
  }
  return { p, view, screen, covered }
}

/** The part of the unzoomed output a view shows. */
function visible(v: View, W = 1920, H = 1200) {
  const hw = W / (2 * v.scale)
  const hh = H / (2 * v.scale)
  return { x0: v.center.x - hw, x1: v.center.x + hw, y0: v.center.y - hh, y1: v.center.y + hh, hw, hh }
}
const frames = (from: number, to: number, fps = 30) => Array.from({ length: Math.round((to - from) * fps) + 1 }, (_, i) => from + i / fps)
/** The one lens showing at t, or null. */
function loupeAt(z: Parameters<typeof loupesAt>[0], t: number) {
  const ls = loupesAt(z, t)
  assert.ok(ls.length <= 1, `one lens at t=${t}`)
  return ls[0] ?? null
}
const near = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} ±${eps} ${msg}`)

test('a zoom at output 0 starts zoomed in; a later one animates in and out', () => {
  let { view } = setup([zoom({ start: 0, end: 3, target: point(0.5, 0.5) })])
  near(view(0).scale, 2, 1e-4)
  ;({ view } = setup([zoom({ start: 2, end: 6, target: point(0.5, 0.5) })]))
  near(view(0).scale, 1, 1e-6)
  near(view(2).scale, 1, 1e-3)
  assert.ok(view(2.3).scale > 1.2 && view(2.3).scale < 1.95)
  near(view(4).scale, 2, 0.01)
  assert.ok(view(6.3).scale > 1.05 && view(6.3).scale < 1.95)
  near(view(8).scale, 1, 0.01)
})

test('pure: any frame alone equals the same frame rendered in sequence', () => {
  const events = [...moves([[0, 400, 400], [4, 2400, 1400], [8, 600, 1500], [12, 2700, 200], [20, 1400, 900]]), { t: 5, type: 'down', x: 1800, y: 1450, button: 'left' } as InputEvent]
  const zooms = [
    zoom({ start: 0, end: 3 }),
    zoom({ start: 4, end: 9, level: 2.5 }),
    zoom({ start: 5, end: 7, level: 3.5, target: point(0.6, 0.7) }),
    zoom({ start: 9.4, end: 11, target: point(0.9, 0.1) }),
    zoom({ start: 13, end: 15, instant: true }),
    zoom({ start: 16, end: 18, mode: 'loupe' }),
    zoom({ start: 18, end: 19, mode: 'loupe', level: 3, size: 150, target: point(0.2, 0.8) }),
    zoom({ start: 19, end: 19.6, mode: 'loupe', instant: true }),
    zoom({ start: 17, end: 18.5, mode: 'loupe', size: 120, target: point(0.7, 0.2) }),
  ]
  const ts = frames(0, 20, 60)
  const a = setup(zooms, events)
  const seq = ts.map((t) => [a.view(t), loupesAt(a.p.zoom, t)])
  const b = setup(zooms, events) // fresh preparation, frames in random order
  const order = ts.map((_, i) => i).sort(() => Math.random() - 0.5)
  for (const i of order) assert.deepEqual([b.view(ts[i]), loupesAt(b.p.zoom, ts[i])], seq[i], `t=${ts[i]}`)
})

test('dead zone: small moves do not pan, big moves do, and the cursor stays in frame', () => {
  const jitter: Array<[number, number, number]> = Array.from({ length: 40 }, (_, i) => [i * 0.125, 1440 + (i % 2 ? 30 : -30), 900 + (i % 3) * 20])
  // ...then a slow drift to a corner, and a fast flick (~5000 px/s) to the opposite one.
  const events = moves([...jitter, [5, 1440, 900], [6.5, 2750, 1700], [7, 2750, 1700], [7.5, 300, 300], [20, 300, 300]])
  const { p, view } = setup([zoom({ start: 1, end: 10 })], events)
  const c0 = view(2).center
  for (const t of frames(2, 4.5)) {
    near(view(t).center.x, c0.x, 0.5, `t=${t}`)
    near(view(t).center.y, c0.y, 0.5, `t=${t}`)
  }
  assert.ok(view(7).center.x > c0.x + 200 && view(7).center.y > c0.y + 100, 'pans toward the far corner')
  for (const t of frames(1, 10, 120)) {
    const v = visible(view(t))
    const c = cursorAt(p.cursor, t)!
    assert.ok(c.x >= v.x0 && c.x <= v.x1 && c.y >= v.y0 && c.y <= v.y1, `cursor out of frame at t=${t}`)
  }
})

test('clicked elements stay whole, but the cursor always stays in frame', () => {
  const click = (t: number, x: number, y: number): InputEvent => ({ t, type: 'down', x, y, button: 'left' })
  const path: Array<[number, number, number]> = [[0, 1440, 900], [3, 1440, 900], [4, 2100, 1250], [9.5, 2100, 1250], [9.9, 1440, 900], [10.1, 1440, 900], [10.4, 2700, 1700], [20, 2700, 1700]]
  const events = [...moves(path), click(1.6, 1440, 900), click(4.2, 2100, 1250), click(10, 1440, 900)].sort((a, b) => a.t - b.t)
  const { p, view } = setup([zoom({ start: 1, end: 13 })], events)
  for (const t of [1.6, 4.2, 10]) {
    const v = visible(view(t))
    const c = cursorAt(p.cursor, t)!
    near(view(t).scale, 2, 0.05)
    assert.ok(Math.abs(c.x - view(t).center.x) <= 0.42 * v.hw && Math.abs(c.y - view(t).center.y) <= 0.42 * v.hh, `click at ${t} is off center`)
  }
  // Right after the last click the cursor flicks away: framing the click must not lose the cursor.
  for (const t of frames(1, 13, 120)) {
    const v = visible(view(t))
    const c = cursorAt(p.cursor, t)!
    assert.ok(c.x >= v.x0 && c.x <= v.x1 && c.y >= v.y0 && c.y <= v.y1, `cursor out of frame at t=${t}`)
  }
})

test('clamped: a zoomed view never shows background past the screen edge', () => {
  for (const level of [2, 3.5]) {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.02, 0.5], [0.5, 0.99]]) {
      const { view, covered } = setup([zoom({ start: 1, end: 5, level, target: point(x, y) })])
      near(view(4).scale, level, 0.02)
      assert.ok(covered(4), `level ${level} at ${x},${y}`)
    }
  }
  // Cropped: aimed anywhere on the recording, the view stays inside the crop.
  const project = createProject('t', { duration: 20, screen: SCREEN })
  project.crop = { x: 0.5, y: 0.25, w: 0.4, h: 0.5 }
  for (const [x, y] of [[0, 0], [1, 1], [0.1, 0.9], [0.7, 0.5]]) {
    const { view, covered } = setup([zoom({ start: 1, end: 5, level: 2, target: point(x, y) })], [], { project })
    near(view(4).scale, 2, 0.02)
    assert.ok(covered(4), `cropped, at ${x},${y}`)
  }
})

test('adjacent zooms pan across instead of zooming out and back in', () => {
  const A = zoom({ start: 1, end: 4, target: point(0.2, 0.2) })
  for (const bStart of [4, 4.5]) {
    const { view } = setup([A, zoom({ start: bStart, end: 9, target: point(0.8, 0.8) })])
    const before = view(3.9).center
    for (const t of frames(3, 8)) assert.ok(view(t).scale > 1.98, `zoomed out at t=${t}, gap ${bStart - 4}`)
    assert.ok(view(8.5).center.x > before.x + 400 && view(8.5).center.y > before.y + 250, 'pans to the second target')
  }
  const { view } = setup([A, zoom({ start: 7, end: 10, target: point(0.8, 0.8) })])
  assert.ok(view(6.9).scale < 1.05, 'a long gap zooms out')
})

test('instant zooms cut in and out on the exact frame', () => {
  const { view } = setup([zoom({ start: 2.0037, end: 5.0041, instant: true, target: point(0.3, 0.3) })])
  near(view(2.0036).scale, 1, 1e-6)
  near(view(2.0037).scale, 2, 1e-6)
  near(view(5.004).scale, 2, 1e-6)
  near(view(5.0041).scale, 1, 1e-6)
})

test('zooms live in source time and follow cuts and speed changes', () => {
  const clips: Clip[] = [
    { id: 'a', start: 0, end: 5, speed: 1, volume: 1 },
    { id: 'b', start: 8, end: 20, speed: 2, volume: 1 },
  ]
  // source 10..14 -> output 5 + (10-8)/2 = 6 .. 8
  const { view } = setup([zoom({ start: 10, end: 14, instant: true, target: point(0.5, 0.5) })], [], { clips })
  near(view(5.99).scale, 1, 1e-6)
  near(view(6).scale, 2, 1e-6)
  near(view(7.99).scale, 2, 1e-6)
  near(view(8.01).scale, 1, 1e-6)
})

test('vertical output: the screen covers the frame and the camera follows the cursor', () => {
  const W = 1080
  const H = 1920
  const events = moves([[0, 100, 900], [4, 2780, 900], [6, 1400, 1700], [10, 1400, 1700]])
  const { p, view, screen, covered } = setup([zoom({ start: 4.5, end: 5.5 }), zoom({ start: 7, end: 9, level: 5 })], events, { width: W, height: H, duration: 10 })
  const base = view(3).scale
  assert.ok(base >= (H / screen(0).h) * (1 - 1e-6) && base < (H / screen(0).h) * 1.05, `base ${base}`) // samples are float32
  near(view(5.3).scale, base, 1e-3) // level 2 is less than the base view already magnifies
  near(view(8.5).scale, 5, 0.05)
  for (const t of frames(0, 10)) {
    const v = visible(view(t), W, H)
    const c = cursorAt(p.cursor, t)!
    assert.ok(covered(t, W, H), `background shows at t=${t}`)
    assert.ok(c.x >= v.x0 && c.x <= v.x1 && c.y >= v.y0 && c.y <= v.y1, `cursor out of frame at t=${t}`)
  }
  assert.ok(view(4.5).center.x > view(0).center.x + 500, 'follows the cursor across')
})

test('a device with big rounded corners on a screen as wide as the output does not zoom in', () => {
  const project = createProject('t', { duration: 10, screen: SCREEN })
  project.style.device = 'iphone' // a large display radius: the part clear of the corners is wider than the screen
  const { view } = setup([], [], { project })
  near(view(3).scale, 1, 1e-9)
})

test('split layouts zoom inside the screen panel and leave the stack in place', () => {
  const W = 1080
  const H = 1920
  const project = createProject('t', { duration: 10, screen: SCREEN, camera: { file: 'c.mp4', width: 1280, height: 720, fps: 30, scale: 1 } })
  project.layouts = [{ id: 'l', start: 0, end: 10, kind: 'split' }]
  const { p, view } = setup([zoom({ start: 4, end: 8, target: point(0.8, 0.2) })], [], { width: W, height: H, duration: 10, project })
  const panel = layoutAt(p.layout, 1).screen!.viewport
  assert.ok(panel.h < H / 2, 'stacked: the panel is the screen frame, not the whole output')
  near(view(1).scale, 1, 1e-9)
  near(view(1).center.x, W / 2, 1e-6)
  near(view(1).center.y, H / 2, 1e-6) // unzoomed: the screen stays in its panel
  const v = view(7)
  near(v.scale, 2, 0.02)
  // The panel shows screen content only, around the zoom target.
  const r = layoutAt(p.layout, 7).screen!.rect
  const un = (x: number, y: number) => ({ x: (x - W / 2) / v.scale + v.center.x, y: (y - H / 2) / v.scale + v.center.y })
  for (const [x, y] of [[panel.x, panel.y], [panel.x + panel.w, panel.y + panel.h]]) {
    const u = un(x, y)
    assert.ok(u.x >= r.x - 0.5 && u.x <= r.x + r.w + 0.5 && u.y >= r.y - 0.5 && u.y <= r.y + r.h + 0.5, `panel corner ${x},${y} shows ${u.x},${u.y}`)
  }
  const c = un(panel.x + panel.w / 2, panel.y + panel.h / 2)
  assert.ok(c.x > r.x + r.w / 2 && c.y < r.y + r.h / 2, 'aimed at the target')
})

test('an output as wide as the screen never zooms at rest, however round and padded the screen', () => {
  const project = createProject('t', { duration: 10, screen: SCREEN, events: 'sources/events.jsonl' })
  for (const [padding, radius, inset] of [[80, 80, 0], [300, 80, 0], [300, 80, 120], [0, 80, 0]]) {
    Object.assign(project.style, { padding, radius, inset })
    const { view } = setup([], moves([[0, 100, 100], [10, 2700, 1700]]), { project, duration: 10 })
    for (const t of [0, 5, 10]) near(view(t).scale, 1, 1e-6, `padding ${padding} radius ${radius} inset ${inset}`)
  }
})

test('loupe fades in and out, magnifies, and follows its target', () => {
  const events = moves([[0, 1000, 800], [10, 1800, 800]])
  const { p, view } = setup([zoom({ start: 2, end: 5, mode: 'loupe', level: 2.5 })], events, { duration: 10 })
  assert.equal(loupeAt(p.zoom, 1.9), null)
  const fadeIn = loupeAt(p.zoom, 2.05)!
  assert.ok(fadeIn.opacity > 0 && fadeIn.opacity < 0.6)
  const on = loupeAt(p.zoom, 3.5)!
  near(on.opacity, 1, 0.01)
  near(on.scale, 2.5, 0.02)
  const lag = cursorAt(p.cursor, 3.5)!.x - on.x
  assert.ok(lag > 0 && lag < 0.05 * on.radius, `trails the cursor on a spring, close behind: ${lag}`)
  assert.ok(on.stretch.x > 0 && Math.abs(on.stretch.y) < 1e-6, 'liquid: stretches along its motion')
  const rigid = setup([zoom({ start: 2, end: 5, mode: 'loupe', level: 2.5, rigid: true })], events, { duration: 10 })
  assert.deepEqual(loupeAt(rigid.p.zoom, 3.5)!.stretch, { x: 0, y: 0 })
  // Size is the radius in units (px at 1080p; this output is 1200 high), clamped to its range.
  const sized = (size?: number) => loupeAt(setup([zoom({ start: 2, end: 5, mode: 'loupe', size })], events, { duration: 10 }).p.zoom, 3.5)!.radius
  near(sized(), (260 * 1200) / 1080, 1e-3)
  near(sized(100), (100 * 1200) / 1080, 1e-3)
  near(sized(5000), (400 * 1200) / 1080, 1e-3)
  near(sized(NaN), (260 * 1200) / 1080, 1e-3)
  const fadeOut = loupeAt(p.zoom, 5.1)!
  assert.ok(fadeOut.opacity > 0 && fadeOut.opacity < 1)
  assert.equal(loupeAt(p.zoom, 6), null)
  near(view(3.5).scale, 1, 1e-9) // a loupe never moves the camera
})

test('a loupe into the next keeps the glass up: it glides there and eases into its level, size, and shape', () => {
  const events = moves([[0, 1000, 800], [12, 1800, 800]])
  const next = zoom({ start: 5, end: 8, mode: 'loupe', level: 3, size: 160, rigid: true, target: point(0.7, 0.3) })
  // Back to back, and a gap shorter than BRIDGE.
  for (const end of [5, 4.5]) {
    const { p, screen } = setup([zoom({ start: 2, end, mode: 'loupe' }), next], events, { duration: 12 })
    let was = loupeAt(p.zoom, 4)!
    for (const t of frames(4, 7, 60).slice(1)) {
      const l = loupeAt(p.zoom, t)!
      near(l.opacity, 1, 1e-9, `no fade at t=${t}`)
      assert.ok(l.scale >= 2 - 1e-3, `never drops to unmagnified: ${l.scale} at t=${t}`)
      assert.ok(Math.hypot(l.x - was.x, l.y - was.y) < 60 && Math.abs(l.radius - was.radius) < 30, `no jump at t=${t}`)
      was = l
    }
    const on = loupeAt(p.zoom, 7.5)!
    near(on.scale, 3, 0.01)
    near(on.radius, (160 * 1200) / 1080, 0.5)
    near(on.x, screen(7.5).x + 0.7 * screen(7.5).w, 1)
    near(Math.hypot(on.stretch.x, on.stretch.y), 0, 1e-6, 'eased into rigid')
  }
  // A longer gap fades out and back in; an instant loupe cuts in.
  const gap = setup([zoom({ start: 2, end: 3.5, mode: 'loupe' }), next], events, { duration: 12 })
  assert.equal(loupeAt(gap.p.zoom, 4.5), null)
  assert.ok(loupeAt(gap.p.zoom, 5.05)!.opacity < 0.6)
  const cut = setup([zoom({ start: 2, end: 5, mode: 'loupe' }), { ...next, instant: true }], events, { duration: 12 })
  near(loupeAt(cut.p.zoom, 4.999)!.scale, 2, 1e-3)
  near(loupeAt(cut.p.zoom, 5.001)!.scale, 3, 1e-3)
})

test('overlapping loupes: other targets get a lens each, one target shares one', () => {
  const events = moves([[0, 1000, 800], [12, 1800, 800]])
  // A point loupe over part of a cursor loupe: two lenses at once, each its own; the first stays up.
  const two = setup([zoom({ start: 2, end: 8, mode: 'loupe' }), zoom({ start: 4, end: 6, mode: 'loupe', level: 3, size: 160, target: point(0.7, 0.3) })], events, { duration: 12 })
  const [a, b] = loupesAt(two.p.zoom, 5)
  near(a.scale, 2, 0.01)
  near(a.x, cursorAt(two.p.cursor, 5)!.x, 0.05 * a.radius)
  near(b.scale, 3, 0.01)
  near(b.radius, (160 * 1200) / 1080, 0.5)
  near(b.x, two.screen(5).x + 0.7 * two.screen(5).w, 1)
  for (const t of frames(3, 7.5)) near(loupesAt(two.p.zoom, t)[0].opacity, 1, 1e-3, `t=${t}`)
  near(loupeAt(two.p.zoom, 7.5)!.scale, 2, 0.01)
  // Two loupes on the cursor: one lens at the deeper level and larger size, easing back after.
  const one = setup([zoom({ start: 2, end: 8, mode: 'loupe', size: 160 }), zoom({ start: 4, end: 6, mode: 'loupe', level: 3, size: 260 })], events, { duration: 12 })
  for (const t of frames(2, 9)) loupeAt(one.p.zoom, t)
  near(loupeAt(one.p.zoom, 5.5)!.scale, 3, 0.01)
  near(loupeAt(one.p.zoom, 5.5)!.radius, (260 * 1200) / 1080, 0.5)
  near(loupeAt(one.p.zoom, 7.5)!.scale, 2, 0.01)
  near(loupeAt(one.p.zoom, 7.5)!.radius, (160 * 1200) / 1080, 0.5)
})

test('overlapping zooms combine: the deepest level, every target framed, never past the shallowest', () => {
  const still = moves([[0, 1440, 900], [20, 1440, 900]])
  // A deeper point zoom inside a wider cursor zoom punches in, then back out.
  const nested = setup([zoom({ start: 2, end: 12, level: 1.5 }), zoom({ start: 5, end: 8, level: 3, target: point(0.55, 0.55) })], still)
  near(nested.view(4.5).scale, 1.5, 0.01)
  near(nested.view(7.5).scale, 3, 0.02)
  near(nested.view(11).scale, 1.5, 0.01)
  const shows = (v: View, x: number, y: number) => Math.abs(x - v.center.x) <= visible(v).hw && Math.abs(y - v.center.y) <= visible(v).hh
  // Two points: the camera backs out just enough to show both, and no further than the shallowest
  // level; points further apart than that leaves stay centered between.
  const points = (x0: number, x1: number) => setup([zoom({ start: 2, end: 10, level: 2, target: point(x0, 0.5) }), zoom({ start: 4, end: 10, level: 3, target: point(x1, 0.5) })], still)
  const close = points(0.42, 0.58)
  const r = close.screen(9)
  assert.ok(close.view(9).scale > 2.05 && close.view(9).scale < 2.9, `${close.view(9).scale}`)
  for (const x of [0.42, 0.58]) assert.ok(shows(close.view(9), r.x + x * r.w, r.y + 0.5 * r.h), `${x} shows`)
  const far = points(0.2, 0.8)
  near(far.view(9).scale, 2, 0.01)
  near(far.view(9).center.x, r.x + 0.5 * r.w, 1)
  // A point zoom over a cursor zoom: the point and the cursor both stay in frame as the cursor moves off.
  const { p, view, screen } = setup([zoom({ start: 2, end: 14, level: 2 }), zoom({ start: 4, end: 14, level: 3, target: point(0.35, 0.35) })], moves([[0, 1000, 600], [6, 1000, 600], [12, 1900, 1200], [20, 1900, 1200]]))
  for (const t of frames(6, 14)) {
    const v = view(t)
    const r = screen(t)
    const c = cursorAt(p.cursor, t)!
    assert.ok(shows(v, r.x + 0.35 * r.w, r.y + 0.35 * r.h) && shows(v, c.x, c.y) && v.scale >= 2 - 0.01, `t=${t}`)
  }
  near(view(5.5).scale, 3, 0.05) // the cursor next to the point: the deepest level
})

test('loupe centers on the cursor at the screen edge, overhanging the background', () => {
  const { p, screen } = setup([zoom({ start: 2, end: 5, mode: 'loupe' })], moves([[0, 2870, 1790], [10, 2870, 1790]]), { duration: 10 })
  const on = loupeAt(p.zoom, 4)!
  const c = cursorAt(p.cursor, 4)!
  near(on.x, c.x, 1, 'x')
  near(on.y, c.y, 1, 'y')
  assert.ok(on.x + on.radius > screen(4).x + screen(4).w, 'the lens overhangs the screen')
})

test('generateAutoZooms: merges, leads, holds, covers typing, skips the erratic', () => {
  const click = (t: number, x = 1400, y = 900): InputEvent => ({ t, type: 'down', x, y, button: 'left' })
  const sources = createProject('t', { duration: 45, screen: SCREEN }).sources
  const on = { enabled: true, level: 2 }
  assert.deepEqual(generateAutoZooms([click(3)], sources, { enabled: false, level: 2 }, {}, []), [])

  const zs = generateAutoZooms(
    [click(0.2), click(3), click(4, 1500, 1000), click(10), click(19.5, 600, 400), click(30, 100, 100), click(30.7, 2800, 1700), click(31.4, 100, 1700), click(32.1, 2800, 100), click(44.9)],
    sources,
    on,
    {},
    [{ start: 20, end: 23 }, { start: 37, end: 38 }], // typing happens where the last click before it was
  )
  const spans = zs.map((z) => [+z.start.toFixed(2), +z.end.toFixed(2)])
  // 0.2, 3, 4 merge; 10 alone; the click at 19.5 joins its typing; the burst across the screen is
  // erratic; typing at 37 zooms on the click at 32.1; the last click is cut short by the end.
  assert.deepEqual(spans, [[0, 6], [9.4, 12], [18.9, 25], [36.4, 40]])
  for (const z of zs) assert.ok(z.auto && z.enabled && z.level === 2 && z.target.kind === 'cursor' && z.id)
  assert.deepEqual(generateAutoZooms([], sources, on, {}, [{ start: 5, end: 8 }]), [], 'typing with no known place is left out')
})

test('autoZoomOnce: auto zooms on the first open only, never again after the user deletes them', () => {
  const events: InputEvent[] = [{ t: 3, type: 'down', x: 1400, y: 900, button: 'left' }]
  const p = createProject('t', { duration: 20, screen: SCREEN, events: 'sources/events.jsonl' })
  assert.equal(autoZoomOnce(p, events), true)
  assert.ok(p.autoZoomed && p.zooms.length === 1 && p.zooms[0].auto)
  p.zooms = []
  assert.equal(autoZoomOnce(p, events), false)
  assert.deepEqual(p.zooms, [], 'deleted zooms stay deleted')
  const off = createProject('t', { duration: 20, screen: SCREEN })
  off.style.autoZoom.enabled = false
  assert.equal(autoZoomOnce(off, events), true)
  assert.ok(off.autoZoomed && off.zooms.length === 0, 'auto zoom off: marked, nothing generated')
})

test('setAutoZoom: auto zooms follow the toggle and level, a manual zoom and a hand-set level stay', () => {
  const events: InputEvent[] = [{ t: 3, type: 'down', x: 1400, y: 900, button: 'left' }]
  const p = createProject('t', { duration: 20, screen: SCREEN })
  p.style.autoZoom.enabled = false
  const manual = { id: 'm', start: 10, end: 12, level: 1.5, target: { kind: 'cursor' as const }, enabled: true }
  p.zooms = [manual]
  setAutoZoom(p, events, { enabled: true, level: 2 })
  const auto = p.zooms.find((z) => z.auto)!
  assert.ok(p.style.autoZoom.enabled && auto.enabled && p.zooms.length === 2, 'turned on with none: generated')
  auto.level = 2.5 // set by hand on the timeline
  setAutoZoom(p, events, { enabled: false, level: 2 }) // a preset with auto zoom off
  assert.ok(!p.style.autoZoom.enabled && !auto.enabled && manual.enabled && auto.level === 2.5, 'off: only auto zooms, level untouched')
  setAutoZoom(p, events, { enabled: true, level: 3 })
  assert.ok(auto.enabled && manual.level === 1.5 && p.zooms.length === 2, 'back on: no duplicates')
  assert.equal(auto.level, 3, 'back on: the new level')
})

test('zoom look: new zooms take the loupe last picked; a full zoom adds nothing', () => {
  assert.deepEqual(lookOf({ mode: 'loupe', size: 180, rigid: false }), { mode: 'loupe', size: 180 })
  assert.deepEqual(lookOf({ mode: 'zoom', size: 180, rigid: true }), {}, 'loupe size and shape mean nothing to a full zoom')
  assert.deepEqual(lookOf('garbage' as never), {}, 'a hand-edited settings file')
  const events: InputEvent[] = [{ t: 3, type: 'down', x: 1400, y: 900, button: 'left' }]
  const sources = createProject('t', { duration: 20, screen: SCREEN }).sources
  const [z] = generateAutoZooms(events, sources, { enabled: true, level: 2 }, { mode: 'loupe', size: 180, rigid: true })
  assert.ok(z.auto && z.mode === 'loupe' && z.size === 180 && z.rigid && z.level === 2)
})

const FIXTURE = join(import.meta.dirname, '../../../.context/fixtures/Demo #1 ✨ café.grip')
test('fixture: auto zooms cover every click, keep the cursor in frame and clicked elements whole', { skip: !existsSync(FIXTURE) && 'no fixture: npx electron scripts/fixture/make.ts' }, (t) => {
  const project: Project = JSON.parse(readFileSync(join(FIXTURE, 'project.json'), 'utf8'))
  const events = parseEvents(readFileSync(join(FIXTURE, 'sources/events.jsonl'), 'utf8'))
  const zooms = generateAutoZooms(events, project.sources, project.style.autoZoom)
  t.diagnostic(`auto zooms: ${zooms.map((z) => `${z.start.toFixed(2)}-${z.end.toFixed(2)}`).join(', ')}`)
  const clicks = events.filter((e): e is Extract<InputEvent, { button: unknown }> => e.type === 'down')
  assert.ok(zooms.length > 0)
  for (const c of clicks) assert.ok(zooms.some((z) => z.start <= c.t - 0.5 && z.end >= c.t + 1.5), `click at ${c.t} is not covered`)
  zooms.forEach((z, i) => assert.ok(z.start >= 0 && z.end <= project.sources.duration && (i === 0 || zooms[i - 1].end <= z.start)))

  for (const style of ['focused', 'smooth'] as const) {
    project.style.screenAnimation = style
    const { p, view } = setup(zooms, events, { project })
    for (const t of frames(0, project.sources.duration)) {
      const v = visible(view(t))
      const c = cursorAt(p.cursor, t)!
      assert.ok(c.x >= v.x0 && c.x <= v.x1 && c.y >= v.y0 && c.y <= v.y1, `cursor out of frame at t=${t}`)
    }
    const r = layoutAt(p.layout, 0).screen!.rect
    for (const c of clicks) {
      const v = visible(view(c.t))
      assert.ok(view(c.t).scale > 1.9, `not zoomed in at the click at ${c.t}`)
      const x = r.x + (c.x * r.w) / project.sources.screen!.width
      const y = r.y + (c.y * r.h) / project.sources.screen!.height
      // Within the focus zone (plus spring slack), so the element around the click is in frame.
      assert.ok(Math.abs(x - view(c.t).center.x) <= 0.45 * v.hw && Math.abs(y - view(c.t).center.y) <= 0.45 * v.hh, `click at ${c.t} is off center`)
    }
  }
})

/** Click a field, type for 8 s, and meanwhile park the cursor toward the camera's corner, jittering
 *  there: framing the field alone leaves the cursor under the camera. */
function typingBesideCamera(pos: CameraPosition, edit: (p: Project) => void = () => {}) {
  const flip = (x: number, y: number): [number, number] => [pos.endsWith('left') ? 2880 - x : x, pos.startsWith('top') ? 1800 - y : y]
  const field = flip(1500, 950)
  const park = flip(2460, 1460)
  const rest = Array.from({ length: 56 }, (_, i): [number, number, number] => [5 + (i + 1) / 8, park[0] + (i % 2 ? 15 : -15), park[1] + (i % 2 ? -10 : 10)])
  const keys: InputEvent[] = Array.from({ length: 32 }, (_, i) => ({ t: 2 + i * 0.25, type: 'key', down: true, key: 'a', code: 0, mods: [] }))
  const click: InputEvent = { t: 1.5, type: 'down', x: field[0], y: field[1], button: 'left' }
  const events = [...moves([[0, ...field], [3, ...field], [5, ...park], ...rest]), click, ...keys].sort((a, b) => a.t - b.t)
  const project = createProject('t', { duration: 12, screen: SCREEN, camera: CAMERA, events: 'sources/events.jsonl' })
  project.style.camera.position = pos
  edit(project)
  return { field, ...setup([zoom({ start: 1, end: 12 })], events, { project, duration: 12 }) }
}
const CORNERS: CameraPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

test('a picture-in-picture camera never covers the cursor or the field being typed in, in any corner', () => {
  for (const pos of CORNERS) {
    const { p, view, field } = typingBesideCamera(pos)
    const r = layoutAt(p.layout, 0).screen!.rect
    const field0 = { x: r.x + (field[0] * r.w) / 2880, y: r.y + (field[1] * r.h) / 1800 }
    for (const t of frames(1.5, 12)) {
      const v = view(t)
      const scene = sceneAt(p, t)
      const cam = scene.camera!.rect // as drawn at t: stepped back by the zoom
      const out = (q: { x: number; y: number }) => ({ x: (q.x - v.center.x) * v.scale + 960, y: (q.y - v.center.y) * v.scale + 600 })
      const under = (q: { x: number; y: number }, w = 0, h = 0) => q.x + w > cam.x && q.x < cam.x + cam.w && q.y + h > cam.y && q.y < cam.y + cam.h
      const c = out(cursorAt(p.cursor, t)!)
      const f = out(field0)
      // The whole arrow: 14 x 20 points right of and below its tip, magnified by the zoom.
      const k = scene.cursor!.scale * v.scale
      assert.equal(scene.cursor!.image, 'arrow')
      assert.ok(!under(c, 14 * k, 20 * k), `${pos}: cursor at ${c.x.toFixed(0)},${c.y.toFixed(0)} under the camera at t=${t.toFixed(2)}`)
      assert.ok(c.x >= 0 && c.x <= 1920 && c.y >= 0 && c.y <= 1200, `${pos}: cursor out of frame at t=${t.toFixed(2)}`)
      assert.ok(!under(f) && f.x >= 0 && f.x <= 1920 && f.y >= 0 && f.y <= 1200, `${pos}: field hidden at t=${t.toFixed(2)}`)
    }
    // Clearing the camera is part of the framing, not a fight with it: a cursor jittering in place
    // at the camera's edge does not shake the view.
    const c0 = view(7).center
    for (const t of frames(7, 9.5)) assert.ok(Math.hypot(view(t).center.x - c0.x, view(t).center.y - c0.y) < 0.5, `${pos}: the view drifts at t=${t.toFixed(2)}`)
  }
})

test('vertical output: following the cursor near the camera pans it out from under the camera, in any corner', () => {
  for (const pos of CORNERS) {
    const to: [number, number] = [pos.endsWith('left') ? 900 : 1980, pos.startsWith('top') ? 250 : 1550]
    const project = createProject('t', { duration: 6, screen: SCREEN, camera: CAMERA, events: 'sources/events.jsonl' })
    project.style.camera.position = pos
    const { p, view } = setup([], moves([[0, 1440, 900], [2, ...to], [6, ...to]]), { project, width: 1080, height: 1920, duration: 6 })
    for (const t of frames(0, 3.5)) { // until the resting cursor hides
      const v = view(t)
      const { camera, cursor } = sceneAt(p, t)
      const cam = camera!.rect
      const x = (cursor!.x - v.center.x) * v.scale + 540
      const y = (cursor!.y - v.center.y) * v.scale + 960
      const k = cursor!.scale * v.scale
      assert.ok(!(x + 14 * k > cam.x && x < cam.x + cam.w && y + 20 * k > cam.y && y < cam.y + cam.h), `${pos}: cursor at ${x.toFixed(0)},${y.toFixed(0)} under the camera at t=${t.toFixed(2)}`)
    }
  }
})

test('only a picture-in-picture camera moves the view: hidden, fullscreen, or turned off do not', () => {
  const alone = typingBesideCamera('bottom-right', (p) => delete p.sources.camera)
  const edits: Array<(p: Project) => void> = [
    (p) => (p.style.camera.visible = false),
    ...(['hidden', 'fullscreen'] as const).map((kind) => (p: Project) => (p.layouts = [{ id: 'l', start: 0, end: 12, kind }])),
  ]
  for (const edit of edits) {
    const { view } = typingBesideCamera('bottom-right', edit)
    for (const t of frames(1, 12)) assert.deepEqual(view(t), alone.view(t), `t=${t}`)
  }
  const pip = typingBesideCamera('bottom-right')
  assert.ok(frames(1, 12).some((t) => Math.abs(pip.view(t).center.x - alone.view(t).center.x) > 20), 'a corner camera does')
})
