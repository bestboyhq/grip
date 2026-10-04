// GIF encoding off the export window's main thread, so rendering the next frame overlaps encoding
// this one. One reply per message, in order:
//   { start: { width, height, fps, loop } } -> { bytes: empty }
//   { frame: ArrayBuffer (RGBA) }           -> { bytes }
//   { finish: true }                        -> { bytes }
// Any failure replies { error }.
import { GifEncoder } from './gif.ts'

let enc: GifEncoder | null = null

self.onmessage = (e: MessageEvent) => {
  const m = e.data
  try {
    let bytes = new Uint8Array(0)
    if (m.start) enc = new GifEncoder(m.start.width, m.start.height, m.start.fps, m.start.loop)
    else if (m.frame) bytes = enc!.add(new Uint8Array(m.frame))
    else if (m.finish) bytes = enc!.finish()
    postMessage({ bytes }, { transfer: [bytes.buffer] })
  } catch (err) {
    postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
