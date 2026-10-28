// The loupe README demo: a raw 10 s take of a revenue dashboard. The cursor sweeps the MRR chart day
// by day, rests on the v3.0 launch, glides up over the Net new MRR and MRR figures, exports a CSV,
// and returns to its start. The scene gets the same pointer path, so its tooltip and hover states
// track it exactly, as the app on screen would.
import type { Demo } from '../make.ts'
import { click, glide, pointer, type Pt } from '../input.ts'

const DURATION = 10
const HZ = 120 // the path the scene reacts to, sampled like pointer()
// Daily MRR, Sep 1-30 2026 (Aug 31 closed at $74,920), and the chart's plot box in CSS px.
const MRR = [75370, 75600, 75830, 75980, 76090, 76180, 76560, 76810, 77120, 77290, 77410, 77330, 77450, 77860, 78400,
  80120, 80940, 81330, 81620, 81700, 81790, 82160, 82390, 82610, 83040, 83120, 83190, 83460, 83820, 84210]
const PLOT = { x0: 346, x1: 1004, y0: 380, y1: 570, min: 60000, max: 100000 }
// Buttons in the scene (CSS px), where the pointer shows.
const BUTTONS = [{ x0: 824, x1: 894, y0: 323, y1: 351 }, { x0: 904, x1: 1020, y0: 323, y1: 351 }] // Daily, Export CSV
const SCRIPT = { click: { down: 7.45, up: 7.55 }, done: 8.05, reset: 9.35 }

const ease = (p: number) => ((p = Math.min(1, Math.max(0, p))), p * p * p * (p * (6 * p - 15) + 10))
const dayX = (d: number) => PLOT.x0 + (d * (PLOT.x1 - PLOT.x0)) / (MRR.length - 1)
const valueY = (v: number) => PLOT.y1 - ((v - PLOT.min) / (PLOT.max - PLOT.min)) * (PLOT.y1 - PLOT.y0)
/** The pointer resting on the line at fractional day d, its tip just under the hover dot. */
function onLine(d: number): Pt {
  const i = Math.min(Math.floor(d), MRR.length - 2)
  return [dayX(d), valueY(MRR[i] + (MRR[i + 1] - MRR[i]) * (d - i)) + 6]
}
const sweep = (t0: number, t1: number, d0: number, d1: number) => (t: number) => onLine(d0 + (d1 - d0) * ease((t - t0) / (t1 - t0)))
/** From a to b along a curve bent toward c, eased like a hand. */
function curve(t0: number, t1: number, a: Pt, c: Pt, b: Pt) {
  return (t: number): Pt => {
    const p = ease((t - t0) / (t1 - t0))
    return [0, 1].map((k) => (1 - p) ** 2 * a[k] + 2 * p * (1 - p) * c[k] + p ** 2 * b[k]) as Pt
  }
}

const START: Pt = [336, 342] // on the MRR growth title
const NET: Pt = [628, 230] // the Net new MRR figure
const BADGE: Pt = [326, 270] // MRR's +12.4% badge
const EXPORT: Pt = [966, 338]
// Pieces of the take, each until the next one starts. The curves pass the Daily and Export CSV
// buttons by, so the pointer only shows where the take clicks.
const PIECES: Array<[number, (t: number) => Pt]> = [
  [0, glide([[0.4, ...START], [0.85, ...onLine(1)]])],
  [1.2, sweep(1.2, 2.5, 1, 15)], // to Sep 16, the v3.0 launch
  [3.4, sweep(3.4, 4.6, 15, 29)], // to Sep 30
  [5.05, curve(5.05, 5.6, onLine(29), [770, 380], NET)],
  [5.6, glide([[5.8, ...NET], [6.15, ...BADGE]])],
  [6.85, curve(6.85, 7.35, BADGE, [800, 410], EXPORT)],
  [8.9, curve(8.9, 9.85, EXPORT, [650, 230], START)],
]
const at = (t: number): Pt => PIECES.findLast(([t0]) => t >= t0)![1](t)
const path = Array.from({ length: Math.round(DURATION * HZ) + 1 }, (_, k) => at(k / HZ).map((v) => Math.round(v * 10) / 10)).flat()

export default {
  name: 'Revenue loupe',
  width: 1440,
  height: 900,
  duration: DURATION,
  script: { ...SCRIPT, hz: HZ, path, mrr: MRR, plot: PLOT },
  events: () => [
    ...pointer(at, DURATION, ([x, y]) => (BUTTONS.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) ? 'pointer' : 'arrow')),
    ...click(SCRIPT.click.down, at(SCRIPT.click.down)),
  ],
  // The GIF's edits: a glass loupe that follows the cursor from the chart to the export.
  edit(p) {
    Object.assign(p.style, { background: { kind: 'wallpaper', id: 'aurora' }, padding: 64, radius: 18, shadow: 0.4 })
    Object.assign(p.style.cursor, { size: 1.6, loop: true })
    p.zooms = [{ id: 'loupe', start: 0.8, end: 8.65, level: 2, target: { kind: 'cursor' }, enabled: true, mode: 'loupe', size: 280 }]
    p.autoZoomed = true
  },
} satisfies Demo
