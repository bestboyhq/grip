// Renderer side of the recording flow, shared by the recorder, area, widget, camera, and
// onboarding windows: settings, shell state, and the engines' contracts: capture ("recording:*",
// electron/recording.ts) and camera ("camera:*", electron/camera.ts).
// electron/shell/fake-recording.ts is a runnable stand-in for both.
import { invoke, listen } from '../../lib/ipc.ts'
import type { Settings } from '../../../electron/shell/settings.ts'
import type { Permission } from '../../../electron/shell/errors.ts'

export type { Settings, Permission }
export type Mode = 'display' | 'window' | 'area' | 'device'
export type Status = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'
export type PermissionStatus = 'granted' | 'denied' | 'notDetermined' | 'restricted'
/** Electron screen geometry (points), used by the overlays. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
/** Capture engine geometry (points). */
export interface EngineRect {
  x: number
  y: number
  w: number
  h: number
}
export interface Device {
  id: string
  name: string
  kind?: string
}
/** recording:windows: front to back, frame in global points. */
export interface WindowSource {
  id: number
  title: string
  app: string
  bundleId?: string
  frame: EngineRect
}
/** recording:start(request). An area rect is relative to its display's top-left corner. */
export type Target =
  | { kind: 'display'; displayId: number }
  | { kind: 'window'; windowId: number; frame?: EngineRect } // frame: move and resize it there first
  | { kind: 'area'; displayId: number; rect: EngineRect }
  | { kind: 'device'; deviceId: string } // iPhone or iPad over USB (camera:list kind 'ios')
export interface StartRequest {
  target: Target
  cameraId?: string
  micId?: string
  systemAudio: boolean
  hideDesktopIcons: boolean
}

export const shell = $state({
  settings: null as Settings | null,
  status: 'idle' as Status,
  mode: null as Mode | null,
  picking: false,
  counting: false,
  area: null as { display: number; rect: EngineRect } | null, // the area being recorded
  drawing: false, // the pen is on (while recording)
  inkDisplay: null as number | null, // the display being recorded, where the pen draws
  elapsed: 0, // seconds recorded as of `at`
  at: 0, // ms since epoch; 0 while not running
  update: '', // a downloaded version waiting for a restart
})

const applyState = (s: Partial<typeof shell>) => void Object.assign(shell, s)
const applySettings = (s: Settings) => {
  shell.settings = s
}
invoke('settings:get').then(applySettings)
listen('settings:changed', applySettings)
invoke('shell:state').then(applyState)
listen('shell:state', applyState)

export const setSettings = (patch: Partial<Settings>) => invoke('settings:set', patch)

/** Cameras, microphones, and iPhone/iPad devices. Missing engines mean empty lists, not errors. */
export async function inputs(): Promise<{ cameras: Device[]; mics: Device[]; devices: Device[] }> {
  const [cams, mics] = await Promise.all([invoke('camera:list').catch(() => []), invoke('recording:microphones').catch(() => [])])
  const list: Device[] = Array.isArray(cams) ? cams : []
  return { cameras: list.filter((c) => c.kind !== 'ios'), devices: list.filter((c) => c.kind === 'ios'), mics: Array.isArray(mics) ? mics : [] }
}

/** The recordable windows, front to back, minus our own. Without Screen Recording the engine
 *  rejects: an empty list. */
export async function windowList(): Promise<WindowSource[]> {
  const [list, display] = await Promise.all([invoke('recording:windows').catch(() => []), invoke('shell:display', 0)])
  const self: string[] = display.self // our app names in the engine's list (dev runs as "Electron")
  return Array.isArray(list) ? list.filter((w) => !self.includes(w.app)) : []
}

export const toEngine = (r: Rect): EngineRect => ({ x: r.x, y: r.y, w: r.width, h: r.height })
export const fromEngine = (r: EngineRect): Rect => ({ x: r.x, y: r.y, width: r.w, height: r.h })

/** recording:start request for a target, with the inputs chosen in settings. */
export function startRequest(target: Target): StartRequest {
  const s = shell.settings
  return { target, cameraId: s?.camera ?? undefined, micId: s?.mic ?? undefined, systemAudio: s?.systemAudio ?? true, hideDesktopIcons: s?.hideDesktopIcons ?? false }
}

export interface MenuItem {
  id?: string
  label?: string
  checked?: boolean
  enabled?: boolean
  separator?: boolean
  accelerator?: string
  icon?: Uint8Array // PNG at 2x
  submenu?: MenuItem[]
}

/** Native menu above `anchor` (the toolbar sits at the bottom of the screen). Resolves to the picked id. */
export function popup(items: MenuItem[], anchor: Element): Promise<string | null> {
  const r = anchor.getBoundingClientRect()
  // ponytail: estimated macOS menu metrics (22 pt rows, 11 pt separators, 5 pt padding); a few points
  // off on systems with other metrics. Native menus cannot be measured before they open.
  const h = items.reduce((n, i) => n + (i.separator ? 11 : 22), 10)
  return invoke('shell:popup', items, r.left - 6, r.top - h - 8)
}

/** Request a permission just in time: the system prompt the first time, System Settings after
 *  that. True when granted. */
export async function ensurePermission(p: Permission): Promise<boolean> {
  return (await invoke('recording:requestPermission', p).catch(() => 'denied')) === 'granted'
}

/** Mic meter value 0..1 from the engine's linear peak, on a -60..0 dB scale (how loudness feels). */
export const meterLevel = (peak: number) => Math.min(1, Math.max(0, (20 * Math.log10(Math.max(peak, 1e-6)) + 60) / 60))

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
}
