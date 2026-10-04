// Main process entry. Domains register their IPC in electron/<domain>.ts. The app shell (menu bar,
// dock, windows, shortcuts, URL scheme, quit prompts, crash reports, updates) lives in electron/shell/.
import { app, BrowserWindow, crashReporter, dialog, nativeTheme } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { registerMediaProtocol } from './media.ts'
import { hidden, openWindow, watchDisplays } from './windows.ts'
import { registerRecording } from './recording.ts'
import { registerProjects } from './projects.ts'
import { registerExport } from './export.ts'
import { registerShare } from './share.ts'
import { registerTranscript } from './transcript.ts'
import { registerCamera } from './camera.ts'
import { registerEditor } from './editor.ts'
import { registerSettings, settings } from './shell/settings.ts'
import { command, openOnboarding, openProject, recordingStatus, registerRecorder, setQuitting, showPicker, stopAndWait, warmUp } from './shell/recorder.ts'
import { createTray } from './shell/tray.ts'
import { checkForUpdates } from './shell/update.ts'
import { parseStudioUrl } from './shell/url.ts'
import { plainError } from './shell/errors.ts'
import { registerFakeRecording } from './shell/fake-recording.ts'

// Dev: per-worktree user data, so parallel checkouts do not share locks, settings, or projects.
if (!app.isPackaged) app.setPath('userData', join(import.meta.dirname, '../.context/userdata'))
if (process.env.STUDIO_CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.STUDIO_CDP_PORT)
// Dev stand-in engine: Chromium's fake camera too, so the preview runs without a camera prompt.
if (!app.isPackaged && process.env.STUDIO_FAKE_RECORDING) app.commandLine.appendSwitch('use-fake-device-for-media-stream')

// One Studio per user: a second launch (Finder, `open`, URL, CLI) hands its arguments to this one.
if (!app.requestSingleInstanceLock()) app.exit(0)

// Crash reports stay on this Mac (~/Library/Application Support/Studio/Crashpad) until a server exists.
crashReporter.start({ uploadToServer: false, globalExtra: { macOS: release(), arch: process.arch } })
function logError(err: unknown) {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'main.log'), `${new Date().toISOString()} ${(err as Error)?.stack ?? err}\n`)
}
process.on('uncaughtException', (err) => {
  logError(err)
  if (hidden) console.error(err) // agents and tests: never block on a modal
  else dialog.showErrorBox('Studio ran into a problem', plainError(err).message)
})
process.on('unhandledRejection', logError)

let quitting = false
function quit(on: boolean) {
  quitting = on
  setQuitting(on)
}

// Files and URLs can arrive before ready (Finder double-click, dock drop, `open studio://...`).
let ready = false
const early: string[] = []
app.on('open-file', (e, path) => {
  e.preventDefault()
  if (ready) openProject(path)
  else early.push(path)
})
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (ready) openUrl(url)
  else early.push(url)
})
app.on('second-instance', (_e, argv) => {
  if (!quitting && !launch(argv)) showPicker()
})

function openUrl(url: string) {
  const a = parseStudioUrl(url)
  if (a?.kind === 'record') showPicker(a.mode)
  else if (a?.kind === 'stop' && recordingStatus() !== 'idle') command('stop')
  else if (a?.kind === 'open') openProject(a.path)
}

/** Act on launch arguments: `--lab <Name>`, `[--open] <bundle.studio>`, `studio://` URLs. False when there were none. */
function launch(argv: string[]): boolean {
  const lab = argv.indexOf('--lab')
  if (lab > 0) {
    // A second instance's argv carries Chromium switches too: the name is the next non-flag.
    openWindow(`dev?lab=${argv.slice(lab + 1).find((a) => !a.startsWith('-')) ?? ''}`)
    return true
  }
  let acted = false
  for (const a of argv.slice(1)) {
    if (/^studio:/i.test(a)) openUrl(a)
    else if (/\.studio\/?$/i.test(a) && !a.startsWith('-')) openProject(a)
    else continue
    acted = true
  }
  return acted
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark' // dark UI everywhere, native menus and dialogs included
  if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../build/icon.png'))
  registerMediaProtocol()
  registerRecording()
  registerProjects()
  registerExport()
  registerShare()
  registerTranscript()
  registerCamera()
  registerEditor()
  if (!app.isPackaged && process.env.STUDIO_FAKE_RECORDING) registerFakeRecording(process.env.STUDIO_FAKE_RECORDING)
  registerSettings()
  registerRecorder()
  watchDisplays()
  createTray()
  warmUp()
  ready = true

  const queued = early.splice(0)
  const acted = launch(process.argv)
  for (const item of queued) /^studio:/i.test(item) ? openUrl(item) : openProject(item)
  if (!acted && !queued.length) settings().onboarded ? showPicker() : openOnboarding()
  checkForUpdates()
})

// Menu bar app: closing the last window keeps Studio running.
app.on('window-all-closed', () => {})
// Dock icon click with nothing open: new recording.
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().some((w) => w.isVisible())) showPicker()
})

// Quit prompts. Cancel always means: keep running, nothing changed.
app.on('before-quit', async (e) => {
  if (quitting) return
  if (recordingStatus() === 'idle') return quit(true)
  e.preventDefault()
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: 'A recording is in progress.',
    detail: 'Studio can save it and then quit.',
    buttons: ['Cancel', 'Save Recording and Quit'],
    defaultId: 0,
    cancelId: 0,
  })
  if (response !== 1) return
  quit(true)
  await stopAndWait()
  app.quit()
})
// A window with work that dies with it (an export) sets `onbeforeunload`; ask before closing it.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-prevent-unload', (e) => {
    const win = BrowserWindow.fromWebContents(wc)
    const options = {
      type: 'warning' as const,
      message: 'An export is in progress.',
      detail: 'Closing now stops the export. Your project is safe.',
      buttons: ['Cancel', 'Stop Export'],
      defaultId: 0,
      cancelId: 0,
    }
    if ((win ? dialog.showMessageBoxSync(win, options) : dialog.showMessageBoxSync(options)) === 1) e.preventDefault()
    else quit(false) // the quit (if any) is off: Electron aborts it when a window refuses to close
  })
})
