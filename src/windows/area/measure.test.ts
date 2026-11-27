import { test } from 'node:test'
import assert from 'node:assert/strict'
import { edges, even, measure } from './measure.ts'

// A 100 x 40 screen: a horizontal ramp (a gradient: no content) with a dark box at x 40..69, y 10..29.
const W = 100
const H = 40
const screen = (gray: (x: number, y: number) => number) => {
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([gray(x, y), gray(x, y), gray(x, y), 255], (y * W + x) * 4)
  return { width: W, height: H, data }
}
const box = (x: number, y: number) => (x >= 40 && x < 70 && y >= 10 && y < 30 ? 20 : 100 + x)

test('from each side of the area to the first content inside it', () => {
  const m = measure(edges(screen(box)), [3, 2, 97, 38], [97, 38]) // the pointer on the bottom right corner
  assert.deepEqual(m.left, { d: 37, at: 29.5 }) // the box's row nearest the pointer
  assert.deepEqual(m.right, { d: 27, at: 29.5 })
  assert.deepEqual(m.top, { d: 8, at: 69.5 })
  assert.deepEqual(m.bottom, { d: 8, at: 69.5 })
  // The pointer beside the box: right across from it.
  assert.deepEqual(measure(edges(screen(box)), [3, 2, 97, 38], [50, 20]).right, { d: 27, at: 20.5 })
  // Flush with the box's edge: no margin. Inside the box: nothing.
  assert.equal(measure(edges(screen(box)), [40, 10, 97, 38], [0, 0]).left?.d, 0)
  assert.deepEqual(measure(edges(screen(box)), [42, 12, 68, 28], [0, 0]), { left: null, right: null, top: null, bottom: null })
  // Past the pixels it has: that side measures nothing.
  assert.equal(measure(edges(screen(box)), [-5, 2, 97, 38], [0, 0]).left, null)
  // Only along the stretch the lens shows: rows 25 to 35 cross the box, rows 32 to 38 miss it.
  const shown = measure(edges(screen(box)), [3, 2, 97, 38], [97, 38], [80, 25, 100, 35.5])
  assert.deepEqual([shown.left, shown.top], [{ d: 37, at: 29.5 }, null])
  assert.equal(measure(edges(screen(box)), [3, 2, 97, 38], [97, 38], [0, 32, 100, 38]).left, null)
})

test('the nearest content on each side, as a pixel by pixel look finds it', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const dots = new Set(Array.from({ length: 30 }, () => Math.floor(rand() * W * H)))
  const px = screen((x, y) => (dots.has(y * W + x) ? 0 : 200))
  const e = edges(px)
  const gray = (x: number, y: number) => px.data[(y * W + x) * 4]
  for (let k = 0; k < 40; k++) {
    const [x0, x1] = [Math.floor(rand() * 50), 50 + Math.floor(rand() * 50)]
    const [y0, y1] = [Math.floor(rand() * 20), 20 + Math.floor(rand() * 20)]
    const [nx, ny] = [Math.floor(rand() * W), Math.floor(rand() * H)] // the pointer
    const band = k % 2 ? [nx - 20 * rand(), ny - 10 * rand(), nx + 20 * rand(), ny + 10 * rand()] : undefined // what the lens shows
    const inBand = (i: number, lo: number, hi: number) => !band || (i >= Math.ceil(band[lo]) && i < Math.ceil(band[hi]))
    // Every ray to its first change; the nearest, on the ray nearest the pointer (the first of two as near).
    const look = (n: number, rays: number[], near: number, at: (ray: number, i: number) => [number, number, number, number]) => {
      const hits = rays.flatMap((r) => {
        for (let i = 0; i < n; i++) {
          const [a, b, c, d] = at(r, i)
          if (Math.min(a, b, c, d) >= 0 && c < W && d < H && Math.abs(gray(a, b) - gray(c, d)) * 3 >= 24) return [{ d: i, at: r + 0.5 }]
        }
        return []
      })
      const best = Math.min(...hits.map((h) => h.d))
      return hits.filter((h) => h.d === best).reduce<{ d: number; at: number } | null>((a, h) => (a && Math.abs(a.at - 0.5 - near) <= Math.abs(h.at - 0.5 - near) ? a : h), null)
    }
    const rows = Array.from({ length: y1 - y0 }, (_, i) => y0 + i).filter((y) => inBand(y, 1, 3))
    const cols = Array.from({ length: x1 - x0 }, (_, i) => x0 + i).filter((x) => inBand(x, 0, 2))
    const m = measure(e, [x0, y0, x1, y1], [nx, ny], band)
    assert.deepEqual(m.left, look(x1 - x0, rows, ny, (y, i) => [x0 + i, y, x0 + i - 1, y]))
    assert.deepEqual(m.right, look(x1 - x0, rows, ny, (y, i) => [x1 - 1 - i, y, x1 - i, y])) // flush: x1 - 1 against x1
    assert.deepEqual(m.top, look(y1 - y0, cols, nx, (x, i) => [x, y0 + i, x, y0 + i - 1]))
    assert.deepEqual(m.bottom, look(y1 - y0, cols, nx, (x, i) => [x, y1 - 1 - i, x, y1 - i]))
  }
})

test('a corner evened out lies as far from the content on both its sides', () => {
  const e = edges(screen(box))
  const at = (r: [number, number, number, number]) => measure(e, r, [30, 4])
  // 10 to the box's left, 6 above it: both 8, the left side in by 2 and the top out by 2.
  assert.deepEqual(even([30, 4, 97, 38], 'left', 'top', at), [32, 2, 97, 38])
  assert.deepEqual([at([32, 2, 97, 38]).left?.d, at([32, 2, 97, 38]).top?.d], [8, 8])
  // Evened out, the bottom would pass the screen's last row: the corner stays.
  assert.deepEqual(even([3, 2, 90, 34], 'right', 'bottom', at), [3, 2, 90, 34])
})
