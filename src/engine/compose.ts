// Pure render, part 2: the ONE path from (prepared project, t) to pixels.
// Preview (src/lib/player.svelte.ts) and export (src/engine/export) both call renderFrame.
// Owner: compositor.

import { sceneAt, type Prepared } from './scene.ts'
import type { FrameSource } from './media/index.ts'
import type { Renderer } from './gpu/renderer.ts'

export interface Media {
  screen?: FrameSource
  camera?: FrameSource
  matte?: FrameSource
}

export async function renderFrame(r: Renderer, p: Prepared, media: Media, t: number): Promise<void> {
  const scene = sceneAt(p, t)
  const [screen, camera] = await Promise.all([
    scene.screen && media.screen ? media.screen.frameAt(scene.src) : null,
    scene.camera && media.camera ? media.camera.frameAt(scene.camera.src) : null,
  ])
  try {
    await r.draw(scene, { screen, camera })
  } finally {
    screen?.close()
    camera?.close()
  }
}
