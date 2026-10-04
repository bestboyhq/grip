// The application menu. Pages get key events first and the menu only those they leave alone, so the
// editor's own shortcuts (⌘Z for project undo, ⌘C for timeline copy, ⌘- for timeline zoom) win,
// while text fields keep native editing through the Edit roles. No page zoom: those keys belong to
// the timeline.
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { kindOf } from '../windows.ts'
import { importDialog, openOnboarding, openProjectDialog, SHORTCUTS, showPicker } from './recorder.ts'

/** The bundle shown by the focused editor window. */
function focusedProject(): string | null {
  const win = BrowserWindow.getFocusedWindow()
  if (!win || kindOf(win) !== 'editor') return null
  return new URLSearchParams(win.webContents.getURL().split('#')[1]?.split('?')[1] ?? '').get('project')
}

export function setAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: () => openOnboarding('page=settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Recording', accelerator: SHORTCUTS.record, registerAccelerator: false, click: () => showPicker() },
        { label: 'Open Project…', accelerator: 'Command+O', click: openProjectDialog },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Import Video…', accelerator: 'Command+I', click: importDialog },
        { type: 'separator' },
        {
          label: 'Show in Finder',
          accelerator: 'Shift+Command+R',
          click: () => {
            const path = focusedProject()
            if (path) shell.showItemInFolder(path)
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }])] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
