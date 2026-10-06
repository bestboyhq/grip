// Screenshot annotations: shapes drawn over a frozen area in the picker, and the one function that
// paints them, on screen and into the PNG that gets copied (same code, same pixels). Shapes live in
// the area's points (origin its top-left); painting scales them by `k` output px per point.

import { paintStroke } from '../../engine/overlays/drawings.ts'

export type Tool = 'arrow' | 'rect' | 'pen' | 'text' | 'blur'
export interface P {
  x: number
  y: number
}
export type Shape =
  | { kind: 'arrow' | 'rect' | 'blur'; color: string; a: P; b: P }
  | { kind: 'pen'; color: string; points: P[] }
  | { kind: 'text'; color: string; at: P; text: string }

/** Keyboard shortcuts of the tools, in toolbar order. */
export const TOOLS: Array<{ id: Tool; key: string; label: string }> = [
  { id: 'arrow', key: 'a', label: 'Arrow' },
  { id: 'rect', key: 'r', label: 'Rectangle' },
  { id: 'pen', key: 'p', label: 'Pen' },
  { id: 'text', key: 't', label: 'Text' },
  { id: 'blur', key: 'b', label: 'Pixelate' },
]
export const COLORS = [
  { value: '#ff3b30', name: 'Red' },
  { value: '#ffcc00', name: 'Yellow' },
  { value: '#34c759', name: 'Green' },
  { value: '#0a84ff', name: 'Blue' },
  { value: '#ffffff', name: 'White' },
  { value: '#1c1c1e', name: 'Black' },
]
export const LINE = 4 // pt, arrows, rectangles, and pen
export const FONT = 20 // pt
const BLOCK = 9 // pt, pixel blocks of the pixelate tool
export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'

/** An arrow from a to b: where the shaft ends (inside the head, so its round cap never pokes out)
 *  and the head's three corners. Short arrows get a smaller head. */
export function arrowHead(a: P, b: P, w = LINE) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const head = Math.min(w * 4.2, len * 0.55)
  const half = head * 0.58
  const base = { x: b.x - ux * head, y: b.y - uy * head }
  return {
    shaft: { x: b.x - ux * head * 0.7, y: b.y - uy * head * 0.7 },
    tip: b,
    left: { x: base.x - uy * half, y: base.y + ux * half },
    right: { x: base.x + uy * half, y: base.y - ux * half },
  }
}

const box = (a: P, b: P) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Paint `shapes` over `image` (the frozen area, already drawn at 0,0 in output px). `k`: output px
 *  per point. The pixelate tool reads from `image`, so it hides what was captured, not other shapes. */
export function paintShapes(ctx: Ctx, shapes: Shape[], image: HTMLImageElement | ImageBitmap, k: number): void {
  const ik = image.width / (ctx.canvas.width / k) // image px per point
  for (const s of shapes) {
    ctx.save()
    ctx.scale(k, k)
    if (s.kind === 'blur') {
      const r = box(s.a, s.b)
      if (r.w >= 1 && r.h >= 1) {
        const small = new OffscreenCanvas(Math.max(1, Math.round(r.w / BLOCK)), Math.max(1, Math.round(r.h / BLOCK)))
        small.getContext('2d')!.drawImage(image, r.x * ik, r.y * ik, r.w * ik, r.h * ik, 0, 0, small.width, small.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(small, r.x, r.y, r.w, r.h)
      }
    } else if (s.kind === 'pen') {
      paintStroke(ctx, s.points, s.color, LINE, 1)
    } else {
      // A soft shadow keeps every color readable on light and dark content alike.
      ctx.shadowColor = 'rgb(0 0 0 / 0.3)'
      ctx.shadowBlur = 3 * k
      ctx.shadowOffsetY = 0.5 * k
      ctx.strokeStyle = ctx.fillStyle = s.color
      ctx.lineWidth = LINE
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (s.kind === 'rect') {
        const r = box(s.a, s.b)
        ctx.beginPath()
        ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(4, r.w / 2, r.h / 2))
        ctx.stroke()
      } else if (s.kind === 'arrow') {
        const h = arrowHead(s.a, s.b)
        ctx.beginPath()
        ctx.moveTo(s.a.x, s.a.y)
        ctx.lineTo(h.shaft.x, h.shaft.y)
        ctx.stroke()
        ctx.lineWidth = LINE * 0.6 // rounds the head's corners without growing it
        ctx.beginPath()
        ctx.moveTo(h.tip.x, h.tip.y)
        ctx.lineTo(h.left.x, h.left.y)
        ctx.lineTo(h.right.x, h.right.y)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else if (s.kind === 'text') {
        ctx.font = `600 ${FONT}px ${FONT_FAMILY}`
        ctx.textBaseline = 'top'
        s.text.split('\n').forEach((line, i) => ctx.fillText(line, s.at.x, s.at.y + i * FONT * 1.25))
      }
    }
    ctx.restore()
  }
}

/** Whether a shape drawn this small is a slip of the mouse, not a mark. */
export function tiny(s: Shape): boolean {
  if (s.kind === 'arrow' || s.kind === 'rect' || s.kind === 'blur') return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < 4
  if (s.kind === 'text') return !s.text.trim()
  return false // a pen tap is a dot
}
