// PNG metadata. Pure: no electron imports, so node:test can run it.
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
