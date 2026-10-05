// Streaming GIF encoder for screen recordings. Pure: runs in gif.worker.ts, tested in gif.test.ts.
// - Per-scene palettes: a frame keeps the current 255-color palette until it no longer fits
//   (a scene change), then gets a fresh one. Colors stay stable within a scene, so nothing flickers.
// - Ordered dithering scaled to how far the palette misses each pixel: soft shadows and gradients
//   mix neighboring colors in proportion, colors the palette has stay clean. Ordered (not error
//   diffusion) keeps unchanged pixels identical from frame to frame, which the next step depends on.
// - Each frame stores only the rectangle that changed, unchanged pixels inside it transparent,
//   with a local color table of just the colors it uses. Identical frames extend the previous delay.

import quantize from 'gifenc/src/pnnquant2.js'
import { gifDelay } from './options.ts'

const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => (v + 0.5) / 64 - 0.5)
const TRANSPARENT = 255 // sentinel while building a frame; palettes hold at most 255 colors

interface Palette {
  rgb: Uint8Array // n * 3
  n: number
  cache: Int16Array // nearest index per 6-bit-per-channel RGB bucket, -1 = unknown
  misfit: number // misfit() on the frame it was built from
}

export class GifEncoder {
  private readonly w: number
  private readonly h: number
  private readonly fps: number
  private readonly loop: number
  private i = 0
  private pal: Palette | null = null
  private prev: Uint8Array
  private cur: Uint8Array
  private pending: { image: Uint8Array; transparent: number; delay: number } | null = null

  /** loop: 0 = forever, n = play n times. */
  constructor(width: number, height: number, fps: number, loop: number) {
    if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error(`GIF size ${width}x${height} is out of range`)
    this.w = width
    this.h = height
    this.fps = fps
    this.loop = loop
    this.prev = new Uint8Array(width * height)
    this.cur = new Uint8Array(width * height)
  }

  /** Add one RGBA frame shown for 1/fps s. Returns the bytes ready to append (often empty: each
   *  frame is held until the next one decides its delay). */
  add(rgba: Uint8Array): Uint8Array<ArrayBuffer> {
    const out = new Bytes()
    if (this.i === 0) this.header(out)
    let pal = this.pal
    // ponytail: scene change = 6% more of the frame misfits than on the frame the palette was built
    // from. Small new elements (a hover, a tooltip) get dithered instead of costing a full frame.
    const fresh = !pal || misfit(rgba, pal) > pal.misfit + 0.06
    if (fresh) pal = this.pal = makePalette(rgba)
    mapPixels(rgba, this.w, pal!, this.cur)
    const rect = fresh ? { x: 0, y: 0, w: this.w, h: this.h } : changedRect(this.prev, this.cur, this.w, this.h)
    const delay = gifDelay(this.i, this.fps)
    if (!rect) this.pending!.delay += delay
    else {
      this.flush(out)
      const { image, transparent } = encodeImage(this.cur, fresh ? null : this.prev, this.w, rect, pal!)
      this.pending = { image, transparent, delay }
    }
    ;[this.prev, this.cur] = [this.cur, this.prev]
    this.i++
    return out.bytes()
  }

  /** Flush the held frame and close the file. */
  finish(): Uint8Array<ArrayBuffer> {
    const out = new Bytes()
    if (this.i === 0) throw new Error('GIF has no frames')
    this.flush(out)
    out.push(0x3b)
    return out.bytes()
  }

  private header(out: Bytes) {
    out.ascii('GIF89a')
    out.u16(this.w)
    out.u16(this.h)
    out.push(0, 0, 0) // no global color table: every frame carries its own
    if (this.loop !== 1) {
      out.push(0x21, 0xff, 11)
      out.ascii('NETSCAPE2.0')
      out.push(3, 1)
      out.u16(this.loop === 0 ? 0 : this.loop - 1) // repeats after the first play
      out.push(0)
    }
  }

  private flush(out: Bytes) {
    const p = this.pending
    if (!p) return
    // ponytail: a static stretch over 655 s is clamped to the GIF delay maximum.
    const delay = Math.min(p.delay, 0xffff)
    // Graphic control: disposal 1 (keep the frame, the next one draws on top), optional transparency.
    out.push(0x21, 0xf9, 4, (1 << 2) | (p.transparent >= 0 ? 1 : 0))
    out.u16(delay)
    out.push(Math.max(p.transparent, 0), 0)
    out.append(p.image)
    this.pending = null
  }
}

function makePalette(rgba: Uint8Array): Palette {
  const colors = quantize(rgba, 255, { format: 'rgb565' })
  const rgb = new Uint8Array(colors.length * 3)
  colors.forEach((c, i) => rgb.set(c.slice(0, 3), i * 3))
  const pal: Palette = { rgb, n: colors.length, cache: new Int16Array(1 << 18).fill(-1), misfit: 0 }
  pal.misfit = misfit(rgba, pal)
  return pal
}

function nearest(p: Palette, r: number, g: number, b: number): number {
  const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)
  let best = p.cache[key]
  if (best >= 0) return best
  // Search from the bucket center, so a bucket always maps the same way (stable across frames).
  const cr = (r & ~3) + 2
  const cg = (g & ~3) + 2
  const cb = (b & ~3) + 2
  let bestD = Infinity
  for (let i = 0, j = 0; i < p.n; i++, j += 3) {
    const dr = p.rgb[j] - cr
    const dg = p.rgb[j + 1] - cg
    const db = p.rgb[j + 2] - cb
    const d = dr * dr + dg * dg + db * db
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return (p.cache[key] = best)
}

function dist(p: Palette, i: number, r: number, g: number, b: number): number {
  const dr = p.rgb[i * 3] - r
  const dg = p.rgb[i * 3 + 1] - g
  const db = p.rgb[i * 3 + 2] - b
  return dr * dr + dg * dg + db * db
}

/** Fraction of sampled pixels the palette misses by more than ~10 levels per channel. */
function misfit(rgba: Uint8Array, p: Palette): number {
  let bad = 0
  let n = 0
  for (let k = 0; k < rgba.length; k += 4 * 7, n++) {
    if (dist(p, nearest(p, rgba[k], rgba[k + 1], rgba[k + 2]), rgba[k], rgba[k + 1], rgba[k + 2]) > 300) bad++
  }
  return n ? bad / n : 0
}

function mapPixels(rgba: Uint8Array, w: number, p: Palette, out: Uint8Array) {
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
  for (let k = 0, y = 0; k < out.length; y++) {
    const row = (y & 7) * 8
    for (let x = 0; x < w; x++, k++) {
      const r = rgba[k * 4]
      const g = rgba[k * 4 + 1]
      const b = rgba[k * 4 + 2]
      let idx = nearest(p, r, g, b)
      const e = dist(p, idx, r, g, b)
      if (e > 2) {
        // A miss of m levels (e = 3m^2) dithers over +-2m: about the right share of the neighbor color.
        const d = BAYER[row + (x & 7)] * Math.min(32, 2.3 * Math.sqrt(e))
        idx = nearest(p, clamp(r + d), clamp(g + d), clamp(b + d))
      }
      out[k] = idx
    }
  }
}

function changedRect(a: Uint8Array, b: Uint8Array, w: number, h: number) {
  let x0 = w
  let x1 = -1
  let y0 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const o = y * w
    let l = 0
    while (l < w && a[o + l] === b[o + l]) l++
    if (l === w) continue
    let r = w - 1
    while (a[o + r] === b[o + r]) r--
    if (y0 < 0) y0 = y
    y1 = y
    if (l < x0) x0 = l
    if (r > x1) x1 = r
  }
  return y0 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Image descriptor + compact local color table + LZW data for `rect` of `cur`. With `prev`,
 *  pixels equal to it become transparent. */
function encodeImage(cur: Uint8Array, prev: Uint8Array | null, w: number, rect: { x: number; y: number; w: number; h: number }, p: Palette) {
  const px = new Uint8Array(rect.w * rect.h)
  const remap = new Int16Array(256).fill(-1)
  const used: number[] = []
  let hasT = false
  for (let y = 0, j = 0; y < rect.h; y++) {
    for (let x = 0, k = (rect.y + y) * w + rect.x; x < rect.w; x++, k++, j++) {
      const v = cur[k]
      if (prev && prev[k] === v) {
        px[j] = TRANSPARENT
        hasT = true
      } else {
        if (remap[v] < 0) remap[v] = used.push(v) - 1
        px[j] = remap[v]
      }
    }
  }
  const transparent = hasT ? used.length : -1
  if (hasT && transparent !== TRANSPARENT) for (let j = 0; j < px.length; j++) if (px[j] === TRANSPARENT) px[j] = transparent
  const bits = Math.max(1, Math.ceil(Math.log2(used.length + (hasT ? 1 : 0))))
  const out = new Bytes()
  out.push(0x2c)
  out.u16(rect.x)
  out.u16(rect.y)
  out.u16(rect.w)
  out.u16(rect.h)
  out.push(0x80 | (bits - 1))
  const table = new Uint8Array(3 << bits)
  used.forEach((v, i) => table.set(p.rgb.subarray(v * 3, v * 3 + 3), i * 3))
  out.append(table)
  lzw(px, Math.max(2, bits), out)
  return { image: out.bytes(), transparent }
}

// LZW with variable code width (max 12 bits) and an open-addressing hash table: the classic
// GIF compressor (Welch 1984; as in giflib and LZWEncoder.js).
const HSIZE = 5003
const htab = new Int32Array(HSIZE)
const codetab = new Int32Array(HSIZE)

function lzw(px: Uint8Array, minCode: number, out: Bytes) {
  out.push(minCode)
  const clear = 1 << minCode
  const eoi = clear + 1
  let bits = minCode + 1
  let maxcode = (1 << bits) - 1
  let free = eoi + 1
  let clearFlag = false
  let acc = 0
  let nacc = 0
  const block = new Uint8Array(255)
  let nblock = 0
  const byte = (b: number) => {
    block[nblock++] = b
    if (nblock === 255) {
      out.push(255)
      out.append(block)
      nblock = 0
    }
  }
  const emit = (code: number) => {
    acc |= code << nacc
    nacc += bits
    while (nacc >= 8) {
      byte(acc & 0xff)
      acc >>>= 8
      nacc -= 8
    }
    // Widen codes once the next entry no longer fits; reset after a clear.
    if (free > maxcode || clearFlag) {
      if (clearFlag) {
        bits = minCode + 1
        clearFlag = false
      } else bits++
      maxcode = bits === 12 ? 4096 : (1 << bits) - 1
    }
  }
  htab.fill(-1)
  emit(clear)
  let ent = px[0]
  outer: for (let i = 1; i < px.length; i++) {
    const c = px[i]
    const fcode = (c << 12) + ent
    let h = (c << 4) ^ ent
    if (htab[h] === fcode) {
      ent = codetab[h]
      continue
    }
    if (htab[h] >= 0) {
      const disp = h === 0 ? 1 : HSIZE - h
      do {
        if ((h -= disp) < 0) h += HSIZE
        if (htab[h] === fcode) {
          ent = codetab[h]
          continue outer
        }
      } while (htab[h] >= 0)
    }
    emit(ent)
    ent = c
    if (free < 4096) {
      codetab[h] = free++
      htab[h] = fcode
    } else {
      htab.fill(-1)
      free = eoi + 1
      clearFlag = true
      emit(clear)
    }
  }
  emit(ent)
  emit(eoi)
  if (nacc > 0) byte(acc & 0xff)
  if (nblock) {
    out.push(nblock)
    out.append(block.subarray(0, nblock))
  }
  out.push(0) // block terminator
}

/** Growable byte buffer. */
class Bytes {
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(1 << 16)
  private n = 0
  private room(k: number) {
    if (this.n + k <= this.buf.length) return
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.n + k))
    next.set(this.buf.subarray(0, this.n))
    this.buf = next
  }
  push(...bytes: number[]) {
    this.room(bytes.length)
    for (const b of bytes) this.buf[this.n++] = b
  }
  u16(v: number) {
    this.push(v & 0xff, (v >> 8) & 0xff)
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.push(s.charCodeAt(i))
  }
  append(a: Uint8Array) {
    this.room(a.length)
    this.buf.set(a, this.n)
    this.n += a.length
  }
  bytes(): Uint8Array<ArrayBuffer> {
    return this.buf.slice(0, this.n)
  }
}
