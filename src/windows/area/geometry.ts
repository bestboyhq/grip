// Area and window-size math for the picking overlay. Pure. Points, origin top-left of the display.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const ASPECTS: Record<string, number | null> = { free: null, '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16 }
const MIN = 32
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Window presets: per aspect, common sizes in points, largest first. */
export const PRESETS = [
  { id: '16:9', sizes: [[1920, 1080], [1600, 900], [1280, 720], [1024, 576]] },
  { id: '4:3', sizes: [[1600, 1200], [1280, 960], [1024, 768], [800, 600]] },
  { id: '1:1', sizes: [[1200, 1200], [1080, 1080], [900, 900], [720, 720]] },
  { id: '9:16', sizes: [[720, 1280], [608, 1080], [540, 960], [450, 800]] },
]

/** The largest preset size that fits the work area with a margin, or null. */
export function presetSize(id: string, work: Rect): [number, number] | null {
  const sizes = PRESETS.find((p) => p.id === id)?.sizes ?? []
  return (sizes.find(([w, h]) => w <= work.width * 0.95 && h <= work.height * 0.95) as [number, number]) ?? null
}

/** Where window `win` goes for preset `id`: same top-left, pulled inside the work area. Global points. */
export function presetFrame(win: Rect, id: string, work: Rect): Rect {
  const size = presetSize(id, work)
  if (!size) return win
  const [width, height] = size
  return { width, height, x: clamp(win.x, work.x, work.x + work.width - width), y: clamp(win.y, work.y, work.y + work.height - height) }
}

/** Drag a handle of `o` (or draw a new area from its top-left) to (px, py), within W x H, keeping `ratio`. */
export function resize(o: Rect, h: Handle | 'new', px: number, py: number, ratio: number | null, W: number, H: number): Rect {
  px = clamp(px, 0, W)
  py = clamp(py, 0, H)
  // The fixed point: the drag start for a new area, else the opposite edge. null = axis not dragged.
  const ax = h === 'new' ? o.x : h.includes('w') ? o.x + o.width : h.includes('e') ? o.x : null
  const ay = h === 'new' ? o.y : h.includes('n') ? o.y + o.height : h.includes('s') ? o.y : null
  const dx = ax === null || px >= ax ? 1 : -1 // growth direction; dragging past the fixed edge flips
  const dy = ay === null || py >= ay ? 1 : -1
  let w = ax === null ? o.width : Math.abs(px - ax)
  let hh = ay === null ? o.height : Math.abs(py - ay)
  if (ratio) {
    if (ax === null) w = hh * ratio
    else if (ay === null) hh = w / ratio
    else if (w / Math.max(hh, 1e-9) > ratio) hh = w / ratio // follow the larger drag
    else w = hh * ratio
    // Shrink to the room on the growth side of the fixed point (both sides for an undragged axis).
    const cx = o.x + o.width / 2
    const cy = o.y + o.height / 2
    const roomX = ax === null ? 2 * Math.min(cx, W - cx) : dx > 0 ? W - ax : ax
    const roomY = ay === null ? 2 * Math.min(cy, H - cy) : dy > 0 ? H - ay : ay
    const k = Math.min(1, roomX / Math.max(w, 1e-9), roomY / Math.max(hh, 1e-9))
    w *= k
    hh *= k
  }
  if (h !== 'new') {
    w = Math.max(w, MIN)
    hh = Math.max(hh, MIN)
  }
  const x = ax === null ? o.x + o.width / 2 - w / 2 : dx > 0 ? ax : ax - w
  const y = ay === null ? o.y + o.height / 2 - hh / 2 : dy > 0 ? ay : ay - hh
  return { width: w, height: hh, x: clamp(x, 0, W - w), y: clamp(y, 0, H - hh) }
}

/** Top-left of a w x h form for area `sel`: under it, else above it, else inside its bottom edge;
 *  never over its center, past the display's edges (W wide), or under the toolbar below `floor`. */
export function formAt(sel: Rect, w: number, h: number, W: number, floor: number): { x: number; y: number } {
  const GAP = 14
  const EDGE = 12
  let y = sel.y + sel.height + GAP
  if (y + h > floor - EDGE) y = sel.y - GAP - h
  if (y < EDGE) y = Math.min(sel.y + sel.height - GAP, floor - EDGE) - h
  return { x: clamp(sel.x + sel.width / 2 - w / 2, EDGE, W - w - EDGE), y }
}

/** `r` with `ratio` applied around its center, shrunk to fit W x H (keeping the ratio; without one,
 *  each side on its own), and moved fully inside. */
export function constrain(r: Rect, ratio: number | null, W: number, H: number): Rect {
  let w = r.width
  let h = ratio ? w / ratio : r.height
  const k = ratio ? Math.min(1, W / w, H / h) : 1
  w = Math.max(MIN, Math.min(w * k, W))
  h = Math.max(MIN, Math.min(h * k, H))
  return { width: w, height: h, x: clamp(r.x + r.width / 2 - w / 2, 0, W - w), y: clamp(r.y + r.height / 2 - h / 2, 0, H - h) }
}

/** Top-left of the w x h tool strip beside area `sel`: right of it, else left of it, else inside its
 *  right edge; level with its top, but clear of `form` (the panel under or over the area) and
 *  inside the display (W x H). */
export function toolsAt(sel: Rect, w: number, h: number, W: number, H: number, form: Rect | null): { x: number; y: number } {
  const GAP = 10
  const EDGE = 12
  let x = sel.x + sel.width + GAP
  if (x + w > W - EDGE) x = sel.x - GAP - w
  if (x < EDGE) x = sel.x + sel.width - GAP - w
  x = clamp(x, EDGE, W - w - EDGE)
  let y = clamp(sel.y, EDGE, H - h - EDGE)
  if (form && x < form.x + form.width && x + w > form.x && y < form.y + form.height && y + h > form.y) {
    y = clamp(form.y > sel.y ? form.y - GAP - h : form.y + form.height + GAP, EDGE, H - h - EDGE)
  }
  return { x, y }
}
