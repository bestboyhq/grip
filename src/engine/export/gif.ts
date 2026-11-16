// Streaming GIF encoder for screen recordings. Pure: runs in gif.worker.ts, tested in gif.test.ts.
// - Per-scene palettes: a frame keeps the current 255-color palette until it no longer fits
//   (a scene change, a soft shadow or surface in tones it lacks, or even a small element in a color
//   it has nothing near), then gets a fresh one. Colors stay stable within a scene, so nothing flickers.
// - Ordered dithering between the two palette colors around each pixel, in the share that mixes back
//   to it: soft shadows and gradients come out smooth, colors the palette has stay clean. Ordered (not
//   error diffusion) keeps unchanged pixels identical from frame to frame, which the next step depends
//   on, and a pixel whose source only moved by a recording's noise keeps its color.
// - Each frame stores only the rectangle that changed, unchanged pixels inside it transparent (by color,
//   so across a palette change too), with a local color table of just the colors it uses. Identical
//   frames extend the previous delay.

import quantize from 'gifenc/src/pnnquant2.js'
import { gifDelay } from './options.ts'

const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => (v + 0.5) / 64)
const TRANSPARENT = 255 // sentinel while building a frame; palettes hold at most 255 colors
const UNKNOWN = 0xffff // Palette.pairs: not looked up yet

interface Palette {
  rgb: Uint8Array // n * 3
  n: number
  // Per exact 24-bit color: the two entries pair() picks, the one its mix starts from in the low byte
  // (both the same when it needs none). Exact, since buckets of 4 levels a channel send a dark shadow's 12,
  // 13, 14, and 15 to one entry even when the palette holds each, and it comes out in rings.
  pairs: Uint16Array
  misfit: Misfit // misfit() on the frame it was built from
}

export class GifEncoder {
  private readonly w: number
  private readonly h: number
  private readonly fps: number
  private readonly loop: number
  private i = 0
  private pal: Palette | null = null
  private readonly cur: Uint8Array // palette index per pixel, TRANSPARENT where the canvas already shows it right
  private readonly canvas: Uint8Array // RGB per pixel: what the GIF shows so far
  private readonly shown: Uint8Array // RGBA per pixel: the source color the canvas color was picked for
  private readonly pairs = new Uint16Array(1 << 24) // 32 MB, reused by every palette
  private pending: { image: Uint8Array; transparent: number; delay: number } | null = null

  /** loop: 0 = forever, n = play n times. */
  constructor(width: number, height: number, fps: number, loop: number) {
    if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error(`GIF size ${width}x${height} is out of range`)
    this.w = width
    this.h = height
    this.fps = fps
    this.loop = loop
    this.cur = new Uint8Array(width * height)
    this.canvas = new Uint8Array(width * height * 3)
    this.shown = new Uint8Array(width * height * 4)
  }

  /** Add one RGBA frame shown for 1/fps s. Returns the bytes ready to append (often empty: each
   *  frame is held until the next one decides its delay). */
  add(rgba: Uint8Array): Uint8Array<ArrayBuffer> {
    const out = new Bytes()
    if (this.i === 0) this.header(out)
    let pal = this.pal
    // ponytail: scene change = 6% more of the frame misfits than on the frame the palette was built
    // from. Small new elements (a hover, a tooltip) get dithered instead of costing most of a frame (a
    // fresh palette moves nearly every color a little), unless their color is out of the palette's
    // reach: dithering only mixes nearby colors, so ink or a badge in a new hue would come out another
    // color. 0.05% of the frame is a short ink stroke. Nor do 2% of the frame in flat tones the palette
    // lacks: a loupe's soft shadow, a dimmed surface.
    const m = pal && misfit(rgba, pal)
    const fresh = !pal || m!.bad > pal.misfit.bad + 0.06 || m!.far > pal.misfit.far + 0.0005 || m!.flat > pal.misfit.flat + 0.02
    if (fresh) pal = this.pal = makePalette(rgba, this.pairs)
    mapPixels(rgba, this.w, pal!, this.cur)
    keep(rgba, pal!, this.i === 0, fresh, this.shown, this.canvas, this.cur)
    const rect = changedRect(this.cur, this.w, this.h)
    const delay = gifDelay(this.i, this.fps)
    if (!rect) this.pending!.delay += delay
    else {
      this.flush(out)
      const { image, transparent } = encodeImage(this.cur, this.w, rect, pal!)
      this.pending = { image, transparent, delay }
    }
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

function makePalette(rgba: Uint8Array, pairs: Uint16Array): Palette {
  // Flat surfaces first, exact: the quantizer bins 5 bits per channel, so a #fafafa page and its #ffffff
  // cards would share one averaged entry and both come out dithered. First also wins pair() ties.
  const flat = flatColors(rgba, 16)
  const colors = [...flat, ...quantize(rgba, 255 - flat.length, { format: 'rgb565' })]
  const rgb = new Uint8Array(colors.length * 3)
  colors.forEach((c, i) => rgb.set(c.slice(0, 3), i * 3))
  const pal: Palette = { rgb, n: colors.length, pairs: pairs.fill(UNKNOWN), misfit: { bad: 0, far: 0, flat: 0 } }
  pal.misfit = misfit(rgba, pal)
  return pal
}

/** Up to k exact colors that each cover at least 0.5% of the frame (sampled), most common first. */
function flatColors(rgba: Uint8Array, k: number): number[][] {
  const counts = new Map<number, number>()
  let n = 0
  for (let i = 0; i < rgba.length; i += 4 * 7, n++) {
    const c = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts]
    .filter(([, m]) => m >= n * 0.005)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([c]) => [c >> 16, (c >> 8) & 255, c & 255])
}

/** The two entries a color shows as, mixed in the share mapPixels() works out: the pair whose mix lands
 *  nearest the color, plus a 64th of their distance squared so far-apart pairs (coarse dither) lose.
 *  Its nearest alone, when within a level or when no mix does better. Low byte: the entry the mix starts
 *  from, one of its 3 nearest; starting only from the nearest fails a gray whose nearest is a tint: it
 *  mixes the tint with a gray, and bands that lean warm, then cool, show as rings. */
function pair(p: Palette, r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b
  const hit = p.pairs[key]
  if (hit !== UNKNOWN) return hit
  const near: number[] = [] // the 3 nearest entries, nearest first, and their distances
  const nd: number[] = []
  for (let i = 0; i < p.n; i++) {
    const d = dist(p, i, r, g, b)
    let s = nd.length
    while (s > 0 && d < nd[s - 1]) s--
    if (s === 3) continue
    near.splice(s, 0, i)
    nd.splice(s, 0, d)
    near.length = nd.length = Math.min(nd.length, 3)
  }
  let [c1, c2, best] = [near[0], near[0], nd[0]]
  if (best > 2)
    for (const c of near) {
      const a = c * 3
      const [er, eg, eb] = [r - p.rgb[a], g - p.rgb[a + 1], b - p.rgb[a + 2]]
      const ee = er * er + eg * eg + eb * eb
      for (let i = 0, j = 0; i < p.n; i++, j += 3) {
        const [dr, dg, db] = [p.rgb[j] - p.rgb[a], p.rgb[j + 1] - p.rgb[a + 1], p.rgb[j + 2] - p.rgb[a + 2]]
        const dot = dr * er + dg * eg + db * eb
        if (dot <= 0) continue // not past c toward the color
        const dd = dr * dr + dg * dg + db * db
        const t = Math.min(1, dot / dd)
        const cost = ee - 2 * t * dot + t * t * dd + dd / 64
        if (cost < best) [best, c1, c2] = [cost, c, i]
      }
    }
  return (p.pairs[key] = c1 | (c2 << 8))
}

function dist(p: Palette, i: number, r: number, g: number, b: number): number {
  const dr = p.rgb[i * 3] - r
  const dg = p.rgb[i * 3 + 1] - g
  const db = p.rgb[i * 3 + 2] - b
  return dr * dr + dg * dg + db * db
}

type Misfit = { bad: number; far: number; flat: number }
/** Fractions of sampled pixels the palette misses by more than ~10 levels per channel (bad), by more
 *  than ~40 levels in one channel (far: no palette color is anywhere near, like new red ink), and by
 *  more than a level or two in colors that each cover 0.5% of the frame, as flatColors() picks them
 *  (flat: a surface or a soft shadow the palette has no tones for, which only dithering would show). */
function misfit(rgba: Uint8Array, p: Palette): Misfit {
  let bad = 0
  let far = 0
  let n = 0
  const missed = new Map<number, number>()
  for (let k = 0; k < rgba.length; k += 4 * 7, n++) {
    const [r, g, b] = [rgba[k], rgba[k + 1], rgba[k + 2]]
    const v = pair(p, r, g, b)
    const d = Math.min(dist(p, v & 255, r, g, b), dist(p, v >> 8, r, g, b)) // the nearer color it shows
    if (d > 8) {
      const c = (rgba[k] << 16) | (rgba[k + 1] << 8) | rgba[k + 2]
      missed.set(c, (missed.get(c) ?? 0) + 1)
    }
    if (d > 300) bad++
    if (d > 1600) far++
  }
  let flat = 0
  for (const m of missed.values()) if (m >= n * 0.005) flat += m
  return n ? { bad: bad / n, far: far / n, flat: flat / n } : { bad: 0, far: 0, flat: 0 }
}

function mapPixels(rgba: Uint8Array, w: number, p: Palette, out: Uint8Array) {
  const c = p.rgb
  for (let k = 0, y = 0; k < out.length; y++) {
    const row = (y & 7) * 8
    for (let x = 0; x < w; x++, k++) {
      const r = rgba[k * 4]
      const g = rgba[k * 4 + 1]
      const b = rgba[k * 4 + 2]
      const v = pair(p, r, g, b)
      const c1 = v & 255
      const c2 = v >> 8
      if (c1 === c2) {
        out[k] = c1
        continue
      }
      // The share of c2 that mixes back to this color: where it falls on the line from c1 to c2.
      const [i, j] = [c1 * 3, c2 * 3]
      const [dr, dg, db] = [c[j] - c[i], c[j + 1] - c[i + 1], c[j + 2] - c[i + 2]]
      const t = ((r - c[i]) * dr + (g - c[i + 1]) * dg + (b - c[i + 2]) * db) / (dr * dr + dg * dg + db * db)
      out[k] = BAYER[row + (x & 7)] < t ? c2 : c1
    }
  }
}

/** Marks TRANSPARENT each pixel the canvas already shows right: it maps to the color shown, or its source
 *  moved at most a level a channel since its color was picked (a recording's noise would otherwise flip
 *  it between neighboring tones every frame, each flip stored). By color, not palette index, so a fresh
 *  palette stores only what changed too, not a full frame. A fresh palette drops that hold: pixels the
 *  old one showed badly (the tones it lacked are why it was replaced) get their new colors. */
function keep(rgba: Uint8Array, p: Palette, first: boolean, fresh: boolean, shown: Uint8Array, canvas: Uint8Array, cur: Uint8Array) {
  for (let k = 0, j = 0, c = 0; k < cur.length; k++, j += 4, c += 3) {
    const v = cur[k] * 3
    if (!first) {
      if (!fresh && Math.abs(rgba[j] - shown[j]) <= 1 && Math.abs(rgba[j + 1] - shown[j + 1]) <= 1 && Math.abs(rgba[j + 2] - shown[j + 2]) <= 1) {
        cur[k] = TRANSPARENT
        continue
      }
      shown.set(rgba.subarray(j, j + 3), j)
      if (canvas[c] === p.rgb[v] && canvas[c + 1] === p.rgb[v + 1] && canvas[c + 2] === p.rgb[v + 2]) {
        cur[k] = TRANSPARENT
        continue
      }
    } else shown.set(rgba.subarray(j, j + 3), j)
    canvas.set(p.rgb.subarray(v, v + 3), c)
  }
}

function changedRect(cur: Uint8Array, w: number, h: number) {
  let x0 = w
  let x1 = -1
  let y0 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    const o = y * w
    let l = 0
    while (l < w && cur[o + l] === TRANSPARENT) l++
    if (l === w) continue
    let r = w - 1
    while (cur[o + r] === TRANSPARENT) r--
    if (y0 < 0) y0 = y
    y1 = y
    if (l < x0) x0 = l
    if (r > x1) x1 = r
  }
  return y0 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Image descriptor + compact local color table + LZW data for `rect` of `cur`, its TRANSPARENT pixels
 *  transparent. */
function encodeImage(cur: Uint8Array, w: number, rect: { x: number; y: number; w: number; h: number }, p: Palette) {
  const px = new Uint8Array(rect.w * rect.h)
  const remap = new Int16Array(256).fill(-1)
  const used: number[] = []
  let hasT = false
  for (let y = 0, j = 0; y < rect.h; y++) {
    for (let x = 0, k = (rect.y + y) * w + rect.x; x < rect.w; x++, k++, j++) {
      const v = cur[k]
      if (v === TRANSPARENT) {
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
