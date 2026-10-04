// Window placement math. Pure: no electron imports. Rects are Electron screen points.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Enough of the window's top edge is on some display that the user can grab and move it. */
export function reachable(b: Rect, areas: Rect[], grab = 40): boolean {
  return areas.some((a) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    return w >= Math.min(grab, b.width) && b.y >= a.y - 1 && b.y < a.y + a.height - grab / 2
  })
}

/** Move (and shrink if needed) `b` so it sits fully inside `area`. */
export function fit(b: Rect, area: Rect): Rect {
  const width = Math.min(b.width, area.width)
  const height = Math.min(b.height, area.height)
  return {
    x: Math.round(Math.min(Math.max(b.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(b.y, area.y), area.y + area.height - height)),
    width,
    height,
  }
}

/** `size` centered in `area`, or at its bottom center `bottom` points above the edge. */
export function place(size: { width: number; height: number }, area: Rect, bottom?: number): Rect {
  const x = area.x + (area.width - size.width) / 2
  const y = bottom === undefined ? area.y + (area.height - size.height) / 2 : area.y + area.height - size.height - bottom
  return fit({ x, y, ...size }, area)
}

/** What the picking overlays depend on: each display's id, bounds, scale, and rotation. Work-area
 *  changes (the Dock, the menu bar) leave it alone. */
export function arrangement(displays: Array<{ id: number; bounds: Rect; scaleFactor: number; rotation: number }>): string {
  return JSON.stringify(displays.map((d) => [d.id, d.bounds, d.scaleFactor, d.rotation]))
}

/** Index of the area holding most of `b` (where a window "is"), -1 when it is on none. */
export function areaOf(b: Rect, areas: Rect[]): number {
  let best = -1
  let most = 0
  areas.forEach((a, i) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
    if (w > 0 && h > 0 && w * h > most) {
      most = w * h
      best = i
    }
  })
  return best
}
