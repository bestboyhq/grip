// Dev only: `STUDIO_FAKE_RECORDING=<bundle.grip>` swaps in a stand-in for the capture engine
// (electron/recording.ts) and the camera list (electron/camera.ts), so the whole recording flow
// (picker, countdown, widget, editor) runs without screen, camera, or mic access, and never
// shows a system prompt. Each take becomes a new project with the stand-in bundle's sources.
// `STUDIO_FAKE_FAIL=<error text>` makes start fail with that error.
// It follows their IPC contracts; the shell uses nothing else:
//   recording:permissions | requestPermission(kind) | openPermissionSettings(kind)
//   recording:windows -> [{ id, title, app, bundleId, frame: { x, y, w, h } }]   global points
//   recording:microphones -> [{ id, name, isDefault, isBuiltIn }]
//   recording:micMonitor(micId) | micMonitorStop; broadcasts recording:micLevel({ peak, rms })
//   recording:start({ target, cameraId?, micId?, systemAudio }) -> RecState; rejects with a reason
//   recording:pause | resume | cancel | restart -> RecState; recording:stop -> sources | null
//   capture.screenshot(displayId, rect) -> PNG (the stand-in's thumbnail, at the rect's pixel size)
//   capture.still(displayId) -> { width, height, data: RGBA } (the same, of the whole display)
//   recording:draw(phase, x, y, color?, width?): pen strokes land in the take's events.jsonl
//   broadcasts recording:state(state), recording:finished(bundle, { reason }); recordingEvents too
//   camera:list -> [{ id, name, kind: 'built-in' | 'external' | 'continuity' | 'ios', formats }]
import { ipcMain, nativeImage, screen, systemPreferences } from 'electron'
import { constants, existsSync } from 'node:fs'
import { appendFile, cp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project } from '../../src/shared/project.ts'
import { sendAll } from '../windows.ts'
import { capture, recordingEvents, recordingName } from '../recording.ts'
import { createBundle, projectsDir, writeNewRecording } from '../projects.ts'
import { settings } from './settings.ts'

export function registerFakeRecording(bundle: string) {
  let state = 'idle'
  const set = (s: string) => {
    state = s
    sendAll('recording:state', s)
    recordingEvents.emit('state', s)
    return s
  }
  const handle = (channel: string, fn: (...args: any[]) => unknown) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (_e, ...args) => fn(...args))
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const media = (t: 'microphone' | 'camera' | 'screen') => {
    const s = systemPreferences.getMediaAccessStatus(t)
    return s === 'not-determined' ? 'notDetermined' : s === 'granted' ? 'granted' : 'denied'
  }
  const permissions = () => ({
    screen: media('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'notDetermined',
    microphone: media('microphone'),
    camera: media('camera'),
  })

  handle('recording:state', () => state)
  handle('recording:permissions', permissions)
  handle('recording:requestPermission', (kind: keyof ReturnType<typeof permissions>) => permissions()[kind]) // no prompts in dev
  handle('recording:openPermissionSettings', (kind: string) => console.log('[fake recording] open settings for', kind))
  handle('recording:windows', () => {
    const { x, y } = screen.getPrimaryDisplay().workArea
    return [
      { id: 11, app: 'Safari', bundleId: 'com.apple.Safari', title: 'Grip - Release Notes', frame: { x: x + 80, y: y + 60, w: 980, h: 680 } },
      { id: 12, app: 'Xcode', bundleId: 'com.apple.dt.Xcode', title: 'Grip — Recorder.swift', frame: { x: x + 520, y: y + 200, w: 860, h: 600 } },
    ]
  })
  handle('recording:microphones', () => [
    { id: 'fake-mic', name: 'MacBook Pro Microphone', isDefault: true, isBuiltIn: true },
    { id: 'fake-usb', name: 'Shure MV7+ USB Microphone', isDefault: false, isBuiltIn: false },
  ])
  handle('camera:list', () => [
    { id: 'fake-camera', name: 'FaceTime HD Camera', kind: 'built-in', formats: [{ width: 1920, height: 1080, fps: 30 }] },
    { id: 'fake-iphone', name: 'iPhone 17 Pro', kind: 'ios', formats: [{ width: 1206, height: 2622, fps: 60 }] },
  ])
  let meter: ReturnType<typeof setInterval> | undefined
  handle('recording:micMonitor', () => {
    clearInterval(meter)
    meter = setInterval(() => {
      const peak = Math.max(0, Math.sin(Date.now() / 260)) * 0.5 * (0.5 + 0.5 * Math.random())
      sendAll('recording:micLevel', { peak, rms: peak * 0.6 })
    }, 33)
  })
  handle('recording:micMonitorStop', () => clearInterval(meter))
  capture.screenshot = async (id, r) => {
    const scale = screen.getAllDisplays().find((d) => d.id === Number(id))?.scaleFactor ?? 2
    const size = { width: Math.round(r.w * scale), height: Math.round(r.h * scale), quality: 'best' as const }
    const thumbnail = nativeImage.createFromPath(join(bundle, 'thumbnail.png'))
    // A bundle never opened in the editor has no thumbnail: a gradient of four BGRA pixels stands in.
    const image = thumbnail.isEmpty() ? nativeImage.createFromBitmap(Buffer.from([200, 120, 40, 255, 80, 160, 240, 255, 60, 200, 120, 255, 230, 230, 230, 255]), { width: 2, height: 2 }) : thumbnail
    return image.resize(size).toPNG()
  }
  capture.still = async (id) => {
    const { width, height } = screen.getAllDisplays().find((d) => d.id === Number(id))?.bounds ?? screen.getPrimaryDisplay().bounds
    const image = nativeImage.createFromBuffer(Buffer.from(await capture.screenshot(id, { x: 0, y: 0, w: width, h: height })))
    const data = image.toBitmap() // BGRA: swap to RGBA
    for (let i = 0; i < data.length; i += 4) [data[i], data[i + 2]] = [data[i + 2], data[i]]
    return { ...image.getSize(), data }
  }
  // Pen strokes in the stand-in's screen pixels, as if the primary display were the screen source.
  let t0 = 0
  let ink: string[] = []
  let screenWidth = 1920
  handle('recording:draw', (phase: string, x: number, y: number, color?: string, width?: number) => {
    if (state !== 'recording') return false
    const d = screen.getPrimaryDisplay().bounds
    const k = screenWidth / d.width
    ink.push(JSON.stringify({ t: (Date.now() - t0) / 1000, type: 'draw', phase, x: (x - d.x) * k, y: (y - d.y) * k, ...(phase === 'start' && { color, width: (width ?? 4) * k }) }))
    return true
  })
  let inputs = { cameraId: '', micId: '', systemAudio: true }
  handle('recording:start', async (req: typeof inputs) => {
    console.log('[fake recording] start', JSON.stringify(req))
    if (state !== 'idle') return state
    if (process.env.STUDIO_FAKE_FAIL) throw new Error(process.env.STUDIO_FAKE_FAIL)
    inputs = req
    set('starting')
    await wait(300)
    t0 = Date.now()
    ink = []
    screenWidth = (JSON.parse(await readFile(join(bundle, 'project.json'), 'utf8')) as Project).sources.screen?.width ?? 1920
    return set('recording')
  })
  handle('recording:pause', () => (state === 'recording' ? set('paused') : state))
  handle('recording:resume', () => (state === 'paused' ? set('recording') : state))
  handle('recording:restart', () => (state === 'idle' ? state : set('recording')))
  handle('recording:cancel', () => (state === 'idle' ? state : set('idle')))
  handle('recording:stop', async () => {
    if (state !== 'recording' && state !== 'paused') return null
    set('stopping')
    // A new project per take, like a real recording: the stand-in's sources, cloned (instant on
    // APFS), with fresh edits, minus the inputs this take had off. The stand-in is never written to.
    const { sources } = JSON.parse(await readFile(join(bundle, 'project.json'), 'utf8')) as Project
    if (!inputs.cameraId) delete sources.camera
    if (!inputs.micId) delete sources.mic
    if (!inputs.systemAudio) delete sources.system
    const dir = await createBundle(recordingName(new Date(), (n) => existsSync(join(projectsDir(), `${n}.grip`))))
    await cp(join(bundle, 'sources'), join(dir, 'sources'), { recursive: true, mode: constants.COPYFILE_FICLONE })
    if (ink.length && sources.events) await appendFile(join(dir, sources.events), ink.join('\n') + '\n')
    await writeNewRecording(dir, sources, { camera: settings().cameraCorner, autoZoom: settings().autoZoom })
    set('idle')
    sendAll('recording:finished', dir, { reason: 'user' })
    recordingEvents.emit('finished', dir, { reason: 'user' })
    return sources
  })
}
