// App preferences: `<userData>/settings.json`, owned by the main process.
// Renderers read with `settings:get`, write with `settings:set(patch)`, and follow `settings:changed`.
import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Permission } from '../../native/index.d.ts'
import type { Rect } from './bounds.ts'
import type { CameraPosition } from '../../src/shared/project.ts'

export interface Settings {
  camera: string | null // capture device id; null = no camera
  mic: string | null
  systemAudio: boolean
  countdown: boolean
  showWidget: boolean
  showCamera: boolean // camera bubble on screen while picking and recording
  /** The corner of the recorded area the camera bubble sits in; new recordings put the camera there. */
  cameraCorner: CameraPosition
  /** New recordings zoom in on clicks and typing; each project can still turn it on or off. */
  autoZoom: boolean
  hideDesktopIcons: boolean
  /** Speaker notes on screen while picking and recording; only the user sees them. */
  speakerNotes: boolean
  notes: string
  /** Prompter scroll speed in lines per minute, and text size in points. */
  prompter: { speed: number; size: number }
  /** Last recording area: display id and rect in points relative to that display. */
  area: { display: number; rect: Rect; aspect: string } | null
  /** Past the welcome page: granting a permission can relaunch Grip, and onboarding resumes at permissions. */
  welcomed: boolean
  onboarded: boolean
  /** Permissions Grip showed the system prompt for; macOS cannot tell these from denied. */
  prompted: Permission[]
  /** Remembered window bounds, keyed `<kind>@<display id>`. */
  windows: Record<string, Rect>
  /** The global shortcut that opens the picker and finishes a recording: an Electron accelerator
   *  (src/shared/shortcut.ts), set through shell:shortcut. */
  recordShortcut: string
}

const defaults: Settings = {
  camera: null,
  mic: null,
  systemAudio: true,
  countdown: true,
  showWidget: true,
  showCamera: true,
  cameraCorner: 'bottom-right',
  autoZoom: true,
  hideDesktopIcons: false,
  speakerNotes: false,
  notes: '',
  prompter: { speed: 20, size: 24 }, // about 150 words a minute
  area: null,
  welcomed: false,
  onboarded: false,
  prompted: [],
  windows: {},
  recordShortcut: 'Alt+Command+Return',
}

const file = () => join(app.getPath('userData'), 'settings.json')
let current: Settings | null = null
/** Main-process reactions to a change (the camera bubble follows the camera choice). */
export const settingsListeners: Array<(s: Settings) => void> = []

export function settings(): Settings {
  if (!current) {
    try {
      current = { ...defaults, ...JSON.parse(readFileSync(file(), 'utf8')) }
    } catch {
      current = { ...defaults } // first run, or a torn file: defaults beat a crash
    }
  }
  return current!
}

export function setSettings(patch: Partial<Settings>) {
  const next = { ...settings() }
  for (const k of Object.keys(patch) as Array<keyof Settings>) if (k in defaults) (next as any)[k] = patch[k]
  current = next
  const tmp = file() + '.tmp'
  mkdirSync(dirname(tmp), { recursive: true })
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, file()) // atomic: a crash leaves the old file or the new one, never half of one
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('settings:changed', next)
  for (const f of settingsListeners) f(next)
}

export function registerSettings() {
  ipcMain.handle('settings:get', () => settings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => setSettings(patch ?? {}))
}
