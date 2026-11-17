// Image bytes: PNG metadata and the menu bar's export ring. Pure: no electron imports, so node:test can run it.
import { crc32 } from 'node:zlib'

/** `png` marked with its pixel density (a pHYs chunk replacing any other), so a 2x screenshot pastes
 *  into Keynote or opens in Preview at the size it had on screen, like the ones macOS takes. */
export function withScale(png: Uint8Array, scale: number): Buffer {
  const src = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  const ppm = Math.round(scale * 72 / 0.0254) // pixels per meter: 2x = 144 dpi = 5669
  const body = Buffer.alloc(13)
  body.write('pHYs', 0, 'latin1')
  body.writeUInt32BE(ppm, 4)
  body.writeUInt32BE(ppm, 8)
  body.writeUInt8(1, 12) // unit: meter
  const len = Buffer.alloc(4)
  len.writeUInt32BE(9)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  const chunks: Buffer[] = [src.subarray(0, 8)]
  for (let i = 8; i + 12 <= src.length; ) {
    const n = src.readUInt32BE(i)
    const type = src.toString('latin1', i + 4, i + 8)
    if (type !== 'pHYs') chunks.push(src.subarray(i, i + 12 + n))
    if (type === 'IHDR') chunks.push(len, body, crc)
    i += 12 + n
  }
  return Buffer.concat(chunks)
}

/** A PNG's pixel size and density as a display scale (its pHYs chunk: 144 dpi is 2x, as withScale and macOS
 *  write it; none is 1x), or null when `png` is no PNG. */
export function pngInfo(png: Uint8Array): { width: number; height: number; scale: number } | null {
  const b = Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null
  let dpi = 72
  for (let i = 8; i + 12 <= b.length; ) {
    const n = b.readUInt32BE(i)
    const type = b.toString('latin1', i + 4, i + 8)
    if (type === 'pHYs' && n === 9 && b[i + 16] === 1) dpi = b.readUInt32BE(i + 8) * 0.0254
    if (type === 'IDAT') break // pHYs comes before the pixels
    i += 12 + n
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), scale: Math.min(Math.max(Math.round((dpi / 72) * 100) / 100, 1), 4) }
}

/** The menu bar's export ring, `px` pixels square on the 18 pt icon grid: a faint track, the done part
 *  from 12 o'clock clockwise with round ends, and the record dot of the app mark inside. Raw BGRA,
 *  black with alpha, for a template image (macOS tints it like the menu bar's own icons). */
export function ring(px: number, progress: number): Buffer {
  const k = px / 18
  const c = 9 * k, r = 7.25 * k, half = 0.85 * k, dot = 2.6 * k // the idle icon's stroke and dot
  const end = Math.min(Math.max(progress, 0), 1) * 2 * Math.PI
  const at = (a: number) => [c + r * Math.sin(a), c - r * Math.cos(a)]
  const [ax, ay] = at(0)
  const [bx, by] = at(end)
  const out = Buffer.alloc(px * px * 4)
  const n = 4 // 4x4 samples a pixel smooth the edges
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      let cover = 0
      for (let i = 0; i < n * n; i++) {
        const sx = x + ((i % n) + 0.5) / n, sy = y + (Math.floor(i / n) + 0.5) / n
        const d = Math.hypot(sx - c, sy - c)
        const track = Math.abs(d - r) <= half
        const angle = (Math.atan2(sx - c, c - sy) + 2 * Math.PI) % (2 * Math.PI) // 0 at 12 o'clock, clockwise
        const done = end > 0 && ((track && angle <= end) || Math.hypot(sx - ax, sy - ay) <= half || Math.hypot(sx - bx, sy - by) <= half)
        cover += d <= dot || done ? 1 : track ? 0.3 : 0
      }
      out[(y * px + x) * 4 + 3] = Math.round((cover / (n * n)) * 255)
    }
  }
  return out
}
