// Owner: capture. The recording session over IPC, and the project bundle around it.
// Invoke (renderer -> main):
//   recording:state -> RecState
//   recording:permissions -> Record<Permission, PermissionStatus>
//   recording:requestPermission(kind) -> PermissionStatus   (prompts the first time only)
//   recording:openPermissionSettings(kind)
//   recording:displays -> Display[]        (needs no permission)
//   recording:windows -> Window[]          (rejects with a one-line reason without Screen Recording)
//   recording:microphones -> Microphone[]
//   recording:micMonitor(micId?)           start the level meter; recording:micMonitorStop ends it
//   recording:start({ target, cameraId?, micId?, systemAudio, hideDesktopIcons?, fps? }) -> RecState
//     target: display | window (frame?: move and resize it there first) | area | device (iPhone/iPad)
//   recording:pause | recording:resume | recording:cancel | recording:restart -> RecState
//   recording:stop -> RecordingSources | null
// Calls in the wrong state are no-ops that return the current state.
// Broadcast to every window:
//   recording:state(state)
//   recording:warning({ code, message })      once per code: camera, input, mic, mic-*, disk-low, finish
//   recording:micLevel({ peak, rms })         ~30 Hz while the meter runs, linear 0..1
//   recording:finished(bundlePath, { reason, message? })   reason: user | disk-full | source-lost | error
//   recording:error(message)                  the recording ended with nothing saved
//   recording:recovered(bundlePath)           at launch: a recording cut by a crash was made whole
import { app, BrowserWindow, ipcMain } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Permission, RecordingEvent, RecordingSources, StartOptions } from '../native/index.d.ts'
import { analyzeCamera } from './camera.ts'
import { native } from './native.ts'
import { createBundle, projectEvents, projectsDir, readProject, writeNewRecording } from './projects.ts'

/** Main-process listeners (dock, quit prompt): 'state' (RecState), 'finished' and 'recovered' (bundle path). */
export const recordingEvents = new EventEmitter()

const PERMISSIONS: Permission[] = ['screen', 'accessibility', 'inputMonitoring', 'microphone', 'camera']

/** Bundle of the running recording. Set before any await, so a second start sees it. */
let bundle: string | null = null
const finished = new Map<string, Promise<void>>()

function broadcast(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args)
}

/** "Recording 2026-10-04 at 13.20.11", made unique if one already exists. */
export function recordingName(d: Date, taken: (name: string) => boolean = () => false): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const base = `Recording ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
  let name = base
  for (let i = 2; taken(name); i++) name = `${base} (${i})`
  return name
}

/** Write project.json for a finalized recording, once per bundle (stop() and the event both land here). */
function finish(dir: string, sources: RecordingSources, reason = 'user', message?: string): Promise<void> {
  if (dir === bundle) bundle = null
  let p = finished.get(dir)
  if (!p) {
    p = (async () => {
      if (!sources.screen && !sources.camera && !sources.mic && !sources.system) {
        await rm(dir, { recursive: true, force: true })
        broadcast('recording:error', message ?? 'Nothing was recorded.')
        return
      }
      await writeNewRecording(dir, sources)
      if (sources.camera) analyzeCamera(dir).catch((err) => console.error('analyzeCamera', dir, err))
      broadcast('recording:finished', dir, { reason, message })
      recordingEvents.emit('finished', dir)
    })()
    finished.set(dir, p)
  }
  return p
}

function onEvent(e: RecordingEvent) {
  if (e.type === 'state') {
    broadcast('recording:state', e.state)
    recordingEvents.emit('state', e.state)
  } else if (e.type === 'warning') {
    broadcast('recording:warning', { code: e.code, message: e.message })
  } else if (e.type === 'cancelled') {
    if (e.bundleDir === bundle) bundle = null
    rm(e.bundleDir, { recursive: true, force: true }).catch((err) => console.error('cancel', err))
  } else {
    finish(e.bundleDir, e.sources, e.reason, e.message ?? undefined).catch((err) => broadcast('recording:error', String(err)))
  }
}

type StartRequest = Omit<StartOptions, 'bundleDir'>

async function start(req: StartRequest) {
  if (bundle !== null && native.recordingState() === 'idle') return 'starting' // creating the bundle
  if (bundle !== null || native.recordingState() !== 'idle') return native.recordingState()
  bundle = ''
  try {
    bundle = await createBundle(recordingName(new Date(), (n) => existsSync(join(projectsDir(), `${n}.studio`))))
    const options: StartOptions = {
      bundleDir: bundle,
      target: req.target,
      cameraId: req.cameraId ?? undefined,
      micId: req.micId ?? undefined,
      systemAudio: Boolean(req.systemAudio),
      fps: req.fps ?? undefined,
      hideDesktopIcons: Boolean(req.hideDesktopIcons),
    }
    return await native.startRecording(options, onEvent)
  } catch (err) {
    if (bundle) await rm(bundle, { recursive: true, force: true })
    bundle = null
    throw err instanceof Error ? err : new Error(String(err))
  }
}

async function stop() {
  const dir = bundle
  const sources = await native.stopRecording()
  if (dir && sources) await finish(dir, sources, sources.screen ? 'user' : 'error')
  return sources
}

/** A crash or power loss leaves a bundle with sources but no project.json. projects.ts rebuilds it
 *  at launch (repairing the files through native.repairRecording); tell the user and finish its camera. */
async function recovered(dir: string) {
  broadcast('recording:recovered', dir)
  recordingEvents.emit('recovered', dir)
  if ((await readProject(dir)).sources.camera) await analyzeCamera(dir)
}

export function registerRecording() {
  projectEvents.on('recovered', (dir: string) => recovered(dir).catch((err) => console.error('recovered', dir, err)))

  ipcMain.handle('recording:state', () => native.recordingState())
  ipcMain.handle('recording:permissions', () => Object.fromEntries(PERMISSIONS.map((k) => [k, native.permissionStatus(k)])))
  ipcMain.handle('recording:requestPermission', (_e, kind: Permission) => native.requestPermission(kind))
  ipcMain.handle('recording:openPermissionSettings', (_e, kind: Permission) => native.openPermissionSettings(kind))
  ipcMain.handle('recording:displays', () => native.listDisplays())
  ipcMain.handle('recording:windows', () => native.listWindows())
  ipcMain.handle('recording:microphones', () => native.listMicrophones())
  ipcMain.handle('recording:micMonitor', (_e, micId?: string | null) =>
    native.startMicMonitor(micId ?? undefined, (level) => broadcast('recording:micLevel', level)),
  )
  ipcMain.handle('recording:micMonitorStop', () => native.stopMicMonitor())
  ipcMain.handle('recording:start', (_e, req: StartRequest) => start(req))
  ipcMain.handle('recording:pause', () => native.pauseRecording())
  ipcMain.handle('recording:resume', () => native.resumeRecording())
  ipcMain.handle('recording:stop', () => stop())
  ipcMain.handle('recording:cancel', () => native.cancelRecording())
  ipcMain.handle('recording:restart', () => native.restartRecording())

  // Quitting mid-recording (after any prompt) still saves it.
  app.on('will-quit', (e) => {
    const s = native.recordingState()
    if (s !== 'recording' && s !== 'paused') return
    e.preventDefault()
    stop().finally(() => app.quit())
  })
}
