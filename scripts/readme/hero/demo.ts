// The README hero: a raw 4.3 s take of a deployments dashboard that loops without a seam. It opens and
// ends on the same frame, a lens on the top build's Ready status. The cursor flies to Deploy and clicks,
// which rebuilds that build in place, then sweeps back to its status in one arc, where Ready lands.
import type { Demo } from '../make.ts'
import { click, glide, pointer, type Pt } from '../input.ts'
import { smooth } from '../../../src/shared/demo.ts'

const T = { leave: 0.4, deploy: 1.15, click: 1.2, sweep: [2.1, 3.2], ready: 3.6, end: 4.3 }
const DEPLOY = { x0: 1267, x1: 1403, y0: 172, y1: 217 }
const AT_DEPLOY: Pt = [1335, 196]
const STATUS: Pt = [650, 334] // right of Ready: inside the lens, clear of its text
// Back from Deploy: down onto the build's row, then along it to its status, one arc with no stop.
const ARC: Pt[] = [AT_DEPLOY, [1330, 430], [1000, 378], STATUS]
const arc = (p: number): Pt => {
  const w = [(1 - p) ** 3, 3 * (1 - p) ** 2 * p, 3 * (1 - p) * p * p, p ** 3]
  return [0, 1].map((k) => w.reduce((s, c, i) => s + c * ARC[i][k], 0)) as Pt
}
const fly = glide([[0, ...STATUS], [T.leave, ...STATUS], [T.deploy, ...AT_DEPLOY]])
const at = (t: number): Pt => (t < T.sweep[0] ? fly(t) : arc(smooth(Math.min(1, (t - T.sweep[0]) / (T.sweep[1] - T.sweep[0])))))
const cursor = { kind: 'cursor' } as const
const status = { kind: 'point', x: 0.4201, y: 0.4022 } as const // Ready, its time, and the cursor beside them

export default {
  name: 'Deployments hero',
  width: 1440,
  height: 900,
  duration: T.end,
  script: { click: { down: T.click, up: T.click + 0.1 }, ready: T.ready, tick: (T.ready - T.click) / 12 },
  events: () => [
    ...pointer(at, T.end, ([x, y]) => (x >= DEPLOY.x0 && x <= DEPLOY.x1 && y >= DEPLOY.y0 && y <= DEPLOY.y1 ? 'pointer' : 'arrow')),
    ...click(T.click, at(T.click)),
  ],
  // The GIF's edits. The camera pushes in on Deploy and the build under it, and pulls out as the cursor
  // leaves; a lens takes over on the moving cursor, opens wide over the row, closes onto the status, and
  // tightens as Ready lands. The lens the take ends on is the one it opens on, until the cursor leaves.
  edit(p) {
    Object.assign(p.style, { background: { kind: 'wallpaper', id: 'iridescent-nacre' }, padding: 56, radius: 14, shadow: 0.4, screenAnimation: 'focused' })
    Object.assign(p.style.cursor, { size: 2, hideIdle: false })
    const go = T.sweep[0]
    const lens = (id: string, start: number, end: number, size: number, level: number, target: typeof cursor | typeof status) =>
      ({ id, start, end, level, target, enabled: true, mode: 'loupe' as const, size })
    p.zooms = [
      lens('opening', 0, T.leave - 0.15, 240, 2, status),
      { id: 'deploy', start: 0.75, end: go + 0.05, level: 1.65, target: { kind: 'point', x: 0.6806, y: 0.3778 }, enabled: true },
      lens('leave', go + 0.3, go + 0.45, 160, 1.8, cursor),
      lens('travel', go + 0.45, go + 0.85, 280, 1.7, cursor),
      lens('status', go + 0.85, T.ready, 240, 1.7, status),
      lens('ready', T.ready, T.end, 240, 2, status),
    ]
    p.autoZoomed = true
  },
} satisfies Demo
