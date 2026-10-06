// Owner: compositor. Built-in wallpapers: our own procedural artwork, rendered by the GPU
// compositor (shaders.wgsl fs_bg dispatches to src/engine/gpu/wallpapers/<style>.wgsl). Being
// procedural, each renders sharp at any output size and keeps its composition at 16:9, 9:16, and
// 1:1. Each collection lives in its own file; a wallpaper is a style plus a palette and parameters.

import { SOFT } from './soft.ts'
import { SPRING } from './spring.ts'
import { SUNSET } from './sunset.ts'
import { RADIANT } from './radiant.ts'
import { ENERGY } from './energy.ts'
import { IRIDESCENT } from './iridescent.ts'
import { MIDNIGHT } from './midnight.ts'
import { NEON } from './neon.ts'

export interface Wallpaper {
  id: string
  name: string
  /** Inspector group, in WALLPAPERS order. */
  collection: string
  /** Shader src/engine/gpu/wallpapers/<style>.wgsl, entry fn wp_<style>(uv, wh) -> encoded sRGB. */
  style: string
  /** sRGB hex palette, at most 12. The shader reads them as OKLab in P.cols, count in P.a.y. */
  colors: string[]
  /** Style parameters, at most 48 numbers. The shader reads them as P.pts (12 vec4f). */
  params: number[]
}

export const DEFAULT_WALLPAPER = 'dusk'

export const WALLPAPERS: Wallpaper[] = [...SOFT, ...SPRING, ...SUNSET, ...RADIANT, ...ENERGY, ...IRIDESCENT, ...MIDNIGHT, ...NEON]

/** The wallpaper for an id, or the default for unknown ids (projects from newer versions). */
export function wallpaper(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]
}

/** CSS color -> sRGB 0..1 with alpha. Hex and rgb() natively; any other CSS color through the
 *  platform's parser where a canvas exists. Unparseable -> null. */
export function parseColor(css: string): [number, number, number, number] | null {
  const s = css.trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(s)
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join('') : m[1]
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1]
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s)
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]
    return [+m[1] / 255, +m[2] / 255, +m[3] / 255, Math.min(Math.max(a, 0), 1)].map((v) => Math.min(Math.max(v, 0), 1)) as [number, number, number, number]
  }
  if (typeof OffscreenCanvas === 'undefined') return null
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!
  ctx.fillStyle = '#010203'
  ctx.fillStyle = s
  const norm = String(ctx.fillStyle)
  return norm === '#010203' && s.toLowerCase() !== '#010203' ? null : parseColor(norm)
}

/** sRGB (0..1, gamma encoded) -> OKLab. */
export function oklab([r, g, b]: readonly number[]): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
