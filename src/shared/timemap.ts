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

/** Source seconds -> output seconds, or null when that moment is cut out. First occurrence wins. */
// ponytail: linear scan over clips, binary search on a source-sorted index if thousands of clips matter.
export function toOutput(m: TimeMap, src: number): number | null {
  for (let i = 0; i < m.clips.length; i++) {
    const c = m.clips[i]
    const last = i === m.clips.length - 1
    if (src >= c.start - EPS && (src < c.end - EPS || (last && src <= c.end + EPS))) {
      return m.outStarts[i] + (Math.max(src, c.start) - c.start) / c.speed
    }
  }
  return null
}

/** A source range -> the output ranges that survive cuts, in output order. */
export function mapRange(m: TimeMap, start: number, end: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  m.clips.forEach((c, i) => {
    const s = Math.max(start, c.start)
    const e = Math.min(end, c.end)
    if (e - s > EPS) out.push([m.outStarts[i] + (s - c.start) / c.speed, m.outStarts[i] + (e - c.start) / c.speed])
  })
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
