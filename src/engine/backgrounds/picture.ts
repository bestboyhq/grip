// Owner: compositor. How a built-in wallpaper's picture is written down, and how it packs into a Wallpaper.
// A picture is drawn on a sheet 1 high with its middle at 0, 0, x to the right and y down. The output's
// aspect decides how much of the sheet shows to the sides, so a square tile shows the middle of a wide frame.
// Every picture has a sky: four colors, each at its own point, that run into each other. In front of it lie
// up to four dunes (style `dunes`), or what a collection adds in their place (neon.ts), or nothing (style `sky`).

import type { Wallpaper } from './index.ts'

/** A point of the sky: x, y, its color, and how much it weighs against the other three (1 when left out). */
export type SkyPoint = [x: number, y: number, color: string, weight?: number]

/** One long wave: sharp and lit at its crest, its color shifting along the crest and deepening below it. */
export interface Dune {
  /** The colors of its crest's two ends. */
  a: string
  b: string
  /** The color of its depth: one, or one under each end. */
  d: string[]
  /** Over 0 the crest falls to the right; near pi the dune hangs from the top. */
  angle: number
  /** Where the crest crosses the middle. */
  line: number
  /** Height, scale and phase of its wave. */
  height: number
  scale: number
  ph: number
  /** How soft its edge is. */
  blur: number
  /** How solid it is at the crest and far below it. */
  top: number
  deep: number
  /** How far its color takes to deepen. */
  depth: number
  /** The line of light on its crest. */
  rim: number
  /** What it casts on what lies behind it, and how far. */
  shade: number
  reach: number
  /** The span along the crest (0 to 1) over which it fades in, and the span over which its color shifts. */
  fade: [number, number]
  along: [number, number]
  /** A sheet of threads: how many lie in one depth, and how much they show. */
  threads: number
  thread: number
  /** How much the sheet swells and thins along its crest, and where it does. */
  pinch: number
  turn: number
  /** From -1 to 1: lights the slopes that face one side and darkens the others. */
  light: number
}

export interface Picture {
  sky: SkyPoint[]
  /** Back to front, at most four. */
  dunes?: Dune[]
  /** What lies on the sky in place of dunes: its style, the rows the style reads after the sky's, and its colors. */
  style?: string
  rows?: number[][]
  cols?: string[]
}

export const dune = (a: string, b: string, d: string | string[], angle: number, line: number, height: number, scale: number, ph: number, o: Partial<Dune> = {}): Dune =>
  ({ a, b, d: [d].flat(), angle, line, height, scale, ph, blur: 0, top: 1, deep: 1, depth: 0.28, rim: 0.6, shade: 0.12, reach: 0.05, fade: [-10, -9], along: [0, 1], threads: 0, thread: 0, pinch: 0, turn: 0, light: 0, ...o })
/** A faint fold in the sky: a line of light that melts below it. */
export const veil = (c: string, angle: number, line: number, height: number, scale: number, ph: number, o: Partial<Dune> = {}) =>
  dune(c, c, c, angle, line, height, scale, ph, { top: 0.4, deep: 0, depth: 0.22, shade: 0.05, ...o })

/** The wallpaper a picture makes. The shader reads the sky's points in P.pts[0..3] and its colors in P.cols[0..3];
 *  a dune follows as six rows and four colors, anything else as the rows and colors of its style. */
export function picture(collection: string, id: string, name: string, { sky, dunes = [], style, rows = [], cols = [] }: Picture): Wallpaper {
  return {
    id,
    name,
    collection,
    style: style ?? (dunes.length ? 'dunes' : 'sky'),
    colors: [...sky.map((p) => p[2]), ...dunes.flatMap((d) => [d.a, d.b, d.d[0], d.d.at(-1)!]), ...cols],
    params: [
      ...sky.flatMap(([x, y, , weight = 1]) => [x, y, weight, 0]),
      ...dunes.flatMap((d) => [d.angle, d.line, d.height, d.scale, d.ph, d.blur, d.top, d.deep, d.depth, d.rim, d.reach, d.shade, ...d.fade, ...d.along, d.threads, d.thread, d.pinch, d.turn, d.light, 0, 0, 0]),
      ...rows.flat(),
    ],
  }
}
