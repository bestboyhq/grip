// Owner: audio. "audio:*" IPC channels and the voice pass: the mic as "Enhance voice" plays it, made
// once per recording by native/src/voice.rs and kept beside the mic as sources.mic.voice. Each
// voiceover take gets its own the same way (sources.takes[].voice), once it is on the timeline.
//   audio:analyze(bundle)   make the voice tracks now (Enhance voice turned on, or an export needs them)
// Broadcasts to every window, for the mic's pass:
//   audio:progress ({ bundle, progress })   voice pass progress, 0..1
//   audio:analyzed ({ bundle, voice } | { bundle, error })
//     On success sources.mic.voice is in project.json (updateProject), and open editors already got it
//     through projects:sources.
import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { native } from './native.ts'
import type { AudioSource, Project } from '../src/shared/project.ts'
import { bundleArg, projectEvents, readProject, updateProject } from './projects.ts'

const running = new Map<string, Promise<void>>()
const aborts = new Set<AbortController>()

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

/** The project plays an enhanced mic or voiceover whose voice track is missing or was made by an older pass. */
export const owesVoice = (p: Project) =>
  (!!p.sources.mic && p.audio.mic.enhance && p.sources.mic.voice?.chain !== native.voiceChain()) ||
  !!p.sources.takes?.some((t) => !t.pending && t.voice?.chain !== native.voiceChain() && p.voiceovers.some((v) => v.take === t.id && v.enhance))

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

/** Called after a recording with a mic stops, after a voiceover lands, on open, and before an export
 *  that needs the voice. Runs in the background; never throws. A call while a pass runs for the bundle
 *  runs again after it, since what it asks for (a new take) may be newer than what that one read. */
export function analyzeVoice(bundle: string): Promise<void> {
  bundle = resolve(bundle)
  const job: Promise<void> = (running.get(bundle) ?? Promise.resolve()).then(() => analyze(bundle)).finally(() => running.get(bundle) === job && running.delete(bundle))
  running.set(bundle, job)
  return job
}

async function analyze(bundle: string) {
  const abort = new AbortController()
  aborts.add(abort)
  try {
    const s = (await readProject(bundle)).sources
    // Already made by this pass: nothing to do (and a track an editor plays is never rewritten).
    const owed = (a?: AudioSource) => !!a && !(a.voice?.chain === native.voiceChain() && existsSync(join(bundle, a.voice.file)))
    if (owed(s.mic)) await pass(bundle, s.mic!, (p) => p.sources.mic, abort.signal, true)
    for (const t of s.takes ?? []) if (!t.pending && owed(t) && !abort.signal.aborted) await pass(bundle, t, (p) => p.sources.takes?.find((x) => x.id === t.id), abort.signal, false)
  } catch (e) {
    console.error(`voice pass failed for ${bundle}: ${e instanceof Error ? e.message : e}`)
  } finally {
    aborts.delete(abort)
  }
}

/** The voice track of `src`, kept on the source `find` picks out of the project then, if it still is
 *  that file. Only the mic's pass is broadcast: a take without one plays raw, as the mic would. */
async function pass(bundle: string, src: AudioSource, find: (p: Project) => AudioSource | undefined, signal: AbortSignal, mic: boolean) {
  try {
    const out = await native.analyzeVoice(
      join(bundle, src.file),
      join(bundle, voiceFile(src.file)),
      src.channels,
      (progress) => mic && broadcast('audio:progress', { bundle, progress }),
      signal,
    )
    const voice = { file: relative(bundle, out.file), chain: out.chain, lufs: out.lufs ?? null }
    // Patched under the projects lock: an editor autosave in between keeps the new field.
    let applied = false
    await updateProject(bundle, (p) => {
      const now = find(p)
      if (now?.file !== src.file) return // the source changed meanwhile
      now.voice = voice
      applied = true
    })
    if (applied && mic) broadcast('audio:analyzed', { bundle, voice })
  } catch (e) {
    if (signal.aborted) return
    const error = e instanceof Error ? e.message : String(e)
    console.error(`voice pass failed for ${src.file} in ${bundle}: ${error}`)
    if (mic) broadcast('audio:analyzed', { bundle, error })
  }
}

/** Voice tracks older passes made beside the mic and the takes, once project.json no longer names
 *  them. The current pass's own files (its track and its work files) are left to it: it may be running. */
async function sweep(bundle: string, p: Project) {
  for (const src of [p.sources.mic, ...(p.sources.takes ?? [])]) {
    if (!src) continue
    const dir = join(bundle, dirname(src.file))
    const stem = `${basename(src.file, extname(src.file))}-voice-`
    const current = basename(voiceFile(src.file))
    const named = src.voice && basename(src.voice.file)
    for (const f of await readdir(dir).catch(() => [])) {
      if (f.startsWith(stem) && !f.startsWith(current) && f !== named) await rm(join(dir, f), { force: true }).catch(() => {})
    }
  }
}
