// Pure render, part 2: the ONE path from (prepared project, t) to pixels.
// Preview (src/lib/player.svelte.ts) and export (src/engine/export) both call renderFrame.
// Owner: compositor.

import { sceneAt, type CursorLayer, type Prepared, type View } from './scene.ts'
import { clipAt, type TimeMap } from '../shared/timemap.ts'
import { viewAt } from './zoom/index.ts'
import { layoutAt } from './layout.ts'
import { cursorAt } from './motion/index.ts'
import type { FrameSource } from './media/index.ts'
import type { Motion, Renderer } from './gpu/renderer.ts'

export interface Media {
  screen?: FrameSource
  camera?: FrameSource
  matte?: FrameSource
}

/** Output seconds each frame integrates for motion blur: a 180 degree shutter at 30 fps. Fixed in
 *  output time, so preview and export at any frame rate blur the same way. */
export const SHUTTER = 1 / 60
const SAMPLES = 9

export async function renderFrame(r: Renderer, p: Prepared, media: Media, t: number): Promise<void> {
  const scene = sceneAt(p, t)
  const cam = scene.camera
  const got = await Promise.allSettled([
    scene.screen && media.screen ? media.screen.frameAt(scene.src) : null,
    cam && media.camera ? media.camera.frameAt(cam.src) : null,
    cam?.removeBackground && media.matte ? media.matte.frameAt(cam.src) : null,
  ])
  const [screen, camera, matte] = got.map((g) => (g.status === 'fulfilled' ? g.value : null))
  try {
    const failed = got.find((g) => g.status === 'rejected')
    if (failed) throw failed.reason // after collecting the others, so no decoded frame leaks
    await r.draw(scene, { screen, camera, matte }, motionAt(p, t))
  } finally {
    screen?.close()
    camera?.close()
    matte?.close()
  }
}

/** Shutter sample times around output time t, clamped to the clip playing at t so motion blur
 *  never smears across a cut. */
export function shutter(map: TimeMap, t: number): number[] {
  const i = clipAt(map, t)
  const c = map.clips[i]
  const a = map.outStarts[i]
  const b = a + (c.end - c.start) / c.speed
  return Array.from({ length: SAMPLES }, (_, k) => Math.min(Math.max(t + SHUTTER * (k / (SAMPLES - 1) - 0.5), a), b))
}

/** Shutter samples of the zoom view and the cursor around t, or undefined when neither moves (the
 *  renderer then draws one sample, so static frames cost nothing extra). Pure in (project, t). */
export function motionAt(p: Prepared, t: number): Motion | undefined {
  const { project, width: W, height: H } = p.input
  if (!project.style.motionBlur || !p.map.clips.length) return
  const ts = shutter(p.map, t)
  const views = ts.map((x) => viewAt(p.zoom, x))
  // Cursor samples ride on the screen as it sits at t: a layout transition moves the screen without
  // blurring it, so it must not blur the cursor on it either.
  const at = layoutAt(p.layout, t).screen?.rect
  const cursors = ts.map((x) => {
    const c = cursorAt(p.cursor, x)
    const r = at && c && layoutAt(p.layout, x).screen?.rect
    if (!r || !at || !c) return c
    const k = at.w / r.w
    return { ...c, x: at.x + (c.x - r.x) * k, y: at.y + (c.y - r.y) * k, scale: c.scale * k }
  })
  // Keep the run of samples around t without a jump (an instant zoom, a teleporting cursor):
  // a jump is a cut, not motion.
  const jump = 0.08 * Math.min(W, H)
  const step = (k: number) => Math.max(viewShift(views[k], views[k + 1], W, H), cursorShift(cursors[k], cursors[k + 1], views[k + 1]))
  const mid = (SAMPLES - 1) / 2
  let lo = mid, hi = mid
  while (lo > 0 && step(lo - 1) < jump) lo--
  while (hi < SAMPLES - 1 && step(hi) < jump) hi++
  const v = views.slice(lo, hi + 1)
  const c = cursors.slice(lo, hi + 1)
  const still = v.every((x) => viewShift(x, v[0], W, H) < 1e-3) && c.every((x) => cursorShift(x, c[0], v[0]) < 1e-3 && x?.angle === c[0]?.angle)
  return still ? undefined : { views: v, cursors: c }
}

/** Largest movement of an output corner between two views, in output px. */
function viewShift(a: View, b: View, W: number, H: number): number {
  let m = 0
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const ux = (x - W / 2) / a.scale + a.center.x
    const uy = (y - H / 2) / a.scale + a.center.y
    m = Math.max(m, Math.hypot((ux - b.center.x) * b.scale + W / 2 - x, (uy - b.center.y) * b.scale + H / 2 - y))
  }
  return m
}

/** Cursor movement in output px. A cursor appearing or vanishing is not motion. */
function cursorShift(a: CursorLayer | null, b: CursorLayer | null, v: View): number {
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) * v.scale : 0
}
