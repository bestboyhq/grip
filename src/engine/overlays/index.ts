// Owner: compositor (overlays). Click effects, keystroke groups, and caption lines in OUTPUT time,
// plus drawOverlays() which paints them with Canvas 2D (text and keycaps get the platform's
// font rendering) for the GPU compositor to layer on top.
// STUB: nothing to show.

import type { TimeMap } from '../../shared/timemap.ts'
import type { Caption, Click, Keystroke, SceneInput } from '../scene.ts'
import type { prepareLayout } from '../layout.ts'

export function prepareOverlays(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>) {
  return { input, map, layout }
}

export function clicksAt(_o: ReturnType<typeof prepareOverlays>, _t: number): Click[] {
  return []
}
export function keystrokesAt(_o: ReturnType<typeof prepareOverlays>, _t: number): Keystroke[] {
  return []
}
export function captionAt(_o: ReturnType<typeof prepareOverlays>, _t: number): Caption | null {
  return null
}

/** Paint clicks, keystrokes, and the caption for `scene` into a transparent 2D canvas of scene size.
 *  Clicks are drawn in zoomed space (apply scene.view); keystrokes and captions unzoomed. */
export function drawOverlays(_ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, _scene: import('../scene.ts').Scene): void {}
