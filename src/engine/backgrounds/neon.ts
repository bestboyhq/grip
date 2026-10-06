import type { Wallpaper } from './index.ts'

// Neon: light in the dark, many ways. Glowing blobs, motion-blurred bars, zoom bursts and orbit
// arcs, light rings and ring tunnels, gradient spheres, bokeh, neon tubes, light trails, laser
// grids, aurora curtains, light leaks and prism beams. Positions in the mean-side styles (glow,
// ring, sphere, tube) are 0.5 + offset from the frame center in units of the geometric mean side.

const C = 'Neon'

type V4 = [number, number, number, number]
type Orb = V4

/** Luminous blobs (glow.wgsl): [exposure, bloom, core, soft], [angle, stretch, warp, seed]. */
function glow(id: string, name: string, colors: string[], g: V4, s: V4, orbs: Orb[]): Wallpaper {
  return { id: `neon-${id}`, name, collection: C, style: 'glow', colors, params: [...g, ...s, ...orbs.flat()] }
}

/** Motion-blurred bars (streaks.wgsl): blur [bar angle, blur angle, length, trail], bars [pitch,
 *  duty, length, jitter], group [offset, half-width, seed, chroma], look [intensity, bloom,
 *  defocus, vignette], frame [ground angle, end slant, center x, y], surface [stagger, brightness
 *  spread, shade, sheen], color sweep, polar [seam angle, scale] (bursts and arcs). */
function streaks(id: string, name: string, colors: string[], blur: V4, bars: V4, group: V4, look: V4, frame: V4, surface: V4 = [0, 0.45, 0, 0], sweep = 0, polar?: [number, number]): Wallpaper {
  return { id: `neon-${id}`, name, collection: C, style: 'streaks', colors, params: [...blur, ...bars, ...group, ...look, ...frame, ...surface, sweep, polar ? 1 : 0, ...(polar ?? [0, 0])] }
}

/** Glowing elliptical rings (ring.wgsl): look [halo, inner haze, shadow, exposure], rings
 *  [x, y, rx, ry, rotation, width, intensity, bright side], ground [vignette, x, y, arc power],
 *  echoes [count, radius step, drift x, y] and intensity step for tunnels. */
function ring(id: string, name: string, colors: string[], look: V4, rings: Array<[...V4, ...V4]>, ground: V4, echoes: V4 = [1, 1, 0, 0], fade = 1): Wallpaper {
  const r = [0, 1, 2].map((i) => rings[i] ?? [0, 0, 0, 0, 0, 0, 0, 0])
  return { id: `neon-${id}`, name, collection: C, style: 'ring', colors, params: [...look, ...r.flatMap((x) => x.slice(0, 4)), ...r.flatMap((x) => x.slice(4)), ...ground, ...echoes, fade, 0, 0, 0] }
}

/** Gradient spheres (sphere.wgsl): [light x, y, rim, glow], [vignette, shadow, specular,
 *  exposure], spheres [x, y, radius, ramp shift]. Colors: ground center, edge, then the ramp. */
function sphere(id: string, name: string, colors: string[], g: V4, h: V4, spheres: V4[]): Wallpaper {
  return { id: `neon-${id}`, name, collection: C, style: 'sphere', colors, params: [...g, ...h, ...spheres.flat()] }
}

/** Bokeh (bokeh.wgsl): cells [size, density, size min, max], [layers, softness, rim, seed],
 *  band [angle, offset, width, amount], [edge frame, exposure, ground angle, haze]. */
function bokeh(id: string, name: string, colors: string[], a: V4, b: V4, band: V4, e: V4): Wallpaper {
  return { id: `neon-${id}`, name, collection: C, style: 'bokeh', colors, params: [...a, ...b, ...band, ...e] }
}

type Path = [x0: number, y0: number, x1: number, y1: number, bulge: number, color: number, intensity: number, width: number]

/** Neon tubes and light trails (tube.wgsl): [width, glow, lanes, lane spacing], [trail fade, 0,
 *  vignette, exposure], paths. */
function tube(id: string, name: string, colors: string[], g: V4, t: V4, paths: Path[]): Wallpaper {
  return { id: `neon-${id}`, name, collection: C, style: 'tube', colors, params: [...g, ...t, ...paths.flat()] }
}

/** Laser grids (grid.wgsl). Colors: sky top, sky horizon, floor, lines, horizon glow, sun top, sun bottom. */
function grid(id: string, name: string, colors: string[], a: V4, b: V4, c: V4, d: V4): Wallpaper {
  return { id: `neon-${id}`, name, collection: C, style: 'grid', colors, params: [...a, ...b, ...c, ...d] }
}

const Z: V4 = [0, 0, 0, 0]

/** Structured gradients (aurora.wgsl): ramp colors, then curtain core, tail, lobe colors. */
function aurora(id: string, name: string, ramp: string[], extra: string[], o: { sweep: V4; warp: V4; ramp: [twist: number, sheen: number, sheenAngle: number]; curtain?: V4; tail?: V4; lobes?: V4[]; curtain2?: V4; prism?: V4; beam?: V4; stretch?: V4 }): Wallpaper {
  const l = o.lobes ?? []
  return {
    id: `neon-${id}`, name, collection: C, style: 'aurora', colors: [...ramp, ...extra],
    params: [...o.sweep, ...o.warp, ramp.length, ...o.ramp, ...(o.curtain ?? Z), ...(o.tail ?? Z), ...(l[0] ?? Z), ...(l[1] ?? Z), ...(o.curtain2 ?? Z), ...(o.prism ?? Z), ...(o.beam ?? Z), ...(o.stretch ?? Z)],
  }
}

export const NEON: Wallpaper[] = [
  // Luminous blobs, entering from edges and corners.
  glow('blush', 'Blush', ['#040203', '#ff8fa8', '#ffc9d4', '#ff5f86'], [1.1, 0.03, 0.55, 0.16], [0.4, 1.2, 0.35, 2.0], [
    [0.14, 0.8, 0.15, 0.9],
    [0.25, 0.73, 0.16, 1.0],
    [0.12, 0.92, 0.12, 0.8],
    [0.34, 0.84, 0.1, 0.6],
  ]),
  glow('ultraviolet', 'Ultraviolet', ['#04030b', '#8a5cff', '#c7b6ff', '#5b33e0'], [1.15, 0.04, 0.6, 0.2], [-0.15, 2.4, 0.3, 4.0], [
    [0.98, 0.16, 0.18, 1.0],
    [0.84, 0.2, 0.13, 0.85],
    [1.06, 0.3, 0.12, 0.7],
    [0.9, 0.06, 0.1, 0.6],
  ]),
  glow('plasma', 'Plasma', ['#010106', '#2433ff', '#ff3d78', '#8a3cff', '#2f7bff'], [1.3, 0.064, 0.35, 0.32], [-0.45, 2.8, 0.5, 1.0], [
    [0.22, 0.66, 0.1, 0.9],
    [0.4, 0.54, 0.12, 1.0],
    [0.58, 0.44, 0.1, 0.85],
    [0.76, 0.36, 0.11, 0.7],
    [0.52, 0.64, 0.08, 0.6],
    [0.68, 0.54, 0.07, 0.5],
  ]),
  glow('binary', 'Binary', ['#0a0410', '#ffb347', '#ff4f8b', '#ffd68a', '#ff7aa8'], [1.1, 0.048, 0.5, 0.18], [0.5, 1.1, 0.3, 3.0], [
    [0.26, 0.38, 0.13, 1.0],
    [0.8, 0.66, 0.14, 1.0],
    [0.3, 0.32, 0.08, 0.6],
    [0.75, 0.7, 0.09, 0.6],
  ]),
  glow('corona', 'Corona', ['#070201', '#ff9a3c', '#ffd9a0', '#ff4a2a', '#ffb070'], [1.2, 0.06, 0.6, 0.3], [-0.08, 3.2, 0.25, 5.0], [
    [0.12, 0.86, 0.09, 0.8],
    [0.36, 0.8, 0.11, 1.0],
    [0.62, 0.74, 0.1, 0.9],
    [0.86, 0.7, 0.08, 0.7],
    [0.5, 0.84, 0.07, 0.6],
  ]),

  // Motion-blurred bars: a diagonal band, a vertical field, stacked horizontals, a corner group,
  // one lone bar.
  streaks('afterimage', 'Afterimage', ['#020203', '#08080a', '#f4f4f6', '#c9ccd4'], [-1.05, -0.6, 0.07, 0.85], [0.085, 0.62, 0.42, 0.4], [0, 0.32, 1, 0.05], [1.1, 0.1, 0.004, 0.4], [0.8, 0.5, 0.5, 0.5], [0.45, 0.55, 0.6, 0.5]),
  streaks('strobe', 'Strobe', ['#000000', '#050506', '#ffffff', '#cfd2d8', '#8e9096'], [-1.5708, -1.49, 0.07, 0.9], [0.028, 0.45, 0.9, 0.85], [0, 1.0, 23, 0.03], [1.1, 0.06, 0.002, 0.5], [1.57, 0, 0.5, 0.5], [0, 0.85, 0.5, 0]),
  streaks('newsprint', 'Newsprint', ['#f6f6f7', '#e2e2e5', '#000000', '#141416', '#3a3a3e'], [0, 0.1, 0.12, 0.6], [0.06, 0.55, 0.75, 0.6], [0, 0.32, 17, 0.0], [1.0, 0.0, 0.006, 0.2], [1.57, 0, 0.5, 0.5], [0.6, 0.3, 0.3, 0.2], 0.3),
  streaks('infrared', 'Infrared', ['#020101', '#070203', '#ff3340', '#ff5a5f', '#ff2a4a'], [0.95, 0.6, 0.16, 0.95], [0.12, 0.6, 0.5, 0.4], [0, 0.26, 9, 0.2], [1.4, 0.15, 0.006, 0.4], [2.4, 0.2, 0.8, 0.22], [0.3, 0.45, 0.65, 0.4], 0.4),
  streaks('signal', 'Signal', ['#062327', '#0b3a40', '#ffffff', '#e8fbff'], [-0.75, -0.42, 0.2, 0.85], [0.2, 0.8, 1.5, 0], [0, 0.15, 7, 0.35], [1.3, 0.12, 0.006, 0.45], [0.8, 0.3, 0.5, 0.52], [0, 0, 0.6, 0.6], 0.5),

  // Polar bars: a zoom burst around a calm center, and orbit arcs swung around a point off frame.
  streaks('warp', 'Warp', ['#010104', '#03030c', '#e6ecff', '#7f9bff', '#ffffff'], [0, 0, 0.35, 0.9], [0.09, 0.35, 0.9, 0.7], [-1.0, 100, 31, 0.08], [1.3, 0, 0.004, 0.2], [0, 0, 0.5, 0.5], [0, 0.65, 0.7, 0], 0.4, [3.1416, 1]),
  streaks('ultramarine', 'Ultramarine', ['#01010a', '#05041c', '#5b6cff', '#a07cff', '#e6ebff'], [0, 1.5708, 1.3, 1], [0.45, 0.14, 0.05, 0.4], [-1.2, 3, 11, 0], [22, 0, 0.004, 0.3], [2.4, 0, -0.15, 1.35], [0.67, 0.45, 0, 0], 0.5, [-0.635, 3]),

  // Light rings, off center so their bright arcs frame the content.
  ring('orbit', 'Orbit', ['#0c0c0d', '#020202', '#ffffff'], [0.2, 0.02, 0, 1.2], [[0.12, 0.8, 0.62, 0.4, -0.3, 0.0024, 1, -0.7]], [1.0, 0.2, 0.8, 3.0]),
  ring('porcelain', 'Porcelain', ['#dcdcdf', '#b4b4b9', '#ffffff'], [0.3, 0.02, 0.5, 1.6], [[1.02, 0.42, 0.45, 0.33, 0.35, 0.0026, 1, 2.6]], [0.9, 0.9, 0.45, 3.0]),
  ring('garnet', 'Garnet', ['#2a0b10', '#0d0305', '#ff5d7a'], [0.5, 0, 0, 1.8], [[0.5, 0.72, 0.8, 0.1, -0.04, 0.0034, 1.4, 1.57]], [1.0, 0.5, 0.75, 2.0]),
  ring('gyre', 'Gyre', ['#070a1c', '#020309', '#5b8cff', '#b06bff'], [0.25, 0.025, 0, 1.3], [[0.58, 0.5, 0.42, 0.22, -0.5, 0.002, 1, 0.4], [0.62, 0.52, 0.3, 0.17, -0.25, 0.0018, 0.8, 1.2]], [1.0, 0.6, 0.5, 2.5]),

  // Ring tunnels: echoes receding toward a vanishing point.
  ring('annulus', 'Annulus', ['#100903', '#030201', '#ffb347', '#ffd9a0'], [0.12, 0, 0, 1.2], [[0.5, 0.5, 0.66, 0.44, 0.05, 0.0022, 1, 1.2]], [1.0, 0.5, 0.5, 1.5], [10, 0.8, 0.018, -0.006], 0.84),
  ring('wormhole', 'Wormhole', ['#05030e', '#010104', '#29e6ff', '#ff3fd2'], [0.15, 0, 0, 1.2], [[0.5, 0.5, 0.62, 0.62, 0, 0.002, 1, 2.3]], [1.0, 0.5, 0.5, 1.2], [14, 0.84, -0.012, 0.01], 0.88),

  // Gradient spheres.
  sphere('cobalt', 'Cobalt', ['#060a1c', '#01020a', '#b8c8ff', '#5b78ff', '#3b2bd9', '#1a0f5a', '#06040f'], [-0.6, -0.7, 0.9, 0.7], [0.9, 0, 0.25, 1.0], [[1.02, 1.0, 0.48, 0]]),
  sphere('phosphor', 'Phosphor', ['#010806', '#000201', '#eafff5', '#5dffc0', '#13b98a', '#05402f', '#010a07'], [0.55, 0.55, 0.8, 0.6], [0.9, 0, 0.3, 1.0], [[0.16, 0.24, 0.2, 0], [0.42, 0.1, 0.045, 0.08]]),
  sphere('hyperblue', 'Hyperblue', ['#f1ecff', '#d6cdf3', '#fff4fa', '#ffb3d9', '#b9a4ff', '#6f7dff', '#3a3fc9'], [-0.5, -0.6, 0.3, 0.15], [0.6, 0.5, 0.4, 1.0], [[0.2, 0.6, 0.24, 0], [0.88, 0.3, 0.085, 0.12]]),

  // Bokeh fields.
  bokeh('tail-lights', 'Tail Lights', ['#030102', '#0a0305', '#ff3b30', '#ff9f40', '#ffd28a', '#ff5a6e'], [0.07, 0.6, 0.25, 0.6], [3, 0.12, 0.6, 1], [0.25, 0.2, 0.17, 0.85], [0.3, 1.4, 1.57, 0.3]),
  bokeh('wake', 'Wake', ['#021216', '#03222a', '#48e0ff', '#2a8cff', '#b8f6ff', '#19c2b0'], [0.09, 0.5, 0.2, 0.55], [3, 0.08, 0.7, 5], [0, 0, 1, 0], [0.9, 1.2, -1.2, 0]),
  bokeh('fuchsia', 'Fuchsia', ['#2a0629', '#12031f', '#ff4fd8', '#b45cff', '#ff9ad5', '#7a4bff'], [0.13, 0.65, 0.3, 0.7], [2, 0.25, 0.4, 9], [-0.5, -0.12, 0.26, 0.7], [0.3, 1.1, 0.8, 0.4]),

  // Neon tubes: bent glass, white-hot cores, dark electrodes.
  tube('marquee', 'Marquee', ['#0a0716', '#020205', '#ff4fa3', '#3fa0ff'], [0.006, 0.7, 1, 0], [0, 0, 0.9, 1.2], [
    [-0.02, 0.42, 0.34, 0.04, 0.55, 0, 1, 1],
    [0.66, 0.9, 0.9, 0.72, 0.9, 1, 1, 1],
    [0.9, 0.72, 1.14, 0.54, -0.9, 1, 1, 1],
    [0.76, 0.22, 1.05, 0.15, 0, 0, 0.9, 0.8],
  ]),
  tube('argon', 'Argon', ['#07041a', '#010106', '#9b5cff', '#ff5ce1'], [0.007, 0.8, 1, 0], [0, 0, 0.9, 1.2], [
    [-0.15, 0.8, 0.3, 0.76, 0.7, 0, 1, 1],
    [0.3, 0.76, 0.75, 0.72, -0.7, 0, 1, 1],
    [0.75, 0.72, 1.2, 0.68, 0.7, 1, 1, 1],
  ]),
  tube('filament', 'Filament', ['#120804', '#030101', '#ffb347', '#ff7a2a', '#fff0d0'], [0.0055, 0.7, 1, 0], [0, 0, 0.9, 1.2], [
    [1.06, 0.12, 1.06, 0.66, 1.6, 0, 1, 1],
    [-0.12, 0.8, 0.36, 0.8, 0, 2, 0.9, 0.8],
    [-0.12, 0.74, 0.2, 0.74, 0, 1, 0.8, 0.7],
  ]),

  // Light trails: long exposures of moving lights along curves.
  tube('amber-lane', 'Amber Lane', ['#060304', '#010101', '#ff3b30', '#ffe6c0', '#ff9a3c'], [0.003, 0.8, 6, 0.013], [0.35, 0, 0.8, 1.6], [
    [-0.25, 0.62, 1.25, 0.86, -0.35, 0, 1, 1],
    [-0.25, 0.74, 1.25, 1.0, -0.3, 1, 0.9, 1],
  ]),
  tube('slipstream', 'Slipstream', ['#020812', '#010205', '#3fe6ff', '#ffffff', '#3f7bff'], [0.0022, 0.7, 3, 0.009], [0.9, 0, 0.8, 1.5], [
    [-0.2, 0.05, 0.62, 0.95, 0, 0, 1, 1],
    [-0.2, 0.05, 1.0, 0.82, 0, 1, 0.9, 1],
    [-0.2, 0.05, 1.22, 0.5, 0, 2, 0.8, 1],
    [-0.2, 0.05, 0.25, 1.0, 0, 1, 0.7, 1],
  ]),
  tube('shutter', 'Shutter', ['#060208', '#010102', '#ff4fd8', '#ffffff', '#ffb347', '#3fe6ff'], [0.0024, 0.65, 5, 0.013], [0.9, 0, 0.8, 1.4], [
    [-0.3, 0.9, 0.5, 0.5, 0.45, 0, 1, 1],
    [0.5, 0.5, 1.3, 0.1, -0.45, 0, 1, 1],
  ]),

  // Laser grids.
  grid('twilight', 'Twilight', ['#0b0420', '#4a1460', '#07020f', '#ff3fd2', '#ff5aa0', '#ffd36b', '#ff3f8e'], [0.62, 0.08, 0.06, 2], [0.8, 3, 0.03, 0.5], [0, 0, 0.19, 0.5], [10, 0.5, 0, 1.2]),
  grid('corridor', 'Corridor', ['#01040a', '#06223a', '#010308', '#3ff0ff', '#7fd8ff', '#000000', '#000000'], [0.5, 0.12, 0.08, 1.6], [0.7, 4, 0.0, 0.5], [1, 0, 0, 0], [0, 0.35, 0, 1.2]),
  grid('lattice', 'Lattice', ['#010402', '#031008', '#000000', '#39ff88', '#000000', '#000000', '#000000'], [0.5, 0, 0.07, 1.4], [0.6, 1, 0, 0.5], [2, 0.35, 0, 0], [0, 0, 0.85, 1.1]),

  // Aurora curtains.
  aurora('borealis', 'Borealis', ['#010309', '#040b22', '#0a1d3f'], ['#6dffc4', '#2f7bff'], { sweep: [0, 1.57, 0.5, 0.5], warp: [0.02, 2, 2, 0.4], ramp: [0, 0, 0], curtain: [0.76, 0.07, 0.03, 1.1], tail: [7, 0.95, 44, -0.08], curtain2: [0.5, 0.05, 0.03, 0.3] }),
  aurora('vespers', 'Vespers', ['#0d0424', '#200a45', '#3a1260'], ['#ff5fd0', '#7a5cff'], { sweep: [0, 1.57, 0.5, 0.5], warp: [0.04, 2, 8, 0.4], ramp: [0, 0, 0], curtain: [0.34, 0.07, 0.045, 0.9], tail: [4, 0.85, 30, 0.15], curtain2: [0.82, 0.05, 0.05, 0.6] }),

  // Light leaks: warm light spilling in from an edge, in banded streaks.
  aurora('flare', 'Flare', ['#10040c', '#180614', '#22081c'], ['#000000', '#000000', '#ff4f7a', '#b05cff'], { sweep: [0, 0.5, 0.5, 0.5], warp: [0.03, 2, 1, 0.4], ramp: [0, 0, 0], lobes: [[-0.05, 0.12, 0.36, 1.3], [0.1, 0.0, 0.24, 0.9]], stretch: [0.6, 2.2, 24, 0.35] }),
  aurora('sherbet', 'Sherbet', ['#16213f', '#22325c', '#33437a'], ['#000000', '#000000', '#ffc39b', '#ff8fc0'], { sweep: [0, -1.57, 0.5, 0.5], warp: [0.03, 2, 2, 0.3], ramp: [0, 0, 0], lobes: [[0.35, 1.05, 0.34, 1.2], [0.75, 1.0, 0.26, 0.9]], stretch: [1.57, 2.4, 34, 0.45] }),

  // Prism beams.
  aurora('kaleido', 'Kaleido', ['#05040c', '#0b0a1a', '#120f26'], ['#000000', '#000000'], { sweep: [0, 0.4, 0.5, 0.5], warp: [0.02, 2, 3, 0.4], ramp: [0, 0, 0], prism: [0.3, 0.55, -0.15, 0.5], beam: [0.012, 1.3, 1.2, 0] }),
  aurora('dispersion', 'Dispersion', ['#141032', '#1d1650', '#2b1c6a'], ['#000000', '#000000', '#7a5cff'], { sweep: [0, 1.0, 0.5, 0.5], warp: [0.03, 2, 4, 0.4], ramp: [0, 0, 0], lobes: [[0.85, 0.1, 0.3, 0.25]], prism: [0.82, 0.12, 2.1, 0.32], beam: [0.018, 1.1, 1.6, 0.3] }),
]
