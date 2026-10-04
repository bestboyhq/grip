// Owner: app-shell. Window factory and routes. Every window loads the same renderer bundle with a
// hash route: #/editor?project=<path>, #/recorder, #/widget, #/area, #/camera, #/onboarding, #/export.
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'

const preload = join(import.meta.dirname, 'preload.cjs')
// Editor: inset traffic lights over its own 52 px title bar, opaque so resizing never flashes.
const editorWindow: BrowserWindowConstructorOptions = { titleBarStyle: 'hiddenInset', backgroundColor: '#111113', minWidth: 900, minHeight: 600 }

export function openWindow(route: string, opts: BrowserWindowConstructorOptions = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#00000000',
    ...(route.startsWith('editor') ? editorWindow : {}),
    ...opts,
    // STUDIO_HIDDEN=1: never show windows (agents and tests inspect them over CDP).
    ...(process.env.STUDIO_HIDDEN ? { show: false, paintWhenInitiallyHidden: true } : {}),
    webPreferences: { preload, sandbox: true, contextIsolation: true, ...opts.webPreferences, ...(process.env.STUDIO_HIDDEN ? { backgroundThrottling: false } : {}) },
  })
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev) win.loadURL(`${dev}#/${route}`)
  else win.loadFile(join(import.meta.dirname, '../dist/index.html'), { hash: `/${route}` })
  return win
}
