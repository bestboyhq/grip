import type { Wallpaper } from './index.ts'

/** Knobs of the silk style (src/engine/gpu/wallpapers/silk.wgsl). Angles in degrees. Lengths are
 *  fractions of the frame's longer side, measured in pattern space: s along the sheets, t across. */
export interface Silk {
  /** Sheets back to front (at most 5), each [edge offset t, slope, wave amplitude, wave frequency]. */
  sheets: Array<[number, number, number, number]>
  angle?: number
  seed?: number
  /** View perspective: how much the view angle (and with it the film hue) changes over the frame. */
  persp?: number
  /** Light azimuth (0 = from -t) and elevation. */
  light?: [number, number]
  spec?: number
  rough?: number
  /** Broad specular lobe: amount and roughness relative to the tight core. */
  broad?: [number, number]
  /** Fold spacing change along the sheets: folds fan out toward one side. */
  fan?: number
  /** Fold amplitude, frequency, skew (-1..1), cross folds. */
  fold?: [number, number, number, number]
  lip?: number
  gap?: number
  gapR?: number
  /** Brightness of the backmost sheet relative to the front one. */
  fade?: number
  /** Thin film amount, scale, phase, grazing sheen. */
  film?: [number, number, number, number]
  /** How much the specular takes the film color (default 0.7 x film amount). */
  specTint?: number
  ambient?: number
  exposure?: number
  /** Soft light on the void behind all sheets. */
  glow?: number
  crease?: number
}

export function silk(id: string, name: string, collection: string, colors: string[], o: Silk): Wallpaper {
  const rad = Math.PI / 180
  const [az, el] = o.light ?? [-30, 40]
  return {
    id, name, collection, style: 'silk', colors,
    params: [
      (o.angle ?? 0) * rad, o.seed ?? 0, o.sheets.length, o.persp ?? 0.6,
      az * rad, el * rad, o.spec ?? 0.4, o.rough ?? 0.14,
      ...(o.fold ?? [0.02, 12, 0.3, 0.2]),
      o.lip ?? 0.02, o.gap ?? 0.35, o.gapR ?? 0.05, o.fade ?? 1,
      ...(o.film ?? [0, 1, 0, 0]),
      o.ambient ?? 0.35, o.exposure ?? 1, o.glow ?? 0, o.crease ?? 1.5,
      ...(o.broad ?? [0.3, 3]), o.fan ?? 0, o.specTint ?? (o.film?.[0] ?? 0) * 0.7,
      ...o.sheets.flat(),
    ],
  }
}

const MODES = ['objects', 'brushed', 'water', 'stars', 'caustics', 'shell', 'film', 'pleats'] as const

/** Knobs of the lustre style (src/engine/gpu/wallpapers/lustre.wgsl); `a`, `b`, and `items` mean
 *  what that mode's comment says. Angles in degrees except inside `a`, `b`, `items`. */
export interface Lustre {
  mode: (typeof MODES)[number]
  seed?: number
  light?: [number, number]
  /** Thin film amount, thickness (um), variation; exposure. */
  film?: [number, number, number]
  exposure?: number
  /** Environment sky level, key light, key size, rim light. */
  env?: [number, number, number, number]
  a?: [number, number, number, number]
  b?: [number, number, number, number]
  /** At most 7. */
  items?: Array<[number, number, number, number]>
}

export function lustre(id: string, name: string, collection: string, colors: string[], o: Lustre): Wallpaper {
  const rad = Math.PI / 180
  const [az, el] = o.light ?? [-35, 50]
  return {
    id, name, collection, style: 'lustre', colors,
    params: [
      MODES.indexOf(o.mode), o.seed ?? 0, az * rad, el * rad,
      ...(o.film ?? [0, 0.4, 0.2]), o.exposure ?? 1,
      ...(o.env ?? [0.5, 2, 0.3, 0.5]),
      ...(o.a ?? [0, 0, 0, 0]), ...(o.b ?? [0, 0, 0, 0]),
      ...(o.items ?? []).flat(),
    ],
  }
}

const IRI = 'Iridescent'
const W = '#ffffff'
/** Bright studio environment for pearls, bubbles, and foil: white sky, soft key, faint rim. */
const STUDIO: [number, number, number, number] = [0.9, 1.6, 0.3, 0.5]

// Motifs: satin drapes, soap bubbles, pearls and drops, soap film macro, prism caustics, nacre shells.
export const IRIDESCENT: Wallpaper[] = [
  // Satin drapes
  silk('iridescent-nacre', 'Nacre', IRI, [W, '#f4f1f6', '#ffc6e4', '#d7c4ff', '#bfe9ff', '#c8f5e0', '#ffe2c8'], {
    angle: -18, seed: 1.2, lip: 0.22, sheets: [[-0.9, 0, 0, 3], [0.02, 0.1, 0.12, 2.6]],
    fold: [0.03, 17, 0.4, 0.15], film: [0.6, 1.1, 0, 0.3], light: [-35, 40], spec: 0.8, crease: 2.2, exposure: 0.96,
  }),
  silk('iridescent-chiffon', 'Chiffon', IRI, [W, '#fbf3f1', '#ffd3df', '#ffe6cc', '#f3d0ff', '#d8e6ff'], {
    angle: 88, seed: 2.7, lip: 0.05, fan: 0.9, sheets: [[-0.9, 0, 0, 3]],
    fold: [0.035, 30, 0.5, 0.1], film: [0.5, 1.2, 0.2, 0.3], light: [-40, 50], spec: 0.8, crease: 2,
  }),
  silk('iridescent-tulle', 'Tulle', IRI, [W, '#f6f3fa', '#e3d0ff', '#ffd2e8', '#cde6ff', '#d6f6ea'], {
    angle: -62, seed: 0.7, lip: 0.3, sheets: [[-0.9, 0, 0, 3], [0.1, 0.25, 0.06, 2]],
    fold: [0.035, 11, 0.4, 0.15], film: [0.65, 1, 0.3, 0.4], light: [-50, 40], spec: 1, crease: 2.5,
  }),
  silk('iridescent-halo', 'Halo', IRI, [W, '#f6f6f6', '#ffd4b5', '#ffbcd9', '#c8bcff', '#b2e3ff', '#bdf0d6'], {
    angle: 0, seed: 4.1, lip: 0.14, sheets: [[-0.9, 0, 0, 3], [-0.1, 0, 0.12, 7], [0.14, 0, 0.08, 5]],
    fold: [0.02, 18, 0.3, 0.2], film: [0.6, 1.2, 0.5, 0.35], light: [70, 40], spec: 0.8,
  }),
  // Soap bubbles
  lustre('iridescent-bubble', 'Soap Bubble', IRI, ['#e4e9f8', '#c4cbe6', W], {
    mode: 'objects', seed: 1.3, film: [0.9, 0.35, 0.55], env: STUDIO, light: [-40, 55],
    a: [5, 0, 0, 0.5], b: [0.2, 0, 0.55, 0],
    items: [[0.74, 0.6, 0.3, 2], [0.93, 0.3, 0.17, 2], [0.5, 0.86, 0.15, 2], [0.9, 0.9, 0.11, 2], [0.56, 0.36, 0.08, 2]],
  }),
  lustre('iridescent-opaline', 'Opaline', IRI, ['#e2f2ee', '#cdc8ea', W], {
    mode: 'objects', seed: 4.1, film: [0.9, 0.5, 0.7], env: STUDIO, light: [30, 55],
    a: [3, 0, 0, 0.45], b: [0.15, 0, 0.7, 0],
    items: [[0.26, 0.55, 0.78, 2], [0.8, 0.26, 0.16, 2], [0.9, 0.7, 0.09, 2]],
  }),
  lustre('iridescent-gossamer', 'Gossamer', IRI, ['#f8e4ea', '#e2c6dc', W], {
    mode: 'objects', seed: 7.7, film: [0.95, 0.32, 0.55], env: STUDIO, light: [-30, 60],
    a: [7, 0, 0, 0.35], b: [0.12, 0, 0.55, 0],
    items: [[0.12, 0.2, 0.09, 2], [0.3, 0.82, 0.12, 2], [0.07, 0.66, 0.06, 2], [0.86, 0.16, 0.08, 2], [0.9, 0.62, 0.13, 2], [0.66, 0.9, 0.06, 2], [0.6, 0.1, 0.05, 2]],
  }),
  // Pearls and drops
  lustre('iridescent-moonstone', 'Moonstone', IRI, ['#f4f0f8', '#d9d2e8', '#f6f2f2'], {
    mode: 'objects', seed: 2.6, film: [0.16, 0.35, 0.3], env: [0.9, 2.2, 0.3, 0.5], light: [-45, 45],
    a: [1, 0.1, 8, 0.4], b: [0.3, 0, 0, 0],
    items: [[0.66, 0.54, 0.36, 1]],
  }),
  lustre('iridescent-meringue', 'Meringue', IRI, ['#fff6ef', '#f0dcd2', '#fbf3ee'], {
    mode: 'objects', seed: 5.2, film: [0.15, 0.32, 0.3], env: [0.9, 2.2, 0.3, 0.5], light: [-35, 50],
    a: [3, 0, 0, 0.5], b: [0.3, 0.2, 0, 0],
    items: [[0.33, 0.5, 0.33, 5], [0.76, 0.34, 0.11, 1], [0.84, 0.64, 0.075, 1]],
  }),
  lustre('iridescent-lustre', 'Lustre', IRI, ['#fde9f2', '#dcd2f2', W], {
    mode: 'objects', seed: 3.4, film: [0.4, 0.3, 0.3], env: STUDIO, light: [-35, 55],
    a: [7, 0.16, 7, 0.45], b: [0.25, 0, 0, 0.55],
    items: [[0.18, 0.3, 0.1, 3], [0.3, 0.72, 0.07, 3], [0.82, 0.22, 0.08, 3], [0.7, 0.78, 0.12, 3], [0.9, 0.55, 0.05, 3], [0.08, 0.6, 0.045, 3], [0.55, 0.12, 0.04, 3]],
  }),
  // Soap film macro
  lustre('iridescent-holo', 'Holo', IRI, [W], {
    mode: 'film', seed: 8, film: [0.62, 0, 0], light: [-35, 55],
    a: [0.2, 0.9, 0.5, 3.6], b: [1.5, 0.3, 0.6, 0],
  }),
  lustre('iridescent-glaze', 'Glaze', IRI, ['#ece6f6', '#fbf2f6', '#ffffff'], {
    mode: 'water', seed: 2.2, env: [0.75, 1.4, 1, 0], a: [-0.02, 0.3, 30, 0.01], b: [0.3, 0.0012, 0.15, 0.12],
    items: [[0.15, 0.6, 1, 0], [-0.4, 0.9, 0.6, 2.5], [0.45, 1.3, 0.5, 4]],
  }),
  lustre('iridescent-taffeta', 'Marbling', IRI, [W], {
    mode: 'film', seed: 5.5, film: [0.5, 0, 0], light: [-40, 50],
    a: [0.35, 0.5, 0.35, 2.6], b: [1.8, -0.5, 0.5, 0],
  }),
  // Prism caustics
  lustre('iridescent-organza', 'Caustic', IRI, ['#efeaf3', '#d2c9de', '#c9bfe0'], {
    mode: 'caustics', seed: 5, light: [-60, 50], a: [2, 0.12, 0.45, 1.6], b: [0.3, 0.38, 0.24, 0.35],
    items: [[0.6, 0.6, 0.45, 0.7], [0.2, 1.4, 0.06, 1], [0.8, 0.28, 0.3, 0.45], [0.14, 1.1, 0.04, -1]],
  }),
  lustre('iridescent-gelato', 'Rainlight', IRI, ['#ece1da', '#d3c3ba', '#e2cfc4'], {
    mode: 'caustics', seed: 9, light: [40, 50], a: [3, 0.14, 0, 0], b: [0.5, 0.5, 0.1, 0],
    items: [[0.24, 0.45, -1.2, 0.95], [0.2, 0.55, 0, 1.4], [0.56, 0.55, -1.2, 0.9], [0.08, 0.5, 0, 1.3], [0.88, 0.5, -1.2, 0.95], [0.14, 0.55, 0, -1.4]],
  }),
  // Nacre shells
  lustre('iridescent-seashell', 'Seashell', IRI, ['#fff7f4', '#efdcdc', '#fbf2ef'], {
    mode: 'shell', seed: 6, film: [0.18, 0.35, 0.2], env: [0.85, 0.5, 0.4, 0.3], light: [-40, 50],
    a: [0.74, 0.56, 1.1, 0.25], b: [24, 0.005, 3, 0],
  }),
  lustre('iridescent-petal', 'Abalone', IRI, ['#f4f6fb', '#d8dcec', '#f2f2f8'], {
    mode: 'shell', seed: 2, film: [0.3, 0.42, 0.3], env: [0.85, 0.6, 0.4, 0.3], light: [40, 45],
    a: [-0.9, 1.7, 0.32, 0.05], b: [0, 0, 3, 0.4],
  }),
]
