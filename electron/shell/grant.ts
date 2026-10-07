// Owner: app-shell. The drag-to-allow panel. Screen Recording and Accessibility are turned on in a
// System Settings list that Grip is not always in (removed with −, or the request never added it),
// so while Grip has System Settings open there, a small panel rides under its window with Grip's
// icon to drag into the list. It hides while another app covers System Settings (a click on it
// brings Grip forward, which must not hide it mid-drag), and closes when the permission turns on
// (bringing Grip back), when System Settings quits, or on its close button.
// Invoke (panel -> main):
//   grant:drag(iconUrl)   drag Grip.app into the list
//   grant:close
import { app, ipcMain, nativeImage, screen, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Permission } from '../../native/index.d.ts'
import { native } from '../native.ts'
import { recordingEvents } from '../recording.ts'
import { openWindow, reveal } from '../windows.ts'
import { under } from './bounds.ts'

/** The lists that take a dropped app. Camera and Microphone don't: their system prompt adds Grip. */
const LISTS: Permission[] = ['screen', 'accessibility']
const SIZE = { width: 380, height: 72 }
/** Grip.app (Electron.app in dev): what the list needs. */
const bundle = join(app.getPath('exe'), '../../..')

let panel: { win: BrowserWindow; timer: NodeJS.Timeout } | null = null

function close() {
  if (!panel) return
  clearInterval(panel.timer)
  if (!panel.win.isDestroyed()) panel.win.destroy()
  panel = null
}

function show(kind: Permission) {
  close()
  const win = openWindow('grant', {
    ...SIZE,
    x: 0,
    y: 0,
    type: 'panel',
    focusable: false, // a click or drag leaves System Settings in front, so the panel stays up
    acceptFirstMouse: true, // the first press already drags
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    vibrancy: 'hud',
    visualEffectState: 'active',
  })
  win.setAlwaysOnTop(true, 'floating')
  const since = Date.now()
  let seen = false
  // ponytail: polls System Settings' frame every 150 ms, so the panel trails a window being dragged;
  // a faster tick while the frame moves, if that ever shows.
  const tick = () => {
    if (win.isDestroyed()) return close()
    if (native.permissionStatus(kind) === 'granted') {
      close()
      return app.focus({ steal: true })
    }
    const s = native.settingsWindow()
    if (!s) {
      if (seen || Date.now() - since > 10_000) close() // quit, or never opened
      return
    }
    seen = true
    if (s.covered || !s.frame) return win.hide()
    const f = { x: Math.round(s.frame.x), y: Math.round(s.frame.y), width: Math.round(s.frame.w), height: Math.round(s.frame.h) }
    win.setBounds(under(SIZE, f, screen.getDisplayMatching(f).workArea, 12))
    if (!win.isVisible()) reveal(win, false)
  }
  panel = { win, timer: setInterval(tick, 150) }
}

export function registerGrant() {
  // Not for one that is on: the turn-it-off-and-on-again advice must not bounce the user back to Grip.
  recordingEvents.on('settings', (kind: Permission) => LISTS.includes(kind) && native.permissionStatus(kind) !== 'granted' && show(kind))
  ipcMain.handle('grant:drag', (e, icon: unknown) => {
    // Synchronous: the drag must start while the mouse is still down.
    if (typeof icon !== 'string' || !icon.startsWith('data:image/png')) return
    const image = nativeImage.createEmpty()
    image.addRepresentation({ scaleFactor: 2, dataURL: icon }) // 128 px: a sharp 64 pt icon
    if (!image.isEmpty()) e.sender.startDrag({ file: bundle, icon: image })
  })
  ipcMain.handle('grant:close', close)
}
