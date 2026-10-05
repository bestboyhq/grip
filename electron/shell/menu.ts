// The application menu. Pages get key events first and the menu only those they leave alone, so the
// editor's own shortcuts (⌘Z for project undo, ⌘C for timeline copy, ⌘- for timeline zoom) win,
// while text fields keep native editing. No page zoom: those keys belong to the timeline.
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { kindOf } from '../windows.ts'
import { importDialog, openOnboarding, openProjectDialog, SHORTCUTS, showPicker } from './recorder.ts'
import { updateMenuItems } from './update.ts'

/** The bundle shown by the focused editor window. */
function focusedProject(): string | null {
  const win = BrowserWindow.getFocusedWindow()
  if (!win || kindOf(win) !== 'editor') return null
  return new URLSearchParams(win.webContents.getURL().split('#')[1]?.split('?')[1] ?? '').get('project')
}

/** An Edit menu item the editor has a command for. A click (or the shortcut, when the page left it
 *  alone) goes to the focused editor page, which runs that command, or edits natively in a text field
 *  (editor:edit). Elsewhere (other windows, DevTools, native panels) it is the macOS action, as a role. */
function editItem(action: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll', label: string, accelerator: string): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => {
      const win = BrowserWindow.getFocusedWindow()
      if (win && kindOf(win) === 'editor' && win.webContents.isFocused()) win.webContents.send('editor:edit', action)
      else Menu.sendActionToFirstResponder(`${action}:`)
    },
  }
}

export function setAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        ...updateMenuItems(),
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
    {
      label: 'Edit',
      submenu: [
        editItem('undo', 'Undo', 'Command+Z'),
        editItem('redo', 'Redo', 'Shift+Command+Z'),
        { type: 'separator' },
        editItem('cut', 'Cut', 'Command+X'),
        editItem('copy', 'Copy', 'Command+C'),
        editItem('paste', 'Paste', 'Command+V'),
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        editItem('selectAll', 'Select All', 'Command+A'),
        { type: 'separator' },
        { label: 'Substitutions', submenu: [{ role: 'showSubstitutions' }, { type: 'separator' }, { role: 'toggleSmartQuotes' }, { role: 'toggleSmartDashes' }, { role: 'toggleTextReplacement' }] },
        { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
      ],
    },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }])] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
