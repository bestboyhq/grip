import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beyond } from './beyond.ts'

// A 20 x 10 display at 0.5 px per point, 30 px more on the left and right, 4 above and below.
const w = 20
const h = 10
const [ox, oy, k] = [30, 4, 0.5]
const W = w + 2 * ox
const image = (gray: (u: number, v: number) => number) => {
  const data = new Uint8Array(w * h * 4)
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) data.set([gray(u, v), gray(u, v), gray(u, v), 255], (v * w + u) * 4)
  return { width: w, height: h, data }
}
const at = (out: Uint8ClampedArray, X: number, Y: number) => out[(Y * W + X) * 4]
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1, `${a} is not ${b}`)

test('past the edges: the wallpaper mirrored, a shadow fading out, or nothing', () => {
  // The wallpaper a ramp left to right, and nothing over it: it mirrors at each edge, and the still is untouched.
  const ramp = image((u) => 10 * u)
  let out = beyond(ramp, ramp, ox, oy, k)
  near(at(out, ox + 5, oy + 5), 50)
  near(at(out, ox - 1, oy + 5), 0) // left of column 0: column 0
  near(at(out, ox - 3, oy + 5), 20)
  near(at(out, ox + w, oy + 5), 190) // right of column 19: column 19
  near(at(out, ox + w + 2, oy + 5), 170)
  near(at(out, ox + 5, 0), 50) // above: the same column, mirrored rows
  assert.equal(out[(0 * W + 0) * 4 + 3], 255) // a corner: filled
  // A window's shadow running into the right edge (strength 0.4 at column 15, falling off over 4 px):
  // past the edge it carries on falling off, from what it was at the edge, toward the wallpaper.
  const wall = image(() => 200)
  const shadow = (u: number) => (u < 15 ? 0 : 0.4 * Math.exp(-(u - 15) / 4))
  out = beyond(image((u) => Math.round(200 * (1 - shadow(u)))), wall, ox, oy, k)
  near(at(out, ox + w, oy + 5), Math.round(200 * (1 - shadow(20)))) // the next column, as if the screen went on
  near(at(out, ox + w + 4, oy + 5), Math.round(200 * (1 - shadow(24))))
  near(at(out, W - 1, oy + 5), 200) // far out: the wallpaper as it is
  // A window the right edge cuts is no shadow, dark or colored: the wallpaper past the edge stays as it is.
  near(at(beyond(image((u) => (u < 12 ? 200 : 30)), wall, ox, oy, k), ox + w, oy + 5), 200)
  const tinted = image(() => 200)
  for (let v = 0; v < h; v++) for (let u = 12; u < w; u++) tinted.data.set([90, 140, 190], (v * w + u) * 4)
  near(at(beyond(tinted, wall, ox, oy, k), ox + w, oy + 5), 200)
  // No wallpaper: transparent past the edges, the still inside.
  out = beyond(ramp, null, ox, oy, k)
  assert.equal(out[(5 * W + 2) * 4 + 3], 0)
  near(at(out, ox + 5, oy + 5), 50)
})
