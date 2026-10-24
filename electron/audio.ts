// Owner: audio. "audio:*" IPC channels and the voice pass: the mic as "Enhance voice" plays it, made
// once per recording by native/src/voice.rs and kept beside the mic as sources.mic.voice.
//   audio:analyze(bundle)   make the voice track now (Enhance voice turned on, or an export needs it)
// Broadcasts to every window:
//   audio:progress ({ bundle, progress })   voice pass progress, 0..1
//   audio:analyzed ({ bundle, voice } | { bundle, error })
//     On success sources.mic.voice is in project.json (updateProject), and open editors already got it
//     through projects:sources.
import { app, BrowserWindow, ipcMain } from 'electron'
import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { native } from './native.ts'
import type { Project } from '../src/shared/project.ts'
import { bundleArg, projectEvents, readProject, updateProject } from './projects.ts'

const running = new Map<string, Promise<void>>()
const aborts = new Set<AbortController>()

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

/** The project plays an enhanced mic whose voice track is missing or was made by an older pass. */
export const owesVoice = (p: Project) => !!p.sources.mic && p.audio.mic.enhance && p.sources.mic.voice?.chain !== native.voiceChain()

/** `sources/mic.m4a` -> `sources/mic-voice-<chain>.m4a`: a new pass never writes over a track in use. */
const voiceFile = (mic: string) => join(dirname(mic), `${basename(mic, extname(mic))}-voice-${native.voiceChain()}.m4a`)

export function registerAudio() {
  ipcMain.handle('audio:analyze', (_e, bundle: unknown) => analyzeVoice(bundleArg(bundle)))
  // A pass cut short (quit, crash), a project from before it existed, or one an older app made.
  projectEvents.on('opened', (bundle: string, p: Project) => {
    void sweep(bundle, p)
    if (owesVoice(p)) void analyzeVoice(bundle)
  })
  app.on('before-quit', () => aborts.forEach((a) => a.abort()))
}

/** Called after a recording with a mic stops, on open, and before an export that needs the voice.
 *  Runs in the background; never throws. A second call for a bundle while one runs returns that one. */
export function analyzeVoice(bundle: string): Promise<void> {
  bundle = resolve(bundle)
  let job = running.get(bundle)
  if (!job) {
    job = analyze(bundle).finally(() => running.delete(bundle))
    running.set(bundle, job)
  }
  return job
}

async function analyze(bundle: string) {
  const abort = new AbortController()
  aborts.add(abort)
  try {
    const mic = (await readProject(bundle)).sources.mic
    if (!mic) return
    const out = await native.analyzeVoice(
      join(bundle, mic.file),
      join(bundle, voiceFile(mic.file)),
      mic.channels,
      (progress) => broadcast('audio:progress', { bundle, progress }),
      abort.signal,
    )
    const voice = { file: relative(bundle, out.file), chain: out.chain, lufs: out.lufs ?? null }
    // Patched under the projects lock: an editor autosave in between keeps the new field.
    let applied = false
    await updateProject(bundle, (p) => {
      if (p.sources.mic?.file !== mic.file) return // the mic source changed meanwhile
      p.sources.mic.voice = voice
      applied = true
    })
    if (applied) broadcast('audio:analyzed', { bundle, voice })
  } catch (e) {
    if (abort.signal.aborted) return
    const error = e instanceof Error ? e.message : String(e)
    console.error(`voice pass failed for ${bundle}: ${error}`)
    broadcast('audio:analyzed', { bundle, error })
  } finally {
    aborts.delete(abort)
  }
}

/** Voice tracks older passes made beside the mic, once project.json no longer names them. The current
 *  pass's own files (its track and its work files) are left to it: it may be running. */
async function sweep(bundle: string, p: Project) {
  const mic = p.sources.mic
  if (!mic) return
  const dir = join(bundle, dirname(mic.file))
  const stem = `${basename(mic.file, extname(mic.file))}-voice-`
  const current = basename(voiceFile(mic.file))
  const named = mic.voice && basename(mic.voice.file)
  for (const f of await readdir(dir).catch(() => [])) {
    if (f.startsWith(stem) && !f.startsWith(current) && f !== named) await rm(join(dir, f), { force: true }).catch(() => {})
  }
}
