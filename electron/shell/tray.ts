// Menu bar icon. A click starts a capture (the area picker: record it or copy a screenshot); while
// recording a click finishes. Right-click opens the menu: new recording, recent projects, open,
// import, settings, updates, quit; while recording finish, pause, draw, delete. Dropped .grip
// bundles open; dropped videos import as new projects.
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { recentProjects } from '../projects.ts'
import { updateMenuItems } from './update.ts'
import { settings } from './settings.ts'
import { cancelRecording, command, importDialog, openFilesOrAlert, openOnboarding, openProject, openProjectDialog, recordingStatus, SHORTCUTS, showPicker, statusListeners, toggleDrawing } from './recorder.ts'

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
    ...updateMenuItems(),
    { type: 'separator' },
    { label: 'Quit Grip', accelerator: 'Command+Q', registerAccelerator: false, click: () => app.quit() },
  ]
  const record = settings().recordShortcut
  if (s === 'idle') return [{ label: 'New Recording', accelerator: record, registerAccelerator: false, click: () => showPicker() }, ...common]
  return [
    { label: 'Finish Recording', accelerator: record, registerAccelerator: false, click: () => command('stop') },
    { label: s === 'paused' ? 'Resume Recording' : 'Pause Recording', accelerator: SHORTCUTS.pause, registerAccelerator: false, click: () => command('toggle-pause') },
    { label: 'Draw on Screen', accelerator: SHORTCUTS.draw, registerAccelerator: false, enabled: s === 'recording', click: () => toggleDrawing() },
    { label: 'Delete Recording…', accelerator: SHORTCUTS.cancel, registerAccelerator: false, click: cancelRecording },
    { label: 'Show Recording Controls', click: () => showPicker() },
    { type: 'separator' },
    ...common,
  ]
}

export function createTray() {
  tray = new Tray(icon('trayTemplate.png'))
  tray.setToolTip('Record or take a screenshot')
  const pop = async () => tray?.popUpContextMenu(Menu.buildFromTemplate(await template()))
  const running = () => ['recording', 'paused'].includes(recordingStatus())
  // One click to capture: the picker, or while recording a stop button, with no menu to land in the
  // recording. Right-click (or ⌃-click) opens the menu.
  tray.on('click', (e) => (e.ctrlKey ? pop() : running() ? command('stop') : showPicker()))
  tray.on('right-click', pop)
  tray.on('drop-files', (_e, files) => openFilesOrAlert(files))
  statusListeners.push((s) => {
    tray?.setImage(icon(s === 'idle' ? 'trayTemplate.png' : 'trayRecordingTemplate.png'))
    tray?.setToolTip(s === 'idle' ? 'Record or take a screenshot' : 'Finish recording')
  })
}
