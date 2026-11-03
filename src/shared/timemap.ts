// The one shared time map. clips[] (in output order) maps source time <-> output time.
// Every feature that converts between the two goes through here: render, captions, SRT/VTT,
// audio, zoom, timeline. Never re-implement this mapping elsewhere.

import { uid, type Clip } from './project.ts'

export interface TimeMap {
  clips: Clip[]
  outStarts: number[] // output start of clips[i]
  duration: number // output seconds
}

const EPS = 1e-9

export function timeMap(clips: Clip[]): TimeMap {
  const outStarts: number[] = []
  let t = 0
  for (const c of clips) {
    outStarts.push(t)
    t += (c.end - c.start) / c.speed
  }
  return { clips, outStarts, duration: t }
}

/** Index of the clip playing at output time `out` (half-open [start, end), last clip owns the end). */
export function clipAt(m: TimeMap, out: number): number {
  let lo = 0
  let hi = m.clips.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (m.outStarts[mid] <= out + EPS) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Output seconds -> source seconds. Clamped to the timeline. */
export function toSource(m: TimeMap, out: number): number {
  if (!m.clips.length) return 0
  const t = Math.min(Math.max(out, 0), m.duration)
  const i = clipAt(m, t)
  const c = m.clips[i]
  return Math.min(c.start + (t - m.outStarts[i]) * c.speed, c.end)
}

/** Source seconds -> output seconds, or null when that moment is cut out. First occurrence wins.
 *  O(log n + clips holding src): every click, keystroke, and word of a 2-hour project goes through it. */
export function toOutput(m: TimeMap, src: number): number | null {
  const { order, maxEnd } = indexOf(m)
  const n = m.clips.length
  let lo = 0
  let hi = order.length // first k with clips[order[k]].start > src + EPS
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (m.clips[order[mid]].start <= src + EPS) lo = mid + 1
    else hi = mid
  }
  let best = -1
  for (let k = lo - 1; k >= 0 && maxEnd[k] >= src - EPS; k--) {
    const i = order[k]
    const c = m.clips[i]
    if ((best < 0 || i < best) && src >= c.start - EPS && (src < c.end - EPS || (i === n - 1 && src <= c.end + EPS))) best = i
  }
  return best < 0 ? null : m.outStarts[best] + (Math.max(src, m.clips[best].start) - m.clips[best].start) / m.clips[best].speed
}

/** Clip indices sorted by source start, with a running max of source ends: lets mapRange and
 *  toOutput visit only the clips that can hold a time, O(log n + hits) instead of O(n). Built once per map. */
const sourceIndex = new WeakMap<TimeMap, { order: number[]; maxEnd: number[] }>()
function indexOf(m: TimeMap) {
  let ix = sourceIndex.get(m)
  if (!ix) {
    const order = m.clips.map((_, i) => i).sort((a, b) => m.clips[a].start - m.clips[b].start)
    const maxEnd: number[] = []
    order.forEach((i, k) => maxEnd.push(Math.max(k ? maxEnd[k - 1] : -Infinity, m.clips[i].end)))
    sourceIndex.set(m, (ix = { order, maxEnd }))
  }
  return ix
}

/** A source range -> the output ranges that survive cuts, in output order. A split that removes
 *  nothing (consecutive clips continuing the same source) does not break a range in two. */
export function mapRange(m: TimeMap, start: number, end: number): Array<[number, number]> {
  const { order, maxEnd } = indexOf(m)
  let lo = 0
  let hi = order.length // first k with clips[order[k]].start >= end
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (m.clips[order[mid]].start < end) lo = mid + 1
    else hi = mid
  }
  const hits: number[] = []
  for (let k = lo - 1; k >= 0 && maxEnd[k] > start; k--) if (m.clips[order[k]].end > start) hits.push(order[k])
  const out: Array<[number, number]> = []
  let prev = -1
  for (const i of hits.sort((a, b) => a - b)) {
    const c = m.clips[i]
    const s = Math.max(start, c.start)
    const e = Math.min(end, c.end)
    if (e - s <= EPS) continue
    const b = m.outStarts[i] + (e - c.start) / c.speed
    if (i > 0 && prev === i - 1 && s === c.start && Math.abs(m.clips[prev].end - s) < EPS) out[out.length - 1][1] = b
    else out.push([m.outStarts[i] + (s - c.start) / c.speed, b])
    prev = i
  }
  return out
}

/** Speed of the clip playing at output time `out`. */
export function speedAt(m: TimeMap, out: number): number {
  return m.clips.length ? m.clips[clipAt(m, out)].speed : 1
}

// ---- Edits. All pure: they return a new clips array. ----

/** Split the clip under output time `out` in two. No-op on an existing boundary. */
export function splitAt(clips: Clip[], out: number): Clip[] {
  const m = timeMap(clips)
  if (out <= EPS || out >= m.duration - EPS) return clips
  const i = clipAt(m, out)
  const c = clips[i]
  const src = toSource(m, out)
  if (src - c.start < EPS || c.end - src < EPS) return clips
  return [...clips.slice(0, i), { ...c, end: src }, { ...c, id: uid(), start: src }, ...clips.slice(i + 1)]
}

/** Remove output range [a, b) and close the gap (ripple delete). */
export function removeOutputRange(clips: Clip[], a: number, b: number): Clip[] {
  if (b - a < EPS) return clips
  let next = splitAt(splitAt(clips, a), b)
  const m = timeMap(next)
  return next.filter((_, i) => {
    const s = m.outStarts[i]
    const e = s + (next[i].end - next[i].start) / next[i].speed
    return !(s >= a - EPS && e <= b + EPS)
  })
}

/** Remove source range [a, b) wherever it appears (edit by transcript, filler words). */
export function removeSourceRange(clips: Clip[], a: number, b: number): Clip[] {
  const out: Clip[] = []
  for (const c of clips) {
    if (b <= c.start || a >= c.end) out.push(c)
    else {
      if (a - c.start > EPS) out.push({ ...c, end: a })
      if (c.end - b > EPS) out.push({ ...c, id: uid(), start: b })
    }
  }
  return out
}

/** Set speed for output range [a, b). */
export function setSpeed(clips: Clip[], a: number, b: number, speed: number): Clip[] {
  const next = splitAt(splitAt(clips, a), b)
  const m = timeMap(next)
  return next.map((c, i) => {
    const s = m.outStarts[i]
    const e = s + (c.end - c.start) / c.speed
    return s >= a - EPS && e <= b + EPS ? { ...c, speed } : c
  })
}

// ---- Cuts: removed source next to a clip edge, and bringing it back (timeline markers, agents). ----

const EDGE = 1e-6 // s: clip edges this close meet

/** A removed stretch of source next to a clip edge: shown as a marker, click restores it. */
export interface Cut {
  t: number // output seconds
  after: number // index of the clip before it (-1 = before the first clip)
  removed: number // source seconds that a restore brings back
}

function sorted(xs: number[]) {
  return Float64Array.from(xs).sort()
}
/** Largest value <= x in a sorted array, or `fallback`. */
function floorOf(xs: Float64Array, x: number, fallback: number) {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo ? xs[lo - 1] : fallback
}
/** Smallest value >= x in a sorted array, or `fallback`. */
function ceilOf(xs: Float64Array, x: number, fallback: number) {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo < xs.length ? xs[lo] : fallback
}

/** How far clip i's edges can grow: up to the nearest source another clip uses, or the recording's ends.
 *  Growing never shows the same source moment twice. */
export function clipLimits(clips: Clip[], i: number, duration: number, ends = sorted(clips.map((c) => c.end)), starts = sorted(clips.map((c) => c.start))) {
  const c = clips[i]
  return {
    lo: Math.min(c.start, Math.max(0, floorOf(ends, c.start + EDGE, 0))),
    hi: Math.max(c.end, Math.min(duration, ceilOf(starts, c.end - EDGE, duration))),
  }
}

/** Removed source next to each clip edge. */
export function cuts(map: TimeMap, duration: number): Cut[] {
  const clips = map.clips
  if (!clips.length) return []
  const ends = sorted(clips.map((c) => c.end))
  const starts = sorted(clips.map((c) => c.start))
  const out: Cut[] = []
  const head = clips[0].start - clipLimits(clips, 0, duration, ends, starts).lo
  if (head > 0.01) out.push({ t: 0, after: -1, removed: head })
  clips.forEach((c, i) => {
    const next = clips[i + 1]
    const hi = clipLimits(clips, i, duration, ends, starts).hi
    const removed = (next ? Math.min(next.start, hi) : hi) - c.end
    if (removed > 0.01 && (!next || next.start > c.end)) out.push({ t: map.outStarts[i] + (c.end - c.start) / c.speed, after: i, removed })
  })
  return out
}

/** Bring back the removed source at a cut marker. Neighbors that become seamless and alike merge. */
export function restoreCut(clips: Clip[], after: number, duration: number): Clip[] {
  const next = clips.slice()
  if (after < 0) {
    next[0] = { ...clips[0], start: clipLimits(clips, 0, duration).lo }
    return next
  }
  const c = clips[after]
  const n = clips[after + 1]
  const end = n ? Math.min(n.start, clipLimits(clips, after, duration).hi) : clipLimits(clips, after, duration).hi
  next[after] = { ...c, end }
  if (n && Math.abs(end - n.start) < EDGE && alike(c, n)) {
    next.splice(after, 2, { ...c, end: n.end })
  }
  return next
}

/** Same settings, so joining them changes nothing but the split. */
const alike = (a: Clip, b: Clip) =>
  a.speed === b.speed && a.volume === b.volume && (a.systemVolume ?? 1) === (b.systemVolume ?? 1) &&
  !!a.muted === !!b.muted && !!a.hideCursor === !!b.hideCursor && !!a.rawCursor === !!b.rawCursor
