// Owner: compositor. Built-in wallpapers: our own procedural mesh gradients, rendered by the GPU
// compositor (shaders.wgsl fs_bg). Each is a few soft color points blended in OKLab (no muddy
// midtones) over a gently warped plane. Positions are frame-relative and distances
// aspect-corrected, so a wallpaper keeps its composition at 16:9, 9:16, and 1:1.

export interface Wallpaper {
  id: string
  name: string
  /** Mesh points: frame-relative x, y (0..1), radius (fraction of the longer side), sRGB hex. */
  points: Array<[number, number, number, string]>
  warp: number // domain warp strength; 0 = straight gradient fields
  seed: number // warp phase, so similar palettes still flow differently
}

export const DEFAULT_WALLPAPER = 'dusk'

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'dusk',
    name: 'Dusk',
    warp: 0.1,
    seed: 1.3,
    points: [
      [0.08, 0.05, 0.42, '#160f3a'],
      [0.62, 0.08, 0.4, '#2e1a63'],
      [0.98, 0.3, 0.32, '#5b2a8c'],
      [0.3, 0.62, 0.36, '#6a2a86'],
      [0.82, 0.86, 0.34, '#f0627a'],
      [0.48, 1.02, 0.3, '#ff9d5c'],
      [0.02, 0.98, 0.34, '#241450'],
    ],
  },
  {
    id: 'dawn',
    name: 'Dawn',
    warp: 0.12,
    seed: 2.1,
    points: [
      [0.05, 0.1, 0.4, '#ffd9bf'],
      [0.55, 0.0, 0.38, '#ffc1d3'],
      [0.98, 0.25, 0.36, '#d5c2ff'],
      [0.3, 0.7, 0.4, '#ffb3a7'],
      [0.85, 0.9, 0.38, '#c7b8ff'],
      [0.1, 1.0, 0.3, '#ffe6c9'],
    ],
  },
  {
    id: 'aurora',
    name: 'Aurora',
    warp: 0.16,
    seed: 0.4,
    points: [
      [0.1, 0.1, 0.45, '#051320'],
      [0.9, 0.08, 0.36, '#0a1d3a'],
      [0.35, 0.42, 0.24, '#14c9a4'],
      [0.62, 0.5, 0.22, '#5be39a'],
      [0.85, 0.62, 0.28, '#6a43e8'],
      [0.15, 0.85, 0.36, '#071a2a'],
      [0.7, 1.0, 0.36, '#0b1630'],
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    warp: 0.11,
    seed: 3.7,
    points: [
      [0.0, 0.0, 0.42, '#041f4a'],
      [0.6, 0.12, 0.38, '#0d4fb0'],
      [1.0, 0.45, 0.34, '#2a8ff0'],
      [0.35, 0.75, 0.38, '#0a3477'],
      [0.85, 0.95, 0.3, '#48cfff'],
      [0.05, 1.0, 0.3, '#03132f'],
    ],
  },
  {
    id: 'forest',
    name: 'Forest',
    warp: 0.13,
    seed: 5.2,
    points: [
      [0.05, 0.05, 0.42, '#0a2219'],
      [0.7, 0.1, 0.36, '#164d36'],
      [1.0, 0.55, 0.3, '#2c8a5c'],
      [0.4, 0.6, 0.34, '#123d2b'],
      [0.75, 0.95, 0.3, '#9bd96b'],
      [0.1, 0.95, 0.32, '#0e2e22'],
    ],
  },
  {
    id: 'ember',
    name: 'Ember',
    warp: 0.12,
    seed: 4.4,
    points: [
      [0.05, 0.05, 0.42, '#170607'],
      [0.65, 0.05, 0.36, '#4a0b16'],
      [0.95, 0.4, 0.32, '#b3162f'],
      [0.35, 0.7, 0.34, '#6b0f1e'],
      [0.8, 0.92, 0.3, '#ff6a2b'],
      [0.45, 1.05, 0.24, '#ffbe5c'],
    ],
  },
  {
    id: 'lavender',
    name: 'Lavender',
    warp: 0.1,
    seed: 2.9,
    points: [
      [0.05, 0.1, 0.42, '#ece6ff'],
      [0.6, 0.05, 0.36, '#c9b8ff'],
      [1.0, 0.45, 0.36, '#f3cdfa'],
      [0.3, 0.7, 0.38, '#b7a6f5'],
      [0.85, 0.95, 0.34, '#dde8ff'],
    ],
  },
  {
    id: 'citrus',
    name: 'Citrus',
    warp: 0.14,
    seed: 6.1,
    points: [
      [0.05, 0.05, 0.4, '#fff27a'],
      [0.65, 0.1, 0.36, '#ffc23d'],
      [1.0, 0.5, 0.32, '#ff9e3d'],
      [0.3, 0.7, 0.36, '#b9e86a'],
      [0.85, 0.95, 0.34, '#ffe08a'],
    ],
  },
  {
    id: 'graphite',
    name: 'Graphite',
    warp: 0.08,
    seed: 1.9,
    points: [
      [0.05, 0.05, 0.45, '#1b1d23'],
      [0.75, 0.15, 0.4, '#2a2e38'],
      [0.35, 0.7, 0.4, '#15171c'],
      [0.9, 0.9, 0.36, '#2b3550'],
    ],
  },
  {
    id: 'mist',
    name: 'Mist',
    warp: 0.09,
    seed: 3.1,
    points: [
      [0.05, 0.05, 0.45, '#f5f6f9'],
      [0.75, 0.15, 0.4, '#e2e6ee'],
      [0.35, 0.75, 0.4, '#eef0f5'],
      [0.95, 0.95, 0.36, '#d3d9e6'],
    ],
  },
  {
    id: 'rose',
    name: 'Rose',
    warp: 0.12,
    seed: 0.9,
    points: [
      [0.05, 0.05, 0.42, '#2d0818'],
      [0.6, 0.1, 0.36, '#7d1340'],
      [1.0, 0.45, 0.32, '#d42a6a'],
      [0.3, 0.75, 0.36, '#5a0d2e'],
      [0.85, 0.95, 0.32, '#ff8fb1'],
    ],
  },
  {
    id: 'sky',
    name: 'Sky',
    warp: 0.1,
    seed: 4.9,
    points: [
      [0.05, 0.05, 0.42, '#8ec5ff'],
      [0.7, 0.05, 0.38, '#b9dcff'],
      [1.0, 0.6, 0.34, '#a9b6ff'],
      [0.3, 0.75, 0.38, '#d9efff'],
      [0.8, 1.0, 0.3, '#f2f8ff'],
    ],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    warp: 0.12,
    seed: 5.8,
    points: [
      [0.05, 0.05, 0.45, '#04050a'],
      [0.7, 0.2, 0.32, '#111a45'],
      [0.25, 0.8, 0.3, '#2a1650'],
      [0.9, 0.9, 0.36, '#060912'],
      [0.5, 0.45, 0.4, '#070a18'],
    ],
  },
  {
    id: 'sand',
    name: 'Sand',
    warp: 0.1,
    seed: 2.4,
    points: [
      [0.05, 0.05, 0.42, '#f6e9d2'],
      [0.7, 0.1, 0.38, '#ecd0a8'],
      [1.0, 0.6, 0.34, '#dba887'],
      [0.3, 0.75, 0.38, '#f1dcbc'],
      [0.85, 1.0, 0.3, '#fff5e6'],
    ],
  },
]

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
