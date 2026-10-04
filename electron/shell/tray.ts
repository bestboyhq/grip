// Menu bar icon: new recording, recent projects, open, settings, quit. While recording: finish,
// pause, delete. Dropping .studio bundles on it opens them.
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { cancelRecording, command, invokeHandler, openOnboarding, openProject, openProjectDialog, recordingStatus, SHORTCUTS, showPicker, statusListeners } from './recorder.ts'

let tray: Tray | null = null // module scope: a collected Tray disappears from the menu bar

function icon(name: string) {
  const img = nativeImage.createFromPath(join(import.meta.dirname, 'assets', name))
  img.setTemplateImage(true)
  return img
}

/** `projects:recent` (projects domain) as absolute paths that still exist. */
async function recentProjects(): Promise<string[]> {
  try {
    const list: unknown[] = (await invokeHandler('projects:recent')) ?? []
    const paths = list.map((p) => (typeof p === 'string' ? p : (p as { path?: string })?.path)).filter((p): p is string => !!p && existsSync(p))
    return paths.slice(0, 10)
  } catch {
    return [] // no handler yet, or the controller is reloading: an empty list beats a dead menu
  }
}

async function template(): Promise<MenuItemConstructorOptions[]> {
  const s = recordingStatus()
  const recent = await recentProjects()
  const common: MenuItemConstructorOptions[] = [
    {
      label: 'Recent Projects',
      enabled: recent.length > 0,
      submenu: recent.map((p) => ({ label: basename(p, '.studio'), click: () => openProject(p) })),
    },
    { label: 'Open Project…', click: openProjectDialog },
    { type: 'separator' },
    { label: 'Settings…', click: () => openOnboarding('page=settings') },
    { type: 'separator' },
    { label: 'Quit Studio', accelerator: 'Command+Q', registerAccelerator: false, click: () => app.quit() },
  ]
  if (s === 'idle') return [{ label: 'New Recording', accelerator: SHORTCUTS.record, registerAccelerator: false, click: () => showPicker() }, ...common]
  return [
    { label: 'Finish Recording', accelerator: SHORTCUTS.record, registerAccelerator: false, click: () => command('stop') },
    { label: s === 'paused' ? 'Resume Recording' : 'Pause Recording', accelerator: SHORTCUTS.pause, registerAccelerator: false, click: () => command('toggle-pause') },
    { label: 'Delete Recording…', accelerator: SHORTCUTS.cancel, registerAccelerator: false, click: cancelRecording },
    { label: 'Show Recording Controls', click: () => showPicker() },
    { type: 'separator' },
    ...common,
  ]
}

export function createTray() {
  tray = new Tray(icon('trayTemplate.png'))
  tray.setToolTip('Studio')
  const pop = async () => tray?.popUpContextMenu(Menu.buildFromTemplate(await template()))
  tray.on('click', pop)
  tray.on('right-click', pop)
  tray.on('drop-files', (_e, files) => {
    for (const f of files) if (/\.studio\/?$/.test(f)) openProject(f)
  })
  statusListeners.push((s) => tray?.setImage(icon(s === 'idle' ? 'trayTemplate.png' : 'trayRecordingTemplate.png')))
}
