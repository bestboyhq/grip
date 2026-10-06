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
import { registerWallpapers } from './wallpapers.ts'
import { registerSettings, settings } from './shell/settings.ts'
import { command, editorsDone, isQuitting, openFilesOrAlert, openOnboarding, openProject, recordingStatus, registerRecorder, setQuitting, showPicker, stopAndWait, warmUp } from './shell/recorder.ts'
import { setAppMenu } from './shell/menu.ts'
import { createTray } from './shell/tray.ts'
import { startUpdates } from './shell/update.ts'
import { inTurn, parseLaunch, parseGripUrl } from './shell/url.ts'
import { plainError } from './shell/errors.ts'
import { registerFakeRecording } from './shell/fake-recording.ts'

// Dev: per-worktree user data, so parallel checkouts do not share locks, settings, or projects.
if (!app.isPackaged) app.setPath('userData', join(import.meta.dirname, '../.context/userdata'))
if (process.env.STUDIO_CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.STUDIO_CDP_PORT)
if (process.env.STUDIO_HIDDEN) app.commandLine.appendSwitch('mute-audio') // hidden runs (agents, tests) never play sound
// Dev stand-in engine: Chromium's fake camera too, so the preview runs without a camera prompt.
if (!app.isPackaged && process.env.STUDIO_FAKE_RECORDING) app.commandLine.appendSwitch('use-fake-device-for-media-stream')

// One Grip per user: a second launch (Finder, `open`, URL, CLI) hands its arguments to this one.
// Chromium's handoff breaks when two launches reach it at the same moment (both get the lock, or one
// exits without handing over its arguments), so launches take turns at it.
const primary = inTurn(join(app.getPath('userData'), 'launch.lock'), () => app.requestSingleInstanceLock())
if (!primary) app.exit(0)

// Crash reports stay on this Mac (~/Library/Application Support/Grip/Crashpad) until a server exists.
crashReporter.start({ uploadToServer: false, globalExtra: { macOS: release(), arch: process.arch } })
function logError(err: unknown) {
  const dir = app.getPath('logs')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'main.log'), `${new Date().toISOString()} ${(err as Error)?.stack ?? err}\n`)
}
process.on('uncaughtException', (err) => {
  logError(err)
  if (hidden) console.error(err) // agents and tests: never block on a modal
  else dialog.showErrorBox('Grip ran into a problem', plainError(err).message)
})
process.on('unhandledRejection', logError)

// Files and URLs can arrive before ready (Finder double-click, dock drop, `open grip://...`).
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
app.on('second-instance', (_e, argv, cwd) => {
  if (!isQuitting() && !launch(argv, cwd)) showPicker()
})

function openUrl(url: string) {
  const a = parseGripUrl(url)
  if (a?.kind === 'record') showPicker(a.mode)
  else if (a?.kind === 'stop' && recordingStatus() !== 'idle') command('stop')
  else if (a?.kind === 'open') openProject(a.path)
  else if (a?.kind === 'import') openSharedLink(a.url)
}

/** Act on launch arguments (parseLaunch); `cwd` is the launching shell's directory. False when there were none. */
function launch(argv: string[], cwd = process.cwd()): boolean {
  const { lab, urls, files } = parseLaunch(argv, cwd)
  if (lab !== undefined) openWindow(`dev?lab=${lab}`)
  urls.forEach(openUrl)
  for (const f of files) openFilesOrAlert([f])
  return lab !== undefined || urls.length + files.length > 0
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
  registerWallpapers()
  if (!app.isPackaged && process.env.STUDIO_FAKE_RECORDING) registerFakeRecording(process.env.STUDIO_FAKE_RECORDING)
  registerSettings()
  registerRecorder()
  watchDisplays()
  setAppMenu()
  if (!hidden) createTray() // agent runs, one per worktree, stay out of the menu bar
  warmUp()
  ready = true

  const queued = early.splice(0)
  const acted = launch(process.argv)
  for (const item of queued) /^grip:/i.test(item) ? openUrl(item) : openFilesOrAlert([item])
  if (!acted && !queued.length) settings().onboarded ? showPicker() : openOnboarding(settings().welcomed ? 'page=permissions' : '')
  startUpdates(logError)
})

// Menu bar app: closing the last window keeps Grip running.
app.on('window-all-closed', () => {})
// Dock icon click with nothing open: new recording.
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().some((w) => w.isVisible())) showPicker()
})

// Quit prompts. Cancel always means: keep running, nothing changed. ⌘Q again while one is open
// does not stack a second prompt.
let asking = false
app.on('before-quit', async (e) => {
  if (!isQuitting()) {
    const recording = recordingStatus() !== 'idle'
    const exports = activeExports()
    if (recording || exports) {
      e.preventDefault()
      if (asking) return
      asking = true
      // Hidden runs (agents, tests) never block on a modal: they save and quit.
      const { response } = await (hidden
        ? Promise.resolve({ response: 1 })
        : dialog.showMessageBox({
            type: 'warning',
            message: recording ? 'A recording is in progress.' : exports === 1 ? 'An export is in progress.' : `${exports} exports are in progress.`,
            detail: recording ? 'Grip can save it and then quit.' : 'Quitting now stops it. Your project is safe.',
            buttons: ['Cancel', recording ? 'Save Recording and Quit' : 'Stop and Quit'],
            defaultId: 0,
            cancelId: 0,
          })
      ).finally(() => (asking = false))
      if (response !== 1) return
      setQuitting(true)
      await stopAndWait() // returns at once when the recording ended while the prompt was open
      return app.quit()
    }
    setQuitting(true)
  }
  // Before any window closes, open editors save (or ask, and Cancel cancels the quit); the quit
  // resumes once each one is done.
  if (!editorsDone()) e.preventDefault()
})
app.on('web-contents-created', (_e, wc) => {
  // A file dropped where no page handles it, or a stray link, must never replace a window's page.
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})
