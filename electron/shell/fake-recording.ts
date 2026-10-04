// Dev only: `STUDIO_FAKE_RECORDING=<bundle.studio>` swaps in a stand-in for the capture engine
// (electron/recording.ts) and the camera list (electron/camera.ts), so the whole recording flow
// (picker, countdown, widget, editor) runs without screen, camera, or mic access, and never
// shows a system prompt. `STUDIO_FAKE_FAIL=<error text>` makes start fail with that error.
// It follows their IPC contracts; the shell uses nothing else:
//   recording:permissions | requestPermission(kind) | openPermissionSettings(kind)
//   recording:windows -> [{ id, title, app, bundleId, frame: { x, y, w, h } }]   global points
//   recording:microphones -> [{ id, name, isDefault, isBuiltIn }]
//   recording:micMonitor(micId) | micMonitorStop; broadcasts recording:micLevel({ peak, rms })
//   recording:start({ target, cameraId?, micId?, systemAudio }) -> RecState; rejects with a reason
//   recording:pause | resume | cancel | restart -> RecState; recording:stop -> sources | null
//   broadcasts recording:state(state), recording:finished(bundle, { reason }); recordingEvents too
//   camera:list -> [{ id, name, kind: 'built-in' | 'external' | 'continuity' | 'ios', formats }]
import { ipcMain, screen, systemPreferences } from 'electron'
import { sendAll } from '../windows.ts'
import { recordingEvents } from '../recording.ts'

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
    inputMonitoring: 'notDetermined',
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
      { id: 12, app: 'Xcode', bundleId: 'com.apple.dt.Xcode', title: 'Studio — Recorder.swift', frame: { x: x + 520, y: y + 200, w: 860, h: 600 } },
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
  handle('recording:start', async (req: unknown) => {
    console.log('[fake recording] start', JSON.stringify(req))
    if (state !== 'idle') return state
    if (process.env.STUDIO_FAKE_FAIL) throw new Error(process.env.STUDIO_FAKE_FAIL)
    set('starting')
    await wait(300)
    return set('recording')
  })
  handle('recording:pause', () => (state === 'recording' ? set('paused') : state))
  handle('recording:resume', () => (state === 'paused' ? set('recording') : state))
  handle('recording:restart', () => (state === 'idle' ? state : set('recording')))
  handle('recording:cancel', () => (state === 'idle' ? state : set('idle')))
  handle('recording:stop', async () => {
    if (state !== 'recording' && state !== 'paused') return null
    set('stopping')
    await wait(400)
    set('idle')
    sendAll('recording:finished', bundle, { reason: 'user' })
    recordingEvents.emit('finished', bundle)
    return { duration: 24 }
  })
}
