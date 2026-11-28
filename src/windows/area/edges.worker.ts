// Owner: capture. edges() (./measure.ts) off the main thread: a 5K screen's pixels take about 20 ms,
// more with a busy wallpaper, and the picker must stay smooth while it opens.
import { edges } from './measure.ts'
import type { Pixels } from './beyond.ts'

self.onmessage = ({ data }: MessageEvent<{ id: number; px: Pixels }>) => {
  const e = edges(data.px)
  postMessage({ id: data.id, edges: e }, { transfer: [e.h.buffer, e.v.buffer] })
}
