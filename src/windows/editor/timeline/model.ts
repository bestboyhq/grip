// Timeline model: lays a project out on OUTPUT time and holds the pure edits the timeline makes.
// Items stay in source time; every conversion goes through src/shared/timemap.ts (mapRange turns an
// item spanning cuts into its surviving pieces). Plain data and functions only, so the 2-hour
// stress project runs under node:test.

import { uid, type CameraLayout, type Clip, type Mask, type Transcript, type Zoom } from '../../../shared/project.ts'
import type { InputEvent } from '../../../shared/events.ts'
import { mapRange, splitAt, timeMap, toOutput, toSource, type TimeMap } from '../../../shared/timemap.ts'

export type ItemTrack = 'zooms' | 'layouts' | 'masks'
export type ChipTrack = 'keys' | 'captions'
export type TrackId = 'clips' | ItemTrack | ChipTrack

/** Anything placed on the timeline: source seconds. */
export interface Timed {
  start: number
  end: number
}
export interface Item extends Timed {
  id: string
}
/** Keystroke or caption word, display only. */
export interface Chip extends Timed {
  label: string
  dim?: boolean
}

/** One drawn piece of an item, in output seconds. An item cut in two has two blocks. */
export interface Block {
  a: number
  b: number
  i: number // index into the lane's items
  head: boolean // owns the item's start handle
  tail: boolean // owns the item's end handle
}

export interface Lane<T extends Timed = Timed> {
  items: T[]
  blocks: Block[] // sorted by a
  maxLen: number // longest block, bounds the visible-range search
}

/** A removed stretch of source next to a clip edge: shown as a marker, click restores it. */
export interface Cut {
  t: number // output seconds
  after: number // index of the clip before it (-1 = before the first clip)
  removed: number // source seconds that a restore brings back
}

export interface Parts {
  clips: Clip[]
  zooms: Zoom[]
  layouts: CameraLayout[]
  masks: Mask[]
  duration: number // sources.duration
}

export interface Model {
  map: TimeMap
  clips: Lane<Clip>
  zooms: Lane<Zoom>
  layouts: Lane<CameraLayout>
  masks: Lane<Mask>
  keys: Lane<Chip>
  captions: Lane<Chip>
  cuts: Cut[]
}

const EPS = 1e-6
export const MIN_LEN = 0.1 // shortest clip or item, output seconds

export function lane<T extends Timed>(map: TimeMap, items: T[]): Lane<T> {
  const blocks: Block[] = []
  let maxLen = 0
  items.forEach((it, i) => {
    const pieces: Array<[number, number]> = []
    for (const [a, b] of mapRange(map, it.start, it.end)) {
      const last = pieces.at(-1)
      // A split or speed change is not a cut: the item runs on as one block, one label.
      if (last && a - last[1] < EPS && Math.abs(toSource(map, a) - toSource(map, last[1] - EPS)) < 1e-4) last[1] = b
      else pieces.push([a, b])
    }
    pieces.forEach(([a, b], k) => {
      blocks.push({ a, b, i, head: k === 0, tail: k === pieces.length - 1 })
      if (b - a > maxLen) maxLen = b - a
    })
  })
  blocks.sort((x, y) => x.a - y.a)
  return { items, blocks, maxLen }
}

function clipLane(map: TimeMap): Lane<Clip> {
  let maxLen = 0
  const blocks = map.clips.map((c, i) => {
    const a = map.outStarts[i]
    const b = a + (c.end - c.start) / c.speed
    if (b - a > maxLen) maxLen = b - a
    return { a, b, i, head: true, tail: true }
  })
  return { items: map.clips, blocks, maxLen }
}

/** Rebuild what changed since `prev` (lanes keep identity when their inputs did). */
export function buildModel(p: Parts, keys: Chip[], words: Chip[], prev?: Model): Model {
  const same = prev?.map.clips === p.clips
  const map = same ? prev!.map : timeMap(p.clips)
  const reuse = <T extends Timed>(old: Lane<T> | undefined, items: T[]) => (same && old?.items === items ? old : lane(map, items))
  return {
    map,
    clips: same ? prev!.clips : clipLane(map),
    zooms: reuse(prev?.zooms, p.zooms),
    layouts: reuse(prev?.layouts, p.layouts),
    masks: reuse(prev?.masks, p.masks),
    keys: reuse(prev?.keys, keys),
    captions: reuse(prev?.captions, words),
    cuts: same && prev ? prev.cuts : cuts(map, p.duration),
  }
}

/** Index range [from, to) of blocks overlapping output [t0, t1]. */
export function visible(l: Lane, t0: number, t1: number): [number, number] {
  const from = lowerBound(l.blocks, t0 - l.maxLen)
  let to = from
  while (to < l.blocks.length && l.blocks[to].a <= t1) to++
  return [from, to]
}

function lowerBound(blocks: Block[], t: number): number {
  let lo = 0
  let hi = blocks.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (blocks[mid].a < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Topmost block under output time t, widened by `tol` seconds on each side. */
export function blockAt(l: Lane, t: number, tol = 0): Block | null {
  const [from, to] = visible(l, t - tol, t + tol)
  let best: Block | null = null
  for (let k = from; k < to; k++) {
    const b = l.blocks[k]
    if (b.a - tol <= t && t <= b.b + tol && (!best || (t >= b.a && t <= b.b) || !(t >= best.a && t <= best.b))) best = b
  }
  return best
}

// ---- Clips ----

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
    lo: Math.min(c.start, Math.max(0, floorOf(ends, c.start + EPS, 0))),
    hi: Math.max(c.end, Math.min(duration, ceilOf(starts, c.end - EPS, duration))),
  }
}

/** Source time for clip i's edge dragged to output time `out`. The clip's own linear map, extended past
 *  its ends (toSource clamps to the timeline), so the edge lands exactly under the pointer at any speed. */
export function edgeSource(map: TimeMap, i: number, out: number): number {
  const c = map.clips[i]
  return c.start + (out - map.outStarts[i]) * c.speed
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
  if (n && Math.abs(end - n.start) < EPS && n.speed === c.speed && n.volume === c.volume && !!n.muted === !!c.muted) {
    next.splice(after, 2, { ...c, end: n.end })
  }
  return next
}

/** Trim one edge of clip i to a source time, clamped to its limits and a minimum length. */
export function trimClip(clips: Clip[], i: number, side: 'start' | 'end', src: number, lim: { lo: number; hi: number }): Clip[] {
  const c = clips[i]
  const min = MIN_LEN * c.speed
  const next = clips.slice()
  next[i] = side === 'start' ? { ...c, start: clamp(src, lim.lo, c.end - min) } : { ...c, end: clamp(src, c.start + min, lim.hi) }
  return next
}

/** Ripple delete: the remaining clips close the gap. Never removes the last clip. */
export function removeClips(clips: Clip[], ids: Set<string>): Clip[] {
  const next = clips.filter((c) => !ids.has(c.id))
  return next.length && next.length < clips.length ? next : clips
}

/** Join clip i with the one after it, restoring the source between them. */
export function mergeClips(clips: Clip[], i: number): Clip[] {
  const a = clips[i]
  const b = clips[i + 1]
  if (!a || !b || b.start < a.start || b.end <= a.end) return clips
  return [...clips.slice(0, i), { ...a, end: b.end }, ...clips.slice(i + 2)]
}

/** Insert copies of `copies` at output time t, splitting the clip there. */
export function insertClips(clips: Clip[], t: number, copies: Clip[]): Clip[] {
  const next = splitAt(clips, t)
  const m = timeMap(next)
  let k = m.outStarts.findIndex((s) => s >= t - EPS)
  if (k < 0) k = next.length
  return [...next.slice(0, k), ...copies.map((c) => ({ ...c, id: uid() })), ...next.slice(k)]
}

/** Copies of the clips in `ids`, placed right after the last of them. */
export function duplicateClips(clips: Clip[], ids: Set<string>): Clip[] {
  const picked = clips.filter((c) => ids.has(c.id))
  if (!picked.length) return clips
  const last = clips.findLastIndex((c) => ids.has(c.id))
  return [...clips.slice(0, last + 1), ...picked.map((c) => ({ ...c, id: uid() })), ...clips.slice(last + 1)]
}

/** Where output time t of `before` is after an edit: the same source moment, or the next one that
 *  survives when it was cut out. Undo, redo, and timing edits put the playhead there. */
export function sameMoment(before: TimeMap, after: TimeMap, t: number): number {
  const src = toSource(before, t)
  return toOutput(after, src) ?? mapRange(after, src, Infinity)[0]?.[0] ?? after.duration
}

// ---- Zooms, layouts, masks: non-overlapping items in source time ----

/** Free source space around [s, e] among items (ignoring `skip`): previous end and next start. */
function room(items: Item[], s: number, e: number, duration: number, skip?: Set<string>) {
  let lo = 0
  let hi = duration
  for (const it of items) {
    if (skip?.has(it.id)) continue
    if (it.end <= s + EPS) lo = Math.max(lo, it.end)
    else if (it.start >= e - EPS) hi = Math.min(hi, it.start)
  }
  return { lo, hi }
}

/** Fit a wanted range into the free gap at its start, shifting it left to keep its length if it can.
 *  A start inside another item moves to that item's end. Null when the gap is too small. */
export function fit(items: Item[], s: number, e: number, duration: number, min = MIN_LEN): [number, number] | null {
  const inside = items.find((it) => it.start < s - EPS && it.end > s + EPS)
  if (inside) [s, e] = [inside.end, inside.end + e - s] // start after the item it lands on
  const { lo, hi } = room(items, s, s, duration)
  const len = Math.min(e - s, hi - lo)
  if (len < min) return null
  const start = clamp(s, lo, hi - len)
  return [start, start + len]
}

/** Move the items in `ids` by a source delta, as a group, stopping at neighbors and the recording's ends. */
export function moveItems<T extends Item>(items: T[], ids: Set<string>, delta: number, duration: number): T[] {
  let lo = -Infinity
  let hi = Infinity
  for (const it of items) {
    if (!ids.has(it.id)) continue
    const r = room(items, it.start, it.end, duration, ids)
    lo = Math.max(lo, r.lo - it.start)
    hi = Math.min(hi, r.hi - it.end)
  }
  const d = clamp(delta, Math.min(lo, 0), Math.max(hi, 0))
  return items.map((it) => (ids.has(it.id) ? { ...it, start: it.start + d, end: it.end + d } : it))
}

/** Move one edge of an item to a source time, clamped to its neighbors and a minimum length. */
export function resizeItem<T extends Item>(items: T[], id: string, side: 'start' | 'end', src: number, duration: number): T[] {
  return items.map((it) => {
    if (it.id !== id) return it
    const r = room(items, it.start, it.end, duration, new Set([id]))
    return side === 'start' ? { ...it, start: clamp(src, r.lo, it.end - MIN_LEN) } : { ...it, end: clamp(src, it.start + MIN_LEN, r.hi) }
  })
}

/** Add copies shifted by `delta` source seconds, each fitted into free space; ones that do not fit are dropped. */
export function placeCopies<T extends Item>(items: T[], copies: T[], delta: number, duration: number): { items: T[]; added: string[] } {
  const next = items.slice()
  const added: string[] = []
  for (const c of copies) {
    const r = fit(next, c.start + delta, c.end + delta, duration)
    if (!r) continue
    const id = uid()
    next.push({ ...c, id, start: r[0], end: r[1] })
    added.push(id)
  }
  return { items: next, added }
}

// ---- Display-only lanes ----

const COMMAND_MODS = new Set(['⌘', '⌃', '⌥'])
const SYMBOL_KEY = /[\u2190-\u23ff]/ // ↩ ⌫ ⌦ ⎋ ⇥ arrows: keys, not typed text

/** Shortcuts as chips; runs of plain typing as one "Typing" chip. */
export function keyChips(events: InputEvent[]): Chip[] {
  const out: Chip[] = []
  let run: Chip | null = null
  for (const e of events) {
    if (e.type !== 'key' || !e.down) continue
    const shortcut = e.mods.some((m) => COMMAND_MODS.has(m))
    if (!shortcut && run && e.t - run.end < 1.2) {
      run.end = e.t + 0.3
      continue
    }
    if (!shortcut && ((e.key.length === 1 && !SYMBOL_KEY.test(e.key)) || e.key === 'Space')) {
      out.push((run = { start: e.t, end: e.t + 0.3, label: 'Typing', dim: true }))
      continue
    }
    run = null
    out.push({ start: e.t, end: e.t + 0.8, label: e.mods.join('') + (e.key.length === 1 ? e.key.toUpperCase() : e.key) })
  }
  return out
}

export function wordChips(t: Transcript | null, edits: Record<number, string>): Chip[] {
  return t ? t.words.map((w, i) => ({ start: w.start, end: w.end, label: edits[i] ?? w.text, dim: w.filler })) : []
}

// ---- Numbers ----

/** Digit keys set the selected zoom's level: 1 = 1.5x, 2 = 2x ... 9 = 5.5x, 0 = 6x. */
export const levelForDigit = (d: number) => 1 + (d === 0 ? 10 : d) / 2

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

/** Ruler steps for px per second: labeled majors at least `px` apart, minors that divide them evenly, 18+ px apart. */
export function ticks(pps: number, px = 72): { major: number; minor: number } {
  const major = STEPS.find((s) => s * pps >= px) ?? 14400
  const minor = STEPS.find((s) => s < major && s * pps >= 18 && Math.abs(major / s - Math.round(major / s)) < 1e-9) ?? major
  return { major, minor }
}

/** Ruler label: "0:05", "1:05:00", or "0:05.5" for sub-second steps. */
export function label(t: number, step: number, hours: boolean): string {
  const r = Math.round(t * 10) / 10
  const h = Math.floor(r / 3600)
  const m = Math.floor((r % 3600) / 60)
  const s = r % 60
  const ss = step < 1 ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
  return hours ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${Math.floor(r / 60)}:${ss}`
}

/** Toolbar clock: "0:08.27" (hundredths), "1:02:03.45" past an hour. */
export function clock(t: number): string {
  const c = Math.max(0, Math.round(t * 100))
  const h = Math.floor(c / 360000)
  const m = Math.floor((c % 360000) / 6000)
  const s = Math.floor((c % 6000) / 100)
  const tail = `${String(s).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`
  return h ? `${h}:${String(m).padStart(2, '0')}:${tail}` : `${m}:${tail}`
}

/** Short duration for badges: "8s", "1.5s", "2m 05s", "1h 02m". */
export function span(sec: number): string {
  if (sec < 10) return `${Math.round(sec * 10) / 10}s`
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s`
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
