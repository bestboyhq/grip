// Owner: capture. Measure lines for the area picker (Area.svelte): how far each side of an area lies from
// the first content inside it, in the frozen screen's pixels. Pure.
import type { Pixels } from './beyond.ts'

/** Where the screen's pixels change, a bit per pixel. `h`, row after row of `(width + 31) >> 5` words:
 *  pixel x differs from x - 1. `v`, column after column of `(height + 31) >> 5` words: pixel y differs
 *  from y - 1. Made once per still, off the main thread (edges.worker.ts). */
export interface Edges {
  width: number
  height: number
  h: Uint32Array
  v: Uint32Array
}

/** A step this big (|ΔR| + |ΔG| + |ΔB| + |ΔA|, out of 1020) is content: a hairline border or a glyph's
 *  edge. A soft shadow or a gradient changes by less from one pixel to the next, so it never stops a line. */
const STEP = 24

export function edges({ width: W, height: H, data }: Pixels): Edges {
  const u = data.byteOffset % 4 ? new Uint32Array(data.slice().buffer) : new Uint32Array(data.buffer, data.byteOffset, W * H)
  const rw = (W + 31) >> 5
  const cw = (H + 31) >> 5
  const h = new Uint32Array(rw * H)
  const v = new Uint32Array(cw * W)
  const far = (a: number, b: number) =>
    Math.abs((a & 255) - (b & 255)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) + Math.abs((a >>> 24) - (b >>> 24)) >= STEP
  for (let y = 0; y < H; y++) {
    const o = y * W
    for (let x = 0; x < W; x++) {
      const p = u[o + x]
      if (x && p !== u[o + x - 1] && far(p, u[o + x - 1])) h[y * rw + (x >> 5)] |= 1 << (x & 31)
      if (y && p !== u[o + x - W] && far(p, u[o + x - W])) v[x * cw + (y >> 5)] |= 1 << (y & 31)
    }
  }
  return { width: W, height: H, h, v }
}

/** The first set bit of the row of words at `base` from `from` up to `to` (not included), or -1: 32 a step. */
function next(w: Uint32Array, base: number, from: number, to: number) {
  for (let i = from; i < to; i = (i | 31) + 1) {
    const word = w[base + (i >> 5)] & (~0 << (i & 31))
    if (word) {
      const b = (i & ~31) + 31 - Math.clz32(word & -word)
      return b < to ? b : -1
    }
  }
  return -1
}
/** The last set bit from `from` down to `lo` (included), or -1. */
function prev(w: Uint32Array, base: number, from: number, lo: number) {
  for (let i = from; i >= lo; i = (i & ~31) - 1) {
    const word = w[base + (i >> 5)] & (~0 >>> (31 - (i & 31)))
    if (word) {
      const b = (i & ~31) + 31 - Math.clz32(word)
      return b >= lo ? b : -1
    }
  }
  return -1
}

/** An area's pixel edges: x0, y0, x1, y1. */
export type Box = [number, number, number, number]

/** A side's measure: `d` pixels from it to the first content, at `at` along it (pixels: the middle of
 *  the pixel row or column nearest the pointer of those that near it). */
export interface Side {
  d: number
  at: number
}
export interface Measure {
  left: Side | null
  right: Side | null
  top: Side | null
  bottom: Side | null
}

/** The nearest content over rays `from` to `to`, on the ray nearest `near` of those it is that near on:
 *  `ray(i, cap)` is how far along ray i the content is, looked for no further than `cap`, or -1. Each
 *  ray looks no further than the nearest so far. */
function side(from: number, to: number, near: number, ray: (i: number, cap: number) => number): Side | null {
  let [best, at] = [Infinity, 0]
  for (let i = from; i < to; i++) {
    const d = ray(i, best)
    if (d >= 0 && (d < best || Math.abs(i - near) < Math.abs(at - near))) [best, at] = [d, i]
  }
  return best < Infinity ? { d: best, at: at + 0.5 } : null
}

/** From each side of area `r` (pixel edges x0, y0, x1, y1 in `e`) in to the first content, as near
 *  pixel `near` (the pointer) along the side as that content allows: 0 where the pixels change right at
 *  the side, flush with it. Only along the stretch of each side inside `band` (pixels x0, y0, x1, y1:
 *  what the lens shows), so a line never lands where the user does not look. A side past the pixels `e`
 *  has (the room past the screen, before its edges come) measures nothing. */
export function measure(e: Edges, r: Box, [nx, ny]: [number, number], band = [-Infinity, -Infinity, Infinity, Infinity]): Measure {
  const [x0, y0, x1, y1] = r.map(Math.round)
  const rw = (e.width + 31) >> 5
  const cw = (e.height + 31) >> 5
  const [a0, a1, b0, b1] = [Math.max(x0, 0), Math.min(x1, e.width), Math.max(y0, 0), Math.min(y1, e.height)]
  const [c0, c1, r0, r1] = [Math.max(a0, Math.ceil(band[0])), Math.min(a1, Math.ceil(band[2])), Math.max(b0, Math.ceil(band[1])), Math.min(b1, Math.ceil(band[3]))]
  const pos = (b: number, d: number) => (b < 0 ? -1 : d)
  return {
    left: x0 < 0 ? null : side(r0, r1, ny, (y, cap) => { const b = next(e.h, y * rw, x0, Math.min(a1, x0 + cap + 1)); return pos(b, b - x0) }),
    right: x1 > e.width ? null : side(r0, r1, ny, (y, cap) => { const b = prev(e.h, y * rw, Math.min(x1, e.width - 1), Math.max(a0 + 1, x1 - cap)); return pos(b, x1 - b) }),
    top: y0 < 0 ? null : side(c0, c1, nx, (x, cap) => { const b = next(e.v, x * cw, y0, Math.min(b1, y0 + cap + 1)); return pos(b, b - y0) }),
    bottom: y1 > e.height ? null : side(c0, c1, nx, (x, cap) => { const b = prev(e.v, x * cw, Math.min(y1, e.height - 1), Math.max(b0 + 1, y1 - cap)); return pos(b, y1 - b) }),
  }
}

/** Area `r` with the corner where sides `a` and `b` meet moved so both lie as far from the content as
 *  each other: on the diagonal through the content's corner, as near where the corner is as that allows.
 *  `at` measures an area. What a move brings into the area can change what a side reaches, so each move
 *  measures again; a corner moved past what `at` can measure stays where it last could. */
export function even(r: Box, a: 'left' | 'right', b: 'top' | 'bottom', at: (r: Box) => Measure): Box {
  let last = r
  for (let i = 0; i < 4; i++) { // ponytail: 4 tries; what a move brings in rarely changes the target more than once
    const m = at(r)
    const [h, v] = [m[a], m[b]]
    if (!h || !v) return last
    if (h.d === v.d) return r
    last = r
    const d = Math.round((h.d + v.d) / 2)
    const [x, y] = [d - h.d, d - v.d] // pixels each side moves out
    r = [r[0] - (a === 'left' ? x : 0), r[1] - (b === 'top' ? y : 0), r[2] + (a === 'right' ? x : 0), r[3] + (b === 'bottom' ? y : 0)]
  }
  return last
}
