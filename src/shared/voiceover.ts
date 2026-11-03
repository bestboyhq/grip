// Owner: audio. Voiceover takes on the timeline, pure (node:test runs it). A take is mic audio recorded
// in the editor while the video played; each Voiceover item plays part of one. Items live in source time
// like every timed item: knots map take seconds to source seconds, so a cut or speed change made after
// the take cuts and stretches it with the video, the way it does the mic.

import { uid, type Voiceover } from './project.ts'
import type { TimeMap } from './timemap.ts'

const EPS = 1e-6
type Knot = [number, number]

/** Seconds: a shorter take was a slip of the key, and is dropped. */
export const MIN_TAKE = 0.2

/** Where a take plays: the source range of an item and its knots. */
export type Span = Pick<Voiceover, 'start' | 'end' | 'knots'>

/** The spans of a take whose second 0 played at output time `zero`, recorded while the video played from
 *  output `from` to `to`: one per stretch that moves forward through the source. A cut the video played
 *  through (the source jumps ahead) is two knots at one take second; a jump back starts a new span. */
export function place(m: TimeMap, zero: number, from: number, to = m.duration): Span[] {
  const out: Span[] = []
  let cur: Span | null = null
  m.clips.forEach((c, i) => {
    const o0 = m.outStarts[i]
    const a = Math.max(o0, from)
    const b = Math.min(o0 + (c.end - c.start) / c.speed, to)
    if (b - a <= EPS) return
    const s = c.start + (a - o0) * c.speed
    const e = c.start + (b - o0) * c.speed
    if (cur && s > cur.end - EPS) {
      if (s - cur.end > EPS) add(cur.knots, a - zero, s)
      add(cur.knots, b - zero, e)
      cur.end = e
    } else out.push((cur = { start: s, end: e, knots: [[a - zero, s], [b - zero, e]] }))
  })
  return out
}

/** Append a knot; a knot the new one makes redundant (same slope on both sides) goes. */
function add(k: Knot[], f: number, s: number) {
  const n = k.length
  if (n >= 2) {
    const [f0, s0] = k[n - 2]
    const [f1, s1] = k[n - 1]
    if (Math.abs((f1 - f0) / (s1 - s0) - (f - f1) / (s - s1)) < 1e-9) k.pop()
  }
  k.push([f, s])
}

/** The spans cut back to the first `len` seconds of the take (where it stopped, or what a crash left). */
export function trim(spans: Span[], len: number): Span[] {
  const out: Span[] = []
  for (const sp of spans) {
    const k = sp.knots
    if (k[0][0] >= len - EPS) continue
    const knots: Knot[] = []
    for (let j = 0; j < k.length; j++) {
      if (k[j][0] <= len) {
        knots.push(k[j])
        continue
      }
      const [f0, s0] = k[j - 1]
      const [f1, s1] = k[j]
      knots.push([len, s0 + ((len - f0) / (f1 - f0)) * (s1 - s0)])
      break
    }
    while (knots.length > 2 && knots.at(-1)![0] - knots.at(-2)![0] < EPS) knots.pop() // stopped right at a cut
    if (knots.at(-1)![1] - knots[0][1] > EPS) out.push({ start: knots[0][1], end: knots.at(-1)![1], knots })
  }
  return out
}

/** `items` with take `take` landed over `spans`, in the default settings, punched in over what was
 *  there (a later span over an earlier one too: one source moment has one voiceover). */
export function land(items: Voiceover[], take: string, spans: Span[]): Voiceover[] {
  let out = items
  for (const sp of spans) out = [...punch(out, [sp]), { id: uid(), take, ...sp, volume: 1, duck: true, enhance: true }]
  return out
}

/** A new take replaces what it covers: older items keep only the parts outside its spans. */
export function punch(items: Voiceover[], spans: Span[]): Voiceover[] {
  let out = items
  for (const sp of spans) {
    out = out.flatMap((v) => {
      if (v.end <= sp.start + EPS || v.start >= sp.end - EPS) return [v]
      const keep: Voiceover[] = []
      if (sp.start - v.start > 0.05) keep.push({ ...v, end: sp.start })
      if (v.end - sp.end > 0.05) keep.push({ ...v, id: keep.length ? uid() : v.id, start: sp.end })
      return keep
    })
  }
  return out
}

/** A stretch of output where a voiceover plays its take linearly: take second `f0` at output `o0`, `rate`
 *  take seconds per output second (1 until a speed changes after the take). */
export interface Piece {
  o0: number
  o1: number
  f0: number
  rate: number
}

/** Where `v` plays on the output timeline, in output order. A stretch the take was recorded through a
 *  cut of (cut back in since) plays nothing. */
export function pieces(m: TimeMap, v: Span): Piece[] {
  const k = v.knots
  const out: Piece[] = []
  m.clips.forEach((c, i) => {
    const s = Math.max(c.start, v.start, k[0][1])
    const e = Math.min(c.end, v.end, k[k.length - 1][1])
    for (let j = 1; j < k.length && e - s > EPS; j++) {
      const [f0, s0] = k[j - 1]
      const [f1, s1] = k[j]
      const a = Math.max(s, s0)
      const b = Math.min(e, s1)
      const slope = (f1 - f0) / (s1 - s0) // take seconds per source second
      if (b - a <= EPS || slope <= 0) continue
      const p = { o0: m.outStarts[i] + (a - c.start) / c.speed, o1: m.outStarts[i] + (b - c.start) / c.speed, f0: f0 + (a - s0) * slope, rate: slope * c.speed }
      const last = out.at(-1)
      if (last && Math.abs(last.o1 - p.o0) < EPS && Math.abs(last.rate - p.rate) < 1e-9 && Math.abs(last.f0 + (last.o1 - last.o0) * last.rate - p.f0) < 1e-4) last.o1 = p.o1
      else out.push(p)
    }
  })
  return out
}

/** Take second playing at source second `s` (inside the knots). */
export function takeAt(k: Knot[], s: number): number {
  let lo = 0
  let hi = k.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (k[mid][1] <= s) lo = mid
    else hi = mid - 1
  }
  const [f0, s0] = k[lo]
  const [f1, s1] = k[lo + 1]
  return f0 + ((Math.min(Math.max(s, s0), s1) - s0) / (s1 - s0)) * (f1 - f0)
}

/** Source second where take second `f` plays (the first, at a cut), clamped to the knots. */
export function sourceAt(k: Knot[], f: number): number {
  if (f <= k[0][0]) return k[0][1]
  for (let j = 1; j < k.length; j++) {
    const [f0, s0] = k[j - 1]
    const [f1, s1] = k[j]
    if (f <= f1 && f1 > f0) return s0 + ((f - f0) / (f1 - f0)) * (s1 - s0)
  }
  return k[k.length - 1][1]
}

/** Source range where take seconds [f0, f1] (a word) play: inside the stretch of knots its middle is
 *  in, so a word the video cut through while it was said stays where most of it was heard. Null
 *  outside the knots. */
export function sourceSpan(k: Knot[], f0: number, f1: number): [number, number] | null {
  const fm = (f0 + f1) / 2
  if (fm < k[0][0] || fm > k[k.length - 1][0]) return null
  let lo = 0
  let hi = k.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (k[mid][0] <= fm) lo = mid
    else hi = mid - 1
  }
  while (lo > 0 && k[lo + 1][0] - k[lo][0] < EPS) lo-- // fm sits right at the end: the stretch before it
  const [a0, s0] = k[lo]
  const [a1, s1] = k[lo + 1]
  if (a1 - a0 < EPS) return null
  const at = (f: number) => s0 + ((Math.min(Math.max(f, a0), a1) - a0) / (a1 - a0)) * (s1 - s0)
  return [at(f0), at(f1)]
}

/** The source range a voiceover's edges can reach: the take's audio. */
export const reach = (v: Pick<Voiceover, 'knots'>): [number, number] => [v.knots[0][1], v.knots[v.knots.length - 1][1]]

/** The item moved `d` source seconds, its audio with it. */
export const slid = <T extends Span>(v: T, d: number): T => ({ ...v, start: v.start + d, end: v.end + d, knots: v.knots.map(([f, s]) => [f, s + d]) })
