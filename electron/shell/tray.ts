// Menu bar icon: new recording, recent projects, open, import, settings, quit. While recording:
// finish, pause, delete. Dropped .studio bundles open; dropped videos import as new projects.
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { recentProjects } from '../projects.ts'
import { cancelRecording, command, importDialog, openFilesOrAlert, openOnboarding, openProject, openProjectDialog, recordingStatus, SHORTCUTS, showPicker, statusListeners } from './recorder.ts'

let tray: Tray | null = null // module scope: a collected Tray disappears from the menu bar

function icon(name: string) {
  const img = nativeImage.createFromPath(join(import.meta.dirname, 'assets', name))
  img.setTemplateImage(true)
  return img
}

async function template(): Promise<MenuItemConstructorOptions[]> {
  const s = recordingStatus()
  const recent = (await recentProjects().catch(() => [])).slice(0, 10) // only bundles that still exist
  const common: MenuItemConstructorOptions[] = [
    {
      label: 'Recent Projects',
      enabled: recent.length > 0,
      submenu: recent.map((p) => ({ label: p.name, click: () => openProject(p.path) })),
    },
    { label: 'Open Project…', click: openProjectDialog },
    { label: 'Import Video…', click: importDialog },
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
  tray.on('drop-files', (_e, files) => openFilesOrAlert(files))
  statusListeners.push((s) => tray?.setImage(icon(s === 'idle' ? 'trayTemplate.png' : 'trayRecordingTemplate.png')))
}
