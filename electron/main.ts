// Main process entry. Domains register their IPC in electron/<domain>.ts.
import { app } from 'electron'
import { join, resolve } from 'node:path'
import { registerMediaProtocol } from './media.ts'
import { openWindow } from './windows.ts'
import { registerRecording } from './recording.ts'
import { registerProjects } from './projects.ts'
import { registerExport } from './export.ts'
import { registerShare } from './share.ts'
import { registerTranscript } from './transcript.ts'
import { registerCamera } from './camera.ts'
import { registerEditor } from './editor.ts'

// Dev: per-worktree user data, so parallel checkouts do not share locks, settings, or projects.
if (!app.isPackaged) app.setPath('userData', join(import.meta.dirname, '../.context/userdata'))
if (process.env.STUDIO_CDP_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.STUDIO_CDP_PORT)

app.whenReady().then(() => {
  registerMediaProtocol()
  registerRecording()
  registerProjects()
  registerExport()
  registerShare()
  registerTranscript()
  registerCamera()
  registerEditor()

  // `electron . --open <bundle.studio>` opens a project straight into the editor (dev and tests).
  const i = process.argv.indexOf('--open')
  if (i > 0 && process.argv[i + 1]) openWindow(`editor?project=${encodeURIComponent(resolve(process.argv[i + 1]))}`)
  else if (process.argv.includes('--lab')) openWindow(`dev?lab=${process.argv[process.argv.indexOf('--lab') + 1] ?? ''}`)
  else openWindow('recorder')
})

app.on('window-all-closed', () => {})
