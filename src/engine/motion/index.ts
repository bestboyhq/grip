// Owner: motion. Cursor path in OUTPUT time: map events through the time map, smooth (passing
// exactly through clicks), tilt, idle hide, loop, cursor image changes. Precompute in prepareCursor,
// evaluate purely in cursorAt.
// STUB: raw last-known cursor position, no smoothing.

import type { TimeMap } from '../../shared/timemap.ts'
import { toSource } from '../../shared/timemap.ts'
import type { CursorLayer, SceneInput } from '../scene.ts'
import type { prepareLayout } from '../layout.ts'
import { layoutAt } from '../layout.ts'

export function prepareCursor(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>) {
  const moves = input.events.filter((e) => e.type === 'move' || e.type === 'down' || e.type === 'up') as Array<{ t: number; x: number; y: number }>
  return { input, map, layout, moves }
}

export function cursorAt(c: ReturnType<typeof prepareCursor>, t: number): CursorLayer | null {
  const s = c.input.project.sources.screen
  if (!s || !c.moves.length || !c.input.project.style.cursor.visible) return null
  const src = toSource(c.map, t)
  let i = 0
  while (i + 1 < c.moves.length && c.moves[i + 1].t <= src) i++
  const screen = layoutAt(c.layout, t).screen
  if (!screen) return null
  const k = screen.rect.w / s.width
  return {
    x: screen.rect.x + c.moves[i].x * k,
    y: screen.rect.y + c.moves[i].y * k,
    image: 'arrow',
    hotX: 0,
    hotY: 0,
    scale: k * s.scale * c.input.project.style.cursor.size,
    angle: 0,
    opacity: 1,
  }
}
