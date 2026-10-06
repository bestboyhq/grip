import type { Wallpaper } from './index.ts'

/** Look of a waves wallpaper (src/engine/gpu/wallpapers/waves.wgsl). Angles in degrees. */
export interface Waves {
  /** Layer frame: straight bands, concentric rings (layer offsets are radii, sheets fill
   *  outward), rays from the center, a spiral curl, or a dome (rings whose sheets fill inward). */
  mode?: 'ribbons' | 'rings' | 'rays' | 'spiral' | 'dome'
  /** Flow direction: 0 sweeps left to right, positive turns clockwise. In the round modes it aims
   *  angle 0, whose opposite is the seam, so point it into the frame. */
  flow: number
  seed: number
  /** Wave frequency in cycles per unit along the flow. */
  freq: number
  /** Center of the round modes: frame-relative inside the frame, longer-side units past an edge. */
  center?: [x: number, y: number]
  /** Below 0 folds curves into flat facets with soft creases (-1 = fully folded). */
  shape?: number
  /** Thin strands per layer instead of one band; a negative layer width makes glowing threads. */
  strands?: number
  /** Below 1 the bands are glass: the layers behind show through. */
  opacity?: number
  /** Bands swell and close over this length along the flow (petals, tongues). */
  taper?: number
  /** Rings, dome: arc length per radian. Rays: petal count. Spiral: pitch per turn. */
  scale?: number
  /** Light direction: 0 from the right, 90 from below, -90 from above. */
  light?: number
  gloss?: number
  /** Bulge across each band's width. */
  curl?: number
  shadow?: number
  /** Ramp travel along the flow. */
  drift?: number
  /** Edge softness of the backmost layer. */
  blur?: number
  twist?: number
  /** Backmost layer's fade toward the background. */
  haze?: number
  glow?: [x: number, y: number, r: number]
  /** Background gradient direction, 0 = top to bottom. */
  bgAngle?: number
}

/** A layer, back to front (at most 6): offset across the flow, amplitude, width, ramp position.
 *  Width < 0 is a light streak that thick; width >= 1 is a sheet filling everything below the
 *  curve. Offsets and widths are fractions of the longer side. */
export type Layer = [offset: number, amp: number, width: number, t: number]

const MODES = ['ribbons', 'rings', 'rays', 'spiral', 'dome']

/** Colors: background start, end, glow, then the ramp the layers sample (at least one). */
export function waves(collection: string, id: string, name: string, colors: string[], w: Waves, layers: Layer[]): Wallpaper {
  const g = w.glow ?? [0.5, 0.5, 0]
  const c = w.center ?? [0.5, 0.5]
  return {
    id, name, collection, style: 'waves', colors,
    params: [
      w.flow, w.seed, layers.length, w.freq,
      w.light ?? -125, w.gloss ?? 1, w.curl ?? 0.5, w.shadow ?? 0.5,
      w.drift ?? 0.3, w.blur ?? 0.004, w.twist ?? 0.5, w.haze ?? 0.2,
      ...g, w.bgAngle ?? 0,
      MODES.indexOf(w.mode ?? 'ribbons'), ...c, w.shape ?? 0,
      w.strands ?? 0, w.opacity ?? 1, w.taper ?? 0, w.scale ?? 0.5,
      ...layers.flat(),
    ],
  }
}

const r = (id: string, name: string, colors: string[], w: Waves, layers: Layer[]) => waves('Radiant', id, name, colors, w, layers)

// Luminous pink, violet, blue, and teal glow, in seven motifs: satin ribbons, concentric rings,
// glass petals, a spiral curl, fiber strands, domes and crests, and folded paper.
export const RADIANT: Wallpaper[] = [
  // Ribbons
  r('radiant-aureole', 'Aureole', ['#f7f0ff', '#d9ccff', '#ffffff', '#9a6bff', '#d77bff', '#ff9bd4', '#ffe0f2'], { flow: -28, seed: 1, freq: 0.7, glow: [0.15, 0.15, 0.45], twist: 0.6 }, [
    [-0.3, 0.08, 0.2, 0.05],
    [-0.08, 0.1, 0.15, 0.4],
    [0.14, 0.09, 0.2, 0.7],
    [0.36, 0.07, 0.26, 0.95],
  ]),
  r('radiant-orchid', 'Orchid', ['#1b0630', '#3d0b55', '#a02bd6', '#4a1080', '#9b2fd8', '#e044c8', '#ff8ad8', '#ffd0f0'], { flow: -38, seed: 7, freq: 0.5, twist: 1.5, gloss: 1.3, glow: [0.1, 0.9, 0.4], shadow: 0.7 }, [
    [-0.36, 0.05, 0.18, 0.1],
    [-0.12, 0.07, 0.14, 0.45],
    [-0.02, 0.07, -0.0018, 0.95],
    [0.12, 0.08, 0.16, 0.7],
    [0.34, 0.05, 0.2, 0.9],
  ]),
  r('radiant-undertow', 'Undertow', ['#032a33', '#062d4f', '#1ec8c8', '#0b5c7a', '#0f9bb0', '#36d6c8', '#9cf2e6', '#6a8cff'], { flow: -12, seed: 9, freq: 0.75, gloss: 1.2, twist: 0.8, glow: [0.2, 0.1, 0.35] }, [
    [-0.34, 0.05, 0.14, 0.1],
    [-0.16, 0.06, 0.12, 0.4],
    [0.0, 0.07, 0.12, 0.7],
    [0.16, 0.06, 0.14, 0.95],
    [0.34, 0.05, 0.16, 0.55],
  ]),
  r('radiant-velvet', 'Velvet', ['#1a0414', '#3d0a2c', '#ff3d8a', '#5a0d3a', '#b8195e', '#ff4f8f', '#ff9ec0'], { flow: 32, seed: 13, freq: 0.45, gloss: 1.5, curl: 0.8, shadow: 0.8, glow: [0.85, 0.85, 0.35] }, [
    [-0.28, 0.07, 0.3, 0.15],
    [0.0, 0.09, 0.26, 0.5],
    [0.28, 0.08, 0.32, 0.85],
  ]),
  r('radiant-frostlight', 'Frostlight', ['#f2fbff', '#d6ecff', '#ffffff', '#4fb8ff', '#8fb0ff', '#a8ecff', '#e8f6ff'], { flow: 62, seed: 17, freq: 0.55, gloss: 1, curl: 0.4, twist: 0.9, shadow: 0.4 }, [
    [-0.3, 0.06, 0.12, 0.2],
    [-0.1, 0.08, 0.1, 0.6],
    [0.1, 0.08, 0.12, 0.0],
    [0.3, 0.06, 0.14, 0.85],
  ]),

  // Rings: concentric glossy bands radiating from a corner.
  r('radiant-reef', 'Reef', ['#eaf4ff', '#ffe6f4', '#ffffff', '#3a5cff', '#3d8cff', '#22c4d8', '#ff7ac4', '#ffc4e6'], { mode: 'rings', center: [0, 1], flow: -45, seed: 4, freq: 1.4, gloss: 1.3, curl: 0.8, shadow: 0.5, twist: 1.4, light: 135, blur: 0.001, glow: [0.9, 0.1, 0.5] }, [
    [0.3, 0.012, 0.05, 0.0],
    [0.44, 0.015, 0.06, 0.25],
    [0.58, 0.018, 0.06, 0.5],
    [0.72, 0.02, 0.07, 0.75],
    [0.87, 0.02, 0.08, 1],
  ]),
  r('radiant-bloom', 'Bloom', ['#fff0f6', '#ffd9ea', '#ffffff', '#ff3d86', '#ff6fa6', '#ffa2c0', '#c48cff', '#fff0f6'], { mode: 'rings', center: [1.05, 1.1], flow: -135, seed: 5, freq: 1.6, gloss: 1.1, curl: 0.8, shadow: 0.5, twist: 1.2, glow: [0.15, 0.1, 0.5] }, [
    [0.35, 0.02, 0.07, 0.1],
    [0.5, 0.025, 0.08, 0.3],
    [0.65, 0.03, 0.09, 0.5],
    [0.8, 0.03, 0.1, 0.7],
    [0.95, 0.035, 0.11, 0.9],
  ]),
  r('radiant-cosmos', 'Cosmos', ['#04061a', '#140a36', '#5b2cff', '#1a1f8a', '#3a4cff', '#8a4cff', '#e05cff', '#ff9ae0'], { mode: 'rings', center: [1.0, 0.0], flow: 135, seed: 127, freq: 1.4, gloss: 1.5, curl: 0.8, twist: 1.3, shadow: 0.8, light: -45, blur: 0.001, glow: [0.85, 0.15, 0.4] }, [
    [0.3, 0.01, -0.0016, 0.9],
    [0.42, 0.015, 0.06, 0.2],
    [0.55, 0.012, -0.0012, 1],
    [0.66, 0.018, 0.07, 0.55],
    [0.8, 0.015, -0.0018, 0.8],
    [0.92, 0.02, 0.08, 0.85],
  ]),

  // Petals: translucent glass petals fanning out from one point.
  r('radiant-camellia', 'Camellia', ['#fff2f6', '#ffdce8', '#ffffff', '#e8306e', '#ff5c93', '#ff9cc0', '#ffe1ea'], { mode: 'rays', center: [0.5, 1.12], flow: -90, seed: 41, freq: 0.8, scale: 7, taper: 1.1, opacity: 0.8, gloss: 1.4, curl: 0.7, twist: 1, shadow: 0.5, blur: 0.0015, glow: [0.5, 1, 0.5] }, [
    [-0.08, 0.02, 0.2, 0.3],
    [0.12, 0.02, 0.17, 0.6],
    [0.02, 0.015, 0.12, 0.9],
  ]),
  r('radiant-amethyst', 'Amethyst', ['#120626', '#2a0a4a', '#8a3cff', '#4a1aa8', '#7a3cf0', '#c05cff', '#ff8ad8', '#ffd0f0'], { mode: 'rays', center: [-0.05, 0.5], flow: 0, seed: 21, freq: 0.7, scale: 11, taper: 1.3, opacity: 0.5, gloss: 1.5, curl: 0.7, shadow: 0.4, glow: [0.0, 0.5, 0.45] }, [
    [-0.04, 0.02, 0.16, 0.1],
    [0.09, 0.02, 0.14, 0.45],
    [0.0, 0.015, 0.1, 0.8],
  ]),
  r('radiant-lumen', 'Lumen', ['#eef6ff', '#dcd4ff', '#ffffff', '#2a8cff', '#46c8e8', '#8a7cff', '#d08cff'], { mode: 'rays', center: [1.04, -0.06], flow: 135, seed: 61, freq: 0.6, scale: 7, taper: 1.5, opacity: 0.6, gloss: 1.2, curl: 0.6, shadow: 0.4, glow: [1, 0, 0.5] }, [
    [-0.08, 0.02, 0.26, 0.15],
    [0.12, 0.02, 0.22, 0.55],
    [0.02, 0.015, 0.14, 0.95],
  ]),

  // Curl: one huge twisted ribbon spiraling in from the frame edge.
  r('radiant-seraph', 'Seraph', ['#f3eaff', '#d8c8ff', '#ffffff', '#5b3fe0', '#9b6bff', '#ff8fd8', '#ffe6f6'], { mode: 'spiral', center: [1.15, 0.55], flow: 180, seed: 103, freq: 0.5, scale: 0.4, twist: 1.5, gloss: 1.4, curl: 0.7, shadow: 0.55, blur: 0.0015, glow: [0.2, 0.3, 0.5] }, [
    [0.32, 0.02, 0.2, 0.15],
    [0.6, 0.02, 0.26, 0.55],
    [0.8, 0.01, -0.0016, 1],
    [0.92, 0.02, 0.12, 0.85],
  ]),
  r('radiant-cascade', 'Cascade', ['#140a3e', '#2a1468', '#ff8cc6', '#3b3fd8', '#6e5cff', '#c46cff', '#ff7cbf', '#ffd0e8'], { mode: 'spiral', center: [-0.02, 1.02], flow: -45, seed: 83, freq: 0.6, scale: 0.6, twist: 1.3, gloss: 1.4, curl: 0.6, shadow: 0.7, glow: [0.0, 1.0, 0.5] }, [
    [0.3, 0.02, 0.26, 0.15],
    [0.5, 0.015, -0.0018, 1],
    [0.62, 0.02, 0.16, 0.6],
  ]),
  r('radiant-riviera', 'Riviera', ['#0b2a6e', '#1a6ac0', '#7ff0ff', '#1f4fd8', '#2a9cff', '#3ad8e0', '#ff8ccf', '#ffd8ee'], { mode: 'spiral', center: [0.5, -0.08], flow: 90, seed: 139, freq: 0.5, scale: 0.35, twist: 1.6, gloss: 1.3, curl: 0.6, shadow: 0.6, glow: [0.5, 0.0, 0.5] }, [
    [0.32, 0.015, 0.2, 0.25],
    [0.55, 0.02, 0.16, 0.75],
  ]),

  // Strands: a tight bundle of fine threads.
  r('radiant-nebula', 'Nebula', ['#05030f', '#120a2e', '#3b1d8a', '#3a2bd0', '#7a3cf0', '#d14de0', '#ff7ab8', '#ffffff'], { flow: -20, seed: 3, freq: 0.6, strands: 18, glow: [0.7, 0.3, 0.5], blur: 0.001 }, [
    [-0.06, 0.1, -0.22, 0.3],
    [0.05, 0.12, -0.14, 0.8],
  ]),
  r('radiant-starlight', 'Starlight', ['#03040c', '#0a1238', '#1a4aa8', '#4a7cff', '#5ad8ff', '#a88cff', '#ffd0f0'], { flow: 75, seed: 131, freq: 0.45, strands: 16, glow: [0.2, 0.8, 0.5], blur: 0.001 }, [
    [-0.3, 0.12, -0.12, 0.2],
    [0.32, 0.1, -0.1, 0.8],
  ]),
  r('radiant-pearl', 'Pearl', ['#f7f2fb', '#e6ddf6', '#ffffff', '#b9a4ff', '#e7b8f2', '#a9d8ff', '#fbefff'], { flow: 30, seed: 31, freq: 0.5, strands: 14, curl: 1, gloss: 1.3, shadow: 0.5, drift: 0.6, glow: [0.8, 0.2, 0.5] }, [
    [-0.16, 0.12, 0.3, 0.2],
    [0.18, 0.1, 0.26, 0.7],
  ]),

  // Domes and crests: concentric swells rising from an edge, or one wave arching overhead.
  r('radiant-gloaming', 'Gloaming', ['#160a3a', '#5a1460', '#ff4fa0', '#2a1a8a', '#6a2ad0', '#d8309a', '#ff6fa8', '#ffb0c8'], { mode: 'dome', center: [0.5, 1.25], flow: -90, seed: 113, freq: 0.9, scale: 0.6, gloss: 1.3, curl: 0.3, shadow: 0.85, twist: 0.6, blur: 0.0008, glow: [0.5, 1, 0.6] }, [
    [-1.08, 0.01, 1, 0.0],
    [-0.92, 0.01, 1, 0.3],
    [-0.77, 0.008, 1, 0.6],
    [-0.63, 0.006, 1, 0.85],
    [-0.5, 0.005, 1, 1],
  ]),
  r('radiant-lumina', 'Lumina', ['#1a1050', '#4a2a9a', '#56e0d0', '#1d6fa0', '#22b8c8', '#6a8cff', '#a77bff', '#ff9ad6'], { mode: 'rings', center: [0.5, -0.9], flow: 90, seed: 97, freq: 1.1, scale: 1, gloss: 1.4, curl: 0.6, twist: 0.8, shadow: 0.8, drift: 0.5, glow: [0.5, 0.0, 0.6] }, [
    [1.0, 0.03, 0.1, 0.0],
    [1.12, 0.035, -0.0018, 1],
    [1.2, 0.04, 0.12, 0.35],
    [1.34, 0.045, 0.14, 0.7],
    [1.46, 0.03, -0.0016, 0.9],
    [1.55, 0.05, 1, 0.55],
  ]),
  r('radiant-opal', 'Opal', ['#eaf7ff', '#f4e6ff', '#ffffff', '#36b8c8', '#5ad8d0', '#8cb4ff', '#c79cff', '#ffb0dc'], { mode: 'dome', center: [1.12, 0.5], flow: 180, seed: 53, freq: 1.0, scale: 0.7, gloss: 1.1, curl: 0.3, twist: 0.6, drift: 0.7, shadow: 0.5, blur: 0.0008, glow: [1, 0.5, 0.5] }, [
    [-1.05, 0.01, 1, 0.0],
    [-0.88, 0.01, 1, 0.3],
    [-0.72, 0.008, 1, 0.6],
    [-0.56, 0.006, 1, 0.95],
  ]),

  // Folds: creased paper sheets with flat lit facets.
  r('radiant-spectra', 'Spectra', ['#e4ecff', '#ffe0f0', '#ffffff', '#6f9cff', '#a88cff', '#ff8cc6', '#ffc9a8'], { flow: -20, seed: 11, freq: 0.9, shape: -1, curl: 0.2, gloss: 0.9, twist: 0, shadow: 0.5, blur: 0.002 }, [
    [-0.28, 0.08, 1, 0.0],
    [-0.1, 0.09, 1, 0.35],
    [0.08, 0.1, 1, 0.65],
    [0.26, 0.08, 1, 0.95],
  ]),
  r('radiant-candy', 'Candy', ['#3aa0ff', '#ff8ad0', '#ffffff', '#2f6bff', '#45c8ff', '#ff5fb8', '#ffd0ec'], { flow: 50, seed: 71, freq: 1.1, shape: -1, curl: 0.3, gloss: 1.1, twist: 0, shadow: 0.6, blur: 0.002 }, [
    [-0.32, 0.06, 0.22, 0.95],
    [-0.04, 0.07, 0.24, 0.6],
    [0.24, 0.06, 0.22, 0.1],
  ]),
]
