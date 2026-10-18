// Menu bar icon. A click starts a capture (the area picker: record it or copy a screenshot); while
// recording a click finishes. Right-click opens the menu: new recording, recent captures (each
// reopens its result card), recent projects, open, import, settings, updates, quit; while
// recording finish, pause, draw, delete. Dropped .grip bundles open; dropped videos import as new
// projects. While exports run the icon is a progress ring and the menu leads with them, Cancel
// included. A blue dot marks an update waiting for a restart, and an outlined one a check or
// download under way.
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { native } from '../native.ts'
import { exportListeners, exportMenuItems, exportStatus } from '../export.ts'
import { ring } from './png.ts'
import { recentProjects } from '../projects.ts'
import { readyVersion, updateActivity, updateListeners, updateMenuItems } from './update.ts'
import { settings } from './settings.ts'
import { captureRows } from './captures.ts'
import { cancelRecording, command, importDialog, openFilesOrAlert, openOnboarding, openProject, openProjectDialog, recordingStatus, reopenCapture, SHORTCUTS, showPicker, statusListeners, toggleDrawing } from './recorder.ts'

let tray: Tray | null = null // module scope: a collected Tray disappears from the menu bar

/** The export ring at `pct` percent, drawn for both display scales. */
function ringIcon(pct: number) {
  const img = nativeImage.createEmpty()
  for (const scale of [1, 2]) img.addRepresentation({ scaleFactor: scale, width: 18 * scale, height: 18 * scale, buffer: ring(18 * scale, pct / 100) })
  img.setTemplateImage(true)
  return img
}

function icon(name: string) {
  const img = nativeImage.createFromPath(join(import.meta.dirname, 'assets', name))
  img.setTemplateImage(name.endsWith('Template.png')) // macOS tints those to match the menu bar
  return img
}

async function template(): Promise<MenuItemConstructorOptions[]> {
  const s = recordingStatus()
  const recent = (await recentProjects().catch(() => [])).slice(0, 10) // only bundles that still exist
  const captures = await captureRows().catch(() => [])
  const common: MenuItemConstructorOptions[] = [
    {
      label: 'Recent Captures',
      enabled: captures.length > 0,
      submenu: captures.map((c) => ({ label: c.label, icon: c.icon, click: () => reopenCapture(c.path) })),
    },
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
  if (s === 'idle') return [...exportMenuItems(), { label: 'New Recording', accelerator: record, registerAccelerator: false, click: () => showPicker() }, ...common]
  return [
    ...exportMenuItems(),
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
  let shown = 'trayTemplate.png'
  let tipShown = ''
  let done: ReturnType<typeof setTimeout> | undefined // a moment of full ring once the last export is done
  const paint = () => {
    const idle = recordingStatus() === 'idle'
    const update = readyVersion()
    const activity = updateActivity()
    const busy = exportStatus()
    const exporting = busy ?? (done ? { name: '', progress: 1, waiting: 0 } : null)
    const pct = exporting && Math.floor(exporting.progress * 100)
    // A recording outranks an export, which outranks a waiting update, which outranks a check. The
    // blue dot rules out a template image: the update icon matches the menu bar's appearance itself.
    const name = !idle ? 'trayRecordingTemplate.png' : exporting ? `ring ${pct}` : update ? (native.menuBarDark() ? 'trayUpdateDark.png' : 'trayUpdateLight.png') : activity ? 'trayCheckingTemplate.png' : 'trayTemplate.png'
    if (name !== shown) tray?.setImage((shown = name).startsWith('ring') ? ringIcon(pct!) : icon(name))
    const tip = !idle ? 'Finish recording' : exporting && !busy ? 'Export finished' : exporting ? `Exporting “${exporting.name}” · ${pct}%${exporting.waiting ? `, ${exporting.waiting} more waiting` : ''}` : 'Record or take a screenshot'
    const note = !idle ? '' : update ? `Grip ${update} is ready to install` : activity
    const full = note ? `${tip}\n${note}` : tip
    if (full !== tipShown) tray?.setToolTip((tipShown = full)) // progress repaints often; set only changes
  }
  statusListeners.push(paint)
  updateListeners.push(paint)
  exportListeners.push((j) => {
    if (j.state === 'done' && !exportStatus()) {
      clearTimeout(done)
      done = setTimeout(() => ((done = undefined), paint()), 1200)
    }
    paint()
  })
  // ponytail: polls while an update waits, since the menu bar turns light or dark with the wallpaper
  // too and says nothing; observe its window's effectiveAppearance natively if the lag ever shows.
  setInterval(() => readyVersion() && paint(), 3000)
}
