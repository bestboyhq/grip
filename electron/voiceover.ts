// Owner: audio. Voiceover takes: the mic recorded in the editor while the video plays, driven by
// src/lib/take.svelte.ts through the "voiceover:*" IPC channels:
//   voiceover:now() -> ms                          host time, so the editor knows its clock's offset to it
//   voiceover:open(bundle, id) -> { name }         opens the mic (the recorder's, else the default) for
//                                                  voiceovers/<id>.m4a; nothing is written yet
//   voiceover:roll(bundle, { id, at, n, pending }) take second 0 is host time `at` (ms); the take joins
//                                                  sources.takes, `pending` where all of it would land
//   voiceover:stop(bundle, id) -> seconds          finishes the file and sets the take's duration
//   voiceover:placed(bundle, id)                   the editor saved its items: no longer pending; the
//                                                  voice pass and transcription follow
//   voiceover:cancel(bundle, id)                   stops it if it records; its file and a pending entry go
// Event to the editor recording it: voiceover:level({ id, t, peak }), what the take records about 30
// times a second (take seconds, linear peak), so the timeline draws it as it comes in.
// A take whose editor goes away while it records (closed, crashed) is finished where it is. A project
// that opens with a take still pending gets it placed from what is on disk (recoverTakes), so a crash
// loses at most the last second of a take.
import electron, { type WebContents } from 'electron'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project, Take } from '../src/shared/project.ts'
import { MIN_TAKE, land, trim } from '../src/shared/voiceover.ts'
import type { TakeLevel } from '../native/index.d.ts'
import { analyzeVoice } from './audio.ts'
import { native } from './native.ts'
import { bundleArg, probe, updateProject } from './projects.ts'
import { settings } from './shell/settings.ts'
import { transcribeTakes } from './transcript.ts'

/** The native take recorder; the dev stand-in (shell/fake-recording.ts) replaces it. */
export const takes = {
  now: (): number => native.hostNowMs(),
  open: async (mic: string | null, path: string, onLevel: (l: TakeLevel) => void) => {
    if (native.permissionStatus('microphone') === 'notDetermined') await native.requestPermission('microphone') // just in time
    return native.openTake(mic, path, onLevel)
  },
  roll: (atMs: number) => native.rollTake(atMs),
  finish: (): Promise<number> => native.finishTake(),
  cancel: () => native.cancelTake(),
  repair: (path: string): Promise<void> => native.repairTake(path),
}

const fileOf = (id: string) => `voiceovers/${id}.m4a`
const idArg = (id: unknown) => {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new Error('Invalid voiceover.')
  return id
}

/** The take being recorded: one at a time, in the whole app (one mic). */
let live: { bundle: string; id: string; channels: number; rolled: boolean; off: () => void } | null = null

export function registerVoiceover() {
  const { app, ipcMain } = electron
  const mine = (bundle: string, id: unknown) => (live?.bundle === bundle && live.id === id ? live : null)

  ipcMain.handle('voiceover:now', () => takes.now())

  ipcMain.handle('voiceover:open', async (e, bundle: unknown, id: unknown) => {
    const b = bundleArg(bundle)
    const take = idArg(id)
    if (live) throw new Error('A voiceover is already recording.')
    const sender: WebContents = e.sender
    const gone = () => void (live === me && orphan())
    const me = (live = { bundle: b, id: take, channels: 1, rolled: false, off: () => (sender.off('destroyed', gone), sender.off('render-process-gone', gone)) })
    sender.once('destroyed', gone)
    sender.once('render-process-gone', gone)
    try {
      await mkdir(join(b, 'voiceovers'), { recursive: true })
      const path = join(b, fileOf(take))
      const want = settings().mic
      const level = (l: TakeLevel) => void (live === me && !sender.isDestroyed() && sender.send('voiceover:level', { id: take, ...l }))
      // The recorder's mic, unplugged since: the default one.
      const mic = await takes.open(want, path, level).catch((err: Error) => (want && live === me && /not connected/.test(err.message) ? takes.open(null, path, level) : Promise.reject(err)))
      me.channels = mic.channels
      return { name: mic.name }
    } catch (err) {
      if (live === me) (me.off(), (live = null))
      throw err
    }
  })

  ipcMain.handle('voiceover:roll', async (_e, bundle: unknown, r: { id?: unknown; at?: unknown; n?: unknown; pending?: unknown }) => {
    const b = bundleArg(bundle)
    const me = mine(b, r?.id)
    if (!me) throw new Error('No voiceover is open.')
    if (typeof r.at !== 'number' || !Number.isFinite(r.at) || !Number.isInteger(r.n) || (r.n as number) < 1 || !Array.isArray(r.pending)) throw new Error('Invalid voiceover.')
    takes.roll(r.at)
    me.rolled = true
    const take: Take = { id: me.id, n: r.n as number, file: fileOf(me.id), channels: me.channels, sampleRate: 48_000, duration: 0, pending: r.pending }
    await updateProject(b, (p) => void (p.sources.takes = [...(p.sources.takes ?? []).filter((t) => t.id !== me.id), take])) // validated there
  })

  ipcMain.handle('voiceover:stop', async (_e, bundle: unknown, id: unknown) => {
    const b = bundleArg(bundle)
    const me = mine(b, id)
    if (!me) throw new Error('No voiceover is recording.')
    me.off()
    live = null
    const duration = await takes.finish().catch(async (err: Error) => {
      if (/No audio/.test(err.message)) await drop(b, me.id) // else its fragments stay pending, placed on the next open
      throw err
    })
    await updateProject(b, (p) => {
      const t = p.sources.takes?.find((t) => t.id === me.id)
      if (t) t.duration = duration
    })
    return duration
  })

  ipcMain.handle('voiceover:placed', async (_e, bundle: unknown, id: unknown) => {
    const b = bundleArg(bundle)
    const take = idArg(id)
    await updateProject(b, (p) => {
      const t = p.sources.takes?.find((t) => t.id === take)
      if (t) delete t.pending
    })
    void analyzeVoice(b)
    void transcribeTakes(b)
  })

  ipcMain.handle('voiceover:cancel', async (_e, bundle: unknown, id: unknown) => {
    const b = bundleArg(bundle)
    const take = idArg(id)
    const me = mine(b, take)
    if (me) {
      me.off()
      live = null
      takes.cancel()
    }
    await drop(b, take)
  })

  app.on('before-quit', () => void (live && orphan()))
}

/** The editor went away while the take recorded: keep what it has, placed on the next open. */
async function orphan() {
  const me = live!
  me.off()
  live = null
  if (!me.rolled) return takes.cancel()
  const duration = await takes.finish().catch(() => 0)
  await updateProject(me.bundle, (p) => {
    const t = p.sources.takes?.find((t) => t.id === me.id)
    if (t) t.duration = duration
  }).catch((e) => console.warn(`[voiceover] ${me.bundle}:`, e))
}

/** A take that never made it onto the timeline: its pending entry and its file go. A placed take
 *  stays, for undo. */
async function drop(bundle: string, id: string) {
  let placed = false
  await updateProject(bundle, (p) => {
    const t = p.sources.takes?.find((t) => t.id === id)
    if (t && !t.pending) placed = true
    else if (t) p.sources.takes = p.sources.takes!.filter((x) => x !== t)
  })
  if (!placed) await rm(join(bundle, fileOf(id)), { force: true })
}

/** A project opening with takes still pending: a crash, or a window closed mid-take, cut them off
 *  before the editor saved their items. Each is made whole and placed where it was recorded, up to
 *  where its audio ends; one with no audio goes. */
export async function recoverTakes(bundle: string, project: Project): Promise<{ project: Project; notice?: string }> {
  const lost = (project.sources.takes ?? []).filter((t) => t.pending && !(live?.bundle === bundle && live.id === t.id))
  if (!lost.length) return { project }
  const lengths = new Map<string, number>()
  for (const t of lost) {
    const path = join(bundle, t.file)
    await takes.repair(path).catch((e) => console.warn(`[voiceover] ${path}:`, e))
    lengths.set(t.id, (await probe(path).catch(() => null))?.duration ?? 0)
  }
  let placed = 0
  const empty: string[] = []
  const p = await updateProject(bundle, (q) => {
    q.sources.takes = (q.sources.takes ?? []).filter((t) => {
      const len = lengths.get(t.id)
      if (!t.pending || len === undefined) return true
      const spans = trim(t.pending, len)
      delete t.pending
      if (q.voiceovers.some((v) => v.take === t.id)) return true // saved, but the editor's word that it was got lost
      if (len < MIN_TAKE || !spans.length) return void empty.push(t.file)
      t.duration = len
      q.voiceovers = land(q.voiceovers, t.id, spans)
      placed++
      return true
    })
  })
  for (const f of empty) await rm(join(bundle, f), { force: true })
  void analyzeVoice(bundle) // a take saved before the crash never got these either
  void transcribeTakes(bundle)
  return { project: p, ...(placed && { notice: 'Grip kept the voiceover that was still recording when this project closed.' }) }
}
