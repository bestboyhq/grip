// Owner: motion. The cursor in OUTPUT time.
//
// prepareCursor bakes the path into typed arrays (cursorPath, reused while its inputs stay the same):
//   1. Sample the recorded position (sample-and-hold of move/down/up/scroll) on a fixed 120 Hz grid
//      over the OUTPUT timeline, clip by clip through the time map. Events in cut ranges never land.
//   2. Smooth each run of contiguous clips with a zero-phase Gaussian (3 box passes) measured in
//      output seconds: no lag, and sped-up clips move faster as they should.
//   3. During a drag (button held and moved) the path eases onto the raw position, so the cursor
//      sticks to whatever it drags.
//   4. Across a cut (the next clip does not continue the previous one in source time) the cursor
//      springs from where it was to its new position instead of teleporting.
//   5. Loop: over the last second the cursor glides back to its position at t = 0.
//   6. Tilt: a springy angle follows the horizontal velocity, clamped.
// cursorAt / cursorPoint then only interpolate (O(log n), pure), so a frame evaluated alone equals
// the same frame evaluated in sequence. Clicks (down and up) are pinned analytically on top: each
// adds a raised-cosine bump carrying its residual, and no bump reaches a neighbor click, so the
// path passes exactly through every click position at its click time.
//
// Motion blur: cursorAt is pure, cheap, and continuous across cuts. The compositor samples it (and
// the zoom view) across the shutter (compose.ts motionAt) and smears the cursor along them.
// Built-in images (src/assets/cursors.ts) are in screen points, so their scale is 1 / backing scale.

import type { InputEvent } from '../../shared/events.ts'
import type { TimeMap } from '../../shared/timemap.ts'
import type { CursorLayer, SceneInput } from '../scene.ts'
import { screenAt, type prepareLayout } from '../layout.ts'
import { springProgress } from './spring.ts'
import { CURSORS, type BuiltinName } from '../../assets/cursors.ts'

// Time constants, all in OUTPUT seconds.
const RATE = 120 // grid samples per second
const SIGMA = 0.08 // smoothing (Gaussian sigma)
const HOLD = 0.12 // ease onto the raw path around a drag
const PIN = 0.3 // reach of a click's correction on each side
const LOOP = 1 // glide back to the start over the last second
const IDLE = 1.5 // still this long, then fade out
const FADE_OUT = 0.3
const FADE_IN = 0.15 // fade in ends when the movement starts
const FLICKER = 0.08 // cursor images shown shorter than this are skipped
const STILL = 3 // screen points of travel that count as moving (ignores hand tremor)
const TILT_MAX = 0.3 // radians the velocity can ask for
const TILT_CLAMP = 0.36 // hard limit, leaves room for a little spring overshoot
const TILT_SPEED = 1500 // points/s for ~76% of TILT_MAX
const TILT_K = 260 // tilt spring stiffness and damping (mass 1), underdamped for a little wobble
const TILT_C = 16

type Pos = Extract<InputEvent, { x: number }>
type CursorEvent = Extract<InputEvent, { type: 'cursor' }>
/** scale = image px per screen.mp4 px. */
interface Img {
  image: string
  hotX: number
  hotY: number
  scale: number
}

export function prepareCursor(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>, path = cursorPath(input, map)) {
  return { input, layout, ...path }
}

let last: { events: InputEvent[]; key: string; path: CursorPath } | null = null

/** The baked path: plain data, a function of the events, the clips' timing, and the cursor style
 *  that shapes the path (not its size, visibility, idle hiding, or click effect: cursorAt applies
 *  those). Edits that leave all of that alone reuse the last path. Events are replaced, never edited
 *  in place, so the same array means the same events. */
export function cursorPath(input: SceneInput, map: TimeMap) {
  const { set, smooth, loop } = input.project.style.cursor
  const key = JSON.stringify([input.project.sources.screen ?? null, set, smooth, loop, map.clips.map((c) => [c.start, c.end, c.speed])])
  if (last?.events !== input.events || last.key !== key) last = { events: input.events, key, path: bakePath(input, map) }
  return last.path
}

export type CursorPath = ReturnType<typeof bakePath>

/** The events the path reads, valid and in time order, once per events array. */
const sorted = new WeakMap<InputEvent[], ReturnType<typeof sortEvents>>()
function eventsOf(events: InputEvent[]) {
  let s = sorted.get(events)
  if (!s) sorted.set(events, (s = sortEvents(events)))
  return s
}
function sortEvents(events: InputEvent[]) {
  const ev = events.filter(valid)
  for (let i = 1; i < ev.length; i++) {
    if (ev[i].t < ev[i - 1].t) {
      ev.sort((a, b) => a.t - b.t)
      break
    }
  }
  const pos = ev.filter((e): e is Pos => 'x' in e)
  const btn = pos.filter((e) => e.type === 'down' || e.type === 'up')
  const cur = ev.filter((e): e is CursorEvent => e.type === 'cursor')
  const posT = Float64Array.from(pos, (e) => e.t)
  const btnT = Float64Array.from(btn, (e) => e.t)
  const curT = Float64Array.from(cur, (e) => e.t)
  return { pos, btn, cur, posT, btnT, curT }
}

function bakePath(input: SceneInput, map: TimeMap) {
  const { project } = input
  const st = project.style.cursor
  const screen = project.sources.screen
  const pt = screen?.scale || 1 // screen.mp4 px per point
  const clips = map.clips

  const { pos, btn, cur, posT, btnT, curT } = eventsOf(input.events)

  const ok = !!screen && pos.length > 0 && map.duration > 0 && Number.isFinite(map.duration) && clips.every((c) => c.speed > 0 && c.end >= c.start)
  const n = ok ? Math.floor(map.duration * RATE) + 2 : 0
  const x = new Float32Array(n)
  const y = new Float32Array(n)

  const builtin = (k: BuiltinName): Img => ({ image: k, hotX: CURSORS[k].hotX, hotY: CURSORS[k].hotY, scale: 1 / pt })
  const imgOf = (e: CursorEvent | undefined): Img =>
    st.set === 'touch' ? builtin('touch')
    : !e ? builtin('arrow')
    : st.set === 'builtin' && e.kind && e.kind in CURSORS ? builtin(e.kind)
    : { image: e.id, hotX: e.hotX, hotY: e.hotY, scale: e.scale }

  const segI: number[] = [] // grid index where each run of contiguous clips starts
  const segT: number[] = [] // and its output time
  const pins: Array<{ t: number; x: number; y: number; seg: number }> = []
  const holds: number[] = [] // flat [start, end] output ranges of drags
  const spans: number[] = [] // flat [first, last] output times of bursts of activity
  const imgs: Array<{ t: number; img: Img }> = []

  const activity = (o: number) => {
    const L = spans.length
    if (L && o - spans[L - 1] <= IDLE + FADE_OUT + FADE_IN) spans[L - 1] = Math.max(spans[L - 1], o)
    else spans.push(o, o)
  }
  const pushImg = (t: number, img: Img) => {
    const last = imgs[imgs.length - 1]
    if (last && last.img.image === img.image) return
    if (last && t - last.t < 1e-9) imgs.pop()
    imgs.push({ t, img })
  }

  if (ok && st.loop) activity(0)
  for (let c = 0; ok && c < clips.length; c++) {
    const clip = clips[c]
    const last = c === clips.length - 1
    const o0 = map.outStarts[c]
    const o1 = last ? map.duration : map.outStarts[c + 1]
    const at = (t: number) => o0 + (t - clip.start) / clip.speed

    // 1. Grid samples.
    const i0 = Math.ceil(o0 * RATE - 1e-6)
    const i1 = last ? n : Math.ceil(o1 * RATE - 1e-6)
    if (c === 0 || Math.abs(clip.start - clips[c - 1].end) > 1e-6) {
      if (segI.at(-1) !== i0) segI.push(i0)
      segT[segI.length - 1] = o0
    }
    let p = bisect(posT, clip.start) - 1
    for (let i = i0; i < i1; i++) {
      const s = Math.min(clip.start + (i / RATE - o0) * clip.speed, clip.end)
      while (p + 1 < pos.length && posT[p + 1] <= s) p++
      const e = pos[p < 0 ? 0 : p]
      x[i] = e.x
      y[i] = e.y
    }

    // Clicks, drags (button held and moved past the tremor threshold), and activity in the clip.
    const lo = bisect(posT, clip.start, true)
    const hi = bisect(posT, clip.end, !last)
    const moved = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y) > STILL * pt
    let anchor = pos[Math.max(lo - 1, 0)]
    const b = bisect(btnT, clip.start, true) - 1
    let press: Pos | null = b >= 0 && btn[b].type === 'down' ? btn[b] : null
    let held = o0
    let dragged = false
    const release = (o: number) => {
      if (dragged) holds.push(held, o)
      press = null
      dragged = false
    }
    for (let i = lo; i < hi; i++) {
      const e = pos[i]
      const o = at(e.t)
      dragged ||= !!press && moved(e, press)
      if (e.type === 'down' || e.type === 'up') {
        pins.push({ t: o, x: e.x, y: e.y, seg: segT.length - 1 })
        activity(o)
        anchor = e
        if (e.type === 'up') release(o)
        else if (!press) {
          press = e
          held = o
        }
      } else if (moved(e, anchor)) {
        activity(o)
        anchor = e
      }
    }
    if (press) release(o1)

    // Cursor image: the state at the clip start, then each change inside the clip.
    const ci = bisect(curT, clip.start) - 1
    pushImg(o0, imgOf(cur[Math.max(ci, 0)]))
    for (let i = ci + 1; i < cur.length && (curT[i] < clip.end || (last && curT[i] <= clip.end)); i++) pushImg(at(curT[i]), imgOf(cur[i]))
  }
  if (ok && st.loop) activity(map.duration)

  // 2-3. Smooth each run of contiguous clips, then ease onto the raw path while a button is held.
  if (ok && st.smooth) {
    const rx = holds.length ? x.slice() : x
    const ry = holds.length ? y.slice() : y
    const r = Math.round((Math.sqrt(4 * (SIGMA * RATE) ** 2 + 1) - 1) / 2) // 3 boxes of 2r+1 ~ Gaussian SIGMA
    const tmp = new Float32Array(n)
    for (let j = 0; j < segI.length; j++) {
      for (let pass = 0; pass < 3; pass++) {
        box(x, segI[j], segI[j + 1] ?? n, r, tmp)
        box(y, segI[j], segI[j + 1] ?? n, r, tmp)
      }
    }
    for (let h = 0; h < holds.length; h += 2) {
      const a = holds[h]
      const z = holds[h + 1]
      for (let i = Math.max(0, Math.ceil((a - HOLD) * RATE)); i < n && i / RATE < z + HOLD; i++) {
        const t = i / RATE
        const w = t < a ? ease((t - a + HOLD) / HOLD) : t > z ? ease((z + HOLD - t) / HOLD) : 1
        x[i] += (rx[i] - x[i]) * w
        y[i] += (ry[i] - y[i]) * w
      }
    }
  }

  // 4. Across a cut, spring from the old position to the new path.
  for (let j = 1; j < segI.length; j++) {
    const s = segI[j]
    const e = segI[j + 1] ?? n
    if (s <= 0 || s >= n) continue
    const dx = x[s - 1] - x[s]
    const dy = y[s - 1] - y[s]
    const d = Math.max(Math.abs(dx), Math.abs(dy))
    for (let i = s; i < e; i++) {
      const g = 1 - springProgress((i - s) / RATE)
      if (Math.abs(g) * d < 0.01) break
      x[i] += dx * g
      y[i] += dy * g
    }
  }

  // 5. Loop back to the start position.
  if (ok && st.loop) {
    const L = Math.min(LOOP, map.duration / 2)
    const t0 = map.duration - L
    const x0 = x[0]
    const y0 = y[0]
    for (let i = Math.max(1, Math.floor(t0 * RATE)); i < n; i++) {
      const w = ease((i / RATE - t0) / L)
      x[i] += (x0 - x[i]) * w
      y[i] += (y0 - y[i]) * w
    }
  }

  // 6. Tilt: an underdamped spring chases a clamped target from the horizontal velocity.
  let angle: Float32Array | null = null
  if (ok && st.smooth && st.set !== 'touch') {
    angle = new Float32Array(n)
    let th = 0
    let w = 0
    for (let i = 0; i < n; i++) {
      const vx = ((x[Math.min(i + 1, n - 1)] - x[Math.max(i - 1, 0)]) * RATE) / 2 / pt
      const target = TILT_MAX * Math.tanh(vx / TILT_SPEED) // moving right: clockwise, the body trails
      w += (TILT_K * (target - th) - TILT_C * w) / RATE
      th += w / RATE
      angle[i] = Math.max(-TILT_CLAMP, Math.min(TILT_CLAMP, th))
    }
  }

  // Click pins: residual against the finished grid, reach limited to the neighbors and the run.
  const kept = pins.filter((q, k) => k === 0 || q.t - pins[k - 1].t > 1e-6)
  const m = kept.length
  const pinT = new Float64Array(m)
  const pinX = new Float64Array(m)
  const pinY = new Float64Array(m)
  const pinA = new Float64Array(m)
  const pinB = new Float64Array(m)
  kept.forEach((q, k) => {
    const segEnd = segT[q.seg + 1] ?? map.duration
    pinT[k] = q.t
    pinX[k] = q.x - lerp(x, q.t)
    pinY[k] = q.y - lerp(y, q.t)
    pinA[k] = Math.max(0, Math.min(PIN, k > 0 ? q.t - kept[k - 1].t : PIN, q.t - segT[q.seg]))
    pinB[k] = Math.max(0, Math.min(PIN, k + 1 < m ? kept[k + 1].t - q.t : PIN, segEnd - q.t))
  })

  // Cursor images, minus flicker shorter than FLICKER.
  const imgT: number[] = []
  const imgV: Img[] = []
  imgs.forEach((e, i) => {
    const next = imgs[i + 1]?.t ?? Infinity
    if (imgT.length && (next - e.t < FLICKER || imgV[imgV.length - 1].image === e.img.image)) return
    imgT.push(e.t)
    imgV.push(e.img)
  })

  return {
    duration: map.duration,
    n,
    x,
    y,
    angle,
    pinT,
    pinX,
    pinY,
    pinA,
    pinB,
    spanA: Float64Array.from(spans.filter((_, i) => i % 2 === 0)),
    spanB: Float64Array.from(spans.filter((_, i) => i % 2 === 1)),
    imgT: Float64Array.from(imgT),
    imgV,
  }
}

export type PreparedCursor = ReturnType<typeof prepareCursor>

/** Smoothed cursor position in unzoomed output px at output time t, shown or not (zoom follow
 *  uses it). Null when there is no cursor data or no screen. */
export function cursorPoint(c: PreparedCursor, t: number): { x: number; y: number } | null {
  const p = locate(c, t)
  return p && { x: p.x, y: p.y }
}

export function cursorAt(c: PreparedCursor, t: number): CursorLayer | null {
  const st = c.input.project.style.cursor
  if (!st.visible) return null
  const p = locate(c, t)
  if (!p) return null
  t = clampT(c, t)
  const opacity = st.hideIdle ? opacityAt(c, t) : 1
  if (opacity <= 0) return null
  const img = c.imgV[Math.max(bisect(c.imgT, t) - 1, 0)]
  return {
    x: p.x,
    y: p.y,
    image: img.image,
    hotX: img.hotX,
    hotY: img.hotY,
    scale: (p.k / img.scale) * st.size,
    angle: c.angle ? lerp(c.angle, t) : 0, // about the hotspot, positive = clockwise on screen
    opacity,
  }
}

function locate(c: PreparedCursor, t: number): { x: number; y: number; k: number } | null {
  const s = c.input.project.sources.screen
  if (!c.n || !s) return null
  t = clampT(c, t)
  let x = lerp(c.x, t)
  let y = lerp(c.y, t)
  const k = bisect(c.pinT, t) - 1
  for (let j = Math.max(k, 0); j <= k + 1 && j < c.pinT.length; j++) {
    const d = t - c.pinT[j]
    const r = d < 0 ? c.pinA[j] : c.pinB[j]
    const w = d === 0 ? 1 : Math.abs(d) < r ? 0.5 + 0.5 * Math.cos((Math.PI * d) / r) : 0
    x += c.pinX[j] * w
    y += c.pinY[j] * w
  }
  const r = screenAt(c.layout, t)?.screen
  if (!r) return null
  const scale = r.w / s.width
  return { x: r.x + x * scale, y: r.y + y * scale, k: scale }
}

function opacityAt(c: PreparedCursor, t: number): number {
  const j = bisect(c.spanA, t) - 1
  const out = j >= 0 ? 1 - ease((t - c.spanB[j] - IDLE) / FADE_OUT) : 0
  const into = j + 1 < c.spanA.length ? ease((t - c.spanA[j + 1] + FADE_IN) / FADE_IN) : 0
  return Math.max(out, into)
}

const clampT = (c: PreparedCursor, t: number) => (t > 0 ? Math.min(t, c.duration) : 0) // NaN -> 0

/** Linear interpolation of a grid at output time t (t within the timeline). */
function lerp(a: Float32Array, t: number): number {
  const f = t * RATE
  const i = Math.min(Math.floor(f), a.length - 2)
  return a[i] + (a[i + 1] - a[i]) * (f - i)
}

/** First index with a[i] > v, or a[i] >= v with `orEqual`. */
function bisect(a: ArrayLike<number>, v: number, orEqual = false): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (a[m] > v || (orEqual && a[m] === v)) hi = m
    else lo = m + 1
  }
  return lo
}

/** Box blur of a[from, to) with radius r, edges held. */
function box(a: Float32Array, from: number, to: number, r: number, tmp: Float32Array) {
  const len = to - from
  if (len < 2) return
  const at = (j: number) => a[from + (j < 0 ? 0 : j >= len ? len - 1 : j)]
  let sum = 0
  for (let j = -r; j <= r; j++) sum += at(j)
  for (let i = 0; i < len; i++) {
    tmp[i] = sum / (2 * r + 1)
    sum += at(i + r + 1) - at(i - r)
  }
  a.set(tmp.subarray(0, len), from)
}

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u))

function valid(e: InputEvent): boolean {
  if (!e || !Number.isFinite(e.t)) return false
  if ('x' in e) return Number.isFinite(e.x) && Number.isFinite(e.y)
  if (e.type === 'cursor') return typeof e.id === 'string' && Number.isFinite(e.hotX) && Number.isFinite(e.hotY) && e.scale > 0
  return false // keys and secure input do not move the cursor
}
