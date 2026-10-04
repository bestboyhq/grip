// Owner: app-shell. Window factory and routes. Every window loads the same renderer bundle with a
// hash route: #/editor?project=<path>, #/recorder, #/widget, #/area, #/camera, #/onboarding, #/export.
// Windows remember their position per display, come back on screen when a display goes away, and
// drive the dock icon: it shows while a normal window is open, and hides during a recording.
import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { fit, place, reachable, type Rect } from './shell/bounds.ts'
import { setSettings, settings } from './shell/settings.ts'

const preload = join(import.meta.dirname, 'preload.cjs')
// Editor: inset traffic lights over its own 52 px title bar, opaque so resizing never flashes.
const editorWindow: BrowserWindowConstructorOptions = { titleBarStyle: 'hiddenInset', backgroundColor: '#111113', minWidth: 900, minHeight: 600 }
/** STUDIO_HIDDEN=1: never show windows (agents and tests inspect them over CDP). */
export const hidden = !!process.env.STUDIO_HIDDEN

/** Window kind = route name. Normal windows show the dock icon; the rest float over the screen. */
const NORMAL = new Set(['editor', 'export', 'onboarding', 'recorder', 'dev'])
/** Kinds whose position is remembered per display. */
const REMEMBER = new Set(['editor', 'export', 'widget', 'camera'])
const kinds = new WeakMap<BrowserWindow, string>()

export const kindOf = (w: BrowserWindow) => kinds.get(w)
export const windowsOf = (kind: string) => BrowserWindow.getAllWindows().filter((w) => kinds.get(w) === kind)
/** The display the user is working on: the one under the mouse. */
export const activeDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
const workAreas = () => screen.getAllDisplays().map((d) => d.workArea)

export function openWindow(route: string, opts: BrowserWindowConstructorOptions = {}) {
  const kind = route.split('?')[0]
  const display = activeDisplay()
  const saved = REMEMBER.has(kind) ? settings().windows[`${kind}@${display.id}`] : undefined
  const size = { width: opts.width ?? 1280, height: opts.height ?? 820 }
  const bounds = saved && reachable(saved, workAreas()) ? saved : opts.x === undefined ? place(size, display.workArea) : {}
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

/** Send to every live window (windows close mid-loop while quitting). */
export function sendAll(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, ...args)
}

/** Show a window unless running hidden. `focus: false` keeps the frontmost app frontmost. */
export function reveal(win: BrowserWindow, focus = true) {
  if (hidden) return
  if (focus) win.show()
  else win.showInactive()
}

// ---- Dock ----

let recording = false
let docked: boolean | null = null

export function setRecordingDock(on: boolean) {
  recording = on
  updateDock()
}

export function updateDock() {
  const want = !recording && BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && NORMAL.has(kinds.get(w) ?? ''))
  if (!app.dock || want === docked) return
  docked = want
  if (want) app.dock.show()
  else app.dock.hide()
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
