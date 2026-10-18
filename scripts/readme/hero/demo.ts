// The README hero: a raw 6 s take of a deployments dashboard. The cursor rests, glides to Deploy,
// waits out the click, then drifts toward the new build. Zooms come from Grip's auto zoom.
import type { Demo } from '../make.ts'
import { click, glide, pointer } from '../input.ts'

const DURATION = 6
const SCRIPT = { click: { down: 2.1, up: 2.2 }, row: 2.35, ready: 4.75 }
const DEPLOY = { x0: 1267, x1: 1403, y0: 172, y1: 217 }
const at = glide([[0, 679, 693], [0.7, 679, 693], [1.95, 1335, 195], [3.0, 1335, 195], [4.0, 1060, 385], [DURATION, 1060, 385]])

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
  // The GIF's edits: a trim, a short zoom onto Deploy, and a loupe on the new build's timer.
  edit(p) {
    Object.assign(p.style, { background: { kind: 'wallpaper', id: 'iridescent-nacre' }, padding: 56, radius: 14, shadow: 0.4, screenAnimation: 'smooth' })
    Object.assign(p.style.cursor, { size: 2.4, loop: true })
    p.clips[0].start = 0.633
    p.clips[0].end = 4.976
    p.zooms = [
      { id: 'deploy', start: 1.41, end: 2.046, level: 1.7, target: { kind: 'cursor' }, enabled: true },
      { id: 'timer', start: 2.323, end: 4.719, level: 1.7, target: { kind: 'point', x: 0.394, y: 0.4 }, enabled: true, mode: 'loupe', size: 160 },
    ]
    p.autoZoomed = true
    p.playhead = 0.633
  },
} satisfies Demo
