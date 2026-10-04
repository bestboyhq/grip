// Wallpaper thumbnails for the inspector, rendered by the real compositor so they show exactly
// what export draws. Separate from ./index.ts so the wallpaper data stays free of GPU code.

import { Renderer } from '../gpu/renderer.ts'
import { WALLPAPERS } from './index.ts'

let thumbs: Promise<Map<string, string>> | undefined

/** Wallpaper id -> thumbnail object URL (PNG). Rendered once, then cached. */
export function wallpaperThumbnails(width = 192, height = 120): Promise<Map<string, string>> {
  return (thumbs ??= (async () => {
    const canvas = new OffscreenCanvas(width, height)
    const r = await Renderer.create(canvas, (rel) => rel)
    const out = new Map<string, string>()
    try {
      for (const w of WALLPAPERS) {
        await r.draw(Renderer.backgroundScene({ kind: 'wallpaper', id: w.id }, width, height), { screen: null, camera: null })
        out.set(w.id, URL.createObjectURL(await canvas.convertToBlob()))
      }
    } finally {
      r.destroy()
    }
    return out
  })().catch((e) => {
    thumbs = undefined // let the inspector retry
    throw e
  }))
}
