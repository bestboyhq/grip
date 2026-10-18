// The README ink demo: a raw 9.8 s take of a landing page draft. ⌥⇧⌘D turns on the pen, then the
// ink circles the headline, an arrow sweeps down to the trial button, and a quick line underlines
// the price. The zooms push in while drawing and pull back out as the ink fades on its own.
import type { Demo } from '../make.ts'
import { glide, pointer, press, stroke, type Pt } from '../input.ts'

const DURATION = 9.8
const HZ = 120 // stroke() and pointer() sample at this rate; stroke times sit on its grid
const REST: Pt = [836, 700]

/** A hand's pace through one piece of a stroke: slower into and out of it by `k` (0..1). */
const pace = (s: number, k: number) => (1 - k) * s + k * (0.5 - 0.5 * Math.cos(Math.PI * s))
const mix = (a: Pt, b: Pt, u: number): Pt => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
const bezier = (a: Pt, b: Pt, c: Pt, d: Pt) => (u: number) => mix(mix(mix(a, b, u), mix(b, c, u), u), mix(mix(b, c, u), mix(c, d, u), u), u)
const quad = (a: Pt, b: Pt, c: Pt) => (u: number) => mix(mix(a, b, u), mix(b, c, u), u)

/** A stroke from t0 through pieces drawn one after another, each [path over 0..1, seconds, slowing]:
 *  its start and end time and the pen at every 1/HZ s, so stroke() and the pointer share each sample. */
function pen(t0: number, pieces: Array<[(u: number) => Pt, number, number]>) {
  const pts: Pt[] = []
  for (const [i, [path, dur, k]] of pieces.entries()) {
    const n = Math.round(dur * HZ)
    for (let j = i ? 1 : 0; j <= n; j++) pts.push(path(pace(j / n, k)))
  }
  return { t0, t1: t0 + (pts.length - 1) / HZ, pts }
}

// One lap and a bit of a loose oval around the headline, started over "days", counterclockwise,
// ending a little wider than it began so the closing pass shows beside the first.
const oval = (u: number): Pt => {
  const a = -1.0 - (2 * Math.PI + 0.8) * u
  const r = (0.97 + 0.06 * u) * (1 + 0.02 * Math.sin(2 * a + 0.7))
  const f = (v: number) => Math.sign(v) * Math.abs(v) ** (2 / 2.8) // squarer than an ellipse, so it clears the corner letters
  return [320 + 295 * r * f(Math.cos(a)), 334 + 105 * r * f(Math.sin(a))]
}
// The arrow: a sweep down past the subhead to the trial button, then its head in the same stroke.
const TIP: Pt = [292, 574]
const BARB_UP: Pt = [318, 557]
const BARB_DOWN: Pt = [316, 591]
const CIRCLE = pen(1.15, [[oval, 0.85, 0.35]])
const ARROW = pen(2.45, [
  [bezier([606, 410], [660, 460], [566, 572], TIP), 0.75, 0.5],
  [(u) => mix(TIP, BARB_UP, u), 0.1, 0.8],
  [(u) => mix(BARB_UP, TIP, u), 0.09, 0.8],
  [(u) => mix(TIP, BARB_DOWN, u), 0.11, 0.8],
])
// The underline: out under $24 and straight back, a little lower.
const UNDERLINE = pen(4.6, [
  [quad([928, 374], [995, 368], [1061, 366]), 0.27, 0.45],
  [quad([1061, 366], [1036, 384], [942, 387]), 0.24, 0.45],
])
const STROKES = [CIRCLE, ARROW, UNDERLINE]
const first = (s: typeof CIRCLE) => s.pts[0]
const last = (s: typeof CIRCLE) => s.pts[s.pts.length - 1]

// Between strokes the hand glides; on a stroke the pointer is the pen.
const travel = glide([
  [0, ...REST], [0.5, ...REST], [CIRCLE.t0, ...first(CIRCLE)], [CIRCLE.t1, ...last(CIRCLE)], [CIRCLE.t1 + 0.1, ...last(CIRCLE)],
  [ARROW.t0, ...first(ARROW)], [ARROW.t1, ...last(ARROW)], [ARROW.t1 + 0.15, ...last(ARROW)],
  [UNDERLINE.t0 - 0.05, ...first(UNDERLINE)], [UNDERLINE.t1, ...last(UNDERLINE)], [5.9, ...last(UNDERLINE)],
  [6.8, ...REST], [DURATION, ...REST],
])
const at = (t: number): Pt => {
  for (const s of STROKES) if (t >= s.t0 && t <= s.t1) return s.pts[Math.round((t - s.t0) * HZ)]
  return travel(t)
}

export default {
  name: 'Landing page ink',
  width: 1440,
  height: 900,
  duration: DURATION,
  events: () => [
    ...pointer(at, DURATION),
    ...press(0.35, 'D', ['⌥', '⇧', '⌘']),
    ...STROKES.flatMap((s) => stroke(s.t0, s.t1, s.pts)),
  ],
  // The GIF's edits: the frame on Kelp, a push in on the headline while drawing, a pan over to the
  // price, and a zoom back out to the whole page as the ink fades.
  edit(p) {
    Object.assign(p.style, { background: { kind: 'wallpaper', id: 'spring-kelp' }, padding: 64, radius: 22, shadow: 0.4 })
    Object.assign(p.style.cursor, { size: 1.6, hideIdle: false })
    p.zooms = [
      { id: 'headline', start: 0.15, end: 3.75, level: 1.9, target: { kind: 'point', x: 0.3, y: 0.472 }, enabled: true },
      { id: 'price', start: 3.75, end: 6.1, level: 2.2, target: { kind: 'point', x: 0.743, y: 0.416 }, enabled: true },
    ]
    p.autoZoomed = true
  },
} satisfies Demo
