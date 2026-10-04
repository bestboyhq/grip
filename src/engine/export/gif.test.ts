import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GifEncoder } from './gif.ts'

// Independent minimal GIF decoder: composites frames (disposal 1) onto an RGB canvas.
function decode(gif: Uint8Array) {
  let p = 0
  const u8 = () => gif[p++]
  const u16 = () => ((p += 2), gif[p - 2] | (gif[p - 1] << 8))
  const ascii = (n: number) => String.fromCharCode(...gif.subarray(p, (p += n)))
  assert.equal(ascii(6), 'GIF89a')
  const W = u16()
  const H = u16()
  assert.equal(u8() & 0x80, 0, 'no global color table')
  p += 2
  const canvas = new Uint8Array(W * H * 3)
  const frames: Array<{ x: number; y: number; w: number; h: number; delay: number; image: Uint8Array }> = []
  let loop: number | null = null
  let gce = { delay: 0, t: -1 }
  const blocks = () => {
    const parts: number[] = []
    for (let n = u8(); n; n = u8()) parts.push(...gif.subarray(p, (p += n)))
    return new Uint8Array(parts)
  }
  for (;;) {
    const b = u8()
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = u8()
      if (label === 0xf9) {
        u8()
        const f = u8()
        assert.equal((f >> 2) & 7, 1, 'disposal: keep')
        const delay = u16()
        const t = u8()
        gce = { delay, t: f & 1 ? t : -1 }
        u8()
      } else if (label === 0xff) {
        const id = ascii(u8())
        const data = blocks()
        if (id === 'NETSCAPE2.0') loop = data[1] | (data[2] << 8)
      } else blocks()
      continue
    }
    assert.equal(b, 0x2c)
    const [x, y, w, h] = [u16(), u16(), u16(), u16()]
    const f = u8()
    assert.ok(f & 0x80, 'local color table')
    const table = gif.subarray(p, (p += 3 * (2 << (f & 7))))
    const minCode = u8()
    const idx = lzwDecode(blocks(), minCode, w * h)
    for (let j = 0; j < w * h; j++) {
      if (idx[j] === gce.t) continue
      const k = ((y + Math.floor(j / w)) * W + x + (j % w)) * 3
      canvas.set(table.subarray(idx[j] * 3, idx[j] * 3 + 3), k)
    }
    frames.push({ x, y, w, h, delay: gce.delay, image: canvas.slice() })
  }
  return { W, H, loop, frames }
}

function lzwDecode(data: Uint8Array, minCode: number, n: number): Uint8Array {
  const out = new Uint8Array(n)
  const clear = 1 << minCode
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const first = new Uint8Array(4096)
  const len = new Int32Array(4096)
  for (let i = 0; i < clear; i++) [suffix[i], first[i], len[i]] = [i, i, 1]
  let size = minCode + 1
  let next = clear + 2
  let prev = -1
  let o = 0
  let bit = 0
  const read = () => {
    let v = 0
    for (let i = 0; i < size; i++, bit++) v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i
    return v
  }
  const write = (code: number) => {
    for (let i = len[code] - 1, c = code; i >= 0; i--, c = prefix[c]) out[o + i] = suffix[c]
    o += len[code]
  }
  for (;;) {
    const code = read()
    if (code === clear) {
      ;[size, next, prev] = [minCode + 1, clear + 2, -1]
      continue
    }
    if (code === clear + 1) break
    assert.ok(code <= next, `bad LZW code ${code} > ${next}`)
    if (prev >= 0 && next < 4096) {
      ;[prefix[next], suffix[next], first[next], len[next]] = [prev, code < next ? first[code] : first[prev], first[prev], len[prev] + 1]
      next++
    }
    write(code)
    prev = code
    if (next === 1 << size && size < 12) size++
  }
  assert.equal(o, n, 'pixel count')
  return out
}

const W = 96
const H = 64
function frame(fn: (x: number, y: number) => [number, number, number]) {
  const rgba = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set([...fn(x, y), 255], (y * W + x) * 4)
  return rgba
}
const meanError = (rgba: Uint8Array, rgb: Uint8Array) => {
  let e = 0
  for (let k = 0; k < W * H; k++) for (let c = 0; c < 3; c++) e += Math.abs(rgba[k * 4 + c] - rgb[k * 3 + c])
  return e / (W * H * 3)
}

test('GIF round trip: diff rectangles, merged static frames, per-scene palettes, exact timing', () => {
  // A UI-like scene: flat window on a gradient wallpaper.
  const a = frame((x, y) => (x > 20 && x < 70 && y > 10 && y < 50 ? [245, 245, 247] : [40 + x, 60 + y, 160]))
  const b = a.slice()
  for (let y = 30; y < 36; y++) for (let x = 40; x < 48; x++) b.set([20, 120, 255, 255], (y * W + x) * 4) // a button lights up
  const c = frame((x, y) => [(x * 7) % 256, 255 - y * 3, (x + y) % 64]) // scene change
  const enc = new GifEncoder(W, H, 15, 0)
  const parts = [a, b, b, b, c].map((f) => enc.add(f))
  parts.push(enc.finish())
  const gif = new Uint8Array(parts.reduce((n, x) => n + x.length, 0))
  parts.reduce((o, x) => (gif.set(x, o), o + x.length), 0)

  const d = decode(gif)
  assert.equal(d.loop, 0)
  assert.equal(d.frames.length, 3, 'identical frames merge into one')
  assert.deepEqual(d.frames[1], { ...d.frames[1], x: 40, y: 30, w: 8, h: 6 }, 'only the changed rectangle is stored')
  // 1, 3, and 1 frames at 15 fps; cumulative rounding keeps the total at exactly 5/15 s = 33 cs.
  assert.deepEqual(d.frames.map((f) => f.delay), [7, 20, 6])
  assert.ok(meanError(a, d.frames[0].image) < 4, 'frame 1 close to source')
  assert.ok(meanError(b, d.frames[1].image) < 4, 'frame 2 close to source')
  assert.ok(meanError(c, d.frames[2].image) < 6, 'scene change gets a fitting palette')
  // Flat UI color stays exact (no dither noise).
  const k = (25 * W + 30) * 3
  assert.deepEqual([...d.frames[0].image.subarray(k, k + 3)], [245, 245, 247])
})

test('GIF LZW survives full code tables (noise), and loop counts', () => {
  const colors = Array.from({ length: 200 }, (_, i) => [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256])
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) % 200
  const noise = frame(() => colors[rand()] as [number, number, number])
  for (const loop of [1, 3]) {
    const enc = new GifEncoder(W, H, 10, loop)
    const head = enc.add(noise)
    const tail = enc.finish()
    const gif = new Uint8Array([...head, ...tail])
    const d = decode(gif)
    assert.equal(d.loop, loop === 1 ? null : loop - 1)
    assert.ok(meanError(noise, d.frames[0].image) < 1, 'every pixel decodes back')
  }
})
