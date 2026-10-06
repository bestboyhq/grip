// The recording flow around the capture engine: toolbar, picking overlays, countdown, recording
// widget, camera bubble, speaker notes, global shortcuts, and the editor once a recording finishes.
//
// The capture engine (electron/recording.ts) reports state and finished recordings on
// `recordingEvents`; its controls are IPC only, so the recorder window is the session controller:
// it runs the commands we send on "shell:do" over "recording:*". It lives from first use until quit,
// hidden when not picking, so the tray, shortcuts, URLs, and the quit prompt reach the recording.
//
// IPC (all windows of this flow):
//   shell:state -> { status, mode, picking, counting, area, elapsed, at, update }, pushed as "shell:state" on change
//                                 (update: a downloaded version waiting for a restart, or '')
//   shell:command(cmd)            widget -> controller: stop, pause, resume, toggle-pause, cancel, restart
//   shell:warn(message)           an engine warning (disk low, a device lost), shown as a notification
//   shell:pick(mode | null)       enter or leave a picking mode (opens overlays per display)
//   shell:close-picker            hide toolbar, overlays, and the idle camera bubble
//   shell:countdown(on)           a countdown runs (Esc cancels it: "shell:escape")
//   shell:start(opts)             overlay -> controller: start recording with these options
//   shell:fail(error)             a recording call failed: plain-language message or permission fix
//   shell:display(id)             display geometry for an overlay, and where the toolbar sits on it
//   shell:popup(items, x, y)      native menu at (x, y) in the sender window -> picked id | null
//   shell:open-project(path?)     open a bundle in the editor (no path: Open dialog)
//   shell:open-files(paths)       dropped files: bundles open, videos import first; rejects with a reason
//   shell:open-settings           the settings window (onboarding route, settings page)
//   shell:relaunch                macOS applies a new Screen Recording grant only after a relaunch
//   notes:prompter                main -> speaker notes window: start or stop the prompter (⌥⌘.)
// Editor windows: "editor:close" asks one to save and refresh its thumbnail; it answers
// editor:closed(error), '' once saved.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, screen, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { importVideo, recoveredAtLaunch } from '../projects.ts'
import { recordingEvents } from '../recording.ts'
import { activeDisplay, hidden, openWindow, reveal, sendAll, setRecordingDock, windowsOf } from '../windows.ts'
import { arrangement, place } from './bounds.ts'
import { plainError, type Permission } from './errors.ts'
import { editorCloser, type Choice } from './closing.ts'
import { hold, release, type Held } from './session.ts'
import { setSettings, settings, settingsListeners } from './settings.ts'
import { readyVersion, updateListeners } from './update.ts'
import type { Mode } from './url.ts'
import type { Rect, StartOptions } from '../../native/index.d.ts'

export type Status = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'
export type Command = 'start' | 'stop' | 'pause' | 'resume' | 'toggle-pause' | 'cancel' | 'restart'

export const SHORTCUTS = { record: 'Alt+Command+Return', pause: 'Alt+Shift+Command+P', cancel: 'Alt+Shift+Command+Backspace', prompter: 'Alt+Command+.' }
const TOOLBAR = { width: 882, height: 64 }
const WIDGET = { width: 280, height: 48 }
const BUBBLE = 216 // camera bubble window; the circle inside leaves room for its shadow
const NOTES = { width: 440, height: 260 }

let toolbar: BrowserWindow | null = null
let loaded: Promise<unknown> = Promise.resolve()
let status: Status = 'idle'
let mode: Mode | null = null
let picking = false // toolbar on screen
let counting = false
/** The area being recorded, from its start request until the recording ends: the overlays stay as
 *  a click-through backdrop that dims everything around it. Rect relative to its display. */
let area: { display: number; rect: Rect } | null = null
let quitting = false
let waiters: Array<(bundle: string | null) => void> = []
/** Seconds recorded as of `at` (ms since epoch); `at` is 0 while not running. */
let clock = { elapsed: 0, at: 0 }
export const statusListeners: Array<(s: Status) => void> = []

export const recordingStatus = () => status
export const isQuitting = () => quitting
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

const state = () => ({ status, mode, picking, counting, area, ...clock, update: readyVersion() })
const broadcast = () => sendAll('shell:state', state())

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
  updateHelpers()
}

export function closePicker() {
  picking = false
  counting = false
  pick(null)
  toolbar?.hide()
  updateHelpers()
}

/** Stop or cancel asked for while the engine starts; sent once it records (setStatus). */
let held: Held = null

/** Send a command to the controller, which calls the capture engine. */
export async function command(cmd: Command, opts?: unknown) {
  if ((cmd === 'stop' || cmd === 'cancel') && status === 'starting') return void (held = hold(held, cmd))
  if (cmd === 'restart' && status !== 'idle') {
    clock = { elapsed: 0, at: status === 'recording' ? Date.now() : 0 }
    broadcast()
  }
  const win = controller()
  await loaded
  win.webContents.send('shell:do', cmd, opts)
}

/** Load the controller ahead of first use (tray menu, shortcuts). */
export const warmUp = () => void controller()

/** Ask, then delete the recording in progress. The shortcut held down or pressed again while the
 *  question is open asks once. */
let confirming = false
export async function cancelRecording() {
  if (status === 'idle' || confirming) return
  confirming = true
  const { response } = await dialog
    .showMessageBox({
      type: 'warning',
      message: 'Delete this recording?',
      detail: 'Everything recorded so far will be deleted.',
      buttons: ['Keep Recording', 'Delete'],
      defaultId: 0,
      cancelId: 0,
    })
    .finally(() => (confirming = false))
  if (response === 1 && recordingStatus() !== 'idle') command('cancel') // it may have ended meanwhile
}

/** Stop the recording and wait until it is saved (quit prompt). Null when it did not finish in
 *  time, or when nothing is recording. */
export function stopAndWait(): Promise<string | null> {
  if (status === 'idle') return Promise.resolve(null)
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
  const backdrop = !!area && status !== 'idle'
  if (!overlays && !backdrop) for (const w of windowsOf('area')) w.destroy()
  else if (!windowsOf('area').length) openOverlays()
  for (const w of windowsOf('area')) w.setIgnoreMouseEvents(backdrop) // the backdrop never takes a click
  escape(overlays)
  broadcast()
}

/** The display arrangement the picker was laid out for. macOS reports metrics changes in bursts
 *  (another app's Dock icon, the menu bar); only a real change moves the toolbar or rebuilds the
 *  overlays, which would lose the pick in progress. */
const displays = () => arrangement(screen.getAllDisplays())
let covered = ''

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

/** Speaker notes: a prompter under the menu bar, near the camera, while picking and recording. */
function updateNotes() {
  const want = settings().speakerNotes && (picking || status !== 'idle')
  const open = windowsOf('notes')[0]
  if (!want) {
    if (open) globalShortcut.unregister(SHORTCUTS.prompter)
    return open?.destroy()
  }
  if (open) return
  const area = activeDisplay().workArea
  const w = openWindow('notes', {
    ...floating,
    ...NOTES,
    x: Math.round(area.x + (area.width - NOTES.width) / 2),
    y: area.y + 12,
    resizable: true,
    minWidth: 300,
    minHeight: 150,
    vibrancy: 'hud',
    visualEffectState: 'active',
  })
  protect(w, 1)
  w.once('ready-to-show', () => reveal(w, false))
  // Start or stop the prompter from any app, the one being recorded included.
  shortcut(SHORTCUTS.prompter, () => w.isDestroyed() || w.webContents.send('notes:prompter'))
}

/** Windows that follow the picker and the recording: camera bubble and speaker notes. */
function updateHelpers() {
  updateBubble()
  updateNotes()
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
    area = null
    pick(null)
  }
  for (const k of [SHORTCUTS.pause, SHORTCUTS.cancel]) globalShortcut.unregister(k)
  if (active) {
    shortcut(SHORTCUTS.pause, () => command('toggle-pause'))
    shortcut(SHORTCUTS.cancel, cancelRecording)
  }
  updateHelpers()
  broadcast()
  for (const f of statusListeners) f(next)
  const [send, still] = release(held, next)
  held = still
  if (send) command(send)
}

/** A system notification; clicking it runs `then`. Never in hidden runs (agents, tests). */
function notify(body: string, then?: () => void) {
  if (hidden || !Notification.isSupported()) return
  const n = new Notification({ title: 'Grip', body })
  if (then) n.on('click', then)
  n.show()
}

// ---- Projects ----

/** Editor routes as opened, for windows whose page has not loaded yet (their URL is still empty). */
const routes = new WeakMap<BrowserWindow, string>()
/** The editor window showing `path`, if one is open (its URL follows in-app renames). */
function editorFor(path: string): BrowserWindow | undefined {
  const param = `project=${encodeURIComponent(path)}`
  return windowsOf('editor').find((w) => !w.webContents.isDestroyed() && (w.webContents.getURL() || routes.get(w) || '').split('#')[1]?.split(/[?&]/).includes(param))
}

/** Open a bundle in the editor, or bring its editor forward. `recovered`: the editor says so. */
export function openProject(path: string, recovered = false) {
  path = resolve(path).replace(/\/+$/, '')
  if (!path.endsWith('.grip') || !existsSync(path) || !statSync(path).isDirectory()) {
    alert(`“${basename(path)}” can’t be opened.`, 'It is not a Grip project, or it was moved or deleted.')
    return
  }
  const open = editorFor(path)
  if (open) return reveal(open)
  app.addRecentDocument(path)
  const route = `editor?project=${encodeURIComponent(path)}${recovered ? '&recovered' : ''}`
  const win = openWindow(route)
  routes.set(win, `#/${route}`)
  closeGracefully(win)
}

/** Open what the user hands us (Finder, dock, menu bar icon, window drops, File menu): bundles open
 *  in the editor, .mp4/.mov videos import as new projects first. Throws the first failure. */
export async function openFiles(paths: string[]): Promise<void> {
  let failure: unknown
  for (const p of paths) {
    try {
      openProject(/\.grip\/?$/i.test(p) ? p : await importVideo(p))
    } catch (e) {
      failure ??= e
    }
  }
  if (failure) throw new Error(plainError(failure).message)
}

/** openFiles for callers with no window to report to: failures become an alert. */
export function openFilesOrAlert(paths: string[]) {
  openFiles(paths).catch((e: Error) => void alert('Grip couldn’t open that.', e.message))
}

export async function openProjectDialog() {
  const r = await dialog.showOpenDialog({
    title: 'Open Project',
    // openDirectory too: where the .grip package type is not registered (dev), a bundle is a folder.
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Grip Project', extensions: ['grip'] }],
  })
  for (const p of r.filePaths) openProject(p)
}

export async function importDialog() {
  const r = await dialog.showOpenDialog({
    title: 'Import Video',
    message: 'Each video becomes a new project.',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov'] }],
  })
  openFilesOrAlert(r.filePaths)
}

// An editor saves and refreshes its thumbnail before it goes (closing.ts): "editor:close" to the
// page, "editor:closed"(error) back.
const editors = editorCloser<BrowserWindow>({
  ask: (win) => win.webContents.send('editor:close'),
  prompt: unsaved,
  close: (win) => win.close(),
  gone: (win) => win.isDestroyed() || win.webContents.isCrashed(),
  quitting: () => quitting,
  quit: () => app.quit(),
  stay: () => (quitting = false),
})
function closeGracefully(win: BrowserWindow) {
  win.on('close', (e) => {
    if (!win.webContents.isCrashed() && !editors.closing(win)) e.preventDefault()
  })
  // A page that is gone has nothing left to save: a close or quit waiting for it goes ahead.
  win.webContents.on('render-process-gone', () => editors.answered(win, ''))
}
/** Quitting: whether every open editor is saved (or discarded) and may close. The rest are asked to
 *  save now; the quit resumes when they are done. */
export const editorsDone = () => windowsOf('editor').filter((w) => !w.webContents.isCrashed() && !editors.closing(w)).length === 0

/** An editor's save failed: Save Again, Discard Edits, or Cancel. Hidden runs (agents, tests) never
 *  block on a modal: they keep the window, and its edits. */
async function unsaved(win: BrowserWindow, error: string): Promise<Choice> {
  if (hidden) {
    console.error(`[editor] kept open, its edits are not saved: ${error}`)
    return 'cancel'
  }
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: `Your latest edits to “${win.getTitle()}” aren’t saved.`,
    detail: error,
    buttons: ['Save Again', 'Cancel', 'Discard Edits'],
    defaultId: 0,
    cancelId: 1,
  })
  return (['save', 'cancel', 'discard'] as const)[response]
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
    backgroundColor: '#111113', // var(--surface-root): no flash of another gray while the page loads
  })
}

// ---- IPC ----

type PopupItem = { id?: string; label?: string; checked?: boolean; enabled?: boolean; separator?: boolean; accelerator?: string; submenu?: PopupItem[] }

export function registerRecorder() {
  ipcMain.handle('shell:state', state)
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
  ipcMain.handle('shell:start', (_e, opts: Partial<StartOptions>) => {
    const t = opts?.target
    area = t?.kind === 'area' ? { display: t.displayId, rect: t.rect } : null
    broadcast()
    return command('start', opts)
  })
  ipcMain.handle('shell:fail', async (_e, error: unknown) => {
    const plain = plainError(error)
    counting = false
    if (status === 'idle') area = null // it never started
    sendAll('shell:escape') // reset countdowns
    if (plain.permission) {
      closePicker() // the overlays float above every window, onboarding included
      return openOnboarding(`page=permissions&need=${plain.permission satisfies Permission}`)
    }
    if (picking) showPicker()
    broadcast()
    await alert('Grip couldn’t record.', plain.message)
  })
  ipcMain.handle('shell:display', (_e, id: number) => {
    const d = screen.getAllDisplays().find((d) => d.id === Number(id)) ?? screen.getPrimaryDisplay()
    // `self`: names our own windows carry in the engine's window list (dev runs as "Electron").
    // `toolbarTop`: where the toolbar's top edge sits on this display (local points); cards stay above it.
    const toolbarTop = place(TOOLBAR, d.workArea, 20).y - d.bounds.y
    return { id: d.id, label: d.label, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor, toolbarTop, self: [app.getName(), basename(process.execPath)] }
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
  ipcMain.handle('shell:open-files', (_e, paths: unknown) => openFiles(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && isAbsolute(p)) : []))
  ipcMain.handle('editor:closed', (e, error: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) editors.answered(win, typeof error === 'string' ? error : '')
  })

  settingsListeners.push(updateHelpers)
  updateListeners.push(broadcast)
  recordingEvents.on('state', setStatus)
  recordingEvents.on('finished', (bundle: string, end?: { reason?: string; message?: string }) => {
    for (const done of waiters.splice(0)) done(bundle)
    if (quitting) return
    openProject(bundle)
    // It stopped on its own (disk full, display unplugged, a write failed): say why, over the editor.
    if (end?.reason && end.reason !== 'user') void alert('Grip stopped recording.', end.message ?? 'The recording was saved.')
  })
  // Recordings cut off by a crash or power loss, made whole at launch (capture repairs its own
  // files, projects rebuilds the rest): each opens in the editor, which says it was recovered.
  recordingEvents.on('recovered', (bundle: string) => openProject(bundle, true))
  recoveredAtLaunch.then((list) => list.forEach((r) => openProject(r.path, true)))
  shortcut(SHORTCUTS.record, () => (status === 'idle' ? showPicker() : command('stop')))
  covered = displays()
  for (const e of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
    screen.on(e as 'display-added', () => {
      if (displays() === covered) return
      covered = displays()
      if (picking && toolbar) toolbar.setBounds(place(TOOLBAR, activeDisplay().workArea, 20))
      if (windowsOf('area').length && !counting) {
        for (const w of windowsOf('area')) w.destroy()
        pick(mode) // the picker, or the backdrop of the area being recorded
      }
    })
  }
}
