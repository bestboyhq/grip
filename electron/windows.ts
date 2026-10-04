// Owner: app-shell. Window factory and routes. Every window loads the same renderer bundle with a
// hash route: #/editor?project=<path>, #/recorder, #/widget, #/area, #/camera, #/onboarding, #/export.
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'

const preload = join(import.meta.dirname, 'preload.cjs')

export function openWindow(route: string, opts: BrowserWindowConstructorOptions = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#00000000',
    ...opts,
    webPreferences: { preload, sandbox: true, contextIsolation: true, ...opts.webPreferences },
  })
  const dev = process.env.VITE_DEV_SERVER_URL
  if (dev) win.loadURL(`${dev}#/${route}`)
  else win.loadFile(join(import.meta.dirname, '../dist/index.html'), { hash: `/${route}` })
  return win
}
