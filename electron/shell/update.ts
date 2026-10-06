// In-app updates from GitHub Releases: the `publish` entry in package.json, which electron-builder
// bakes into the app as app-update.yml. electron-updater downloads the new zip in the background,
// Squirrel.Mac checks its Developer ID signature and stages it, and it installs when Grip quits.
// "Restart to Update" quits through the normal path (recording, export, and unsaved-edit prompts,
// where Cancel still cancels), then relaunches into the new version. A downloaded update also shows
// on the recording toolbar (shell:state `update`, electron/shell/recorder.ts).
//
// IPC: update:restart   the toolbar's Restart to Update
import { app, autoUpdater as squirrel, dialog, ipcMain, powerMonitor, type MenuItemConstructorOptions } from 'electron'
import electronUpdater from 'electron-updater'
import { hidden } from '../windows.ts'
import { isQuitting } from './recorder.ts'
import { setAppMenu } from './menu.ts'
import { plainError } from './errors.ts'

const { autoUpdater } = electronUpdater
const EVERY = 4 * 60 * 60 * 1000 // a menu bar app runs for weeks: check again every few hours

let state: 'idle' | 'checking' | 'downloading' | 'ready' = 'idle'
let version = ''
let asked = false // the user clicked Check for Updates: answer them, even "up to date"
let requested = false // Restart to Update started the next quit
let restarting = false // the quit in progress ends in installing and relaunching
/** Main-process reactions to a state change (the recording toolbar's shell:state). */
export const updateListeners: Array<() => void> = []

function set(next: typeof state) {
  state = next
  setAppMenu()
  for (const f of updateListeners) f()
}

/** The downloaded version waiting for a restart; '' until there is one. */
export const readyVersion = () => (state === 'ready' ? version : '')

function say(message: string, detail: string) {
  if (!hidden) void dialog.showMessageBox({ message, detail })
}

async function check() {
  if (state !== 'idle') return
  set('checking')
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) {
      set('idle')
      if (asked) say('You’re up to date.', `Grip ${app.getVersion()} is the latest version.`)
      asked = false
      return
    }
    version = result.updateInfo.version
    set('downloading') // then Squirrel verifies and stages it: 'update-downloaded' below
    result.downloadPromise?.catch(() => {}) // a failed download or install arrives as 'error' too
  } catch (err) {
    set('idle')
    if (asked) say('Grip couldn’t check for updates.', plainError(err).message)
    asked = false
  }
}

export function restartToUpdate() {
  requested = true
  app.quit()
}

export function updateMenuItems(): MenuItemConstructorOptions[] {
  if (!app.isPackaged) return []
  if (state === 'ready') return [{ label: 'Restart to Update', click: restartToUpdate }]
  const label = { idle: 'Check for Updates…', checking: 'Checking for Updates…', downloading: 'Downloading Update…' }[state]
  return [{ label, enabled: state === 'idle', click: () => ((asked = true), check()) }]
}

/** Check now and every few hours; errors (also background ones) go to `log`. */
export function startUpdates(log: (err: unknown) => void) {
  if (!app.isPackaged) return
  // Squirrel cannot replace an app running from the disk image or from Downloads (App Translocation).
  if (!app.isInApplicationsFolder() && !hidden) {
    const response = dialog.showMessageBoxSync({
      message: 'Move Grip to your Applications folder?',
      detail: 'Grip can only update itself from there.',
      buttons: ['Move to Applications', 'Not Now'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) {
      try {
        if (app.moveToApplicationsFolder()) return // quits and relaunches from there
      } catch (err) {
        say('Grip couldn’t move itself.', plainError(err).message)
      }
    }
  }
  autoUpdater.logger = null
  // Every error is logged (without a listener it would crash the main process). One while checking
  // is check()'s to answer; one while downloading ends the download.
  autoUpdater.on('error', (err) => {
    log(err)
    if (state !== 'downloading') return
    set('idle')
    if (asked) say('Grip couldn’t download the update.', plainError(err).message)
    asked = false
  })
  squirrel.on('update-downloaded', () => {
    set('ready')
    if (!asked || hidden) return
    asked = false
    void dialog
      .showMessageBox({ message: `Grip ${version} is ready to install.`, detail: 'Restart now, or it installs the next time you quit Grip.', buttons: ['Restart to Update', 'Later'], defaultId: 0, cancelId: 1 })
      .then(({ response }) => response === 0 && restartToUpdate())
  })
  // Each quit decides afresh whether it restarts, so one cancelled from a prompt never relaunches a
  // later plain ⌘Q. First listener: the main handler marks the quit as started.
  app.prependListener('before-quit', () => {
    if (isQuitting()) return
    restarting = requested
    requested = false
  })
  // Every window is closed and every prompt answered: install now instead of exiting.
  app.on('will-quit', (e) => {
    if (!restarting) return
    restarting = false
    e.preventDefault()
    autoUpdater.once('error', () => app.quit()) // Squirrel refused: still quit, it was asked for
    autoUpdater.quitAndInstall()
  })
  ipcMain.handle('update:restart', restartToUpdate)
  void check()
  setInterval(check, EVERY)
  powerMonitor.on('resume', check) // the interval stops while the Mac sleeps: a laptop opened each morning checks then
}
