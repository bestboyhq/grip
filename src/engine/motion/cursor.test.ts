import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject, type Project } from '../../shared/project.ts'
import { removeSourceRange, setSpeed, timeMap } from '../../shared/timemap.ts'
import type { InputEvent } from '../../shared/events.ts'
import { layoutAt, prepareLayout } from '../layout.ts'
import { cursorAt, cursorPoint, prepareCursor } from './index.ts'
import { CURSORS } from '../../assets/cursors.ts'

// Deterministic PRNG (mulberry32).
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Human-like stream in 2880x1800 screen px: glide to a target with hand jitter, maybe click, rest.
 *  Moves at 120 Hz only while moving, like a real event tap. */
function stream(seconds: number, seed = 1, rest = true): InputEvent[] {
  const r = rng(seed)
  const ev: InputEvent[] = [{ t: 0, type: 'move', x: 1440, y: 900 }]
  let [t, x, y] = [0, 1440, 900]
  while (t < seconds) {
    const [x0, y0, tx, ty, dur] = [x, y, 100 + r() * 2680, 100 + r() * 1600, 0.3 + r() * 0.6]
    for (let u = 1 / 120; u <= dur && t + u < seconds; u += 1 / 120) {
      const k = (u / dur) ** 2 * (3 - (2 * u) / dur)
      x = x0 + (tx - x0) * k + (r() - 0.5) * 3
      y = y0 + (ty - y0) * k + (r() - 0.5) * 3
      ev.push({ t: t + u, type: 'move', x, y })
    }
    t += dur
    if (r() < 0.6 && t + 0.3 < seconds) {
      const d = t + 0.02 + r() * 0.1
      ev.push({ t: d, type: 'down', x, y, button: 'left' }, { t: d + 0.06 + r() * 0.08, type: 'up', x, y, button: 'left' })
      t = d + 0.15
    }
    if (rest) t += r() * 1.5
  }
  return ev
}

function setup(events: InputEvent[], duration: number, edit: (p: Project) => void = () => {}) {
  const project = createProject('t', { duration, screen: { file: 's.mp4', width: 2880, height: 1800, fps: 30, scale: 2 }, events: 'e' })
  edit(project)
  const input = { project, events, transcript: null, width: 1920, height: 1080 }
  const map = timeMap(project.clips)
  const layout = prepareLayout(input, map, 1)
  return { project, map, layout, c: prepareCursor(input, map, layout) }
}

/** Output time and output-px position of every click (down and up) that survives the cuts. */
function clicks(s: ReturnType<typeof setup>, events: InputEvent[]) {
  const out: Array<{ t: number; x: number; y: number }> = []
  s.map.clips.forEach((c, i) => {
    const last = i === s.map.clips.length - 1
    for (const e of events) {
      if ((e.type !== 'down' && e.type !== 'up') || e.t < c.start || e.t > c.end || (!last && e.t === c.end)) continue
      const t = s.map.outStarts[i] + (e.t - c.start) / c.speed
      const r = layoutAt(s.layout, t).screen!.rect
      out.push({ t, x: r.x + (e.x * r.w) / 2880, y: r.y + (e.y * r.w) / 2880 })
    }
  })
  return out
}

const edits = (p: Project) => {
  p.clips = removeSourceRange(p.clips, 7.3, 9.1)
  p.clips = removeSourceRange(p.clips, 20, 20.4)
  p.clips = setSpeed(p.clips, 30, 40, 4)
  p.clips = setSpeed(p.clips, 45, 50, 0.5)
  p.clips = removeSourceRange(p.clips, 52.05, 55)
}

test('a frame evaluated alone equals the frame evaluated in sequence', () => {
  const events = stream(60, 7)
  events.push({ t: 0, type: 'cursor', id: 'a', hotX: 8, hotY: 8, w: 32, h: 32, scale: 1 }, { t: 12, type: 'cursor', id: 'p', hotX: 12, hotY: 4, w: 32, h: 32, scale: 1 })
  events.sort((a, b) => a.t - b.t)
  const s = setup(events, 60, (p) => {
    edits(p)
    p.style.cursor.loop = true
  })
  const times = Array.from({ length: Math.ceil(s.map.duration * 60) + 1 }, (_, i) => i / 60)
  const seq = times.map((t) => cursorAt(s.c, t))
  assert.ok(seq.filter(Boolean).length > times.length / 3, 'cursor mostly visible')
  const r = rng(3)
  const order = times.map((_, i) => i).sort(() => r() - 0.5)
  for (const i of order) assert.deepEqual(cursorAt(s.c, times[i]), seq[i])
  const again = setup(events, 60, (p) => {
    p.clips = s.project.clips
    p.style.cursor.loop = true
  })
  for (const i of order) assert.deepEqual(cursorAt(again.c, times[i]), seq[i], 'prepare is deterministic')
})

test('passes through every click within 0.5 px, with cuts, speed changes, and loop', () => {
  const events = stream(60, 11)
  for (const loop of [false, true]) {
    for (const animation of ['smooth', 'medium', 'rapid', 'none'] as const) {
      const s = setup(events, 60, (p) => {
        edits(p)
        p.style.cursor.loop = loop
        p.style.cursor.animation = animation
      })
      const cs = clicks(s, events)
      assert.ok(cs.length > 10)
      for (const k of cs) {
        const p = cursorPoint(s.c, k.t)!
        assert.ok(Math.hypot(p.x - k.x, p.y - k.y) < 0.5, `click at ${k.t}: off by ${Math.hypot(p.x - k.x, p.y - k.y)}`)
        assert.ok(cursorAt(s.c, k.t)?.opacity === 1, 'visible at a click')
      }
    }
  }
})

test('no NaN at the timeline edges and around cuts; bad input fails clean', () => {
  const events: InputEvent[] = [...stream(30, 5), { t: 3, type: 'move', x: NaN, y: 1 }, { t: NaN, type: 'move', x: 1, y: 1 }]
  events.push({ t: 4, type: 'move' } as unknown as InputEvent)
  const s = setup(events, 30, (p) => {
    p.clips = removeSourceRange(p.clips, 0, 0.5)
    p.clips = removeSourceRange(p.clips, 10, 11)
    p.clips = setSpeed(p.clips, 15, 20, 8)
    p.clips = removeSourceRange(p.clips, 29.9, 30)
    p.style.cursor.hideIdle = false
  })
  const d = s.map.duration
  const ts = [-5, 0, 1e-9, NaN, Infinity, -Infinity, d - 1e-9, d, d + 3]
  for (const o of s.map.outStarts) for (const e of [0, 1e-9, 1 / 240, 1 / 120]) ts.push(o - e, o + e)
  for (const t of ts) {
    const l = cursorAt(s.c, t)
    assert.ok(l, `layer at ${t}`)
    for (const v of Object.values(l)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `finite at ${t}: ${JSON.stringify(l)}`)
  }
  assert.equal(setup([], 30).c.n, 0)
  assert.equal(cursorAt(setup([], 30).c, 1), null)
  assert.equal(cursorAt(setup(events, 30, (p) => (p.clips = [])).c, 1), null)
  assert.equal(cursorAt(setup(events, 30, (p) => (p.sources.screen = undefined)).c, 1), null)
})

test('a cut blends to the new position instead of teleporting', () => {
  const events: InputEvent[] = []
  for (let t = 0; t <= 10; t += 1 / 120) events.push({ t, type: 'move', x: t < 5 ? 200 + Math.sin(t) : 2600, y: t < 5 ? 200 : 1600 })
  const s = setup(events, 10, (p) => (p.clips = removeSourceRange(p.clips, 4, 6)))
  const cut = s.map.outStarts[1]
  const before = cursorPoint(s.c, cut - 1e-6)!
  const after = cursorPoint(s.c, cut)!
  const settled = cursorPoint(s.c, cut + 1.2)!
  const far = cursorPoint(s.c, cut + 3)!
  const gap = Math.hypot(far.x - before.x, far.y - before.y)
  assert.ok(gap > 1000)
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1, 'continuous at the cut')
  for (let t = cut; t < cut + 1; t += 1 / 60) {
    const a = cursorPoint(s.c, t)!
    const b = cursorPoint(s.c, t + 1 / 60)!
    assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < gap * 0.12, `no jump at ${t}`)
  }
  assert.ok(Math.hypot(settled.x - far.x, settled.y - far.y) < 1, 'settles on the new position')
})

test('hides when idle and fades back in before it moves', () => {
  const events: InputEvent[] = []
  for (let t = 0; t <= 1; t += 1 / 120) events.push({ t, type: 'move', x: 500 + t * 800, y: 500 })
  for (let t = 6; t <= 7; t += 1 / 120) events.push({ t, type: 'move', x: 1300 - (t - 6) * 800, y: 500 })
  events.push({ t: 7.5, type: 'move', x: 501, y: 500 }) // tremor, not movement
  const s = setup(events, 12)
  assert.equal(cursorAt(s.c, 0.5)?.opacity, 1)
  assert.equal(cursorAt(s.c, 2.4)?.opacity, 1)
  const fading = cursorAt(s.c, 2.65)!.opacity
  assert.ok(fading > 0 && fading < 1)
  assert.equal(cursorAt(s.c, 4), null)
  assert.ok(cursorAt(s.c, 5.95)!.opacity > 0, 'fades in before the move')
  assert.equal(cursorAt(s.c, 6.05)?.opacity, 1)
  assert.equal(cursorAt(s.c, 9.5), null, 'tremor does not wake it')
  const shown = setup(events, 12, (p) => (p.style.cursor.hideIdle = false))
  assert.equal(cursorAt(shown.c, 4)?.opacity, 1)
})

test('loop returns to the start position at the end', () => {
  const events = stream(20, 2)
  const s = setup(events, 20, (p) => (p.style.cursor.loop = true))
  const a = cursorPoint(s.c, 0)!
  const b = cursorPoint(s.c, s.map.duration)!
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.5, `${JSON.stringify([a, b])}`)
  assert.ok(cursorAt(s.c, 0) && cursorAt(s.c, s.map.duration), 'visible at both ends so the loop is seamless')
})

test('cursor images: recorded, flicker removed, built-in and touch sets', () => {
  const cur = (t: number, id: string, kind?: 'arrow' | 'pointer' | 'ibeam'): InputEvent => ({ t, type: 'cursor', id, hotX: 4, hotY: 4, w: 32, h: 32, scale: 1, kind })
  const events: InputEvent[] = [stream(10, 4, false), [cur(0, 'a1', 'arrow'), cur(2, 'p1', 'pointer'), cur(3, 'a1', 'arrow'), cur(3.03, 'p1', 'pointer'), cur(5, 'x9')]].flat()
  events.sort((a, b) => a.t - b.t)
  const at = (s: ReturnType<typeof setup>, t: number) => cursorAt(s.c, t)!.image
  const s = setup(events, 10)
  assert.deepEqual([1, 2.5, 3.01, 4, 6].map((t) => at(s, t)), ['a1', 'p1', 'p1', 'p1', 'x9'])
  const b = setup(events, 10, (p) => (p.style.cursor.set = 'builtin'))
  assert.deepEqual([1, 2.5, 6].map((t) => at(b, t)), ['arrow', 'pointer', 'x9'])
  const touch = setup(events, 10, (p) => (p.style.cursor.set = 'touch'))
  assert.equal(at(touch, 2.5), 'touch')
  assert.deepEqual([cursorAt(touch.c, 2.5)!.hotX, cursorAt(touch.c, 2.5)!.hotY], [CURSORS.touch.hotX, CURSORS.touch.hotY])
  assert.equal(cursorAt(touch.c, 2.5)!.angle, 0)
  // State carries across a cut: the clip after it starts with the image set inside the cut.
  const cut = setup(events, 10, (p) => (p.clips = removeSourceRange(p.clips, 1.5, 2.5)))
  assert.equal(at(cut, 1.5), 'p1')
  // No recorded images: our arrow, sized in screen points.
  const plain = setup(stream(10, 4, false), 10)
  const l = cursorAt(plain.c, 2)!
  const k = layoutAt(plain.layout, 2).screen!.rect.w / 2880
  assert.equal(l.image, 'arrow')
  assert.ok(Math.abs(l.scale - k * 2 * 1.6) < 1e-9)
  assert.deepEqual([l.hotX, l.hotY], [CURSORS.arrow.hotX, CURSORS.arrow.hotY])
})

test('tilts on fast horizontal moves, clamped, and settles at rest', () => {
  const events: InputEvent[] = []
  for (let t = 0; t <= 4; t += 1 / 120) events.push({ t, type: 'move', x: 300 + 2200 * Math.min(1, Math.max(0, t - 1) / 0.5), y: 900 })
  const s = setup(events, 4, (p) => (p.style.cursor.hideIdle = false))
  const angles = Array.from({ length: 4 * 60 }, (_, i) => cursorAt(s.c, i / 60)!.angle)
  assert.ok(Math.max(...angles) > 0.15, 'moving right tilts clockwise: tip leads, body trails')
  assert.ok(Math.max(...angles.map(Math.abs)) <= 0.36 + 1e-6)
  assert.ok(Math.abs(cursorAt(s.c, 3.9)!.angle) < 0.01)
})

test('sticks to the raw position while a button is held (drags)', () => {
  // A scribble drag at 4 Hz: smoothing alone would flatten it by ~100 px.
  const at = (j: number) => ({ x: 400 + j * 12, y: 600 + 150 * Math.sin((2 * Math.PI * 4 * j) / 120) })
  const events: InputEvent[] = [{ t: 0, type: 'move', x: 400, y: 600 }, { t: 1, type: 'down', x: 400, y: 600, button: 'left' }]
  for (let j = 1; j < 120; j++) events.push({ t: (120 + j) / 120, type: 'move', ...at(j) })
  events.push({ t: 2, type: 'up', ...at(120), button: 'left' }, { t: 3, type: 'move', ...at(120) })
  const s = setup(events, 4)
  const rect = layoutAt(s.layout, 1).screen!.rect
  const k = rect.w / 2880
  for (let j = 1; j < 120; j++) {
    const p = cursorPoint(s.c, (120 + j) / 120)!
    const e = at(j)
    assert.ok(Math.hypot(p.x - (rect.x + e.x * k), p.y - (rect.y + e.y * k)) < 0.5, `drag sample ${j}`)
  }
  // A click with hand tremor is not a drag: the path stays smooth (no 120 Hz zigzag) through it.
  const r = rng(4)
  const shaky: InputEvent[] = []
  for (let j = 0; j <= 360; j++) shaky.push({ t: j / 120, type: 'move', x: 1000 + (r() - 0.5) * 6, y: 1000 + (r() - 0.5) * 6 })
  shaky.push({ t: 1.5, type: 'down', x: 1002, y: 998, button: 'left' }, { t: 1.6, type: 'up', x: 999, y: 1001, button: 'left' })
  shaky.sort((a, b) => a.t - b.t)
  const q = setup(shaky, 3)
  const xs = Array.from({ length: 121 }, (_, j) => cursorPoint(q.c, 1 + j / 120)!.x / k)
  const zigzag = Math.max(...xs.slice(2).map((v, j) => Math.abs(v - 2 * xs[j + 1] + xs[j])))
  assert.ok(zigzag < 0.5, `second difference ${zigzag} screen px`)
})

test('a 2-hour stream with hundreds of cuts precomputes fast in bounded memory', () => {
  const hours = 2
  const events = stream(hours * 3600, 21, false)
  assert.ok(events.length > 700_000)
  const s0 = Date.now()
  const s = setup(events, hours * 3600, (p) => {
    const r = rng(5)
    for (let i = 0; i < 300; i++) {
      const a = r() * hours * 3600
      p.clips = removeSourceRange(p.clips, a, a + r() * 4)
    }
    for (let i = 0; i < 20; i++) p.clips = setSpeed(p.clips, i * 300, i * 300 + 20, 2 + (i % 3))
  })
  const ms = Date.now() - s0
  console.log(`2 h, ${events.length} events, ${s.map.clips.length} clips: prepared in ${ms} ms`)
  assert.ok(s.map.clips.length > 250)
  assert.ok(ms < 1000, `${ms} ms`)
  const bytes = [s.c.x, s.c.y, s.c.angle!, s.c.pinT, s.c.pinX, s.c.pinY, s.c.pinA, s.c.pinB, s.c.spanA, s.c.spanB, s.c.imgT].reduce((a, b) => a + b.byteLength, 0)
  assert.ok(bytes < 12 * s.map.duration * 120 + 1e6, `${(bytes / 1e6).toFixed(1)} MB`)
  for (let t = 0; t < s.map.duration; t += 7.77) assert.ok(Number.isFinite(cursorAt(s.c, t)?.x ?? 0))
})

test('built-in cursors: one set for motion and the renderer, hotspot inside each image', () => {
  for (const [name, a] of Object.entries(CURSORS)) assert.ok(a.hotX > 0 && a.hotX < a.w && a.hotY > 0 && a.hotY < a.h, name)
})

test('cursor animation styles smooth progressively less: smooth > medium > rapid > none (raw)', () => {
  const events = stream(30, 7)
  const path = (animation: 'smooth' | 'medium' | 'rapid' | 'none') => {
    const s = setup(events, 30, (p) => (p.style.cursor.animation = animation))
    return Array.from({ length: 2400 }, (_, i) => cursorPoint(s.c, i / 80)!)
  }
  const raw = path('none')
  const off = (a: string) => path(a as 'smooth').reduce((m, p, i) => m + Math.hypot(p.x - raw[i].x, p.y - raw[i].y), 0)
  const [s, m, r] = ['smooth', 'medium', 'rapid'].map(off)
  assert.ok(s > m && m > r && r > 0, `deviation from raw: smooth ${s}, medium ${m}, rapid ${r}`)
})
