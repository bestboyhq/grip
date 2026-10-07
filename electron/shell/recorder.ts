// The capture flow around the engine: toolbar, picking overlays (area first: record it or take a
// screenshot of it), countdown, recording widget, drawing on screen, camera bubble, speaker notes,
// global shortcuts, and the result card once a recording or screenshot is done.
//
// The capture engine (electron/recording.ts) reports state and finished recordings on
// `recordingEvents`; its controls are IPC only, so the recorder window is the session controller:
// it runs the commands we send on "shell:do" over "recording:*". It lives from first use until quit,
// hidden when not picking, so the tray, shortcuts, URLs, and the quit prompt reach the recording.
//
// IPC (all windows of this flow):
//   shell:state -> { status, mode, picking, counting, area, drawing, inkDisplay, elapsed, at, update }, pushed as
//                                 "shell:state" on change (update: a downloaded version waiting for a restart, or '' also while put off;
//                                 drawing: the pen is on, on display inkDisplay)
//   shell:command(cmd)            widget -> controller: stop, pause, resume, toggle-pause, cancel, restart
//   shell:warn(message)           an engine warning (disk low, a device lost), shown as a notification
//   shell:pick(mode | null)       enter or leave a picking mode (opens overlays per display)
//   shell:still(displayId) -> Still | null   overlay: its display frozen as it was when the picker opened (raw
//                                 RGBA); a loaded overlay asks ahead and gets it when a pick opens
//   shell:ready                   overlay: painted (its still too), show it
//   shell:close-picker            hide toolbar, overlays, and the idle camera bubble
//   shell:countdown(on)           a countdown runs (Esc cancels it: "shell:escape")
//   shell:start(opts)             overlay -> controller: start recording with these options
//   shell:draw(on?)               toggle (or set) drawing on screen while recording
//   shell:shot(png, scale, save)  overlay: a finished screenshot; copied to the clipboard, or saved to the Desktop
//   shell:fit(height)             the result card sizes itself to its content (bottom edge stays), and shows
//   shell:drag(path, iconUrl)     the result card: drag its file out (into Slack, Mail, Finder)
//   shell:reveal(path)            the result card: show its file in Finder
//   shell:shot-copy(path)         the result card: a screenshot onto the clipboard again
//   shell:shot-save(path) -> path the result card: a screenshot into a file on the Desktop
//   shell:captures -> [{ id, label, icon }]   Recent Captures as menu items (id: the path; icon: PNG at 2x)
//   shell:reopen(path)            a recent capture's result card again (the picker closes first)
//   shell:fail(error, title?)     a recording (or screenshot) call failed: plain-language message or permission fix
//   shell:shortcut(keys | null) -> ok   Settings: the record shortcut becomes `keys` (an accelerator), false if
//                                 macOS won't give it to Grip; null pauses it while the user types a new one
//   shell:display(id)             display geometry for an overlay, and where the toolbar sits on it
//   shell:popup(items, x, y)      native menu at (x, y) in the sender window -> picked id | null (icon: PNG at 2x)
//   shell:open-project(path?)     open a bundle in the editor (no path: Open dialog)
//   shell:open-files(paths)       dropped files: bundles open, videos import first; rejects with a reason
//   shell:open-settings           the settings window (onboarding route, settings page)
//   shell:relaunch                macOS applies a new Screen Recording grant only after a relaunch
//   notes:prompter                main -> speaker notes window: start or stop the prompter (⌥⌘.)
// Editor windows: "editor:close" asks one to save and refresh its thumbnail; it answers
// editor:closed(error), '' once saved.
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, shell, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { importVideo, recoveredAtLaunch } from '../projects.ts'
import { capture, recordingEvents, recordingName } from '../recording.ts'
import { native } from '../native.ts'
import { DRAW_FADE, DRAW_HOLD } from '../../src/engine/overlays/drawings.ts'
import type { CameraPosition } from '../../src/shared/project.ts'
import { activeDisplay, hidden, openWindow, reveal, sendAll, setRecordingDock, updateDock, windowsOf } from '../windows.ts'
import { arrangement, place } from './bounds.ts'
import { withScale } from './png.ts'
import { plainError, type Permission } from './errors.ts'
import { editorCloser, type Choice } from './closing.ts'
import { hold, release, type Held } from './session.ts'
import { setSettings, settings, settingsListeners } from './settings.ts'
import { addCapture, captureRows, captures, moveCapture, shotsDir } from './captures.ts'
import { toolbarUpdate, updateListeners } from './update.ts'
import { setAppMenu } from './menu.ts'
import { symbols } from '../../src/shared/shortcut.ts'
import type { Mode } from './url.ts'
import type { Rect, StartOptions, Still } from '../../native/index.d.ts'

export type Status = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'
export type Command = 'start' | 'stop' | 'pause' | 'resume' | 'toggle-pause' | 'cancel' | 'restart'

/** Shortcuts while recording, and the prompter's. The record shortcut is the user's: settings.recordShortcut. */
export const SHORTCUTS = { pause: 'Alt+Shift+Command+P', cancel: 'Alt+Shift+Command+Backspace', prompter: 'Alt+Command+.', draw: 'Alt+Shift+Command+D' }
const TOOLBAR = { width: 882, height: 64 }
const WIDGET = { width: 316, height: 48 }
const RESULT = { width: 300, height: 400 } // taller than any card, which fits its height to its content (shell:fit)
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
/** The display being recorded (null: an iPhone or iPad), where the pen draws. */
let recDisplay: number | null = null
/** The pen is on: the recorded display's overlay takes the mouse and strokes go into the recording. */
let drawing = false
/** Until when (ms since epoch) strokes drawn before the pen went off still fade out on screen. */
let inkUntil = 0
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

/** Global shortcuts belong to the user's Mac: hidden runs (agents, tests) never take them. False when
 *  another app has it. */
function shortcut(accelerator: string, fn: () => void): boolean {
  if (hidden || globalShortcut.register(accelerator, fn)) return true
  console.warn(`Shortcut ${accelerator} is taken by another app`)
  return false
}

/** The record shortcut as registered; '' while paused, or when another app has it. */
let recordKeys = ''

/** Make `keys` (an accelerator from src/shared/shortcut.ts) the record shortcut, or pause it (null)
 *  while the user types a new one, so pressing the current one records it instead of opening the
 *  picker. False when it isn't one, or another app has it: the one before stays. */
function setRecordShortcut(keys: string | null): boolean {
  if (recordKeys) globalShortcut.unregister(recordKeys)
  recordKeys = ''
  if (keys === null) return true
  const before = settings().recordShortcut
  if (!symbols(keys) || !shortcut(keys, () => (status === 'idle' ? showPicker() : command('stop')))) {
    if (keys !== before) setRecordShortcut(before)
    return false
  }
  if (!hidden) recordKeys = keys
  if (keys !== before) {
    setSettings({ recordShortcut: keys })
    setAppMenu() // its New Recording item shows the shortcut
  }
  return true
}

/** A one-off message. Hidden runs log it instead of blocking on a modal. */
function alert(message: string, detail: string) {
  if (hidden) return console.error(`${message} ${detail}`)
  return dialog.showMessageBox({ type: 'warning', message, detail })
}

const state = () => ({ status, mode, picking, counting, area, drawing, inkDisplay: recDisplay, ...clock, update: toolbarUpdate() })
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
  native.disableWindowAnimation(win.getNativeWindowHandle()) // shows at once, with the frozen screen
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

/** Open the picker on the display under the mouse, in area mode unless told otherwise: the screen
 *  freezes, and the last area comes back selected, ready to record (↩) or to copy as a screenshot
 *  (⌘C). While recording, bring back the controls. */
export function showPicker(m: Mode = 'area') {
  if (status !== 'idle') return showWidget()
  const win = controller()
  win.setBounds(place(TOOLBAR, activeDisplay().workArea, 20))
  picking = true
  // Overlays bring the toolbar with the frozen screen (showOverlay). Ones on screen already: it shows
  // now, before pick() gives the keyboard back to the area overlay.
  if (m === 'device' || windowsOf('area').some((w) => w.isVisible())) reveal(win)
  pick(m)
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

/** Load the controller and the overlays ahead of first use (tray menu, shortcuts). */
export function warmUp() {
  controller()
  loadOverlays()
}

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
// They load ahead, hidden, so a pick only captures the stills and hands them over. Used ones go with
// their state (a drawn screenshot, a countdown), and fresh ones load for the next pick.

/** The overlays are in use: picking, or the backdrop of a recording. */
let overlaysOpen = false

function pick(m: Mode | null) {
  mode = m
  const overlays = m === 'display' || m === 'window' || m === 'area'
  // While recording: the backdrop around an area, the pen, and strokes still fading out.
  const backdrop = status !== 'idle' && (!!area || drawing || Date.now() < inkUntil)
  if (!overlays && !backdrop) {
    if (overlaysOpen) closeOverlays()
  } else if (!overlaysOpen) openOverlays()
  else if (m === 'area') {
    // Switched to area mode: the overlay under the mouse takes the keyboard (showOverlay does it for new ones).
    const here = windowsOf('area').find((w) => screen.getDisplayMatching(w.getBounds()).id === activeDisplay().id)
    if (here?.isVisible()) reveal(here)
  }
  // The backdrop never takes a click, except the pen's display while it is on.
  for (const w of windowsOf('area')) w.setIgnoreMouseEvents(backdrop && !(drawing && screen.getDisplayMatching(w.getBounds()).id === recDisplay))
  escape(overlays || drawing)
  broadcast()
  updateBubble()
}

/** The display arrangement the picker was laid out for. macOS reports metrics changes in bursts
 *  (another app's Dock icon, the menu bar); only a real change moves the toolbar or rebuilds the
 *  overlays, which would lose the pick in progress. */
const displays = () => arrangement(screen.getAllDisplays())
let covered = ''

/** Each display as it was when the overlays opened to pick (null while recording, or if the capture
 *  failed), for its overlay, which asks ahead (shell:still): the overlays show it frozen, and
 *  screenshots are cut from it. */
const stills = new Map<number, PromiseWithResolvers<Still | null>>()
const stillOf = (id: number) => stills.get(id) ?? stills.set(id, Promise.withResolvers()).get(id)!
/** Every display is frozen. Nothing of ours shows before: the capture leaves out only what is on screen. */
let frozen: Promise<unknown> = Promise.resolve()

function openOverlays() {
  overlaysOpen = true
  const idle = status === 'idle'
  // Picking: freeze every display now, before anything of ours shows (a menu or a hover stays open).
  frozen = Promise.all(
    screen.getAllDisplays().map(async (d) => {
      const { resolve } = stillOf(d.id) // this pick's: a capture done after it closed goes nowhere
      resolve(idle ? await capture.still(d.id).catch(() => null) : null)
    }),
  )
  if (windowsOf('area').some((w) => w.webContents.isCrashed())) for (const w of windowsOf('area')) w.destroy() // gone while waiting
  if (!windowsOf('area').length) loadOverlays()
  // Each shows once it has painted its still (shell:ready); one that never does can't hold the picker back.
  for (const w of windowsOf('area')) setTimeout(() => showOverlay(w), 2000)
}

/** The overlays go with their stills; fresh ones load for the next pick. */
function closeOverlays() {
  overlaysOpen = false
  for (const w of windowsOf('area')) w.destroy()
  stills.clear()
  loadOverlays()
}

/** One overlay per display, hidden until a pick hands it its still. */
function loadOverlays() {
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
    native.disableWindowAnimation(w.getNativeWindowHandle()) // the frozen screen shows at once, without a zoom
  }
}

/** An overlay on screen, after the toolbar: picking an area, the overlay under the mouse takes the
 *  keyboard (↩ records, ⌘C copies, A arrow...). A panel: it takes key focus without bringing Grip forward. */
function showOverlay(w: BrowserWindow) {
  if (w.isDestroyed() || w.isVisible()) return
  if (picking && !counting && toolbar && !toolbar.isVisible()) reveal(toolbar)
  reveal(w, mode === 'area' && screen.getDisplayMatching(w.getBounds()).id === activeDisplay().id)
}

/** Esc is a global shortcut while picking, counting down, or drawing, but not while one of our menus is
 *  open (shell:popup): then Esc closes the menu, and the next press the picker. As a shortcut it never
 *  reaches the menu, and macOS holds its presses until the menu closes; the first then unregisters Esc
 *  (closePicker), and the next one, for a shortcut Electron no longer has, aborts the app. */
let escWanted = false
let menus = 0
function escape(on: boolean) {
  escWanted = on
  if (!on || menus) return globalShortcut.unregister('Escape')
  if (globalShortcut.isRegistered('Escape')) return
  shortcut('Escape', () => {
    if (drawing) return setDrawing(false)
    if (counting) {
      counting = false
      sendAll('shell:escape')
      if (picking) reveal(controller())
      return broadcast()
    }
    closePicker() // the toolbar too: Esc leaves the picker in one press
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

/** What the camera bubble sits in: the area being recorded or picked, else the display's work area.
 *  Global points. */
function bubbleBox(): Rectangle {
  const display = (id: number) => screen.getAllDisplays().find((d) => d.id === id)
  const global = (id: number, r: { x: number; y: number; width: number; height: number }) => {
    const b = display(id)?.bounds
    return b && { x: b.x + r.x, y: b.y + r.y, width: r.width, height: r.height }
  }
  const s = settings()
  const box =
    status !== 'idle' && area ? global(area.display, { x: area.rect.x, y: area.rect.y, width: area.rect.w, height: area.rect.h })
    : picking && mode === 'area' && s.area ? global(s.area.display, s.area.rect)
    : null
  return box ?? (recDisplay !== null && status !== 'idle' ? display(recDisplay) : undefined)?.workArea ?? activeDisplay().workArea
}

/** The bubble in its corner (settings.cameraCorner) of bubbleBox, where the video will show the
 *  camera; smaller in a small area. The window has room for the circle's shadow around it. */
function bubbleBounds(): Rectangle {
  const box = bubbleBox()
  const size = Math.round(Math.min(BUBBLE, Math.max(128, Math.min(box.width, box.height) * 0.45)))
  const corner = settings().cameraCorner
  const inset = 6 // the circle sits 10 pt inside the box (the window pads it by 16)
  return {
    width: size,
    height: size,
    x: Math.round(corner.endsWith('left') ? box.x + inset : box.x + box.width - size - inset),
    y: Math.round(corner.startsWith('top') ? box.y + inset : box.y + box.height - size - inset),
  }
}

let placed: Rectangle | null = null
function updateBubble() {
  const s = settings()
  const want = !!s.camera && s.showCamera && (picking || status !== 'idle')
  const open = windowsOf('camera')[0]
  if (!want) return open?.destroy()
  const b = bubbleBounds()
  if (open) {
    if (JSON.stringify(open.getBounds()) !== JSON.stringify(b)) open.setBounds((placed = b))
    return
  }
  const w = openWindow('camera', { ...floating, ...(placed = b), transparent: true, hasShadow: false, movable: true })
  protect(w, 1)
  w.once('ready-to-show', () => frozen.then(() => w.isDestroyed() || reveal(w, false)))
  // Dropped after a drag: it snaps to the nearest corner, which the next recording keeps.
  w.on('moved', () => {
    const r = w.getBounds()
    if (JSON.stringify(r) === JSON.stringify(placed)) return
    const box = bubbleBox()
    const top = r.y + r.height / 2 < box.y + box.height / 2
    const left = r.x + r.width / 2 < box.x + box.width / 2
    const corner: CameraPosition = `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`
    if (corner !== settings().cameraCorner) setSettings({ cameraCorner: corner }) // its listener moves it
    else w.setBounds((placed = bubbleBounds()), true)
  })
}

// ---- Drawing on screen ----

export const toggleDrawing = () => setDrawing(!drawing)

/** The pen, while recording: strokes on the recorded display go into the recording (recording:draw)
 *  and fade out on screen as they will in the video. */
function setDrawing(on: boolean) {
  if (on && (status !== 'recording' || recDisplay === null)) return
  if (on === drawing) return
  drawing = on
  if (!on) fadeInk()
  pick(mode)
}

/** The pen went off: its strokes still fade out on screen, then the overlays may go. */
function fadeInk() {
  const fade = (DRAW_HOLD + DRAW_FADE) * 1000
  inkUntil = Date.now() + fade
  setTimeout(() => status !== 'idle' && pick(mode), fade + 50)
}

// ---- Result card ----

/** The card after a recording (bundle=<path>) or a screenshot (shot=<path>), bottom right of the
 *  display: copy, share, or edit it. One at a time; a new recording closes it. */
function showResult(query: string) {
  for (const w of windowsOf('result')) w.destroy()
  const work = activeDisplay().workArea
  const w = openWindow(`result?${query}`, {
    ...floating,
    ...RESULT,
    x: work.x + work.width - RESULT.width - 16,
    y: work.y + work.height - RESULT.height - 16,
    vibrancy: 'hud',
    visualEffectState: 'active',
  })
  protect(w, 2)
  // It shows once it fits its content (shell:fit); a picture that never loads can't hold it back.
  setTimeout(() => w.isDestroyed() || w.isVisible() || reveal(w, false), 1500)
}

/** Screenshot files Grip wrote (its Screenshots folder and the Desktop), this session or listed in
 *  Recent Captures. The result card may copy, save, reveal, or drag these, and exports in Grip's
 *  temp folder. */
const shots = new Set<string>()
const ours = (path: unknown): path is string =>
  typeof path === 'string' && isAbsolute(path) && existsSync(path) && (shots.has(path) || resolve(path).startsWith(join(app.getPath('temp'), 'Grip ')))

/** A new screenshot file in `dir`, named like macOS names them. */
async function writeShot(dir: string, png: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${recordingName(new Date(), (n) => existsSync(join(dir, `${n}.png`)), 'Screenshot')}.png`)
  await writeFile(file, png)
  shots.add(file)
  return file
}

const copyImage = (png: Uint8Array) => clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as Uint8Array<ArrayBuffer>]) })])

/** A finished screenshot: onto the clipboard, or into a file on the Desktop. Then the card. */
async function finishShot(png: Uint8Array, scale: number, save: boolean) {
  png = withScale(png, scale) // pastes and opens as big as it was on screen
  const file = await writeShot(save ? app.getPath('desktop') : shotsDir(), png)
  addCapture({ kind: 'shot', path: file, at: Date.now() })
  if (!save) await copyImage(png)
  closePicker()
  showResult(`shot=${encodeURIComponent(file)}${save ? '&saved' : ''}`)
}

/** A recent capture's card again (menu bar and gear menus), saying nothing was copied or saved yet.
 *  The picker's overlays float above everything: it closes first. */
export function reopenCapture(path: string) {
  const c = captures().find((c) => c.path === path)
  if (!c) return
  if (picking) closePicker()
  if (c.kind === 'recording') return showResult(`bundle=${encodeURIComponent(c.path)}`)
  shots.add(c.path)
  showResult(`shot=${encodeURIComponent(c.path)}${dirname(c.path) === shotsDir() ? '' : '&saved'}&reopened`)
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
  w.once('ready-to-show', () => frozen.then(() => w.isDestroyed() || reveal(w, false)))
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
  if (next !== 'recording' && drawing) {
    // Paused or ending: the engine takes no strokes now.
    drawing = false
    fadeInk()
  }
  if (active) {
    // Recording (or about to): clear the picker and the last result off the screen.
    counting = false
    pick(null)
    picking = false
    toolbar?.hide()
    for (const w of windowsOf('result')) w.destroy()
    if (settings().showWidget) showWidget()
  } else {
    for (const w of windowsOf('widget')) w.destroy()
    area = null
    recDisplay = null
    inkUntil = 0
    pick(null)
  }
  for (const k of [SHORTCUTS.pause, SHORTCUTS.cancel, SHORTCUTS.draw]) globalShortcut.unregister(k)
  if (active) {
    shortcut(SHORTCUTS.pause, () => command('toggle-pause'))
    shortcut(SHORTCUTS.cancel, cancelRecording)
    shortcut(SHORTCUTS.draw, toggleDrawing)
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

/** Open a bundle in the editor, or bring its editor forward. `recovered`: the editor says so.
 *  Like every window and dialog the user asks for, it closes the picker first, which floats above them. */
export function openProject(path: string, recovered = false) {
  closePicker()
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

/** A dialog the user asked for, in front: the picker, which floats above it, goes, and Grip comes
 *  forward. The picker's toolbar takes the dock icon with it (updateDock), and with the icon the focus,
 *  so that happens first: after the dialog shows, it would drop the dialog behind other apps. */
function toDialog() {
  closePicker()
  updateDock()
  if (!hidden) app.focus({ steal: true })
}

export async function openProjectDialog() {
  toDialog()
  const r = await dialog.showOpenDialog({
    title: 'Open Project',
    // openDirectory too: where the .grip package type is not registered (dev), a bundle is a folder.
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Grip Project', extensions: ['grip'] }],
  })
  for (const p of r.filePaths) openProject(p)
}

export async function importDialog() {
  toDialog()
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
  closePicker()
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

type PopupItem = { id?: string; label?: string; checked?: boolean; enabled?: boolean; separator?: boolean; accelerator?: string; icon?: Uint8Array; submenu?: PopupItem[] }

export function registerRecorder() {
  ipcMain.handle('shell:state', state)
  ipcMain.handle('shell:pick', (_e, m: Mode | null) => pick(['display', 'window', 'area', 'device'].includes(m as string) ? m : null))
  ipcMain.handle('shell:close-picker', () => closePicker())
  ipcMain.handle('shell:still', (_e, id: unknown) => stillOf(Number(id)).promise)
  ipcMain.handle('shell:ready', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (w && windowsOf('area').includes(w)) showOverlay(w)
  })
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
    escape(counting || overlaysOpen)
    if (counting) toolbar?.hide()
    broadcast()
  })
  ipcMain.handle('shell:start', (_e, opts: Partial<StartOptions>) => {
    const t = opts?.target
    area = t?.kind === 'area' ? { display: t.displayId, rect: t.rect } : null
    // A window records on the display it was picked on, the one under the mouse.
    recDisplay = t?.kind === 'area' || t?.kind === 'display' ? t.displayId : t?.kind === 'window' ? activeDisplay().id : null
    broadcast()
    return command('start', opts)
  })
  ipcMain.handle('shell:draw', (_e, on?: unknown) => setDrawing(typeof on === 'boolean' ? on : !drawing))
  ipcMain.handle('shell:shot', (_e, png: unknown, scale: unknown, save: unknown) => {
    if (!(png instanceof Uint8Array) || png.byteLength < 8) throw new Error('The screenshot is empty.')
    return finishShot(png, Math.min(Math.max(Number(scale) || 1, 1), 4), save === true)
  })
  ipcMain.handle('shell:fit', (e, height: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const h = Math.round(Number(height))
    if (!win || !(h >= 40 && h <= 800)) return
    const b = win.getBounds()
    win.setBounds({ ...b, y: b.y + b.height - h, height: h })
    if (!win.isVisible()) reveal(win, false)
  })
  // The result card: only files Grip made (ours), never any path a page asks for.
  ipcMain.handle('shell:drag', (e, path: unknown, icon: unknown) => {
    // Synchronous: the drag must start while the mouse is still down.
    const image = typeof icon === 'string' && icon.startsWith('data:image/png') ? nativeImage.createFromDataURL(icon) : null
    if (ours(path) && image && !image.isEmpty()) e.sender.startDrag({ file: path, icon: image })
  })
  ipcMain.handle('shell:reveal', (_e, path: unknown) => ours(path) && shell.showItemInFolder(path))
  ipcMain.handle('shell:shot-copy', async (_e, path: unknown) => {
    if (ours(path) && shots.has(path)) await copyImage(await readFile(path))
  })
  ipcMain.handle('shell:shot-save', async (_e, path: unknown) => {
    if (!ours(path) || !shots.has(path)) return null
    const file = await writeShot(app.getPath('desktop'), await readFile(path))
    moveCapture(path, file) // Recent Captures follows it to the Desktop; Grip's copy goes
    return file
  })
  ipcMain.handle('shell:captures', async () => (await captureRows()).map((r) => ({ id: r.path, label: r.label, icon: r.icon.toPNG({ scaleFactor: 2 }) })))
  ipcMain.handle('shell:reopen', (_e, path: unknown) => typeof path === 'string' && reopenCapture(path))
  ipcMain.handle('shell:fail', async (_e, error: unknown, title?: unknown) => {
    const plain = plainError(error)
    counting = false
    if (status === 'idle') area = null // it never started
    sendAll('shell:escape') // reset countdowns
    if (plain.permission) return openOnboarding(`page=permissions&need=${plain.permission satisfies Permission}`)
    if (picking) showPicker()
    broadcast()
    await alert(typeof title === 'string' ? title : 'Grip couldn’t record.', plain.message)
  })
  ipcMain.handle('shell:shortcut', (e, keys: unknown) => {
    if (keys !== null) return typeof keys === 'string' && setRecordShortcut(keys)
    setRecordShortcut(null)
    // Settings closed while the user was typing one: the current one comes back.
    e.sender.once('destroyed', () => recordKeys || setRecordShortcut(settings().recordShortcut))
    return true
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
                icon: i.icon instanceof Uint8Array ? nativeImage.createFromBuffer(Buffer.from(i.icon), { scaleFactor: 2 }) : undefined,
                submenu: i.submenu && build(i.submenu),
                click: () => (picked = i.id ?? null),
              },
        )
      menus++
      escape(escWanted)
      // The click lands after the menu reports closed: settle on the next turn.
      const closed = () => {
        menus--
        escape(escWanted)
        setTimeout(() => done(picked), 0)
      }
      Menu.buildFromTemplate(build(items)).popup({ window: win, x: Math.round(x), y: Math.round(y), callback: closed })
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
    addCapture({ kind: 'recording', path: bundle, at: Date.now() })
    if (quitting) return
    showResult(`bundle=${encodeURIComponent(bundle)}`)
    // It stopped on its own (disk full, display unplugged, a write failed): say why.
    if (end?.reason && end.reason !== 'user') void alert('Grip stopped recording.', end.message ?? 'The recording was saved.')
  })
  // Recordings cut off by a crash or power loss, made whole at launch (capture repairs its own
  // files, projects rebuilds the rest): each opens in the editor, which says it was recovered.
  recordingEvents.on('recovered', (bundle: string) => openProject(bundle, true))
  recoveredAtLaunch.then((list) => list.forEach((r) => openProject(r.path, true)))
  setRecordShortcut(settings().recordShortcut)
  covered = displays()
  for (const e of ['display-added', 'display-removed', 'display-metrics-changed'] as const) {
    screen.on(e as 'display-added', () => {
      if (displays() === covered) return
      covered = displays()
      if (picking && toolbar) toolbar.setBounds(place(TOOLBAR, activeDisplay().workArea, 20))
      if (!counting) {
        const was = overlaysOpen
        closeOverlays() // fresh ones for the new arrangement
        if (was) pick(mode) // the picker, or the backdrop of the area being recorded
      }
    })
  }
}
