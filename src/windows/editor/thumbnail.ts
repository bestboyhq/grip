// Stills of the open project, rendered by the same compositor as preview and export: the project's
// Finder, Quick Look, and recent-projects thumbnail (handed to the main process as PNG bytes,
// projects:thumbnail), and the Presets tab's view of this project in each preset.
import { doc } from '../../lib/doc.svelte.ts'
import { loadedExtras, pathsOffThread } from '../../lib/player.svelte.ts'
import { invoke } from '../../lib/ipc.ts'
import type { Project, Style } from '../../shared/project.ts'
import { outputSize, prepare } from '../../engine/scene.ts'
import { renderFrame, type Media } from '../../engine/compose.ts'
import { Renderer } from '../../engine/gpu/renderer.ts'
import { fileUrl, openVideo } from '../../engine/media/index.ts'
import { timeMap } from '../../shared/timemap.ts'
import { resumeAt } from './helpers.ts'

/** Render the open project at output time `t` in each of `styles`, `height` px tall, and hand each PNG
 *  to `each` as it lands. One renderer and one set of decoders serve them all. Asset paths in a style
 *  are bundle-relative, or absolute (a preset's look before it is applied). */
// ponytail: opens its own decoders per call; share the player's sources if this shows up in profiles.
export async function renderStills(styles: Style[], height: number, t: number, each: (i: number, png: Blob) => unknown): Promise<void> {
  const path = doc.path
  if (!doc.project || !path) return
  const project: Project = JSON.parse(JSON.stringify(doc.project)) // a plain copy: edits during the render must not tear it
  const url = (rel: string) => fileUrl(rel.startsWith('/') ? rel : `${path}/${rel}`)
  const canvas = new OffscreenCanvas(2, 2)
  const renderer = await Renderer.create(canvas, url)
  const media: Media = {}
  try {
    const { screen, camera } = project.sources
    if (screen) media.screen = await openVideo(url(screen.file))
    if (camera) media.camera = await openVideo(url(camera.file))
    if (camera?.matte && styles.some((s) => s.camera.removeBackground)) media.matte = await openVideo(url(camera.matte))
    for (const [i, style] of styles.entries()) {
      const p = { ...project, style }
      const size = outputSize(p, height)
      canvas.width = size.width
      canvas.height = size.height
      const input = { project: p, events: doc.events, transcript: doc.transcript, ...size, ...loadedExtras() }
      await renderFrame(renderer, prepare(input, await pathsOffThread(input)), media, t) // the heavy part off the main thread
      await each(i, await canvas.convertToBlob({ type: 'image/png' }))
    }
  } finally {
    media.screen?.close()
    media.camera?.close()
    media.matte?.close()
    renderer.destroy()
  }
}

export async function sendThumbnail(): Promise<void> {
  const path = doc.path
  const project = doc.project
  if (!project || !path) return
  // The frame the user last looked at; a fifth in when they never moved the playhead.
  const t = resumeAt(project.clips, project.playhead) || timeMap(project.clips).duration * 0.2
  await renderStills([JSON.parse(JSON.stringify(project.style))], 360, t, async (_, png) => {
    await invoke('projects:thumbnail', path, new Uint8Array(await png.arrayBuffer()))
  })
}
