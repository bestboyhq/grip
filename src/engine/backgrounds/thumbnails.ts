// Wallpaper thumbnails for the inspector, rendered by the real compositor so they show exactly
// what export draws. Separate from ./index.ts so the wallpaper data stays free of GPU code.

import { Renderer } from '../gpu/renderer.ts'

const cache = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()
let session: { canvas: OffscreenCanvas; renderer: Promise<Renderer>; pending: number } | undefined

/** Thumbnail object URL (PNG) of a wallpaper at width x height px, rendered on first request, then
 *  cached. Callers ask only for what they show, so ~170 wallpapers cost nothing until browsed.
 *  Renders run one at a time on one renderer, released once the queue drains. */
export function wallpaperThumbnail(id: string, width: number, height: number): Promise<string> {
  const key = `${id} ${width}x${height}`
  let url = cache.get(key)
  if (!url) {
    url = render(id, width, height)
    url.catch(() => cache.delete(key)) // let the inspector retry
    cache.set(key, url)
  }
  return url
}

function render(id: string, width: number, height: number): Promise<string> {
  if (!session) {
    const canvas = new OffscreenCanvas(width, height)
    session = { canvas, renderer: Renderer.create(canvas, (rel) => rel), pending: 0 }
  }
  const s = session
  s.pending++
  const job = queue.then(async () => {
    try {
      const r = await s.renderer
      await r.draw(Renderer.backgroundScene({ kind: 'wallpaper', id }, width, height), { screen: null, camera: null })
      return URL.createObjectURL(await s.canvas.convertToBlob())
    } finally {
      if (!--s.pending) {
        if (session === s) session = undefined
        s.renderer.then((r) => r.destroy(), () => {})
      }
    }
  })
  queue = job.catch(() => {})
  return job
}
