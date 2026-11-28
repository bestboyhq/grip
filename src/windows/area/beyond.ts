// What lies past a display's edges, for an area picked past them (Area.svelte). Pure.
import { clamp } from './geometry.ts'

/** Raw RGBA pixels: the overlay's still, or the display's wallpaper alone. */
export interface Pixels {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/** The display (`still`) with `ox` pixels more on its left and right and `oy` more above and below it.
 *  Past its edges: the wallpaper alone (`wall`, the still's size) mirrored at each edge, so it carries on
 *  without a seam, and darkened where a shadow crosses the edge, so the shadow fades out instead of
 *  stopping there. Transparent without a wallpaper. `k`: pixels per point. */
export function beyond(still: Pixels, wall: Pixels | null, ox: number, oy: number, k: number): Uint8ClampedArray<ArrayBuffer> {
  const { width: w, height: h } = still
  const W = w + 2 * ox
  const H = h + 2 * oy
  const out = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < h; y++) out.set(still.data.subarray(y * w * 4, (y + 1) * w * 4), ((y + oy) * W + ox) * 4)
  if (!wall || wall.width !== w || wall.height !== h) return out
  const s = still.data
  const p = wall.data
  // How much a shadow darkens the wallpaper at (u, v): 0 where the still shows the wallpaper as it is, or
  // something no shadow makes: a window the edge cuts, whose pixels would smear past the edge. A shadow
  // takes the same share off each of the wallpaper's channels, and never most of it.
  const dark = (u: number, v: number) => {
    const i = (v * w + u) * 4
    const paper = p[i] + p[i + 1] + p[i + 2]
    const f = paper ? (s[i] + s[i + 1] + s[i + 2]) / paper : 1
    if (f >= 1 || f < 0.4) return 0
    for (let c = 0; c < 3; c++) if (Math.abs(s[i + c] - f * p[i + c]) > 3 + 0.03 * p[i + c]) return 0
    return 1 - f
  }
  // ponytail: a shadow's fade past the edge is read from two pixels inside it and carried on as an
  // exponential, and a window the edge cuts stays cut, unless its pixels are the wallpaper's own hue,
  // darker: a gray window on a gray wallpaper. Fit the shadow's whole profile if one reads wrong.
  const IN = Math.max(1, Math.round(6 * k))
  /** At edge pixel (u, v), inward (du, dv): the shadow's strength there, and the pixels over which it falls off. */
  const fade = (u: number, v: number, du: number, dv: number) => {
    const s0 = dark(u, v)
    if (s0 < 0.01) return [0, 1]
    const s1 = dark(clamp(u + du * IN, 0, w - 1), clamp(v + dv * IN, 0, h - 1))
    const reach = s1 > s0 * 1.02 ? (IN * Math.hypot(du, dv)) / Math.log(s1 / s0) : 8 * k
    return [s0, clamp(reach, 2 * k, 40 * k)]
  }
  /** An edge's fades, eased along it over 4 points: a shadow is soft along the edge too, and a window's
   *  rounded corner reads as shadow on one row and not the next. */
  const soft = (a: number[][]) => {
    const n = Math.round(4 * k)
    return a.map((_, i) => {
      const [lo, hi] = [Math.max(0, i - n), Math.min(a.length - 1, i + n)]
      let [s, r] = [0, 0]
      for (let j = lo; j <= hi; j++) [s, r] = [s + a[j][0], r + a[j][0] * a[j][1]]
      return s ? [s / (hi - lo + 1), r / s] : [0, 1]
    })
  }
  const top = soft(Array.from({ length: w }, (_, u) => fade(u, 0, 0, 1)))
  const bottom = soft(Array.from({ length: w }, (_, u) => fade(u, h - 1, 0, -1)))
  const left = soft(Array.from({ length: h }, (_, v) => fade(0, v, 1, 0)))
  const right = soft(Array.from({ length: h }, (_, v) => fade(w - 1, v, -1, 0)))
  const corners = [fade(0, 0, 1, 1), fade(w - 1, 0, -1, 1), fade(0, h - 1, 1, -1), fade(w - 1, h - 1, -1, -1)]
  const mirror = (a: number, n: number) => (a < 0 ? Math.min(-1 - a, n - 1) : a >= n ? Math.max(2 * n - 1 - a, 0) : a)
  for (let Y = 0; Y < H; Y++) {
    const v = Y - oy
    const cv = clamp(v, 0, h - 1)
    const row = mirror(v, h) * w
    const beside = v >= 0 && v < h // left or right of the still, not above or below it
    for (let X = 0; X < W; X++) {
      const u = X - ox
      if (beside && u === 0) {
        X += w - 1 // the still itself: already in
        continue
      }
      const cu = clamp(u, 0, w - 1)
      const e = beside ? (u < 0 ? left[v] : right[v]) : u >= 0 && u < w ? (v < 0 ? top[u] : bottom[u]) : corners[(u < 0 ? 0 : 1) + (v < 0 ? 0 : 2)]
      const f = e[0] ? 1 - e[0] * Math.exp(-Math.hypot(u - cu, v - cv) / e[1]) : 1
      const n = f < 1 ? Math.random() - 0.5 : 0 // dither: a faded shadow is a soft ramp (the banding skill)
      const i = (row + mirror(u, w)) * 4
      const o = (Y * W + X) * 4
      out[o] = p[i] * f + n
      out[o + 1] = p[i + 1] * f + n
      out[o + 2] = p[i + 2] * f + n
      out[o + 3] = 255
    }
  }
  return out
}
