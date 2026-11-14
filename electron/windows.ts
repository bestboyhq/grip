// Owner: app-shell. Window factory and routes. Every window loads the same renderer bundle with a
// hash route: #/editor?project=<path>, #/recorder, #/widget, #/area, #/camera, #/notes, #/onboarding, #/export,
// #/result, #/grant, #/demo.
// Windows remember their position per display, come back on screen when a display goes away, and
// drive the dock icon: it shows while a normal window is open, and hides during a recording.
import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { native } from './native.ts'
import { fit, place, reachable, type Rect } from './shell/bounds.ts'
import { setSettings, settings } from './shell/settings.ts'

const preload = join(import.meta.dirname, 'preload.cjs')
// Editor: traffic lights centered on its own 40 px title bar (14 px lights at y 13), opaque so resizing never flashes.
const editorWindow: BrowserWindowConstructorOptions = {
  titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 13 }, backgroundColor: '#111110', minWidth: 900, minHeight: 600,
}
/** STUDIO_HIDDEN=1: never show windows (agents and tests inspect them over CDP). */
export const hidden = !!process.env.STUDIO_HIDDEN

/** Window kind = route name. Normal windows show the dock icon; the rest float over the screen. */
const NORMAL = new Set(['editor', 'export', 'onboarding', 'recorder', 'dev'])
/** Kinds whose position is remembered per display. */
const REMEMBER = new Set(['editor', 'export', 'widget', 'notes']) // the camera bubble keeps its own spot (shell/recorder.ts)
const kinds = new WeakMap<BrowserWindow, string>()

export const kindOf = (w: BrowserWindow) => kinds.get(w)
export const windowsOf = (kind: string) => BrowserWindow.getAllWindows().filter((w) => kinds.get(w) === kind)
/** The display the user is working on: the one under the mouse. */
export const activeDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
const workAreas = () => screen.getAllDisplays().map((d) => d.workArea)

/** Opens on the display of `opts.x/y` when given, else the active one; a remembered position there wins. */
export function openWindow(route: string, opts: BrowserWindowConstructorOptions = {}) {
  const kind = route.split('?')[0]
  const size = { width: opts.width ?? 1280, height: opts.height ?? 820 }
  const display = opts.x === undefined || opts.y === undefined ? activeDisplay() : screen.getDisplayMatching({ x: opts.x, y: opts.y, ...size })
  const saved = REMEMBER.has(kind) ? settings().windows[`${kind}@${display.id}`] : undefined
  const bounds = saved && reachable(saved, workAreas()) ? saved : opts.x === undefined ? place(size, display.workArea) : {}
  if (opts.show !== false) dockFor(kind) // it shows, and activates Grip, as it is made
  const win = new BrowserWindow({
    ...size,
    backgroundColor: '#00000000',
    ...(route.startsWith('editor') ? editorWindow : {}),
    ...opts,
    ...bounds,
    ...(hidden ? { show: false, paintWhenInitiallyHidden: true } : {}),
    webPreferences: { preload, sandbox: true, contextIsolation: true, ...opts.webPreferences, ...(hidden ? { backgroundThrottling: false } : {}) },
  })
  kinds.set(win, kind)
  if (opts.resizable === false) keepFixed(win)
  if (REMEMBER.has(kind)) {
    const remember = () => {
      const b = win.getBounds()
      setSettings({ windows: { ...settings().windows, [`${kind}@${screen.getDisplayMatching(b).id}`]: b } })
    }
    win.on('moved', remember)
    win.on('resized', remember)
  }
  for (const e of ['show', 'hide', 'closed'] as const) win.on(e as 'show', () => setImmediate(updateDock))
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev) win.loadURL(`${dev}#/${route}`)
  else win.loadFile(join(import.meta.dirname, '../dist/index.html'), { hash: `/${route}` })
  return win
}

/** The first screen capture in a process (a still, a screenshot, or a recording) has ReplayKit re-set the
 *  style mask of every window of ours: a frameless one that is not resizable turns resizable and grows
 *  by a title bar, its bottom edge kept. The toolbar came up 96 points tall instead of 64, its edges
 *  draggable. It goes back as it was in the same turn, so the window server never shows it grown. */
function keepFixed(win: BrowserWindow) {
  let last = win.getBounds()
  const check = () => {
    if (!win.isResizable()) return void (last = win.getBounds())
    win.setResizable(false)
    win.setBounds(last)
  }
  win.on('resize', check)
  win.on('move', check)
}

/** Send to every live window (windows close mid-loop while quitting). */
export function sendAll(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
}

/** Show a window unless running hidden. `focus: false` keeps the frontmost app frontmost. It is on screen
 *  at once, not once the work after it in this turn is done. */
export function reveal(win: BrowserWindow, focus = true) {
  if (hidden) return
  dockFor(kinds.get(win) ?? '')
  if (focus) win.show()
  else win.showInactive()
  native.commitWindows()
}

// ---- Dock ----

let dialogs = 0

/** The dock icon shows while a normal window is open, recording or not: a window on screen with no icon
 *  to switch back to it reads as Grip gone. The dock icon goes through the activation policy, never app.dock.show(): with Grip active, that brings
 *  the Dock forward first, which left its first icon, Finder, highlighted after a recording opened the
 *  editor. The policy turns regular before a normal window shows (dockFor): turned regular after the
 *  window activates Grip, macOS keeps the other app's menu bar. Setting the policy Grip has already does
 *  nothing, so it is set each time, never cached: macOS can change it too (opening Grip from Finder). */
function dock(want: boolean) {
  if (app.dock) app.setActivationPolicy(want ? 'regular' : 'accessory')
}
const dockFor = (kind: string) => !hidden && NORMAL.has(kind) && dock(true)

export function updateDock() {
  dock(dialogs > 0 || BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && NORMAL.has(kinds.get(w) ?? '')))
}

/** A dialog the user asked for keeps the dock icon, and with it the menu bar, from before Grip comes
 *  forward to show it until `show` (which opens what the user picked) is done. */
export async function withDock<T>(show: () => Promise<T>): Promise<T> {
  dialogs++
  updateDock()
  try {
    return await show()
  } finally {
    dialogs--
    updateDock()
  }
}

// ---- Displays ----

/** Bring every window whose display went away (or shrank) back where the user can reach it. */
export function rescueWindows() {
  const areas = workAreas()
  const home = screen.getPrimaryDisplay()
  for (const win of BrowserWindow.getAllWindows()) {
    const kind = kinds.get(win)
    if (win.isDestroyed() || kind === 'area' || reachable(win.getBounds(), areas)) continue
    const saved: Rect | undefined = settings().windows[`${kind}@${home.id}`]
    win.setBounds(saved && reachable(saved, areas) ? saved : fit(win.getBounds(), home.workArea))
  }
}

export function watchDisplays() {
  for (const e of ['display-removed', 'display-metrics-changed'] as const) screen.on(e as 'display-removed', () => setImmediate(rescueWindows))
}
