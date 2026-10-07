// Owner: compositor (overlays). Ink drawn on screen while recording: strokes from the event stream,
// which of them show at a time, and how one is painted. Pure and free of engine deps, so the
// recorder's live overlay paints with the same code as preview and export. Any time base works:
// the engine passes output time, the live overlay its own clock.

import { getStroke } from 'perfect-freehand'
import type { InputEvent } from '../../shared/events.ts'

export interface Stroke {
  start: number // time of the earliest point
  end: number // time of the latest point
  color: string
  width: number // px, in the points' space
  points: Array<{ t: number; x: number; y: number }>
}

/** Seconds a group of strokes stays after its last stroke ends. */
export const DRAW_HOLD = 3
/** Seconds the group then takes to fade out. */
export const DRAW_FADE = 0.4

/** Strokes in source time and screen.mp4 px. A stroke without its end (torn file) ends at its last point. */
export function strokesFromEvents(events: InputEvent[]): Stroke[] {
  const out: Stroke[] = []
  let cur: Stroke | null = null
  for (const e of events) {
    if (e.type !== 'draw') continue
    if (e.phase === 'start' || !cur) out.push((cur = { start: e.t, end: e.t, color: e.color ?? '#ff3b30', width: e.width ?? 8, points: [] }))
    cur.points.push({ t: e.t, x: e.x, y: e.y })
    cur.end = e.t
    if (e.phase === 'end') cur = null
  }
  return out
}

/** What shows at t, strokes sorted by start: each stroke as drawn up to t. Strokes started less than
 *  DRAW_HOLD after the previous one ended form a group that stays until its last end + DRAW_HOLD,
 *  then fades out together over DRAW_FADE. */
export function visibleStrokes(strokes: Stroke[], t: number): Array<{ points: Array<{ x: number; y: number }>; color: string; width: number; opacity: number }> {
  const out: ReturnType<typeof visibleStrokes> = []
  let group: Stroke[] = []
  let end = -Infinity
  const flush = () => {
    const opacity = Math.min(1, Math.max(0, 1 - (t - end - DRAW_HOLD) / DRAW_FADE))
    if (opacity > 0) for (const s of group) out.push({ points: s.points.filter((p) => p.t <= t), color: s.color, width: s.width, opacity })
  }
  // Strokes starting after t never join a group early enough to change it before t.
  for (const s of strokes) {
    if (s.start > t) break
    if (s.start - end >= DRAW_HOLD) {
      flush()
      group = []
    }
    group.push(s)
    end = Math.max(end, s.end)
  }
  flush()
  return out
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// tldraw's draw settings (packages/tldraw/src/lib/shapes/draw/getPath.ts), for strokes that are done.
const MOUSE = { thinning: 0.5, streamline: 0.64, smoothing: 0.62, easing: (t: number) => Math.sin((t * Math.PI) / 2), simulatePressure: true, last: true }
const STYLUS = { thinning: 0.62, streamline: 0.62, smoothing: 0.62, easing: (t: number) => t * 0.65 + Math.sin((t * Math.PI) / 2) * 0.35, simulatePressure: false, last: true }

/** One stroke as ink, like tldraw's pen (perfect-freehand): wider where the hand slows down or presses
 *  harder, thinner where it speeds up, smoothed of jitter, a dot for a tap. Points with a pressure
 *  `p` (a stylus) go by it, points without (a mouse, a trackpad) by their speed. `width` is the
 *  width at medium pressure. A soft dark halo keeps it readable on light and same-colored content. */
export function paintStroke(ctx: Ctx, points: Array<{ x: number; y: number; p?: number }>, color: string, width: number, opacity: number): void {
  if (!points.length || !(width > 0) || !(opacity > 0)) return
  const stylus = points.some((q) => q.p !== undefined)
  const outline = getStroke(points.map((q) => [q.x, q.y, q.p ?? 0.5]), stylus ? { ...STYLUS, size: 1 + width * 1.2 } : { ...MOUSE, size: width })
  if (outline.length < 3) return
  const m = ctx.getTransform()
  ctx.save()
  ctx.globalAlpha = Math.min(1, opacity)
  ctx.fillStyle = color
  ctx.shadowColor = 'rgb(0 0 0 / 0.25)'
  ctx.shadowBlur = width * 0.6 * Math.hypot(m.a, m.b) // shadows ignore the transform; scale by hand
  // A smooth closed curve through the midpoints of the outline, filled once: one halo, no seams.
  const n = outline.length
  ctx.beginPath()
  for (let i = 0; i <= n; i++) {
    const [ax, ay] = outline[i % n]
    const [bx, by] = outline[(i + 1) % n]
    if (i === 0) ctx.moveTo((ax + bx) / 2, (ay + by) / 2)
    else ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2)
  }
  ctx.fill()
  ctx.restore()
}
