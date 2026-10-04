// The recording flow around the capture engine: toolbar, picking overlays, countdown, recording
// widget, camera bubble, global shortcuts, and the editor once a recording finishes.
//
// The capture engine (electron/recording.ts) reports state and finished recordings on
// `recordingEvents`; its controls are IPC only, so the recorder window is the session controller:
// it runs the commands we send on "shell:do" over "recording:*". It lives from first use until quit,
// hidden when not picking, so the tray, shortcuts, URLs, and the quit prompt reach the recording.
//
// IPC (all windows of this flow):
//   shell:state -> { status, mode, picking, counting, elapsed, at }, pushed as "shell:state" on change
//   shell:command(cmd)            widget -> controller: stop, pause, resume, toggle-pause, cancel, restart
//   shell:warn(message)           an engine warning (disk low, a device lost), shown as a notification
//   shell:pick(mode | null)       enter or leave a picking mode (opens overlays per display)
//   shell:close-picker            hide toolbar, overlays, and the idle camera bubble
//   shell:countdown(on)           a countdown runs (Esc cancels it: "shell:escape")
//   shell:start(opts)             overlay -> controller: start recording with these options
//   shell:fail(error)             a recording call failed: plain-language message or permission fix
//   shell:display(id)             display geometry for an overlay
//   shell:popup(items, x, y)      native menu at (x, y) in the sender window -> picked id | null
//   shell:open-project(path?)     open a bundle in the editor (no path: Open dialog)
//   shell:open-settings           the settings window (onboarding route, settings page)
//   shell:relaunch                macOS applies a new Screen Recording grant only after a relaunch
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, screen, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { recordingEvents } from '../recording.ts'
import { activeDisplay, hidden, openWindow, reveal, sendAll, setRecordingDock, windowsOf } from '../windows.ts'
import { place } from './bounds.ts'
import { plainError, type Permission } from './errors.ts'
import { setSettings, settings, settingsListeners } from './settings.ts'
import type { Mode } from './url.ts'

export type Status = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'
export type Command = 'start' | 'stop' | 'pause' | 'resume' | 'toggle-pause' | 'cancel' | 'restart'

export const SHORTCUTS = { record: 'Alt+Command+Return', pause: 'Alt+Shift+Command+P', cancel: 'Alt+Shift+Command+Backspace' }
const TOOLBAR = { width: 882, height: 64 }
const WIDGET = { width: 280, height: 48 }
const BUBBLE = 216 // camera bubble window; the circle inside leaves room for its shadow

let toolbar: BrowserWindow | null = null
let loaded: Promise<unknown> = Promise.resolve()
let status: Status = 'idle'
let mode: Mode | null = null
let picking = false // toolbar on screen
let counting = false
let quitting = false
let waiters: Array<(bundle: string | null) => void> = []
/** Seconds recorded as of `at` (ms since epoch); `at` is 0 while not running. */
let clock = { elapsed: 0, at: 0 }
export const statusListeners: Array<(s: Status) => void> = []

export const recordingStatus = () => status
export const setQuitting = (on: boolean) => (quitting = on)

/** Recording UI floats over everything, on every Space and over fullscreen apps, and stays out
 *  of screenshots. ScreenCaptureKit ignores sharingType on recent macOS, so the capture engine
 *  also excludes this app from its content filter. */
const floating: BrowserWindowConstructorOptions = {
  type: 'panel',
  frame: false,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  show: false,
}
function protect(win: BrowserWindow, level: number) {
  win.setContentProtection(true)
  win.setAlwaysOnTop(true, 'screen-saver', level)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
}

/** Global shortcuts belong to the user's Mac: hidden runs (agents, tests) never take them. */
function shortcut(accelerator: string, fn: () => void) {
  if (!hidden && !globalShortcut.register(accelerator, fn)) console.warn(`Shortcut ${accelerator} is taken by another app`)
}

/** A one-off message. Hidden runs log it instead of blocking on a modal. */
function alert(message: string, detail: string) {
  if (hidden) return console.error(`${message} ${detail}`)
  return dialog.showMessageBox({ type: 'warning', message, detail })
}

function broadcast() {
  const s = { status, mode, picking, counting, ...clock }
  sendAll('shell:state', s)
}

// ---- Toolbar (controller) ----

function controller(): BrowserWindow {
  if (toolbar && !toolbar.isDestroyed()) return toolbar
  const win = openWindow('recorder', {
    ...floating,
    ...place(TOOLBAR, activeDisplay().workArea, 20),
    vibrancy: 'hud',
    visualEffectState: 'active',
    webPreferences: { backgroundThrottling: false },
  })
  protect(win, 2)
  loaded = new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    closePicker()
  })
  win.webContents.on('render-process-gone', () => {
    if (quitting) return
    toolbar = null
    setImmediate(() => {
      win.destroy()
      controller() // keep a live controller for the recording in progress
    })
  })
  return (toolbar = win)
}

/** Open the recording picker on the display under the mouse. While recording, bring back the controls. */
export function showPicker(m?: Mode) {
  if (status !== 'idle') return showWidget()
  const win = controller()
  win.setBounds(place(TOOLBAR, activeDisplay().workArea, 20))
  picking = true
  reveal(win)
  if (m) pick(m)
  else broadcast()
  updateBubble()
}

export function closePicker() {
  picking = false
  counting = false
  pick(null)
  toolbar?.hide()
  updateBubble()
}

/** Send a command to the controller, which calls the capture engine. */
export async function command(cmd: Command, opts?: unknown) {
  if (cmd === 'restart' && status !== 'idle') {
    clock = { elapsed: 0, at: status === 'recording' ? Date.now() : 0 }
    broadcast()
  }
  const win = controller()
  await loaded
  win.webContents.send('shell:do', cmd, opts)
}

/** Call an IPC handler from the main process. Electron has no main-side invoke, so the call
 *  goes through the controller renderer, the same path every window uses. */
export async function invokeHandler(channel: string, ...args: unknown[]): Promise<any> {
  const win = controller()
  await loaded
  return win.webContents.executeJavaScript(`window.studio.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
}

/** Load the controller ahead of first use (tray menu, shortcuts). */
export const warmUp = () => void controller()

export async function cancelRecording() {
  if (status === 'idle') return
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'Delete this recording?',
    detail: 'Everything recorded so far will be deleted.',
    buttons: ['Keep Recording', 'Delete'],
    defaultId: 0,
    cancelId: 0,
  })
  if (response === 1) command('cancel')
}

/** Stop the recording and wait until it is saved (quit prompt). Null when it did not finish in time. */
export function stopAndWait(): Promise<string | null> {
  return new Promise((done) => {
    waiters.push(done)
    command('stop')
    setTimeout(() => done(null), 30_000)
  })
}

// ---- Overlays: one per display, for display, window, and area picking and the countdown ----

function pick(m: Mode | null) {
  mode = m
  const overlays = m === 'display' || m === 'window' || m === 'area'
  if (!overlays) for (const w of windowsOf('area')) w.destroy()
  else if (!windowsOf('area').length) openOverlays()
  escape(overlays)
  broadcast()
}

function openOverlays() {
  for (const d of screen.getAllDisplays()) {
    const w = openWindow(`area?display=${d.id}`, {
      ...floating,
      ...d.bounds,
      transparent: true,
      hasShadow: false,
      roundedCorners: false,
      enableLargerThanScreen: true,
      webPreferences: { backgroundThrottling: false },
    })
    protect(w, 0)
    w.setBounds(d.bounds) // over the menu bar too
    w.once('ready-to-show', () => reveal(w, false))
  }
}

function escape(on: boolean) {
  if (!on) return globalShortcut.unregister('Escape')
  if (globalShortcut.isRegistered('Escape')) return
  shortcut('Escape', () => {
    if (counting) {
      counting = false
      sendAll('shell:escape')
      if (picking) reveal(controller())
      return broadcast()
    }
    pick(null)
  })
}

// ---- Widget and camera bubble ----

function showWidget() {
  const open = windowsOf('widget')[0]
  if (open) return reveal(open, false)
  const w = openWindow('widget', { ...floating, ...place(WIDGET, activeDisplay().workArea, 24), vibrancy: 'hud', visualEffectState: 'active' })
  protect(w, 2)
  w.once('ready-to-show', () => reveal(w, false))
}

function updateBubble() {
  const s = settings()
  const want = !!s.camera && s.showCamera && (picking || status !== 'idle')
  const open = windowsOf('camera')[0]
  if (!want) return open?.destroy()
  if (open) return
  const area = activeDisplay().workArea
  const w = openWindow('camera', {
    ...floating,
    width: BUBBLE,
    height: BUBBLE,
    x: area.x + 24,
    y: area.y + area.height - BUBBLE - 24,
    transparent: true,
    hasShadow: false,
    movable: true,
  })
  protect(w, 1)
  w.once('ready-to-show', () => reveal(w, false))
}

// ---- Status from the engine ----

function setStatus(next: Status) {
  if (next === status) return
  const now = Date.now()
  const sofar = clock.elapsed + (clock.at ? (now - clock.at) / 1000 : 0)
  const fresh = status === 'idle' || status === 'starting'
  clock = { elapsed: fresh ? 0 : sofar, at: next === 'recording' ? now : 0 }
  status = next
  const active = next !== 'idle'
  setRecordingDock(active)
  if (active) {
    // Recording (or about to): clear the picker off the screen.
    counting = false
    pick(null)
    picking = false
    toolbar?.hide()
    if (settings().showWidget) showWidget()
  } else {
    for (const w of windowsOf('widget')) w.destroy()
  }
  for (const k of [SHORTCUTS.pause, SHORTCUTS.cancel]) globalShortcut.unregister(k)
  if (active) {
    shortcut(SHORTCUTS.pause, () => command('toggle-pause'))
    shortcut(SHORTCUTS.cancel, cancelRecording)
  }
  updateBubble()
  broadcast()
  for (const f of statusListeners) f(next)
}

/** A system notification; clicking it runs `then`. Never in hidden runs (agents, tests). */
function notify(body: string, then?: () => void) {
  if (hidden || !Notification.isSupported()) return
  const n = new Notification({ title: 'Studio', body })
  if (then) n.on('click', then)
  n.show()
}

// ---- Projects ----

export function openProject(path: string) {
  path = resolve(path)
  if (!path.endsWith('.studio') || !existsSync(path) || !statSync(path).isDirectory()) {
    alert(`“${basename(path)}” can’t be opened.`, 'It is not a Studio project, or it was moved or deleted.')
    return
  }
  const route = `editor?project=${encodeURIComponent(path)}`
  const open = windowsOf('editor').find((w) => w.webContents.getURL().endsWith(route))
  if (open) return reveal(open)
  app.addRecentDocument(path)
  openWindow(route)
}

export async function openProjectDialog() {
  const r = await dialog.showOpenDialog({
    title: 'Open Project',
    // openDirectory too: where the .studio package type is not registered (dev), a bundle is a folder.
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Studio Project', extensions: ['studio'] }],
  })
  for (const p of r.filePaths) openProject(p)
}

export function openOnboarding(query = '') {
  const open = windowsOf('onboarding')[0]
  if (open) open.destroy()
  openWindow(`onboarding${query ? `?${query}` : ''}`, {
    width: 640,
    height: 600,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e20',
  })
}

// ---- IPC ----

type PopupItem = { id?: string; label?: string; checked?: boolean; enabled?: boolean; separator?: boolean; accelerator?: string; submenu?: PopupItem[] }

export function registerRecorder() {
  ipcMain.handle('shell:state', () => ({ status, mode, picking, counting, ...clock }))
  ipcMain.handle('shell:pick', (_e, m: Mode | null) => pick(['display', 'window', 'area', 'device'].includes(m as string) ? m : null))
  ipcMain.handle('shell:close-picker', () => closePicker())
  ipcMain.handle('shell:warn', (_e, message: string) => notify(String(message)))
  ipcMain.handle('shell:relaunch', () => {
    app.relaunch()
    app.quit()
  })
  ipcMain.handle('shell:command', (_e, cmd: Command) => {
    if (['stop', 'pause', 'resume', 'toggle-pause', 'cancel', 'restart'].includes(cmd)) return command(cmd)
  })
  ipcMain.handle('shell:finish-onboarding', () => {
    setSettings({ onboarded: true })
    for (const w of windowsOf('onboarding')) w.destroy()
    showPicker()
  })
  ipcMain.handle('shell:countdown', (_e, on: boolean) => {
    counting = !!on
    escape(counting || windowsOf('area').length > 0)
    if (counting) toolbar?.hide()
    broadcast()
  })
  ipcMain.handle('shell:start', (_e, opts: unknown) => command('start', opts))
  ipcMain.handle('shell:fail', async (_e, error: unknown) => {
    const plain = plainError(error)
    counting = false
    sendAll('shell:escape') // reset countdowns
    if (plain.permission) {
      closePicker() // the overlays float above every window, onboarding included
      return openOnboarding(`page=permissions&need=${plain.permission satisfies Permission}`)
    }
    if (picking) showPicker()
    broadcast()
    await alert('Studio couldn’t record.', plain.message)
  })
  ipcMain.handle('shell:display', (_e, id: number) => {
    const d = screen.getAllDisplays().find((d) => d.id === Number(id)) ?? screen.getPrimaryDisplay()
    // `self`: names our own windows carry in the engine's window list (dev runs as "Electron").
    return { id: d.id, label: d.label, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, self: [app.getName(), basename(process.execPath)] }
  })
  ipcMain.handle('shell:popup', (e, items: PopupItem[], x: number, y: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    return new Promise<string | null>((done) => {
      let picked: string | null = null
      const build = (list: PopupItem[]): MenuItemConstructorOptions[] =>
        list.map((i) =>
          i.separator
            ? { type: 'separator' }
            : {
                label: i.label,
                type: i.checked === undefined ? 'normal' : 'checkbox',
                checked: i.checked,
                enabled: i.enabled ?? true,
                accelerator: i.accelerator,
                registerAccelerator: false,
                submenu: i.submenu && build(i.submenu),
                click: () => (picked = i.id ?? null),
              },
        )
      // The click lands after the menu reports closed: settle on the next turn.
      Menu.buildFromTemplate(build(items)).popup({ window: win, x: Math.round(x), y: Math.round(y), callback: () => setTimeout(() => done(picked), 0) })
    })
  })
  ipcMain.handle('shell:open-settings', () => openOnboarding('page=settings'))
  ipcMain.handle('shell:open-project', (_e, path?: string) => (typeof path === 'string' ? openProject(path) : openProjectDialog()))

  settingsListeners.push(updateBubble)
  recordingEvents.on('state', setStatus)
  recordingEvents.on('finished', (bundle: string) => {
    for (const done of waiters.splice(0)) done(bundle)
    if (!quitting) openProject(bundle)
  })
  recordingEvents.on('recovered', (bundle: string) => notify(`A recording cut off by a crash was saved: “${basename(bundle, '.studio')}”. Click to open it.`, () => openProject(bundle)))
  shortcut(SHORTCUTS.record, () => (status === 'idle' ? showPicker() : command('stop')))
  for (const e of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
    screen.on(e as 'display-added', () => {
      if (picking && toolbar) toolbar.setBounds(place(TOOLBAR, activeDisplay().workArea, 20))
      if (windowsOf('area').length && !counting) {
        for (const w of windowsOf('area')) w.destroy()
        openOverlays()
      }
    })
  }
}
