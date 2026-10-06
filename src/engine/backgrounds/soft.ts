import type { Wallpaper } from './index.ts'

// Soft: calm color fields, drawn by src/engine/gpu/wallpapers/soft.wgsl in seven modes. The
// collection holds the default wallpaper, so every look stays rich but quiet behind a recording.

const wp = (id: string, name: string, colors: string[], params: number[]): Wallpaper => ({ id, name, collection: 'Soft', style: 'soft', colors, params })

/** A color point: frame-relative x, y, radius (mean-side units), sRGB hex, weight (default 1). */
type Pt = [x: number, y: number, r: number, color: string, weight?: number]
const pts = (list: Pt[]) => list.flatMap(([x, y, r, , w = 1]) => [x, y, r, w])

interface MeshLook {
  /** Focus, frame-relative: the origin of the field (may lie outside the frame). */
  focus: [number, number]
  /** 0: bands run straight across `angle`; 1: rings around the focus. */
  radial?: number
  /** Direction the linear field grows toward, rad, y down. */
  angle?: number
  /** Field units (mean-side) per full ramp, and its offset. */
  span?: number
  offset?: number
  bend?: number
  seed?: number
  /** Feature scale of the bends. */
  scale?: number
  relief?: number
  /** Where light comes from, rad, y down. */
  light?: number
  bloom?: number
  bloomR?: number
}

/** A gradient-mapped flow field. Colors are ramp stops from the focus outward, light to deep:
 *  shaded folds borrow their hue from deeper stops. */
function mesh(id: string, name: string, look: MeshLook, colors: string[]): Wallpaper {
  const { focus, radial = 1, angle = 0, span = 1.2, offset = 0, bend = 0.4, seed = 0, scale = 0.9, relief = 5, light = -2.2, bloom = 0, bloomR = 0.3 } = look
  return wp(id, name, colors, [0, bend, seed, scale, ...focus, radial, angle, relief, light, bloom, bloomR, span, offset, 0, 0])
}

/** An orb: frame-relative x, y, radius (mean-side units), edge blur (fraction of radius), sRGB hex. */
type Orb = [x: number, y: number, r: number, blur: number, color: string]
interface OrbLook {
  /** Ground gradient angle, rad, 0 points up. */
  angle?: number
  /** Where light comes from, rad, y down. */
  light?: number
  shadow?: number
  sheen?: number
  glass?: number
  rim?: number
  ambient?: number
  /** Subsurface glow filling the shaded side, light wrap 0..1, sheen sharpness (exponent). */
  glow?: number
  wrap?: number
  sharpness?: number
  /** Light scattered onto the ground around each orb. */
  groundGlow?: number
}

/** Big soft spheres over a two-color ground, back to front. */
function orbs(id: string, name: string, ground: [string, string], look: OrbLook, list: Orb[]): Wallpaper {
  const { angle = 0, light = -2.3, shadow = 0.25, sheen = 0.3, glass = 0, rim = 0.4, ambient = 0.55, glow = 0, wrap = 0, sharpness = 24, groundGlow = 0 } = look
  return wp(id, name, [...ground, ...list.map((o) => o[4])], [1, angle, light, shadow, sheen, glass, rim, ambient, glow, wrap, sharpness, groundGlow, ...list.flatMap(([x, y, r, b]) => [x, y, r, b])])
}

interface ConicLook {
  /** Pivot, frame-relative (may lie outside the frame), and the axis angle (rad, y down). */
  pivot: [number, number]
  axis: number
  /** Angle from the axis to the last color, rad. */
  span: number
  pleats?: number
  depth?: number
  /** Spiral twist, rad per mean-side unit. */
  twist?: number
  falloff?: number
  glow?: number
  glowR?: number
}

/** A duotone sweep around a pivot, mirrored about its axis. */
function conic(id: string, name: string, look: ConicLook, colors: string[]): Wallpaper {
  const { pivot, axis, span, pleats = 0, depth = 0, twist = 0, falloff = 0, glow = 0, glowR = 0.3 } = look
  return wp(id, name, colors, [2, pivot[0], pivot[1], axis, span, pleats, depth, twist, falloff, glow, glowR, 0])
}

interface HorizonLook {
  /** Frame-relative y of the top of the arc. */
  y: number
  /** Arc radius, mean-side units; large reads flat. */
  radius: number
  glowH: number
  glow: number
  /** Sun x (frame-relative) and radius (0: none). */
  sunX?: number
  sun?: number
  rim?: number
  /** How far the glow reaches along the horizon, mean-side units. */
  spread?: number
  haze?: number
  /** Edge softness of the horizon, mean-side units. */
  edge?: number
  /** Frame-relative x of the arc's center. */
  cx?: number
  /** Sun reflection on a glossy ground. */
  reflect?: number
}

/** A horizon or planet limb with an atmospheric glow. Colors: sky top, sky at horizon, glow
 *  core, glow outer, ground at the limb, ground deep. */
function horizon(id: string, name: string, look: HorizonLook, colors: string[]): Wallpaper {
  const { y, radius, glowH, glow, sunX = 0.5, sun = 0, rim = 0, spread = 0.6, haze = 0, edge = 0, cx = 0.5, reflect = 0 } = look
  return wp(id, name, colors, [3, y, radius, glowH, glow, sunX, sun, rim, spread, haze, edge, cx, reflect, 0, 0, 0])
}

interface SpotLook {
  /** Light source, frame-relative (y < 0 above the frame). */
  src: [number, number]
  spread: number
  beam: number
  floor: number
  pool: number
  vignette: number
  tilt?: number
  haze?: number
  /** Cyclorama: cove width (mean-side units), highlight along the cove, warm bounce from the pool
   *  onto the lower wall, and the wash of light on the wall. */
  cove?: number
  coveLight?: number
  bounce?: number
  wash?: number
  /** Rays per radian of spread, as light through a canopy (0: one smooth beam), and their seed. */
  shafts?: number
  seed?: number
}

/** A lit studio sweep. Colors: wall deep (cool), lit, key light (warm), floor deep. */
function spot(id: string, name: string, look: SpotLook, colors: string[]): Wallpaper {
  const { src, spread, beam, floor, pool, vignette, tilt = 0, haze = 0, shafts = 0, seed = 0, cove = 0.15, coveLight = 0, bounce = 0, wash = 0 } = look
  return wp(id, name, colors, [4, src[0], src[1], spread, beam, floor, pool, vignette, tilt, haze, shafts, seed, cove, coveLight, bounce, wash])
}

interface CloudLook {
  seed: number
  coverage: number
  scale: number
  light: number
  soft?: number
  clear?: number
  sunGlow?: number
  sun?: [number, number]
  stretch?: number
  warp?: number
  /** Positive banks the clouds low in the frame. */
  bank?: number
  /** Frame-relative horizon: the clouds become a sea seen from above (0: off). */
  horizon?: number
}

/** Pastel clouds. Colors: sky top, sky bottom, cloud lit, cloud shade, sun tint. */
function clouds(id: string, name: string, look: CloudLook, colors: string[]): Wallpaper {
  const { seed, coverage, scale, light, soft = 0.6, clear = 0.6, sunGlow = 0, sun = [0.8, 0.1], stretch = 1.8, warp = 0.6, bank = 0, horizon = 0 } = look
  return wp(id, name, colors, [5, seed, coverage, scale, light, soft, clear, sunGlow, ...sun, stretch, warp, bank, horizon, 0, 0])
}

interface GlassLook {
  rib: number
  angle?: number
  /** Scale of the slice each rib shows; negative flips it. */
  refract?: number
  highlight?: number
  seam?: number
  warp?: number
  seed?: number
  sharp?: number
  flow?: number
}

/** A color field behind reeded glass. */
function glass(id: string, name: string, look: GlassLook, points: Pt[]): Wallpaper {
  const { rib, angle = 0, refract = -0.4, highlight = 0.25, seam = 0.15, warp = 0.15, seed = 0, sharp = 1.5, flow = 1.2 } = look
  return wp(id, name, points.map((p) => p[3]), [6, rib, angle, refract, highlight, seam, warp, seed, sharp, flow, 0, 0, ...pts(points)])
}

export const SOFT: Wallpaper[] = [
  mesh('dusk', 'Dusk', { focus: [1.05, 1.0], span: 1.8, bend: 0.4, scale: 0.9, seed: 7.7, relief: 5, bloom: 0.2, bloomR: 0.4 }, ['#f9b98f', '#e8708f', '#9a4bb0', '#4b2c96', '#241a63', '#100b30']),
  orbs('lavender', 'Lavender', ['#f1ecff', '#d9cdfb'], { angle: 2.6, shadow: 0.12, sheen: 0.35, glass: 0.25 }, [
    [0.12, 0.2, 0.42, 0.08, '#c7b3ff'],
    [0.86, 0.82, 0.5, 0.1, '#f2c6f0'],
    [0.95, 0.12, 0.22, 0.05, '#b9c9ff'],
    [0.3, 0.98, 0.26, 0.04, '#e3d4ff'],
  ]),
  conic('ocean', 'Ocean', { pivot: [-0.04, -0.06], axis: 0, span: 1.65, twist: 0.3, pleats: 24, depth: 0.16, glow: 0.3, glowR: 0.3 }, ['#7ae8ff', '#2aa6f0', '#1559c9', '#0c2b85', '#071447']),
  horizon('aurora', 'Polar', { y: 0.62, radius: 2.2, glowH: 0.06, glow: 0.9, rim: 0.4, spread: 0.7, haze: 0.2 }, ['#030b16', '#07253a', '#5be3b0', '#1b6f8a', '#06131f', '#02060c']),
  spot('graphite', 'Studio', { src: [0.44, -0.5], spread: 0.4, beam: 0.18, floor: 0.62, pool: 0.22, vignette: 0.55, tilt: 0.06, haze: 0.04, cove: 0.2, coveLight: 0.28, bounce: 0.22, wash: 0.75 }, ['#0e1117', '#4f525b', '#ecdcc4', '#1a1c22']),
  clouds('sky', 'Sky', { seed: 3.1, coverage: 0.45, scale: 3.5, light: -1.7, sunGlow: 0.4, sun: [0.8, 0.12], clear: 0.3, bank: 0.5 }, ['#86b4f0', '#f3d6e4', '#fffaf6', '#c4c6ea', '#ffe6c8']),
  glass('soft-prism', 'Prism', { rib: 0.07, refract: -0.5, seed: 2.0 }, [
    [0.1, 0.1, 0.5, '#ff7a59'],
    [0.6, 0.0, 0.45, '#ff4f8b'],
    [1.0, 0.5, 0.45, '#8a4dff'],
    [0.3, 0.8, 0.45, '#ffb36b'],
    [0.85, 1.0, 0.4, '#5a3bd6'],
  ]),
  mesh('dawn', 'Dawn', { focus: [0, 0], radial: 0, angle: 0.6, span: 1.6, seed: 4.0, relief: 1.5, bloom: 0.25, bloomR: 0.5 }, ['#fff4e2', '#ffd2bf', '#ffb8d9', '#e4b9ff', '#a9b8ff']),
  orbs('rose', 'Rose', ['#2d0818', '#140310'], { angle: 3.0, shadow: 0.4, sheen: 0.4, rim: 0.5, ambient: 0.45 }, [
    [0.85, 0.15, 0.5, 0.25, '#7d1340'],
    [0.1, 0.85, 0.42, 0.06, '#d42a6a'],
    [0.72, 0.9, 0.3, 0.03, '#ff8fb1'],
  ]),
  conic('ember', 'Ember', { pivot: [0.5, 1.2], axis: -Math.PI / 2, span: 1.25, pleats: 22, depth: 0.12, glow: 0.45, glowR: 0.45 }, ['#ffc86a', '#ff7a2e', '#d42a3a', '#7a0e2a', '#2a0612']),
  horizon('midnight', 'Nightside', { y: 0.42, radius: 0.75, cx: 1.05, glowH: 0.025, glow: 1, sunX: 0.62, rim: 0.7, spread: 0.3 }, ['#03040a', '#0a1030', '#bfd0ff', '#3b3fbf', '#0a0e22', '#020308']),
  spot('forest', 'Forest', { src: [0.95, -0.35], spread: 0.45, beam: 1.5, floor: 0.92, pool: 0.4, vignette: 0.4, tilt: -0.55, haze: 0.12, shafts: 9, seed: 2.0, wash: 0.35 }, ['#03241a', '#178a50', '#efffb8', '#03180e']),
  clouds('mist', 'Mist', { seed: 7.4, coverage: 0.55, scale: 2.5, light: -1.57, soft: 0.6, clear: 0, sunGlow: 0.6, sun: [0.62, 0.3], stretch: 1.5, horizon: 0.3 }, ['#c9c4e8', '#ffe1d6', '#fff8f4', '#c7b6dc', '#ffd9c2']),
  glass('soft-frost', 'Frost', { rib: 0.11, angle: 0.5, refract: 0.35, highlight: 0.35, seed: 4.2 }, [
    [0.1, 0.2, 0.5, '#e8f1ff'],
    [0.7, 0.1, 0.45, '#9cc4ff'],
    [0.95, 0.8, 0.45, '#5f8dea'],
    [0.3, 0.9, 0.4, '#cfe2ff'],
  ]),
  mesh('citrus', 'Citrus', { focus: [0, 0], span: 1.7, bend: 0.4, scale: 0.9, seed: 5.3 }, ['#fff8c4', '#ffe066', '#ffb340', '#ff8a4a', '#f25c6e']),
  orbs('soft-pebble', 'Bubble', ['#0a1024', '#16204a'], { angle: 0.4, light: -2.4, shadow: 0.25, sheen: 0.12, sharpness: 5, glass: 0.3, rim: 0.35, ambient: 0.3, glow: 0.55, wrap: 0.6, groundGlow: 0.12 }, [
    [0.82, 0.8, 0.44, 0.02, '#2fb6a6'],
    [0.64, 0.66, 0.17, 0.025, '#7d6bff'],
    [0.92, 0.3, 0.1, 0.03, '#ff8fc4'],
    [0.52, 0.88, 0.05, 0.04, '#8fd0ff'],
    [0.04, 0.06, 0.36, 0.55, '#4a6cf0'],
  ]),
  conic('soft-fan', 'Origami', { pivot: [1.15, 0.55], axis: Math.PI, span: 1.5, pleats: 14, depth: 0.1 }, ['#fff9fd', '#d9c9ff', '#a9dcd4', '#6fbfb6']),
  horizon('sand', 'Haze', { y: 0.64, radius: 40, glowH: 0.1, glow: 0.7, sunX: 0.36, sun: 0.09, spread: 0.7, haze: 0.5, edge: 0.012, reflect: 0.45 }, ['#e6cdd0', '#f7d6c4', '#ffd09a', '#ffad86', '#e6b39c', '#b88072']),
  mesh('soft-tide', 'Tidewater', { focus: [0.5, 1.1], radial: 0, angle: -Math.PI / 2, span: 1.2, offset: 0.2, seed: 1.3 }, ['#d2ffe6', '#6ee6b8', '#1fae98', '#0f6470', '#083040']),
  glass('soft-champagne', 'Champagne', { rib: 0.09, refract: -0.6, highlight: 0.4, seam: 0.08, sharp: 1.4, seed: 5.5 }, [
    [0.1, 0.15, 0.55, '#fbf4ea'],
    [0.66, 0.5, 0.34, '#f0b97a', 1.5],
    [0.85, 0.2, 0.25, '#ffd9c0', 1.2],
    [0.25, 0.95, 0.4, '#f6e2c6'],
    [0.95, 0.95, 0.35, '#e7a77e'],
  ]),
]
