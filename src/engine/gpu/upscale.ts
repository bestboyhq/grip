// Owner: compositor. Where the UI-text upscaler (upscale.wgsl, trained by scripts/upscale/train.py) runs on a
// frame: the part of the recording the frame shows past its pixel density, and how much denser to redraw it.
// Pure, so preview and export redraw the same region the same way.

import type { Loupe, Scene } from '../scene.ts'
import weights from './upscale.json' with { type: 'json' }

/** One 3x3 layer as upscale.wgsl reads it: channel groups of 4 in and out, mat4x4 columns per tap, biases. */
export interface UpLayer {
  in: number
  out: number
  w: number[]
  b: number[]
}

/** The networks by how many times denser they redraw. */
export const MODELS: Record<number, UpLayer[]> = Object.fromEntries(Object.entries(weights as Record<string, { layers: UpLayer[] }>).map(([k, v]) => [Number(k), v.layers]))

/** Source px per output px under which the redraw shows (UP_FROM in shaders.wgsl). */
export const UP_FROM = 1
const MAX_SIDE = 8192 // WebGPU's default texture size limit
// ponytail: one region and one scale a frame, so a 4x lens over a wide 2x zoom redraws all of it at 4x; past this
// many texels it drops to 2x. Separate regions per lens if 4K exports with lenses need the 4x.
const MAX_TEXELS = 48e6

export interface UpRegion {
  /** Recording px the passes run over. */
  x: number
  y: number
  w: number
  h: number
  /** Output px per recording px of the redraw. */
  scale: number
  /** Recording px where the redraw holds: the region less what reads past its edge, except at the recording's own. */
  valid: [number, number, number, number]
}

/** The region of a recording of srcW x srcH px to redraw for `scene`, with the lenses' shutter samples; null when
 *  the frame shows none of it past its density. */
export function upRegion(scene: Scene, srcW: number, srcH: number, lensPaths: Loupe[][] = []): UpRegion | null {
  const s = scene.screen
  if (!s || s.rect.w <= 0 || s.rect.h <= 0 || srcW <= 0 || srcH <= 0) return null
  const kx = srcW / s.rect.w, ky = srcH / s.rect.h // recording px per unzoomed px
  const v = s.visible
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, m = Infinity
  // Unzoomed px [ax, bx] x [ay, by] shown at `px` recording px per output px.
  const need = (ax: number, ay: number, bx: number, by: number, px: number) => {
    ax = Math.max(ax, v.x), ay = Math.max(ay, v.y), bx = Math.min(bx, v.x + v.w), by = Math.min(by, v.y + v.h)
    if (px >= UP_FROM || ax >= bx || ay >= by) return
    x0 = Math.min(x0, ax), y0 = Math.min(y0, ay), x1 = Math.max(x1, bx), y1 = Math.max(y1, by)
    m = Math.min(m, px)
  }
  const { center: c, scale: z } = scene.view
  const vp = s.viewport
  const unview = (p: number, half: number, center: number) => (p - half) / z + center
  const view = kx / z // m in screenAt: recording px per output px
  need(unview(vp.x, scene.width / 2, c.x), unview(vp.y, scene.height / 2, c.y), unview(vp.x + vp.w, scene.width / 2, c.x), unview(vp.y + vp.h, scene.height / 2, c.y), view)
  for (const l of [...scene.loupes, ...lensPaths.flat()]) {
    if (l.radius <= 0 || l.scale <= 0) continue
    const r = l.radius * (1 + Math.hypot(l.stretch.x, l.stretch.y)) // a Liquid lens stretches along its motion
    need(l.x - r, l.y - r, l.x + r, l.y + r, view / Math.max(l.scale, 1))
  }
  if (!(m < UP_FROM)) return null

  const fit = (scale: number): UpRegion | null => {
    const layers = MODELS[scale]
    if (!layers) return null
    const reach = layers.length + 1 // each 3x3 layer reads a px further, the bilinear tap one more
    const pad = reach + 4 // and a few for click ripples, which bend the samples a little
    const rx0 = Math.max(0, Math.floor((x0 - s.rect.x) * kx) - pad), ry0 = Math.max(0, Math.floor((y0 - s.rect.y) * ky) - pad)
    const rx1 = Math.min(srcW, Math.ceil((x1 - s.rect.x) * kx) + pad), ry1 = Math.min(srcH, Math.ceil((y1 - s.rect.y) * ky) + pad)
    const w = rx1 - rx0, h = ry1 - ry0
    if (w <= 0 || h <= 0 || w * scale > MAX_SIDE || h * scale > MAX_SIDE || w * h * scale * scale > MAX_TEXELS) return null
    const valid: UpRegion['valid'] = [rx0 > 0 ? rx0 + reach : 0, ry0 > 0 ? ry0 + reach : 0, rx1 < srcW ? rx1 - reach : srcW, ry1 < srcH ? ry1 - reach : srcH]
    return { x: rx0, y: ry0, w, h, scale, valid }
  }
  return (m < 0.5 ? fit(4) : null) ?? fit(2)
}
