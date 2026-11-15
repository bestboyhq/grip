// In-app updates from GitHub Releases: the `publish` entry in package.json, which electron-builder
// bakes into the app as app-update.yml. electron-updater downloads the new zip in the background,
// Squirrel.Mac checks its Developer ID signature and stages it, and it installs when Grip quits.
// "Restart to Update" quits through the normal path (recording, export, and unsaved-edit prompts,
// where Cancel still cancels), then relaunches into the new version. A downloaded update also shows
// on the recording toolbar (shell:state `update`, electron/shell/recorder.ts) and as a blue dot on the menu
// bar icon (electron/shell/tray.ts), outlined while a check or download runs (updateActivity).
// A menu bar app is rarely quit, so a waiting update also installs while the user is away (screen
// locked, or no input for a while), when that loses and hides nothing: no recording, export,
// transcription, or playing preview, and no window open but editors. Editors save as any quit has
// them do, and come back where they were (restartedToUpdate, at launch); otherwise the new version
// starts in the menu bar only, since an update is no reason to open the picker.
//
// IPC: update:restart   the toolbar's Restart to Update
//      update:later     the toolbar's Later: off the toolbar for a day
import { app, BrowserWindow, autoUpdater as squirrel, dialog, ipcMain, powerMonitor, screen, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hidden, kindOf, windowsOf } from '../windows.ts'
import { activeExports } from '../export.ts'
import { previewing } from '../editor.ts'
import { transcribing } from '../transcript.ts'
import { isQuitting, openProject, projectOf, recordingStatus } from './recorder.ts'
import { setAppMenu } from './menu.ts'
import { plainError } from './errors.ts'
import { reachable } from './bounds.ts'

/** Loaded by startUpdates: its ~20 ms of modules stay out of the launch. */
let autoUpdater: AppUpdater
const EVERY = Number(process.env.STUDIO_UPDATE_EVERY) || 4 * 60 * 60 * 1000 // a menu bar app runs for weeks: check again every few hours
const DAY = 24 * 60 * 60 * 1000
const AWAY = Number(process.env.STUDIO_UPDATE_AWAY) || 15 * 60 // seconds without input that mean the user is away
const HELPERS = ['recorder', 'area'] // window kinds Grip keeps open, hidden, for itself

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
/** An editor open when a restart began, which the new version reopens as it was. */
type Editor = { project: string; bounds: Rectangle; minimized: boolean; fullscreen: boolean }
let editors: Editor[] = []
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
/** The check or download under way while no update waits, for the menu bar icon; '' otherwise. */
export const updateActivity = () => (state === 'checking' ? 'Checking for updates…' : state === 'downloading' ? 'Downloading an update…' : '')

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

/** The relaunched app's cue: JSON with the version it should come back as and the editors to reopen.
 *  The name predates restarts the user asked for, and stays so an update from a version before them
 *  finds it; those versions wrote the bare version. */
const marker = () => join(app.getPath('userData'), 'updated-while-away')

function restartWhileAway() {
  if (state !== 'ready' || failed || isQuitting() || !['idle', 'locked'].includes(powerMonitor.getSystemIdleState(AWAY))) return
  // Nothing under way that a restart cuts short. A preview can play for a long time with no input.
  if (recordingStatus() !== 'idle' || activeExports() || transcribing() || previewing()) return
  // Editors, which come back as they were, and Grip's own helpers, hidden (the recording controller
  // and the picker's overlays, loaded ahead): no other window of the user's goes away, not even a hidden one.
  if (!BrowserWindow.getAllWindows().every((w) => kindOf(w) === 'editor' || (HELPERS.includes(kindOf(w)!) && !w.isVisible()))) return
  away = true
  restartToUpdate()
}

/** At launch: whether a restart into an update started this run. It reopens the editors that were
 *  open and nothing else. */
export function restartedToUpdate(): boolean {
  let cue: { version?: unknown; editors?: Editor[] }
  try {
    const text = readFileSync(marker(), 'utf8')
    rmSync(marker())
    try {
      cue = JSON.parse(text)
    } catch {
      cue = { version: text }
    }
  } catch {
    return false
  }
  failed = cue?.version !== app.getVersion()
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  for (const e of Array.isArray(cue?.editors) ? cue.editors : []) {
    if (typeof e?.project !== 'string') continue
    // Where it was, unless that display is gone: then where editors last were.
    const win = openProject(e.project, { focus: false, at: e.bounds && reachable(e.bounds, areas) ? e.bounds : undefined })
    if (e.fullscreen) win?.setFullScreen(true)
    else if (e.minimized) win?.minimize()
  }
  return true
}

export function updateMenuItems(): MenuItemConstructorOptions[] {
  if (!app.isPackaged) return []
  if (state === 'ready') return [{ label: 'Restart to Update', click: restartToUpdate }]
  const label = { idle: 'Check for Updates…', checking: 'Checking for Updates…', downloading: 'Downloading Update…' }[state]
  return [{ label, enabled: state === 'idle', click: () => ((asked = true), check()) }]
}

/** Check now and every few hours; errors (also background ones) go to `log`. */
export async function startUpdates(log: (err: unknown) => void) {
  if (!app.isPackaged) return
  // Squirrel cannot replace an app running from the disk image or from Downloads (App Translocation).
  if (!app.isInApplicationsFolder() && !hidden) {
    const response = dialog.showMessageBoxSync({
      message: 'Move Grip to Applications?',
      detail: 'From there, Grip keeps itself up to date for you.',
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
  ;({ autoUpdater } = (await import('electron-updater')).default)
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
      .showMessageBox({ message: 'A new Grip is ready.', detail: `Restart now to get Grip ${version}, or Grip installs it the next time you quit.`, buttons: ['Restart to Update', 'Later'], defaultId: 0, cancelId: 1 })
      .then(({ response }) => response === 0 && restartToUpdate())
  })
  // Each quit decides afresh whether it restarts, so one cancelled from a prompt never relaunches a
  // later plain ⌘Q. First listener: the main handler marks the quit as started.
  app.prependListener('before-quit', () => {
    if (isQuitting()) return
    restarting = requested
    requested = false
    // Before they save and close: by will-quit they are gone.
    editors = !restarting ? [] : windowsOf('editor').flatMap((w) => {
      const project = projectOf(w)
      return project ? [{ project, bounds: w.getNormalBounds(), minimized: w.isMinimized(), fullscreen: w.isFullScreen() }] : []
    })
  })
  // Every window is closed and every prompt answered: install now instead of exiting.
  app.on('will-quit', (e) => {
    if (!restarting) return
    restarting = false
    e.preventDefault()
    try {
      writeFileSync(marker(), JSON.stringify({ version, editors }))
    } catch {} // without it, the new version opens the picker as if the user had launched it, and no editor
    // Squirrel refused: still quit, it was asked for, and the next launch is the user's own; unasked,
    // come back as this version (the marker says so).
    autoUpdater.once('error', () => {
      if (away) app.relaunch()
      else rmSync(marker(), { force: true })
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
  powerMonitor.on('lock-screen', restartWhileAway) // a laptop closed right after it locks sleeps before the interval comes round
  powerMonitor.on('resume', check) // the interval stops while the Mac sleeps: a laptop opened each morning checks then
}
