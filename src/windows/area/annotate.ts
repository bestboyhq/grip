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
  | { kind: 'pen'; color: string; points: Array<P & { p?: number }> } // p: a stylus's pressure
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

/** An arrow from a to b as one outline, tip first around: a shaft that widens from a fine tail to
 *  the head, and a head whose barbs sweep back past where the shaft meets it. Short arrows get a
 *  smaller head. */
export function arrowOutline(a: P, b: P, w = LINE): P[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const at = (back: number, side: number): P => ({ x: b.x - ux * back - uy * side, y: b.y - uy * back + ux * side }) // back from the tip
  const head = Math.min(w * 5, len * 0.6)
  const barb = head * 0.55 // half the head's width
  const neck = head * 0.72 // where the shaft meets the head
  const shaft = Math.min(w * 0.55, barb * 0.4) // half the shaft's width there
  const tail = shaft * 0.3
  return [b, at(head, barb), at(neck, shaft), at(len, tail), at(len, -tail), at(neck, -shaft), at(head, -barb)]
}

const box = (a: P, b: P) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Screenshots are Display P3, like the screen they come from: canvases that paint them keep it. */
export const P3: CanvasRenderingContext2DSettings = { colorSpace: 'display-p3' }

/** Sizes from w x h down to tw x th, at most halving per step. One big drawImage samples a few
 *  pixels per block, so text pixelates to stray dots; a bilinear draw up to 2:1 averages every pixel in. */
export function halvings(w: number, h: number, tw: number, th: number): Array<[number, number]> {
  const steps: Array<[number, number]> = []
  while (w > tw || h > th) steps.push([(w = Math.max(tw, Math.ceil(w / 2))), (h = Math.max(th, Math.ceil(h / 2)))])
  return steps
}

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
        let src: CanvasImageSource = image
        let [x, y, w, h] = [r.x * ik, r.y * ik, r.w * ik, r.h * ik]
        for (const [nw, nh] of halvings(w, h, Math.max(1, Math.round(r.w / BLOCK)), Math.max(1, Math.round(r.h / BLOCK)))) {
          const step = new OffscreenCanvas(nw, nh)
          step.getContext('2d', P3)!.drawImage(src, x, y, w, h, 0, 0, nw, nh)
          ;[src, x, y, w, h] = [step, 0, 0, nw, nh]
        }
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(src, x, y, w, h, r.x, r.y, r.w, r.h)
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
        ctx.beginPath()
        for (const q of arrowOutline(s.a, s.b)) ctx.lineTo(q.x, q.y)
        ctx.closePath()
        ctx.fill()
        // Corners rounded a hair, with no second shadow falling on the fill.
        ctx.shadowColor = 'transparent'
        ctx.lineWidth = LINE * 0.25
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

/** Distance from p to the segment a-b. */
function toSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** The topmost shape under p, or -1: near an arrow, a pen stroke, or a rectangle's edge (so a mark
 *  can still go inside a rectangle), or inside a pixelated box or a text. `measure`: a line of
 *  text's width in points. */
export function shapeAt(shapes: Shape[], p: P, measure: (line: string) => number): number {
  const near = LINE / 2 + 5
  const inside = (r: ReturnType<typeof box>, m: number) => p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    let hit: boolean
    if (s.kind === 'pen') hit = s.points.some((q, j) => toSegment(p, s.points[Math.max(0, j - 1)], q) <= near)
    else if (s.kind === 'arrow') hit = toSegment(p, s.a, s.b) <= near
    else if (s.kind === 'text') {
      const lines = s.text.split('\n')
      hit = inside({ x: s.at.x, y: s.at.y, w: Math.max(...lines.map(measure)), h: lines.length * FONT * 1.25 }, 4)
    } else {
      const r = box(s.a, s.b)
      hit = s.kind === 'blur' ? inside(r, 0) : inside(r, near) && !inside(r, -near)
    }
    if (hit) return i
  }
  return -1
}

/** `s` moved by (dx, dy). */
export function moved(s: Shape, dx: number, dy: number): Shape {
  const by = <T extends P>(q: T): T => ({ ...q, x: q.x + dx, y: q.y + dy })
  if (s.kind === 'pen') return { ...s, points: s.points.map(by) }
  if (s.kind === 'text') return { ...s, at: by(s.at) }
  return { ...s, a: by(s.a), b: by(s.b) }
}

/** Whether a shape drawn this small is a slip of the mouse, not a mark. */
export function tiny(s: Shape): boolean {
  if (s.kind === 'arrow' || s.kind === 'rect' || s.kind === 'blur') return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < 4
  if (s.kind === 'text') return !s.text.trim()
  return false // a pen tap is a dot
}
