// Owner: compositor (overlays). Ink drawn on screen while recording: strokes from the event stream,
// which of them show at a time, and how one is painted. Pure and free of engine deps, so the
// recorder's live overlay paints with the same code as preview and export. Any time base works:
// the engine passes output time, the live overlay its own clock.

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

/** One stroke: a smooth path through the midpoints of its points, round caps and joins, a dot for a
 *  tap. A soft dark halo keeps it readable on light and same-colored content. */
export function paintStroke(ctx: Ctx, points: Array<{ x: number; y: number }>, color: string, width: number, opacity: number): void {
  if (!points.length || !(width > 0) || !(opacity > 0)) return
  const m = ctx.getTransform()
  ctx.save()
  ctx.globalAlpha = Math.min(1, opacity)
  ctx.strokeStyle = ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgb(0 0 0 / 0.25)'
  ctx.shadowBlur = width * 0.6 * Math.hypot(m.a, m.b) // shadows ignore the transform; scale by hand
  ctx.beginPath()
  const [a] = points
  // A tap without moving: Canvas may prune a zero-length path instead of capping it.
  if (points.every((p) => p.x === a.x && p.y === a.y)) {
    ctx.arc(a.x, a.y, width / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.moveTo(a.x, a.y)
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i]
      const q = points[i + 1]
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2)
    }
    const z = points[points.length - 1]
    ctx.lineTo(z.x, z.y)
    ctx.stroke()
  }
  ctx.restore()
}
