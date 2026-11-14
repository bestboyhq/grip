import type { Wallpaper } from './index.ts'
import { picture, type Picture, type SkyPoint } from './picture.ts'

const neon = (id: string, name: string, p: Picture) => picture('Neon', `neon-${id}`, name, p)
const flat = (c: string | SkyPoint[]): SkyPoint[] => (typeof c === 'string' ? [[-0.6, -0.5, c], [0.6, -0.5, c], [0.6, 0.3, c], [-0.6, 0.3, c]] : c)
/** A glow on black: three lobes [x, y, radius, weight] that melt into one shape, then the colors of its heart, its
 *  edge and its halo. The last row: where the edge begins, where the heart does, how strong the halo is, and how
 *  much the lower side keeps its color. */
const glow = (lobes: number[][], heart: string, edge: string, halo: string): Picture =>
  ({ sky: flat('#020203'), style: 'glow', rows: [...lobes, [0.22, 0.62, 0.4, 1.6]], cols: [heart, edge, halo] })
/** A layer of streaks: its fringe and core colors, then the bars' angle and period, the band's y and the bars'
 *  length. blur softens a bar's sharp side, decay is how fast it fades to its other side, gain how bright it is. */
const bar = (fringe: string, core: string, angle: number, period: number, y: number, length: number, o: { blur?: number; decay?: number; seed?: number; gain?: number } = {}) =>
  ({ fringe, core, gain: o.gain ?? 1.4, rows: [[angle, period, y, length], [o.blur ?? 0.05, o.decay ?? 0.8, o.seed ?? 1, 0]] })
/** Up to three layers of streaks, back to front. */
const streaks = (sky: string | SkyPoint[], ...layers: ReturnType<typeof bar>[]): Picture => ({
  sky: flat(sky),
  style: 'streaks',
  rows: [...[0, 1, 2].flatMap((i) => layers[i]?.rows ?? [[0, 0, 0, 0], [0, 0, 0, 0]]), [0, 1, 2, 3].map((i) => layers[i]?.gain ?? 0)],
  cols: layers.flatMap((l) => [l.fringe, l.core]),
})
/** A ring: the colors of its line and its glow, then its middle, its two radii and its angle. from is where on the
 *  ring the glow is widest, wide how wide it gets, dim how bright it stays there, inside how dark the inside is. */
const ring = (sky: string | SkyPoint[], line: string, halo: string, x: number, y: number, rx: number, ry: number, angle: number, o: { from?: number; wide?: number; inside?: number; dim?: number } = {}): Picture =>
  ({ sky: flat(sky), style: 'ring', rows: [[x, y, rx, ry], [angle, o.from ?? -2.4, 0.003, o.wide ?? 0.14], [o.inside ?? 0, o.dim ?? 0.55, 2, 0]], cols: [line, halo] })
/** Four colors that run into each other, and nothing else. */
const mesh = (...sky: SkyPoint[]): Picture => ({ sky })

// Neon has no dunes: a glow, slanted streaks or a ring on black, or four colors alone.
export const NEON: Wallpaper[] = [
  neon('blush', 'Blush', glow([[-0.17, -0.02, 0.2, 1], [0.13, -0.06, 0.22, 1], [0, 0.1, 0.16, 0.7]], '#fff4f2', '#ff5a78', '#7a1028')),
  neon('ultraviolet', 'Ultraviolet', glow([[-0.14, 0.02, 0.18, 1], [0.15, -0.05, 0.23, 1], [0.05, 0.12, 0.15, 0.6]], '#f8f0ff', '#9a50ff', '#30107a')),
  neon('plasma', 'Plasma', glow([[-0.2, 0.05, 0.17, 1], [0.02, -0.05, 0.22, 1], [0.24, 0.04, 0.16, 0.9]], '#f0fbff', '#3a90ff', '#0a2070')),
  neon('binary', 'Binary', glow([[-0.17, 0.02, 0.19, 1], [0.19, -0.02, 0.19, 1], [0, 0, 0.12, 0.4]], '#f4fff8', '#30e0a0', '#06503a')),
  neon('corona', 'Corona', glow([[0, -0.04, 0.24, 1.5], [-0.16, 0.1, 0.14, 0.7], [0.18, 0.08, 0.13, 0.7]], '#fff8e8', '#ff9a30', '#6a2a00')),
  neon('afterimage', 'Afterimage', streaks('#020308', bar('#101a90', '#3a50ff', -0.7, 0.36, 0.02, 0.5, { blur: 0.5, decay: 0.6, seed: 2, gain: 1.3 }), bar('#a03a70', '#ffb0c0', -0.7, 0.19, -0.02, 0.44, { seed: 5 }))),
  neon('strobe', 'Strobe', streaks('#020202', bar('#505050', '#f4f4f4', -0.65, 0.16, 0, 0.32, { seed: 1 }))),
  neon('newsprint', 'Newsprint', streaks('#d4d4d4', bar('#9a9a9a', '#6a6a6a', -0.7, 0.36, 0, 0.5, { blur: 0.5, decay: 0.6, seed: 4, gain: 1 }), bar('#606060', '#0a0a0a', -0.7, 0.2, 0.02, 0.5, { seed: 8 }))),
  neon('infrared', 'Infrared', streaks('#030202', bar('#8a1414', '#ff3a34', -0.65, 0.16, 0, 0.3, { seed: 3, decay: 0.6 }))),
  neon('signal', 'Signal', streaks('#8ab8bc', bar('#5a8a90', '#3a5a60', -0.7, 0.4, 0.05, 0.55, { blur: 0.5, decay: 0.6, seed: 6, gain: 1 }), bar('#a0c8cc', '#e8f0f0', -0.7, 0.22, -0.05, 0.52, { seed: 2 }))),
  neon('warp', 'Warp', streaks('#030208', bar('#2010a0', '#3a30ff', -0.75, 0.3, -0.03, 0.5, { blur: 0.5, decay: 0.6, seed: 9, gain: 1.4 }), bar('#6a30c0', '#e0b0ff', -0.75, 0.18, 0.03, 0.42, { seed: 4, decay: 1.1 }))),
  neon('ultramarine', 'Ultramarine', streaks('#01030a', bar('#0a2ab0', '#e8f0ff', -0.6, 0.17, 0, 0.34, { seed: 7, decay: 1 }))),
  neon('orbit', 'Orbit', ring('#040404', '#ffffff', '#b0b0b0', 0.03, 0.03, 0.21, 0.145, 0.5)),
  neon('porcelain', 'Porcelain', ring('#d2d2d2', '#ffffff', '#f6f6f6', 0.02, 0.02, 0.22, 0.15, 0.45, { inside: 0.05, dim: 0.9 })),
  neon('garnet', 'Garnet', ring([[-0.6, -0.5, '#1a0609'], [0.6, -0.5, '#120406'], [0.6, 0.3, '#1e080c'], [-0.6, 0.3, '#140507']], '#fff0f4', '#e04a80', 0.04, 0.03, 0.2, 0.14, 0.55)),
  neon('gyre', 'Gyre', ring('#03030c', '#f0f4ff', '#5a50ff', -0.02, 0.02, 0.24, 0.125, 0.3, { from: -1.9 })),
  neon('annulus', 'Annulus', ring('#060300', '#fff8e0', '#ff9a20', 0, 0.02, 0.18, 0.16, 0.8, { from: -2.8 })),
  neon('wormhole', 'Wormhole', ring('#020408', '#e0ffff', '#e040d0', 0.03, 0, 0.23, 0.11, 0.2, { from: -2.2, wide: 0.17 })),
  neon('cobalt', 'Cobalt', mesh([-0.5, -0.5, '#70d0f8'], [0.5, -0.4, '#3a40d8'], [0.3, 0.4, '#a880f8'], [-0.5, 0.4, '#c0a0ff'])),
  neon('phosphor', 'Phosphor', mesh([-0.5, -0.5, '#141050'], [0.5, -0.5, '#1a1a70'], [0.4, 0.3, '#60f0c8'], [-0.5, 0.2, '#50e0d0'])),
  neon('hyperblue', 'Hyperblue', mesh([-0.5, -0.5, '#1a10a0'], [0.5, -0.5, '#3a20d0'], [0.4, 0.4, '#2a60ff'], [-0.5, 0.4, '#5a30e0'])),
  neon('tail-lights', 'Tail Lights', streaks('#030101', bar('#7a1010', '#ff3a30', -0.75, 0.3, 0, 0.52, { seed: 17, blur: 0.08 }), bar('#0a3a50', '#3a90b0', -0.75, 0.5, 0.24, 0.42, { blur: 0.45, decay: 0.7, seed: 4, gain: 0.8 }))),
  neon('wake', 'Wake', streaks('#c8d0d0', bar('#7ab0b8', '#4a98a4', -0.7, 0.42, -0.1, 0.55, { blur: 0.5, decay: 0.6, seed: 5, gain: 1 }), bar('#6a7474', '#1c2424', -0.7, 0.22, 0, 0.5, { seed: 3, gain: 1.3 }), bar('#e8a090', '#e06a58', -0.7, 0.44, 0.34, 0.42, { blur: 0.5, decay: 0.6, seed: 8, gain: 0.9 }))),
  neon('fuchsia', 'Fuchsia', streaks('#060108', bar('#8a1070', '#ff40c0', -0.65, 0.3, 0, 0.44, { blur: 0.45, decay: 0.6, seed: 14, gain: 1.4 }), bar('#c060b0', '#ffe0f4', -0.65, 0.17, 0, 0.42, { seed: 6, decay: 1 }))),
  neon('marquee', 'Marquee', streaks('#040202', bar('#801414', '#f04a3a', -0.65, 0.3, 0.02, 0.44, { blur: 0.45, decay: 0.6, seed: 3, gain: 1.4 }), bar('#909090', '#f4f4f4', -0.65, 0.17, 0, 0.42, { seed: 5 }))),
  neon('argon', 'Argon', streaks('#04020a', bar('#5a2ab0', '#f0e0ff', -0.7, 0.17, 0, 0.46, { seed: 11, decay: 1 }))),
  neon('filament', 'Filament', streaks('#050301', bar('#a04a08', '#fff0c0', -0.6, 0.15, 0, 0.3, { seed: 13, decay: 1.1 }))),
  neon('amber-lane', 'Amber Lane', streaks('#040200', bar('#7a3a04', '#ffa830', -0.8, 0.32, 0, 0.55, { seed: 6, blur: 0.08 }))),
  neon('slipstream', 'Slipstream', streaks('#01060a', bar('#0a5a70', '#40e0e0', -0.7, 0.32, 0.03, 0.5, { blur: 0.5, decay: 0.6, seed: 12, gain: 1.3 }), bar('#70a8b0', '#f0ffff', -0.7, 0.18, -0.02, 0.44, { seed: 2, decay: 1.1 }))),
  neon('shutter', 'Shutter', streaks('#020202', bar('#404040', '#e0e0e0', -0.8, 0.3, 0, 0.5, { seed: 15, blur: 0.1 }), bar('#606060', '#ffffff', -0.8, 0.2, 0.08, 0.2, { seed: 9, decay: 1.6 }))),
  neon('twilight', 'Twilight', mesh([-0.5, -0.5, '#5a40c0'], [0.5, -0.5, '#4a3090'], [0.4, 0.4, '#e07a70'], [-0.5, 0.4, '#8a70d0'])),
  neon('corridor', 'Corridor', mesh([-0.5, -0.5, '#1a0a70'], [0.5, -0.5, '#4a10a0'], [0.3, 0.4, '#e090d0'], [-0.5, 0.4, '#5a1080'])),
  neon('lattice', 'Lattice', mesh([-0.5, -0.5, '#90a0f0'], [0.5, -0.5, '#a0c0f8'], [0.5, 0.4, '#f0f0d8'], [-0.5, 0.4, '#a0e8f0'])),
  neon('borealis', 'Borealis', mesh([-0.5, -0.5, '#103a60'], [0.5, -0.5, '#6a30c0'], [0.4, 0.4, '#30e0a0'], [-0.5, 0.3, '#20b0c0'])),
  neon('vespers', 'Vespers', mesh([-0.5, -0.5, '#a03a80'], [0.5, -0.5, '#b060c0'], [0.5, 0.4, '#7a50d0'], [-0.5, 0.4, '#c04a90'])),
  neon('flare', 'Flare', mesh([-0.4, -0.5, '#f0b030'], [0.5, -0.5, '#d08a30'], [-0.5, 0.2, '#f06a50'], [0.4, 0.3, '#c0b0f0'])),
  neon('sherbet', 'Sherbet', mesh([-0.5, -0.5, '#f0f0a0'], [0.4, -0.5, '#f8fff0'], [0, 0.3, '#e86a70'], [0.6, 0, '#d0c0f8'])),
  neon('kaleido', 'Kaleido', mesh([-0.5, -0.4, '#8a30f0'], [0.5, -0.4, '#e03a60'], [0.2, 0.4, '#f8d0b0'], [-0.4, 0.4, '#5a50f0'])),
  neon('dispersion', 'Dispersion', mesh([-0.5, -0.5, '#f0b0a0'], [0.5, -0.5, '#b070e0'], [0.5, 0.4, '#8a60e8'], [-0.5, 0.4, '#f080c8'])),
]
