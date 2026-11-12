// Thumbnails of one video for the timeline: the clips' filmstrip and the trim lens each keep their own.
// Decoded on their own decoder so the preview's is never disturbed, latest request first served, oldest evicted.

import { openVideo, type FrameSource } from '../../../engine/media/index.ts'

export class Frames {
  readonly url: string
  private src: Promise<FrameSource | null>
  private cache = new Map<number, ImageBitmap>() // by source millisecond
  private want: number[] = []
  private busy = false
  private closed = false
  private redraw: () => void
  private cap: number

  /** `cap`: bitmaps kept, about what a few screens of thumbnails hold. */
  constructor(url: string, redraw: () => void, cap: number) {
    this.url = url
    this.redraw = redraw
    this.cap = cap
    this.src = openVideo(url).catch((e) => {
      console.warn('timeline: frames unavailable:', e)
      return null
    })
  }

  get = (t: number) => this.cache.get(Math.round(t * 1000)) ?? null

  /** Decode these times, in order, dropping what an earlier call still wanted. */
  request(ts: number[], w: number, h: number) {
    this.want = ts.filter((t) => !this.cache.has(Math.round(t * 1000)))
    if (this.want.length) void this.pump(w, h)
  }

  private async pump(w: number, h: number) {
    if (this.busy) return
    this.busy = true
    const src = await this.src
    while (src && !this.closed && this.want.length) {
      const t = this.want.shift()!
      // ponytail: exact frames, each decoded from the keyframe before it; a keyframe-only decode would be
      // cheaper for thumbnails of a long recording zoomed out, if filling the strip ever feels slow.
      const f = await src.frameAt(t).catch(() => null)
      if (!f) continue
      try {
        const bmp = await createImageBitmap(f, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
        if (this.closed) bmp.close()
        else this.cache.set(Math.round(t * 1000), bmp)
      } finally {
        f.close()
      }
      // ponytail: FIFO eviction; the cap covers scrolling and zooming back and forth over what was seen.
      if (this.cache.size > this.cap) {
        const [k, old] = this.cache.entries().next().value!
        old.close()
        this.cache.delete(k)
      }
      this.redraw()
    }
    this.busy = false
  }

  close() {
    this.closed = true
    this.want = []
    void this.src.then((s) => s?.close())
    for (const b of this.cache.values()) b.close()
    this.cache.clear()
  }
}
