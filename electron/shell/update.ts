// In-app updates from GitHub Releases: the `publish` entry in package.json, which electron-builder
// bakes into the app as app-update.yml. electron-updater downloads the new zip in the background,
// Squirrel.Mac checks its Developer ID signature and stages it, and it installs when Grip quits.
// "Restart to Update" quits through the normal path (recording, export, and unsaved-edit prompts,
// where Cancel still cancels), then relaunches into the new version. A downloaded update also shows
// on the recording toolbar (shell:state `update`, electron/shell/recorder.ts) and as a blue dot on the menu
// bar icon (electron/shell/tray.ts).
// A menu bar app is rarely quit, so a waiting update also installs while the user is away (screen
// locked, or no input for a while), when that loses and hides nothing: no recording or export, and no
// window open. The new version then starts in the menu bar only (updatedWhileAway, at launch).
//
// IPC: update:restart   the toolbar's Restart to Update
//      update:later     the toolbar's Later: off the toolbar for a day
import { app, BrowserWindow, autoUpdater as squirrel, dialog, ipcMain, powerMonitor, type MenuItemConstructorOptions } from 'electron'
import electronUpdater from 'electron-updater'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hidden, kindOf } from '../windows.ts'
import { activeExports } from '../export.ts'
import { isQuitting, recordingStatus } from './recorder.ts'
import { setAppMenu } from './menu.ts'
import { plainError } from './errors.ts'

const { autoUpdater } = electronUpdater
const EVERY = Number(process.env.STUDIO_UPDATE_EVERY) || 4 * 60 * 60 * 1000 // a menu bar app runs for weeks: check again every few hours
const DAY = 24 * 60 * 60 * 1000
const AWAY = Number(process.env.STUDIO_UPDATE_AWAY) || 15 * 60 // seconds without input that mean the user is away

let state: 'idle' | 'checking' | 'downloading' | 'ready' = 'idle'
let version = '' // the update waiting for a restart
let next = '' // the release downloading, until Squirrel stages it
let busy = false // a check or download in flight; they go on while an update waits, for a newer one
let asked = false // the user clicked Check for Updates: answer them, even "up to date"
let requested = false // Restart to Update started the next quit
let restarting = false // the quit in progress ends in installing and relaunching
let later = 0 // the toolbar's Later keeps the update off it until then
let away = false // the restart in progress installs while the user is away
let failed = false // one did and came back as this version: no second try this run
/** Main-process reactions to a state change (the recording toolbar's shell:state). */
export const updateListeners: Array<() => void> = []

function set(next: typeof state) {
  state = next
  setAppMenu()
  for (const f of updateListeners) f()
}

/** The downloaded version waiting for a restart; '' until there is one. */
export const readyVersion = () => (state === 'ready' ? version : '')
/** The update the recording toolbar offers: the ready one, unless put off within the last day. */
export const toolbarUpdate = () => (Date.now() < later ? '' : readyVersion())

function say(message: string, detail: string) {
  if (!hidden) void dialog.showMessageBox({ message, detail })
}

async function check() {
  if (busy) return
  busy = true
  if (state === 'idle') set('checking')
  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result?.isUpdateAvailable ? result.updateInfo.version : ''
    // A release newer than the update waiting for a restart replaces it: a restart lands on the latest.
    if (latest && latest !== readyVersion()) {
      next = latest
      if (state === 'checking') set('downloading')
      autoUpdater.downloadUpdate().catch(() => {}) // then Squirrel verifies and stages it: 'update-downloaded' below, or 'error'
      return
    }
    if (asked) say('You’re up to date.', `Grip ${app.getVersion()} is the latest version.`)
  } catch (err) {
    if (asked) say('Grip couldn’t check for updates.', plainError(err).message)
  }
  settle()
}

/** A check or download ended without staging anything: an update already waiting still waits. */
function settle() {
  busy = false
  next = ''
  asked = false
  if (state !== 'ready') set('idle')
}

export function restartToUpdate() {
  requested = true
  app.quit()
}

/** The relaunched app's cue, holding the version it should come back as. */
const marker = () => join(app.getPath('userData'), 'updated-while-away')

function restartWhileAway() {
  if (state !== 'ready' || failed || isQuitting() || !['idle', 'locked'].includes(powerMonitor.getSystemIdleState(AWAY))) return
  // Only the recording controller, hidden: no window of the user's goes away.
  if (recordingStatus() !== 'idle' || activeExports() || !BrowserWindow.getAllWindows().every((w) => kindOf(w) === 'recorder' && !w.isVisible())) return
  try {
    writeFileSync(marker(), version)
  } catch {
    return // without it, the new version would open the picker on its own
  }
  away = true
  restartToUpdate()
}

/** At launch: whether a restart while the user was away started this run, which then opens nothing. */
export function updatedWhileAway(): boolean {
  try {
    failed = readFileSync(marker(), 'utf8') !== app.getVersion()
    rmSync(marker())
    return true
  } catch {
    return false
  }
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
  autoUpdater.autoDownload = false // check() downloads, and never the update already waiting
  // Every error is logged (without a listener it would crash the main process). One while checking
  // is check()'s to answer; one while downloading ends the download.
  autoUpdater.on('error', (err) => {
    log(err)
    if (!next) return
    if (asked) say('Grip couldn’t download the update.', plainError(err).message)
    settle()
  })
  squirrel.on('update-downloaded', () => {
    version = next
    next = ''
    busy = false
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
    // Squirrel refused: still quit, it was asked for; unasked, come back as this version (the marker says so).
    autoUpdater.once('error', () => {
      if (away) app.relaunch()
      app.quit()
    })
    autoUpdater.quitAndInstall()
  })
  ipcMain.handle('update:restart', restartToUpdate)
  ipcMain.handle('update:later', () => {
    later = Date.now() + DAY
    for (const f of updateListeners) f()
  })
  void check()
  setInterval(check, EVERY)
  setInterval(restartWhileAway, Math.min(EVERY, 60_000))
  powerMonitor.on('resume', check) // the interval stops while the Mac sleeps: a laptop opened each morning checks then
}
