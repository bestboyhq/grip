// The project's Finder, Quick Look, and recent-projects thumbnail: one frame rendered by the same
// compositor as preview and export, handed to the main process as PNG bytes (projects:thumbnail).
import { doc } from '../../lib/doc.svelte.ts'
import { invoke } from '../../lib/ipc.ts'
import { outputSize, prepare } from '../../engine/scene.ts'
import { renderFrame, type Media } from '../../engine/compose.ts'
import { Renderer } from '../../engine/gpu/renderer.ts'
import { fileUrl, openVideo } from '../../engine/media/index.ts'
import { timeMap } from '../../shared/timemap.ts'
import { resumeAt } from './helpers.ts'

// ponytail: opens its own decoders per thumbnail; share the player's sources if this shows up in profiles.
export async function sendThumbnail(): Promise<void> {
  const path = doc.path
  if (!doc.project || !path) return
  const project = JSON.parse(JSON.stringify(doc.project)) // a plain copy: edits during the render must not tear it
  const url = (rel: string) => fileUrl(`${path}/${rel}`)
  const { width, height } = outputSize(project, 360)
  const canvas = new OffscreenCanvas(width, height)
  const renderer = await Renderer.create(canvas, url)
  const media: Media = {}
  try {
    const { screen, camera } = project.sources
    if (screen) media.screen = await openVideo(url(screen.file))
    if (camera) media.camera = await openVideo(url(camera.file))
    if (camera?.matte && project.style.camera.removeBackground) media.matte = await openVideo(url(camera.matte))
    const prepared = prepare({ project, events: doc.events, transcript: doc.transcript, width, height })
    // The frame the user last looked at; a fifth in when they never moved the playhead.
    const t = resumeAt(project.clips, project.playhead) || timeMap(project.clips).duration * 0.2
    await renderFrame(renderer, prepared, media, t)
    const png = await canvas.convertToBlob({ type: 'image/png' })
    await invoke('projects:thumbnail', path, new Uint8Array(await png.arrayBuffer()))
  } finally {
    media.screen?.close()
    media.camera?.close()
    media.matte?.close()
    renderer.destroy()
  }
}
