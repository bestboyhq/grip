import type { Wallpaper } from './index.ts'

/** One rolling surface, back to front: crest height y (frame units, y down, the frame spans about
 *  -0.5..0.5 on a square), amplitude, frequency, seed, its two palette colors a -> b (b deeper or
 *  further along x), and the lateral share of that gradient. */
export type DuneLayer = [y: number, amp: number, freq: number, seed: number, a: number, b: number, lat?: number]

export interface DuneLook {
  /** Rotation of the whole landscape, radians (negative tilts crests up to the right). */
  angle?: number
  /** OKLab hue (radians) that shadows lean toward: about 0 is crimson, 4.5 blue. */
  turn?: number
  /** How much farther layers fade into the sky. */
  haze?: number
  /** Light from the left (-1) or the right (1). */
  light?: number
  sheen?: number
  shadow?: number
  /** Edge softness of the farthest layer, frame units. */
  dof?: number
  /** Sun glow on the horizon: position along it, strength 0..1, palette color (default: lit horizon). */
  glowX?: number
  glow?: number
  glowColor?: number
  /** Lean of the crests toward a steep lee side, 0..0.9. */
  skew?: number
  /** How fast each layer turns from color a to b with depth below its crest. */
  fill?: number
  /** Bend the bands into concentric arcs around (cx, cy), frame units, off frame. */
  curl?: boolean
  cx?: number
  cy?: number
  /** Flatten crests into mesas, 0..0.95. */
  mesa?: number
  /** Sun disc: position (frame units), radius, palette color (0: none). */
  sunX?: number
  sunY?: number
  sunR?: number
  sunColor?: number
}

/** A layered dunes wallpaper: colors[0], colors[1] are sky top and horizon; layers (at most 5) pick theirs. */
export function dunes(collection: string, id: string, name: string, colors: string[], look: DuneLook, layers: DuneLayer[]): Wallpaper {
  const l = { angle: 0, turn: 4.5, haze: 0.35, light: -0.5, sheen: 0.45, shadow: 0.5, dof: 0.004, glowX: 0, glow: 0, glowColor: 0, skew: 0, fill: 2, curl: false, cx: 0, cy: 0, mesa: 0, sunX: 0, sunY: 0, sunR: 0.08, sunColor: 0, ...look }
  return {
    id,
    name,
    collection,
    style: 'dunes',
    colors,
    params: [
      l.angle, l.turn, layers.length, l.haze,
      l.light, l.sheen, l.shadow, l.dof,
      l.glowX, l.glowColor + Math.min(l.glow, 0.99), l.skew, l.fill,
      (l.curl ? 1 : 0) + Math.min(l.mesa, 0.95), l.cx, l.cy, l.sunX,
      l.sunY, l.sunColor + Math.min(l.sunR, 0.99),
      ...layers.flatMap(([y, amp, freq, seed, a, b, lat = 0]) => [y, amp, freq, seed, a * 16 + b, lat]),
    ],
  }
}

export interface ReliefLook {
  /** ridges: sharp wind-cut crests (aerial dunes, sand ripples); water: interfering rings; terraces:
   *  contour steps on soft hills. */
  mode: 'ridges' | 'water' | 'terraces'
  /** Ridge direction, radians. */
  angle?: number
  /** Crests per frame unit. */
  freq: number
  seed?: number
  /** Screen direction the light comes from (radians, 0 = from the right, y down) and its elevation. */
  sunAz?: number
  sunEl?: number
  shadow?: number
  /** Ridges: lean toward a steep lee side, 0..1. Terraces: step count. */
  lean?: number
  /** Below 0: the ground is seen at a grazing angle under a horizon at that frame y. */
  horizon?: number
  detail?: number
  warp?: number
  gloss?: number
  swell?: number
  haze?: number
  turn?: number
  /** Water: ring centers x, y, frequency factor, phase. */
  rings?: Array<[number, number, number, number]>
}

/** A lit height field: colors[0], colors[1] are sky top and horizon (tilted view), the rest a ramp
 *  from low ground to the crests. */
export function relief(collection: string, id: string, name: string, colors: string[], look: ReliefLook): Wallpaper {
  const l = { angle: 0, seed: 0, sunAz: -2.4, sunEl: 0.45, shadow: 0.8, lean: 0.5, horizon: 0, detail: 0.15, warp: 0.8, gloss: 0.2, swell: 0.15, haze: 0.4, turn: 0.15, rings: [], ...look }
  const rings = [0, 1, 2, 3].flatMap((i) => l.rings[i] ?? [0, 0, 0, 0])
  return {
    id,
    name,
    collection,
    style: 'relief',
    colors,
    params: [
      { ridges: 0, water: 1, terraces: 2 }[l.mode], l.angle, l.freq, l.seed,
      l.sunAz, l.sunEl, l.shadow, l.lean,
      l.horizon, l.detail, l.warp, l.gloss,
      l.swell, l.haze, l.turn, colors.length - 2,
      ...rings,
    ],
  }
}

/** One petal, leaf or blob: base x, y (16:10 frame units), angle, length, width, colors a -> b
 *  (base to tip), and an optional ring count that repeats it around the base like a flower. */
export type Petal = [x: number, y: number, angle: number, len: number, width: number, a: number, b: number, ring?: number]

export interface PetalLook {
  /** Direction of the ground gradient from colors[0] to colors[1], radians (0 = upward). */
  angle?: number
  light?: [number, number]
  shadow?: number
  sheen?: number
  opacity?: number
  turn?: number
  /** Drop shadow distance and softness. */
  offset?: number
  soft?: number
  /** Center of the colors[2] glow on the ground. */
  glow?: [number, number]
}

/** Soft petals over a gradient ground: colors[0..1] ground, colors[2] glow, records pick the rest. */
export function petals(collection: string, id: string, name: string, colors: string[], look: PetalLook, shapes: Petal[]): Wallpaper {
  const l = { angle: 0, light: [-0.5, -0.7], shadow: 0.45, sheen: 0.35, opacity: 0.9, turn: 4.5, offset: 0.03, soft: 0.05, glow: [0, -0.2], ...look }
  return {
    id,
    name,
    collection,
    style: 'petals',
    colors,
    params: [
      shapes.length, l.angle, l.light[0], l.light[1],
      l.shadow, l.sheen, l.opacity, l.turn,
      l.offset, l.soft, l.glow[0], l.glow[1],
      ...shapes.flatMap(([x, y, angle, len, width, a, b, ring = 1]) => [x, y, angle, len, width, a * 16 + b + 256 * ring]),
    ],
  }
}

const spring = (id: string, name: string, colors: string[], look: DuneLook, layers: DuneLayer[]) => dunes('Spring', `spring-${id}`, name, colors, look, layers)

export const SPRING: Wallpaper[] = [
  // Hills: a wide horizon landscape of rolling layers.
  spring('meadow', 'Meadow', ['#9be8cf', '#f4f7c0', '#b3e3b5', '#6cc2a0', '#ffc690', '#f28b6c', '#2fa58c', '#13605d', '#d6f0b0'], { light: -0.6, glow: 0.5, glowX: 0.35 }, [
    [-0.08, 0.05, 3.4, 1, 8, 2, 0.2],
    [-0.01, 0.06, 3.0, 80, 2, 3, 0.3],
    [0.07, 0.12, 2.2, 2, 4, 5, 0.9],
    [0.2, 0.1, 2.6, 81, 3, 6, -0.4],
    [0.3, 0.2, 1.3, 3, 6, 7, 0.4],
  ]),
  spring('highlands', 'Highlands', ['#ffaacb', '#ffe2d0', '#c4bcec', '#97a8e0', '#6a8cc8', '#4a6ea8', '#2f5084', '#1c3660'], { light: -0.5, haze: 0.75, glow: 0.4, glowX: -0.2 }, [
    [-0.04, 0.09, 3.4, 41, 2, 3, 0.2],
    [0.05, 0.1, 3.0, 42, 3, 4, -0.2],
    [0.14, 0.1, 2.7, 43, 4, 5, 0.2],
    [0.24, 0.09, 2.4, 44, 5, 6, -0.2],
    [0.36, 0.16, 1.3, 45, 6, 7, 0.2],
  ]),
  spring('coral-bay', 'Coral Bay', ['#ff8f86', '#ffc6d6', '#86e3d0', '#38b6b0', '#2a8fa8', '#1d5f86', '#b2f0e0'], { angle: 0.32, light: -0.6, shadow: 0.55 }, [
    [-0.12, 0.08, 2.0, 21, 6, 2, 0.4],
    [0.04, 0.1, 2.3, 22, 2, 3, -0.4],
    [0.18, 0.1, 1.9, 23, 3, 4, 0.3],
    [0.3, 0.08, 1.6, 24, 4, 5, 0.2],
    [0.42, 0.2, 1.2, 94, 5, 4, 0.3],
  ]),
  spring('nightfall', 'Nightfall', ['#4a52c8', '#ffa06e', '#2f8590', '#1d4f66', '#e0388a', '#8a1f6e', '#0f2e44', '#0a1e30'], { light: 0.5, glow: 0.5, glowX: 0.3, haze: 0.1, sheen: 0.5 }, [
    [-0.06, 0.06, 3.4, 95, 2, 3, 0.2],
    [0.0, 0.12, 2.6, 25, 2, 3, 0.2],
    [0.14, 0.1, 3.0, 26, 4, 5, -0.6],
    [0.24, 0.09, 2.2, 27, 6, 7, 0.3],
    [0.34, 0.16, 1.4, 96, 6, 7, 0.3],
  ]),
  // Sun: a pastel disc in a big sky over low hills.
  spring('lowlands', 'Lowlands', ['#c3a6f2', '#ffe68f', '#93e0c8', '#46a9b0', '#2e8aa0', '#1f6a8a', '#174a6e', '#ffffff'], { light: 0.3, glow: 0.3, glowX: 0.16, haze: 0.5, sunX: 0.16, sunY: 0.0, sunR: 0.08, sunColor: 7 }, [
    [0.14, 0.04, 5.0, 90, 2, 3, 0.2],
    [0.18, 0.06, 4.0, 15, 2, 3, 0.2],
    [0.24, 0.06, 3.2, 16, 3, 4, -0.2],
    [0.3, 0.06, 2.6, 91, 4, 5, 0.2],
    [0.36, 0.1, 1.8, 17, 5, 6, 0.2],
  ]),
  spring('daybreak', 'Daybreak', ['#8fb4ff', '#ffd6c8', '#ffc2c8', '#ff9fb0', '#5fd6c0', '#2fa0a8', '#1d6688', '#ffcf70'], { light: -0.5, haze: 0.35, sunX: -0.22, sunY: 0.06, sunR: 0.15, sunColor: 7 }, [
    [0.12, 0.1, 1.7, 75, 2, 3, 0.3],
    [0.22, 0.12, 2.2, 76, 4, 5, -0.3],
    [0.33, 0.14, 1.4, 77, 5, 6, 0.3],
  ]),
  spring('mint-dusk', 'Mint Dusk', ['#80e6ea', '#ff8fc0', '#7a9cf0', '#4a6ad8', '#2f4fb0', '#1c3480', '#fff2f6'], { light: 0.3, glow: 0.5, glowX: -0.32, haze: 0.5, sunX: -0.32, sunY: -0.02, sunR: 0.055, sunColor: 6 }, [
    [0.06, 0.05, 4.0, 105, 2, 3, 0.2],
    [0.12, 0.07, 3.2, 49, 2, 3, 0.3],
    [0.2, 0.08, 2.6, 50, 3, 4, -0.3],
    [0.28, 0.07, 2.2, 106, 4, 5, 0.2],
    [0.36, 0.14, 1.5, 51, 4, 5, 0.2],
  ]),
  // Ribbons: steep sweeping bands with no horizon.
  spring('citrus-grove', 'Citrus Grove', ['#7fe0a0', '#d2f59c', '#ff7a5c', '#ffb36b', '#e8f58a', '#3fbf8a', '#f2586a'], { angle: -0.75, light: 0.5, shadow: 0.55 }, [
    [-0.28, 0.05, 2.0, 10, 5, 4, 0.5],
    [-0.14, 0.07, 1.8, 86, 4, 5, -0.3],
    [-0.02, 0.1, 1.4, 11, 3, 2, 0.6],
    [0.12, 0.07, 2.2, 87, 2, 6, -0.3],
    [0.26, 0.16, 1.2, 12, 6, 2, -0.5],
  ]),
  spring('prism', 'Falls', ['#4fd8c8', '#9fe8ff', '#b05cf5', '#ff8a4c', '#ff5c8a', '#ffc46b'], { angle: 1.35, light: -0.5, fill: 1.2 }, [
    [-0.14, 0.06, 2.4, 97, 5, 2, 0.6],
    [-0.06, 0.1, 1.8, 28, 2, 3, 1.2],
    [0.08, 0.08, 2.6, 98, 3, 4, -0.6],
    [0.2, 0.15, 1.6, 29, 4, 5, -0.9],
  ]),
  spring('kelp', 'Kelp', ['#3fc8c0', '#c8f5d8', '#dff58a', '#5fd88a', '#ff6fa8', '#c03f9a', '#1f8f80'], { angle: 0.95, light: 0.6, fill: 1.4 }, [
    [-0.14, 0.06, 2.6, 109, 3, 2, 0.3],
    [-0.04, 0.12, 1.8, 55, 2, 3, -0.8],
    [0.1, 0.1, 2.4, 110, 6, 3, 0.4],
    [0.18, 0.12, 2.1, 56, 4, 5, 0.7],
    [0.32, 0.15, 1.3, 57, 6, 3, 0.3],
  ]),
  // Curl: bands bent into concentric arcs around an off-frame center.
  spring('tidal', 'Tidal', ['#3a5ce0', '#ff9a8a', '#ff6390', '#ffa08c', '#e83f78', '#8a42d6', '#ffc8b0'], { curl: true, cx: 0.95, cy: 0.85, light: -0.5, sheen: 0.5 }, [
    [-0.42, 0.03, 3.0, 13, 6, 3, 0.2],
    [-0.24, 0.04, 2.6, 14, 3, 2, 0.3],
    [-0.06, 0.05, 2.2, 15, 2, 4, -0.3],
    [0.14, 0.05, 2.8, 16, 4, 5, 0.3],
  ]),
  spring('iris', 'Iris', ['#e8f8ff', '#c8f0ff', '#a45cf0', '#d9a8ff', '#5fe0d0', '#2fb0c8', '#6a4fe0'], { curl: true, cx: -1.25, cy: 0.05, light: 0.6, haze: 0.2 }, [
    [-0.3, 0.03, 3.2, 30, 3, 2, 0.2],
    [-0.12, 0.04, 2.6, 31, 2, 6, -0.2],
    [0.06, 0.05, 2.2, 32, 4, 5, 0.2],
    [0.26, 0.05, 2.8, 33, 5, 6, 0.2],
  ]),
  spring('aloe', 'Aloe', ['#fff4e8', '#ffe2d0', '#c6f0d8', '#5ccfa8', '#2a9a88', '#ff9a86', '#156a6a'], { curl: true, cx: 0.1, cy: -1.15, light: 0.4, shadow: 0.55 }, [
    [-0.06, 0.03, 2.4, 58, 5, 2, 0.2],
    [0.1, 0.04, 2.0, 59, 2, 3, 0.2],
    [0.26, 0.05, 2.6, 60, 3, 4, -0.2],
    [0.42, 0.05, 2.2, 61, 4, 6, 0.2],
  ]),
  // Flower: a ring of soft petals as one focal form.
  petals('Spring', 'spring-blossom', 'Blossom', ['#ffe6d8', '#ffd2e0', '#fff8ec', '#ff8fb0', '#ffe0ea', '#ff6f98', '#ffc0d0', '#ffd890'], { turn: 0.2, glow: [0.22, 0.0] }, [
    [0.22, 0.0, 0.3, 0.36, 0.12, 4, 3, 6],
    [0.22, 0.0, 0.82, 0.22, 0.085, 6, 5, 6],
    [0.22, 0.0, 0.0, 0.05, 0.05, 7, 7, 5],
  ]),
  petals('Spring', 'spring-tulip', 'Tulip', ['#e4f7d8', '#fff6e0', '#ffffff', '#ff5f7a', '#ffb0b0', '#e83f68', '#ffc0b8', '#8fdca8', '#3fae7a'], { turn: 0.1, angle: 0.6, glow: [0.05, -0.2], light: [0.6, -0.6], shadow: 0.35, soft: 0.035, opacity: 0.97 }, [
    [0.03, 0.17, 1.57, 0.9, 0.045, 7, 8],
    [0.03, 0.17, 2.15, 0.5, -0.1, 7, 8],
    [0.03, 0.17, -1.98, 0.4, 0.13, 5, 6],
    [0.03, 0.17, -1.18, 0.4, 0.13, 5, 6],
    [0.03, 0.17, -1.58, 0.42, 0.15, 3, 4],
  ]),
  petals('Spring', 'spring-flamingo', 'Flamingo', ['#ffd0dc', '#ffeede', '#fff8f0', '#ff5fa0', '#ffb0cc', '#5fd0c0', '#c8f5ec', '#ff8fb8'], { turn: 0.0, glow: [-0.2, -0.1] }, [
    [0.42, -0.18, 0.4, 0.34, 0.11, 4, 3, 7],
    [0.42, -0.18, 0.85, 0.2, 0.08, 7, 3, 7],
    [-0.4, 0.26, 0.1, 0.22, 0.08, 6, 5, 5],
  ]),
  // Petals: translucent blobs and petals scattered toward the edges around a calm center.
  petals('Spring', 'spring-sorbet', 'Sorbet', ['#fff2e8', '#ffe2ec', '#ffffff', '#ff9fb8', '#ffe4ec', '#7fdcc4', '#dcfff2', '#ffbf94', '#fff0dc'], { opacity: 0.82, shadow: 0.4, sheen: 0.45, light: [0.5, -0.7], glow: [0.1, -0.1] }, [
    [-0.6, 0.4, -0.2, 0.86, 0.3, 3, 4],
    [-0.6, 0.4, -0.8, 0.74, 0.27, 5, 6],
    [-0.6, 0.4, -1.4, 0.58, 0.22, 7, 8],
    [0.6, -0.4, 2.95, 0.7, 0.26, 5, 6],
    [0.6, -0.4, 2.3, 0.56, 0.22, 3, 4],
  ]),
  petals('Spring', 'spring-orchard', 'Orchard', ['#ffd8c4', '#fff4e4', '#fffaf2', '#b8a4ff', '#f2ecff', '#ffa08a', '#ffe4d6', '#c8b8ff', '#fff0f6'], { angle: 2.4, opacity: 0.88, light: [0.4, -0.75], glow: [-0.25, 0.1] }, [
    [0.62, -0.42, 1.75, 0.62, 0.2, 7, 8],
    [0.62, -0.42, 2.25, 0.86, 0.26, 3, 4],
    [0.62, -0.42, 2.75, 0.78, 0.24, 5, 6],
    [0.62, -0.42, 3.25, 0.6, 0.19, 3, 4],
    [-0.62, 0.42, -0.35, 0.46, 0.16, 5, 6],
    [-0.62, 0.42, -0.95, 0.38, 0.13, 7, 8],
  ]),
  // Leaf: one giant leaf or petal close up, entering from a corner.
  petals('Spring', 'spring-grove', 'Grove', ['#f2fbe4', '#dcf6d4', '#ffffff', '#2f9a6a', '#b4eca8', '#4fbf8a', '#d8f8c8', '#7fd49a', '#e8fbe0'], { light: [-0.4, -0.8], shadow: 0.5, sheen: 0.45, opacity: 0.95, turn: 4.5, glow: [0.3, -0.2], angle: 0.8 }, [
    [-0.7, 0.46, -0.3, 1.05, -0.2, 3, 4],
    [-0.7, 0.46, -0.75, 0.92, -0.18, 5, 6],
    [-0.7, 0.46, -1.2, 0.74, -0.15, 7, 8],
    [0.7, -0.46, 2.65, 0.6, -0.13, 5, 6],
  ]),
  petals('Spring', 'spring-seafoam', 'Seafoam', ['#d8fbef', '#c4f2e6', '#ffffff', '#ff8fa8', '#ffe6ec', '#ffb4c4', '#fff2f4', '#6fd6bc', '#dcfff4'], { light: [0.4, -0.8], shadow: 0.45, sheen: 0.5, opacity: 0.9, turn: 0.2, glow: [-0.2, 0.0], angle: -0.6 }, [
    [0.8, -0.46, 2.6, 1.0, 0.3, 3, 4],
    [0.8, 0.5, 3.55, 0.78, 0.24, 5, 6],
    [-0.78, 0.5, -0.65, 0.55, 0.18, 7, 8],
  ]),
  // Water: rings spreading on calm water, seen from above.
  relief('Spring', 'spring-seaglass', 'Seaglass', ['#ffffff', '#ffffff', '#167a8a', '#2fb0b0', '#6fdcc8', '#c0f5e4'], { mode: 'water', freq: 70, shadow: 0, gloss: 1.2, sunAz: -2.2, sunEl: 1.3, swell: 0.08, turn: 4.5, rings: [[0.32, -0.12, 1, 0]] }),
  relief('Spring', 'spring-lagoon', 'Lagoon', ['#ffffff', '#ffffff', '#3060c0', '#3f9fe0', '#7fdcf0', '#d8f8ff'], { mode: 'water', freq: 55, shadow: 0, gloss: 1.2, sunAz: -0.8, sunEl: 1.3, swell: 0.1, turn: 4.5, rings: [[-0.95, 0.62, 1, 0]] }),
  // Terraces: contour steps on soft hills, seen from above.
  relief('Spring', 'spring-drizzle', 'Drizzle', ['#ffffff', '#ffffff', '#1f6a5a', '#3fa87a', '#8fd890', '#d8f2a8', '#fff4c8'], { mode: 'terraces', freq: 5, lean: 9, shadow: 0.6, sunEl: 0.6, warp: 0.6, turn: 4.5 }),
  relief('Spring', 'spring-glacier', 'Glacier', ['#ffffff', '#ffffff', '#1d4f8a', '#2f8fc0', '#5fd0d8', '#b8f0e8', '#f4fffc'], { mode: 'terraces', freq: 2.2, lean: 30, shadow: 0.4, sunEl: 0.7, warp: 1.2, seed: 7, sunAz: -0.7, turn: 4.5, swell: 0.25 }),
]
