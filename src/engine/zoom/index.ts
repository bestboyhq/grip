// Owner: auto-zoom. Zoom camera in OUTPUT time: zoom items (source time) mapped through the time
// map, springs in and out, cursor follow with a dead zone, first-frame zoom starts zoomed in,
// vertical output follows the cursor. Also exports generateAutoZooms(events, sources) -> Zoom[].
// STUB: no zoom.

import type { TimeMap } from '../../shared/timemap.ts'
import type { Loupe, SceneInput, View } from '../scene.ts'
import type { prepareLayout } from '../layout.ts'
import type { prepareCursor } from '../motion/index.ts'

export function prepareZoom(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>, cursor: ReturnType<typeof prepareCursor>) {
  return { input, map, layout, cursor }
}

export function viewAt(z: ReturnType<typeof prepareZoom>, t: number): View {
  return { center: { x: z.input.width / 2, y: z.input.height / 2 }, scale: 1 }
}

export function loupeAt(_z: ReturnType<typeof prepareZoom>, _t: number): Loupe | null {
  return null
}
