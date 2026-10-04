// Owner: camera. "camera:*" IPC channels and post-recording camera analysis.
//   camera:list() -> CameraDevice[]   webcams, Continuity Cameras, iPhone/iPad screens (kind 'ios')
//   camera:analyze(bundle)            (re)run the analysis, e.g. for a project recorded before it existed
// Broadcasts to every window:
//   camera:devices (CameraDevice[])                       a camera or iPhone/iPad was plugged in or out
//   camera:progress ({ bundle, progress })                analysis progress, 0..1
//   camera:analyzed ({ bundle, matte, faces } | { bundle, error })
//     On success sources.camera.matte/.faces are already in project.json, and open editors got
//     them through projects:sources (electron/projects.ts updateProject).
import { app, BrowserWindow, ipcMain } from 'electron'
import { dirname, join, relative, resolve } from 'node:path'
import { native } from './native.ts'
import { readProject, updateProject } from './projects.ts'

const running = new Map<string, Promise<void>>()
const aborts = new Set<AbortController>()

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

export function registerCamera() {
  ipcMain.handle('camera:list', () => native.listCameras())
  ipcMain.handle('camera:analyze', (_e, bundle: string) => analyzeCamera(bundle))
  native.watchCameras(() => broadcast('camera:devices', native.listCameras()))
  app.on('before-quit', () => aborts.forEach((a) => a.abort()))
}

/** Called by recording.ts after a recording with a camera stops. Runs in the background; never
 *  throws. A second call for the same bundle while one runs returns the running one. */
export function analyzeCamera(bundle: string): Promise<void> {
  bundle = resolve(bundle)
  let job = running.get(bundle)
  if (!job) {
    job = analyze(bundle).finally(() => running.delete(bundle))
    running.set(bundle, job)
  }
  return job
}

async function analyze(bundle: string) {
  const abort = new AbortController()
  aborts.add(abort)
  try {
    const camera = (await readProject(bundle)).sources.camera
    if (!camera) return
    const out = await native.analyzeCamera(
      join(bundle, camera.file),
      join(bundle, dirname(camera.file)),
      (progress) => broadcast('camera:progress', { bundle, progress }),
      abort.signal,
    )
    // Under the save lock, so edits the editor saved meanwhile survive; open editors get the new
    // sources through projects:sources.
    const result = { matte: relative(bundle, out.matte), faces: relative(bundle, out.faces) }
    const project = await updateProject(bundle, (p) => {
      if (p.sources.camera?.file === camera.file) Object.assign(p.sources.camera, result) // else the source changed meanwhile
    })
    if (project.sources.camera?.matte === result.matte) broadcast('camera:analyzed', { bundle, ...result })
  } catch (e) {
    if (abort.signal.aborted) return
    const error = e instanceof Error ? e.message : String(e)
    console.error(`camera analysis failed for ${bundle}: ${error}`)
    broadcast('camera:analyzed', { bundle, error })
  } finally {
    aborts.delete(abort)
  }
}
