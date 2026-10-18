// Scripted input for README demos: a hand-like pointer, clicks, typing, shortcuts, and ink, written
// as the recorder writes them (seconds, video px). Scenes and paths use CSS px; SCALE converts.
import type { InputEvent, Modifier } from '../../src/shared/events.ts'

export const SCALE = 2
export type Pt = [number, number]
type Kind = 'arrow' | 'pointer' | 'ibeam'

const smooth = (p: number) => p * p * p * (p * (6 * p - 15) + 10)

/** The pointer at t along [t, x, y] waypoints (CSS px): eased between them, on a slight arc like a hand. */
export function glide(path: Array<[number, number, number]>) {
  return (t: number): Pt => {
    let i = 0
    while (i + 2 < path.length && path[i + 1][0] <= t) i++
    const [t0, x0, y0] = path[i]
    const [t1, x1, y1] = path[i + 1] ?? path[i]
    const p = t1 > t0 ? smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : 1
    const bow = Math.sin(Math.PI * p) * 0.05
    return [x0 + (x1 - x0) * p - (y1 - y0) * bow, y0 + (y1 - y0) * p + (x1 - x0) * bow]
  }
}

/** Moves at 120 Hz over [0, duration], and the cursor image `kind` shows at each point. */
export function pointer(at: (t: number) => Pt, duration: number, kind: (p: Pt, t: number) => Kind = () => 'arrow'): InputEvent[] {
  const ev: InputEvent[] = []
  let shown: Kind | null = null
  for (let k = 0; k <= Math.round(duration * 120); k++) {
    const t = +(k / 120).toFixed(4)
    const p = at(t)
    const now = kind(p, t)
    if (now !== shown) ev.push({ t, type: 'cursor', id: (shown = now), hotX: 8, hotY: 8, w: 64, h: 64, scale: SCALE, kind: now })
    ev.push({ t, type: 'move', x: p[0] * SCALE, y: p[1] * SCALE })
  }
  return ev
}

/** A left click at t where the pointer is, held for `hold` s. */
export function click(t: number, [x, y]: Pt, hold = 0.1): InputEvent[] {
  return [
    { t, type: 'down', x: x * SCALE, y: y * SCALE, button: 'left' },
    { t: t + hold, type: 'up', x: x * SCALE, y: y * SCALE, button: 'left' },
  ]
}

/** One key press (down, then up 60 ms later) with modifiers. */
export function press(t: number, key: string, mods: Modifier[] = []): InputEvent[] {
  return [
    { t, type: 'key', down: true, key, code: 0, mods },
    { t: t + 0.06, type: 'key', down: false, key, code: 0, mods },
  ]
}

/** `text` typed from t0 at `cps` characters a second, with a little human unevenness. */
export function type(t0: number, text: string, cps = 10): InputEvent[] {
  return [...text].flatMap((ch, i) => press(t0 + (i + 0.35 * Math.sin(i * 2.7)) / cps, ch === ' ' ? 'Space' : ch, /[A-Z]/.test(ch) ? ['⇧'] : []))
}

/** When character i of `text` typed from t0 lands (matches type()). */
export const typedAt = (t0: number, i: number, cps = 10) => t0 + (i + 0.35 * Math.sin(i * 2.7)) / cps

/** An ink stroke from t0 to t1 through `points` (CSS px), and the pointer that draws it. */
export function stroke(t0: number, t1: number, points: Pt[], color = '#ff3b30', width = 6): InputEvent[] {
  const n = Math.max(2, Math.round((t1 - t0) * 120))
  const at = (p: number): Pt => {
    const f = p * (points.length - 1)
    const i = Math.min(Math.floor(f), points.length - 2)
    const w = f - i
    return [points[i][0] + (points[i + 1][0] - points[i][0]) * w, points[i][1] + (points[i + 1][1] - points[i][1]) * w]
  }
  const ev: InputEvent[] = []
  for (let k = 0; k <= n; k++) {
    const t = +(t0 + ((t1 - t0) * k) / n).toFixed(4)
    const [x, y] = at(k / n)
    const phase = k === 0 ? 'start' : k === n ? 'end' : 'move'
    ev.push({ t, type: 'draw', phase, x: x * SCALE, y: y * SCALE, ...(phase === 'start' ? { color, width: width * SCALE } : {}) })
  }
  return ev
}
