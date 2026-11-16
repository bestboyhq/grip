// The README hero: a raw 8 s take of a deployments dashboard. The cursor rests, glides to Deploy,
// clicks, travels to the new build's commit, goes on along the row to its status, waits there for
// Ready, and returns to its start. The zoom onto Deploy comes from Grip's auto zoom.
import type { Demo } from '../make.ts'
import { click, glide, pointer } from '../input.ts'

const DURATION = 8
const SCRIPT = { click: { down: 2.1, up: 2.2 }, row: 2.35, ready: 5.4 }
const DEPLOY = { x0: 1267, x1: 1403, y0: 172, y1: 217 }
const START = [679, 693] as const
const COMMIT = [928, 396] as const // under the commit message, so the arrow covers no text
const STATUS = [658, 340] as const // beside the new build's status, clear of its text
const at = glide([
  [0, ...START], [0.7, ...START], [1.95, 1335, 195], [2.5, 1335, 195],
  [3.15, ...COMMIT], [3.65, ...COMMIT], [4.3, ...STATUS], [6.1, ...STATUS], [7.1, ...START], [DURATION, ...START],
])
const cursor = { kind: 'cursor' } as const

export default {
  name: 'Deployments hero',
  width: 1440,
  height: 900,
  duration: DURATION,
  script: SCRIPT,
  events: () => [
    ...pointer(at, DURATION, ([x, y]) => (x >= DEPLOY.x0 && x <= DEPLOY.x1 && y >= DEPLOY.y0 && y <= DEPLOY.y1 ? 'pointer' : 'arrow')),
    ...click(SCRIPT.click.down, at(SCRIPT.click.down)),
  ],
  // The GIF's edits: a trim, a short zoom onto Deploy, and one lens that follows the cursor from
  // Deploy: small as it leaves, wide over the commit, and tight on the status, where it stays.
  edit(p) {
    Object.assign(p.style, { background: { kind: 'wallpaper', id: 'iridescent-nacre' }, padding: 56, radius: 14, shadow: 0.4, screenAnimation: 'smooth' })
    Object.assign(p.style.cursor, { size: 2, loop: true })
    p.clips[0].start = 0.633
    p.clips[0].end = 7.4
    p.zooms = [
      { id: 'deploy', start: 1.41, end: 2.046, level: 1.7, target: cursor, enabled: true },
      { id: 'leave', start: 2.55, end: 2.85, level: 1.9, target: cursor, enabled: true, mode: 'loupe', size: 180 },
      { id: 'commit', start: 2.85, end: 3.8, level: 1.9, target: cursor, enabled: true, mode: 'loupe', size: 340 },
      { id: 'travel', start: 3.8, end: 4.45, level: 1.8, target: cursor, enabled: true, mode: 'loupe', size: 215 },
      // Framed on the status, its timer, and the cursor beside them, with the build under it left to the rim.
      { id: 'status', start: 4.45, end: 6, level: 1.8, target: { kind: 'point', x: 0.4236, y: 0.3789 }, enabled: true, mode: 'loupe', size: 215 },
    ]
    p.autoZoomed = true
    p.playhead = 0.633
  },
} satisfies Demo
