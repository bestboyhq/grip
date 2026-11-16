// In-app updates from GitHub Releases: the `publish` entry in package.json, which electron-builder
// bakes into the app as app-update.yml. electron-updater downloads the new zip in the background,
// Squirrel.Mac checks its Developer ID signature and stages it, and it installs when Grip quits.
// "Restart to Update" quits through the normal path (recording, export, and unsaved-edit prompts,
// where Cancel still cancels), then relaunches into the new version. A downloaded update also shows
// on the recording toolbar (shell:state `update`, electron/shell/recorder.ts) and as a blue dot on the menu
// bar icon (electron/shell/tray.ts), outlined while a check or download runs (updateActivity).
// Check for Updates… answers in a card under the menu bar icon (src/windows/update/Update.svelte), the
// way a menu bar app answers a click on it: checking, the download with what's new, ready, up to date,
// or what failed and Try Again. It asks to move Grip to Applications there too. No system dialog.
// A menu bar app is rarely quit, so a waiting update also installs while the user is away (screen
// locked, or no input for a while), when that loses and hides nothing: no recording, export,
// transcription, or playing preview, and no window open but editors. Editors save as any quit has
// them do, and come back where they were (restartedToUpdate, at launch); otherwise the new version
// starts in the menu bar only, since an update is no reason to open the picker.
//
// IPC: update:restart     the toolbar's and the card's Restart to Update
//      update:later       the toolbar's Later: off the toolbar for a day
//      update:state -> Card   the card's content, pushed as "update:state" on change
//      update:check       the card's Try Again
//      update:move        the card's Move to Applications
//      update:fit(height) the card fits its height to its content (top edge stays), and shows
import { app, BrowserWindow, autoUpdater as squirrel, ipcMain, powerMonitor, screen, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hidden, kindOf, openWindow, reveal, windowsOf } from '../windows.ts'
import { activeExports } from '../export.ts'
import { previewing } from '../editor.ts'
import { transcribing } from '../transcript.ts'
import { floating, isQuitting, openProject, projectOf, protect, recordingStatus } from './recorder.ts'
import { setAppMenu } from './menu.ts'
import { plainError } from './errors.ts'
import { reachable } from './bounds.ts'
import { trayBounds } from './tray.ts'
import { whatsNew } from './changes.ts'

/** Loaded by startUpdates: its ~20 ms of modules stay out of the launch. */
let autoUpdater: AppUpdater
const EVERY = Number(process.env.STUDIO_UPDATE_EVERY) || 4 * 60 * 60 * 1000 // a menu bar app runs for weeks: check again every few hours
const DAY = 24 * 60 * 60 * 1000
const AWAY = Number(process.env.STUDIO_UPDATE_AWAY) || 15 * 60 // seconds without input that mean the user is away
const HELPERS = ['recorder', 'area'] // window kinds Grip keeps open, hidden, for itself
const CARD = { width: 320, height: 400 } // taller than any card, which fits its height to its content (update:fit)

let state: 'idle' | 'checking' | 'downloading' | 'ready' = 'idle'
let version = '' // the update waiting for a restart
let next = '' // the release downloading, until Squirrel stages it
let notes: string[] = [] // what's new in the waiting update
let nextNotes: string[] = [] // and in the one downloading
let progress = { done: 0, total: 0 } // bytes of the download
let busy = false // a check or download in flight; they go on while an update waits, for a newer one
/** How the last check or download ended, for the card: up to date, or what failed and why. */
let outcome: { step: 'current' | 'check-failed' | 'download-failed'; version: string; error: string } | null = null
/** The card asks to move Grip to Applications; `error` once a move failed. */
let move: { error: string } | null = null
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
  changed()
}

export type Card = {
  step: 'checking' | 'downloading' | 'ready' | 'current' | 'check-failed' | 'download-failed' | 'move' | 'move-failed'
  version: string // the one the card names: the update's, or the running one's
  notes: string[]
  progress: { done: number; total: number }
  error: string
}

function card(): Card {
  const running = app.getVersion()
  const shown: Pick<Card, 'step' | 'version' | 'error'> = move
    ? { step: move.error ? 'move-failed' : 'move', version: running, error: move.error }
    : state === 'ready'
      ? { step: 'ready', version, error: '' }
      : state === 'downloading'
        ? { step: 'downloading', version: next, error: '' }
        : state === 'idle' && outcome
          ? outcome
          : { step: 'checking', version: running, error: '' }
  return { ...shown, notes: state === 'ready' ? notes : nextNotes, progress }
}

const cardWindow = () => windowsOf('update')[0] as BrowserWindow | undefined
const changed = () => cardWindow()?.webContents.send('update:state', card())

/** Under the menu bar icon, centered on it, where the click that asked for it was; top right without
 *  one (hidden runs). Read as the card shows: a new icon sits at 0, 0 until the menu bar places it, and
 *  the card that asks to move Grip comes up at launch. */
function spot(height: number): Rectangle {
  const b = trayBounds()
  const icon = b && (b.x || b.y) ? b : undefined
  const work = (icon ? screen.getDisplayMatching(icon) : screen.getPrimaryDisplay()).workArea
  const center = icon ? icon.x + icon.width / 2 : work.x + work.width
  return { x: Math.round(Math.max(work.x + 8, Math.min(center - CARD.width / 2, work.x + work.width - 8 - CARD.width))), y: work.y + 6, width: CARD.width, height }
}

/** The card under the menu bar icon. A click anywhere else closes it, as it closes a menu; whatever
 *  runs goes on behind the icon. */
function showCard() {
  const open = cardWindow()
  if (open) return open.isVisible() && reveal(open) // a new one shows once it fits its content (update:fit)
  const w = openWindow('update', { ...floating, ...spot(CARD.height), vibrancy: 'hud', visualEffectState: 'active' })
  protect(w, 2)
  w.on('blur', () => w.isDestroyed() || w.close())
  w.on('closed', () => (move = null)) // the move question closed unanswered is Not Now
}

/** The menu bar icon's click closes the card, as a second click closes a menu: true if it did. */
export function closeCard() {
  const open = cardWindow()
  open?.close()
  return !!open
}

/** Check for Updates…, or the menu's Checking… and Downloading…: the card, and a check unless one runs. */
function ask() {
  showCard()
  void check()
}

/** The downloaded version waiting for a restart; '' until there is one. */
export const readyVersion = () => (state === 'ready' ? version : '')
/** The update the recording toolbar offers: the ready one, unless put off within the last day. */
export const toolbarUpdate = () => (Date.now() < later ? '' : readyVersion())
/** The check or download under way while no update waits, for the menu bar icon; '' otherwise. */
export const updateActivity = () => (state === 'checking' ? 'Checking for updates…' : state === 'downloading' ? 'Downloading an update…' : '')

async function check() {
  if (busy) return
  busy = true
  outcome = null
  set(state === 'idle' ? 'checking' : state)
  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result?.isUpdateAvailable ? result.updateInfo.version : ''
    // A release newer than the update waiting for a restart replaces it: a restart lands on the latest.
    if (latest && latest !== readyVersion()) {
      next = latest
      nextNotes = whatsNew(result!.updateInfo.releaseNotes)
      progress = { done: 0, total: 0 }
      set(state === 'checking' ? 'downloading' : state)
      autoUpdater.downloadUpdate().catch(() => {}) // then Squirrel verifies and stages it: 'update-downloaded' below, or 'error'
      return
    }
    outcome = { step: 'current', version: app.getVersion(), error: '' }
  } catch (err) {
    outcome = { step: 'check-failed', version: app.getVersion(), error: plainError(err).message }
  }
  settle()
}

/** A check or download ended without staging anything: an update already waiting still waits. */
function settle() {
  busy = false
  next = ''
  set(state === 'ready' ? 'ready' : 'idle')
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
  // Editors, which come back as they were, the update card, which offers this restart, and Grip's own
  // helpers, hidden (the recording controller and the picker's overlays, loaded ahead): no other window
  // of the user's goes away, not even a hidden one.
  if (!BrowserWindow.getAllWindows().every((w) => ['editor', 'update'].includes(kindOf(w)!) || (HELPERS.includes(kindOf(w)!) && !w.isVisible()))) return
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
  return [{ label, click: ask }]
}

/** Check now and every few hours; errors (also background ones) go to `log`. */
export async function startUpdates(log: (err: unknown) => void) {
  if (!app.isPackaged) return
  ipcMain.handle('update:state', card)
  ipcMain.handle('update:fit', (e, height: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const h = Math.round(Number(height))
    if (!win || kindOf(win) !== 'update' || !(h >= 40 && h <= 600)) return
    win.setBounds(win.isVisible() ? { ...win.getBounds(), height: h } : spot(h))
    if (!win.isVisible()) reveal(win) // focused, so a click elsewhere closes it
  })
  ipcMain.handle('update:move', () => {
    try {
      app.moveToApplicationsFolder() // quits and relaunches from there; false: the user turned down the password prompt
    } catch (err) {
      move = { error: plainError(err).message }
      changed()
    }
  })
  // Squirrel cannot replace an app running from the disk image or from Downloads (App Translocation).
  if (!app.isInApplicationsFolder() && !hidden) {
    move = { error: '' }
    showCard()
  }
  ;({ autoUpdater } = (await import('electron-updater')).default)
  autoUpdater.logger = null
  autoUpdater.autoDownload = false // check() downloads, and never the update already waiting
  autoUpdater.fullChangelog = true // what's new since the running version, not in the latest release alone
  // Every error is logged (without a listener it would crash the main process). One while checking
  // is check()'s to answer; one while downloading ends the download.
  autoUpdater.on('error', (err) => {
    log(err)
    if (!next) return
    outcome = { step: 'download-failed', version: next, error: plainError(err).message }
    settle()
  })
  autoUpdater.on('download-progress', (p) => {
    progress = { done: p.transferred, total: p.total }
    changed()
  })
  squirrel.on('update-downloaded', () => {
    version = next
    notes = nextNotes
    next = ''
    busy = false
    set('ready')
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
  ipcMain.handle('update:check', check)
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
