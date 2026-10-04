// Main process entry. Domains register their IPC in electron/<domain>.ts. The app shell (menu bar,
// dock, windows, shortcuts, URL scheme, quit prompts, crash reports, updates) lives in electron/shell/.
import { app, BrowserWindow, crashReporter, dialog, nativeTheme, shell } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { registerMediaProtocol } from './media.ts'
import { hidden, openWindow, watchDisplays } from './windows.ts'
import { registerRecording } from './recording.ts'
import { registerProjects } from './projects.ts'
import { activeExports, registerExport } from './export.ts'
import { openSharedLink, registerShare } from './share.ts'
import { registerTranscript } from './transcript.ts'
import { registerCamera } from './camera.ts'
import { registerEditor } from './editor.ts'
import { registerSettings, settings } from './shell/settings.ts'
import { command, openFilesOrAlert, openOnboarding, openProject, recordingStatus, registerRecorder, setQuitting, showPicker, stopAndWait, warmUp } from './shell/recorder.ts'
import { setAppMenu } from './shell/menu.ts'
import { createTray } from './shell/tray.ts'
import { checkForUpdates } from './shell/update.ts'
import { parseStudioUrl } from './shell/url.ts'
import { plainError } from './shell/errors.ts'
import { registerFakeRecording } from './shell/fake-recording.ts'

// Dev: per-worktree user data, so parallel checkouts do not share locks, settings, or projects.
if (!app.isPackaged) app.setPath('userData', join(import.meta.dirname, '../.context/userdata'))
if (process.env.STUDIO_CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.STUDIO_CDP_PORT)
if (process.env.STUDIO_HIDDEN) app.commandLine.appendSwitch('mute-audio') // hidden runs (agents, tests) never play sound
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
  if (ready) openFilesOrAlert([path])
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
  else if (a?.kind === 'import') openSharedLink(a.url)
}

/** Act on launch arguments: `--lab <Name>`, `[--open] <bundle.studio | video.mp4>`, `studio://` URLs. False when there were none. */
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
    else if (/\.(studio\/?|mp4|mov)$/i.test(a) && !a.startsWith('-')) openFilesOrAlert([a])
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
  setAppMenu()
  createTray()
  warmUp()
  ready = true

  const queued = early.splice(0)
  const acted = launch(process.argv)
  for (const item of queued) /^studio:/i.test(item) ? openUrl(item) : openFilesOrAlert([item])
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
  const recording = recordingStatus() !== 'idle'
  const exports = activeExports()
  if (!recording && !exports) return quit(true)
  e.preventDefault()
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: recording ? 'A recording is in progress.' : exports === 1 ? 'An export is in progress.' : `${exports} exports are in progress.`,
    detail: recording ? 'Studio can save it and then quit.' : 'Quitting now stops it. Your project is safe.',
    buttons: ['Cancel', recording ? 'Save Recording and Quit' : 'Stop and Quit'],
    defaultId: 0,
    cancelId: 0,
  })
  if (response !== 1) return
  quit(true)
  if (recording) await stopAndWait()
  app.quit()
})
app.on('web-contents-created', (_e, wc) => {
  // A file dropped where no page handles it, or a stray link, must never replace a window's page.
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})
