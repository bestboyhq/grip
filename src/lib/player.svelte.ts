// Owner: audio/media. Preview playback of doc.project: playback clock, synced audio, and
// rendering through src/engine/compose.ts (the same path export uses).
// Times are OUTPUT seconds.
//
// While playing, the audio context clock is the master: the time shown is the output time being
// heard right now. A requestAnimationFrame loop renders the latest time and skips a tick while the
// previous frame is still rendering, so video drops frames instead of drifting. Audio is mixed
// ahead in the audio worker (the same graph export uses) and played by a worklet at exact frames.
//
// The playhead is saved in the project (source time, so it survives cuts) on pause and seek, as view
// state outside edit(): no undo step. Attaching seeks back to it.

import { doc, save } from './doc.svelte.ts'
import type { InputEvent } from '../shared/events.ts'
import type { Project, Transcript } from '../shared/project.ts'
import { clipAt, mapRange, timeMap, toOutput, toSource } from '../shared/timemap.ts'
import { outputSize, prepare, type FaceSample, type Prepared } from '../engine/scene.ts'
import { renderFrame, type Media } from '../engine/compose.ts'
import { Renderer } from '../engine/gpu/renderer.ts'
import { fileUrl, openVideo } from '../engine/media/index.ts'
import { SR, mix, planOf, scrubGrain, voiceGain, type Plan } from '../engine/audio/index.ts'
import type { PlaybackMessage } from '../engine/audio/playback.worklet.ts'
import workletUrl from '../engine/audio/playback.worklet.ts?worker&url'

export const player = $state({ time: 0, duration: 0, playing: false, error: null as string | null })

/** Timing for labs and logs; plain (not reactive) so the hot loop stays cheap. Set `sync` to an
 *  array to log [audio clock, frame time] (output seconds) for each frame drawn while playing. */
export const stats = { frames: 0, dropped: 0, renderMs: 0, maxRenderMs: 0, prepares: 0, prepareMs: 0, starved: 0, grains: 0, sync: null as Array<[number, number]> | null }

const LEAD = 0.05 // s from play or seek to the first scheduled frame; the first chunk mixes meanwhile (about 10 ms)
const AHEAD = 0.6 // s of audio kept scheduled
const CHUNK = 9600 // frames per mix request (200 ms)
const GRAIN = 3840 // frames of audio per scrub step (80 ms)

let canvas: HTMLCanvasElement | null = null
let renderer: Renderer | null = null
let prepared: Prepared | null = null
const media: Media = {}
const opened: Record<keyof Media, string | undefined> = { screen: undefined, camera: undefined, matte: undefined }
let raf = 0
let inFlight = false
let shown = { t: NaN, p: null as Prepared | null }
let stale = true
let staleAt = 0
let preparedAt = 0
let size = ''
let events: { from: unknown; value: InputEvent[] } = { from: null, value: [] }
let transcript: { from: unknown; value: Transcript | null } = { from: null, value: null }
let faces: { url: string | undefined; value: FaceSample[] | undefined } = { url: undefined, value: undefined }
let restore = false // seek to the saved playhead on the next prepare
let saveTimer: ReturnType<typeof setTimeout> | undefined
let detachCurrent: (() => void) | null = null

// Audio
let ctx: AudioContext | null = null
let node: AudioWorkletNode | null = null
let audioReady: Promise<boolean> | null = null
let plan: Plan | null = null
let planKey = ''
const gains = new Map<string, number>()
let run = 0 // id of the current run
let runAudio = false // the run is clocked by the audio context (else by the wall clock)
let runOut = 0 // output time heard at clock time runCtx
let runCtx = 0
let runHold = false // before runCtx: hold at runOut (play, seek) or keep running (splice)
let runFrames = 0 // frames scheduled so far in this run
let requesting = false
let pump: ReturnType<typeof setInterval> | undefined
const session = `preview-${crypto.randomUUID()}`

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  if (player.error !== msg) console.warn(`Player: ${msg}`)
  player.error = msg
}

/** Start rendering the open project into `canvas`. Returns a detach function.
 *  Size the canvas with CSS (e.g. 100% of its box); the player sets its pixel size to that box times
 *  devicePixelRatio, fitted to the output aspect, and letterboxes with object-fit. */
export function attach(c: HTMLCanvasElement): () => void {
  detachCurrent?.()
  canvas = c
  player.error = null
  restore = true
  c.style.objectFit = 'contain'
  const stopEffects = $effect.root(() => {
    $effect(() => {
      void doc.rev
      void doc.path
      // The duration follows edits at once (seeks right after an edit clamp to it); frames re-prepare debounced.
      if (doc.project) player.duration = timeMap(doc.project.clips).duration
      stale = true
      staleAt = performance.now()
    })
  })
  Renderer.create(c, (rel) => fileUrl(rel.startsWith('/') ? rel : `${doc.path}/${rel}`))
    .then((r) => {
      if (canvas === c) renderer = r
      else r.destroy()
    })
    .catch(fail)
  raf = requestAnimationFrame(frame)
  pump = setInterval(feed, 50) // audio keeps flowing even when rAF is throttled
  void ensureAudio() // ready before the first play, so it starts as fast as every later one
  const detach = () => {
    if (detachCurrent !== detach) return
    detachCurrent = null
    pause()
    cancelAnimationFrame(raf)
    clearInterval(pump)
    stopEffects()
    for (const k of Object.keys(opened) as Array<keyof Media>) closeMedia(k)
    renderer?.destroy()
    renderer = null
    prepared = null
    canvas = null
    shown = { t: NaN, p: null }
    void ctx?.close()
    ctx = node = null
    audioReady = null
  }
  return (detachCurrent = detach)
}

export function play() {
  if (player.playing || !prepared) return
  catchUp()
  if (player.time >= player.duration - 1e-3) player.time = 0
  player.playing = true
  startRun(false)
  // Audio not running yet (still starting, or suspended by the system): switch to its clock once it is.
  if (!runAudio) void ensureAudio().then((ok) => ok && player.playing && !runAudio && startRun(false))
}

export function pause() {
  if (!player.playing) return
  player.time = Math.min(clock(), player.duration)
  player.playing = false
  run++
  if (ctx) post({ type: 'stop', at: Math.round(ctx.currentTime * SR) })
  keepPlayhead()
}

export const toggle = () => (player.playing ? pause() : play())

export function seek(t: number) {
  catchUp()
  player.time = Math.min(Math.max(t, 0), player.duration)
  if (player.playing) startRun(false)
  else keepPlayhead()
}

/** Apply a pending edit now rather than at the next debounced frame: a play or seek right after an
 *  edit (keepingPlayhead seeks after every edit that moves content) must start in the new timeline,
 *  not play a moment of the old one. */
function catchUp() {
  if (stale && canvas && doc.project && size) rebuild(doc.project, canvas.width, canvas.height, false) // the caller starts the run
}

/** Store the playhead in the project as source time; saved to disk once it settles for a second. */
function keepPlayhead() {
  const p = doc.project
  if (!p?.clips.length) return
  const src = toSource(timeMap(p.clips), player.time)
  if (Math.abs(p.playhead - src) < 1e-3) return
  p.playhead = src
  doc.dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save().catch(fail), 1000)
}

/** Seek while dragging the playhead: when paused, also plays the audio it crosses (see grains). */
export function scrub(t: number) {
  seek(t)
  if (!player.playing) {
    grainAt = player.time
    if (!grainBusy) void grains()
  }
}

// ---- Video ----

function frame(ts: number) {
  raf = requestAnimationFrame(frame)
  const project = doc.project
  if (!canvas || !project) return
  // Pixel size: the CSS box times devicePixelRatio, fitted to the output aspect.
  const out = outputSize(project, 1080)
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (!cw || !ch) return
  const k = Math.min(cw / out.width, ch / out.height) * devicePixelRatio
  const w = Math.max(2, Math.round(out.width * k))
  const h = Math.max(2, Math.round(out.height * k))
  if (`${w}x${h}` !== size) {
    size = `${w}x${h}`
    canvas.width = w
    canvas.height = h
    stale = true
    staleAt = 0
  }
  // Debounced re-prepare: after 40 ms of quiet, or every 150 ms during a continuous drag.
  if (stale && (ts - staleAt > 40 || ts - preparedAt > 150)) rebuild(project, w, h)
  if (player.playing) {
    const t = clock()
    if (t >= player.duration) {
      pause()
      player.time = player.duration
    } else player.time = t
  }
  if (!prepared || !renderer) return
  if (player.playing) prefetchCut(prepared, player.time)
  if (inFlight) {
    if (player.playing) stats.dropped++
    return
  }
  const t = player.time
  if (t === shown.t && prepared === shown.p) return
  shown = { t, p: prepared }
  inFlight = true
  const t0 = performance.now()
  renderFrame(renderer, prepared, media, t)
    .then(() => {
      const ms = performance.now() - t0
      stats.frames++
      stats.renderMs += (ms - stats.renderMs) * 0.1
      stats.maxRenderMs = Math.max(stats.maxRenderMs, ms)
      if (stats.sync && player.playing) stats.sync.push([clock(), t])
    })
    .catch(fail)
    .finally(() => (inFlight = false))
}

/** Half a second before playback reaches a cut, start decoding where the next clip begins, so the
 *  frame after the cut is ready instead of waiting for a keyframe decode. */
let warmed = NaN
function prefetchCut(p: Prepared, t: number) {
  const i = clipAt(p.map, t) + 1
  const src = p.map.clips[i]?.start
  if (src === undefined || src === warmed || p.map.outStarts[i] - t > 0.5) return
  warmed = src
  for (const k of Object.keys(media) as Array<keyof Media>) media[k]?.prefetch(src, toSource(p.map, t))
}

function rebuild(project: Project, width: number, height: number, splice = true) {
  stale = false
  preparedAt = performance.now()
  try {
    // The render path must not touch reactive proxies: the project is copied; events and transcript
    // are raw state (plain already, and replaced rather than edited).
    if (events.from !== doc.events) events = { from: doc.events, value: doc.events }
    if (transcript.from !== doc.transcript) transcript = { from: doc.transcript, value: doc.transcript }
    const p = $state.snapshot(project) as Project
    syncFaces(p)
    prepared = prepare({ project: p, events: events.value, transcript: transcript.value, width, height, faces: faces.value })
    stats.prepares++
    stats.prepareMs = performance.now() - preparedAt
    player.duration = prepared.map.duration
    if (restore) {
      // Reopen where the user left off; a moment cut out since then resumes at the next one kept.
      restore = false
      seek(toOutput(prepared.map, p.playhead) ?? mapRange(prepared.map, p.playhead, Infinity)[0]?.[0] ?? 0)
    }
    if (player.time > player.duration) player.time = player.duration
    syncMedia(p)
    syncAudio(p, splice)
  } catch (e) {
    fail(e)
  }
}

function syncMedia(p: Project) {
  const url = (f?: string) => f && fileUrl(f.startsWith('/') ? f : `${doc.path}/${f}`)
  const want = { screen: url(p.sources.screen?.file), camera: url(p.sources.camera?.file), matte: url(p.sources.camera?.matte) }
  for (const k of Object.keys(want) as Array<keyof Media>) {
    if (want[k] === opened[k]) continue
    closeMedia(k)
    const u = (opened[k] = want[k])
    if (!u) continue
    openVideo(u)
      .then((src) => {
        if (opened[k] !== u) return src.close()
        media[k] = src
        shown.t = NaN // draw again with the source
      })
      .catch(fail)
  }
}

/** Load the camera face track (for face follow) once per file; re-prepares when it arrives. */
function syncFaces(p: Project) {
  const f = p.sources.camera?.faces
  const url = f && fileUrl(f.startsWith('/') ? f : `${doc.path}/${f}`)
  if (url === faces.url) return
  faces = { url, value: undefined }
  if (!url) return
  fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((v: unknown) => {
      if (faces.url !== url) return
      faces.value = Array.isArray(v) ? v : []
      stale = true
    })
    .catch(() => fail(new Error(`Face follow is unavailable: ${f} could not be read.`)))
}

function closeMedia(k: keyof Media) {
  media[k]?.close()
  media[k] = undefined
  opened[k] = undefined
}

// ---- Audio ----

function syncAudio(p: Project, splice: boolean) {
  const next = planOf(p, events.value, doc.path, gains)
  for (const t of next.tracks) {
    if (t.voice && !gains.has(t.url)) {
      gains.set(t.url, 1) // until measured
      voiceGain(t.url)
        .then((g) => {
          gains.set(t.url, g)
          stale = true
        })
        .catch(fail)
    }
  }
  const key = JSON.stringify(next)
  if (key === planKey) return
  if (!plan) void mix(session, next, Math.round(player.time * SR), 480).catch(() => {}) // warm the worker before play
  plan = next
  planKey = key
  if (player.playing && splice) startRun(true) // an edit while playing: splice in the new mix, clock continues
}

/** The output context, created once per attach and resumed if the system suspended it. */
async function ensureAudio(): Promise<boolean> {
  const ok = await (audioReady ??= (async () => {
    try {
      const c = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' })
      await c.audioWorklet.addModule(workletUrl)
      const n = new AudioWorkletNode(c, 'studio-playback', { numberOfInputs: 0, outputChannelCount: [2] })
      n.port.onmessage = ({ data }) => (stats.starved = data.starved)
      n.connect(c.destination)
      if (!canvas) return (void c.close(), false) // detached meanwhile
      ctx = c
      node = n
      return true
    } catch (e) {
      fail(new Error(`Audio output is unavailable, playing without sound (${e instanceof Error ? e.message : e})`))
      return false
    }
  })())
  if (ok && ctx && ctx.state !== 'running') await ctx.resume().catch(() => {})
  return ok && audible()
}

const audible = () => !!ctx && ctx.state === 'running'

/** The run's clock: the context time being heard while audio runs, the wall clock otherwise. */
function now(): number {
  if (!runAudio || !ctx) return performance.now() / 1000
  const ts = ctx.getOutputTimestamp()
  // The context time being heard right now (output latency included).
  if (ts.contextTime && ts.performanceTime) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)
}

/** Output time being heard now. */
function clock(): number {
  const d = now() - runCtx
  return runOut + (runHold ? Math.max(0, d) : d)
}

/** Begin a new run of audio LEAD seconds from now. `splice`: continue the clock (edits while
 *  playing); otherwise start at player.time (play, seek). */
function startRun(splice: boolean) {
  const heard = splice ? clock() : player.time
  runAudio = audible()
  const at = Math.round(((runAudio ? ctx!.currentTime : performance.now() / 1000) + LEAD) * SR)
  run++
  runCtx = at / SR
  runOut = splice ? heard + (runCtx - now()) : heard
  runHold = !splice
  runFrames = 0
  post({ type: 'run', id: run, at })
  void feed()
}

/** Keep AHEAD seconds of the current run mixed and queued in the worklet. */
async function feed() {
  if (!player.playing || !plan || requesting || !audible()) return
  if (runCtx + runFrames / SR - ctx!.currentTime > AHEAD) return
  const id = run
  const start = Math.round(runOut * SR) + runFrames
  const total = Math.round(plan.duration * SR)
  const frames = Math.min(CHUNK, total - start)
  if (frames <= 0) return
  requesting = true
  try {
    const [L, R] = await mix(session, plan, start, frames)
    if (id !== run || !player.playing) return
    post({ type: 'chunk', run: id, at: Math.round(runCtx * SR) + runFrames, L, R }, [L.buffer as ArrayBuffer, R.buffer as ArrayBuffer])
    runFrames += frames
    if (start + frames >= total) post({ type: 'stop', at: Math.round(runCtx * SR) + runFrames }) // the end: nothing more follows
  } catch (e) {
    fail(e)
  } finally {
    requesting = false
  }
  void feed()
}

let grainAt: number | null = null
let grainBusy = false
let grainFrom = { t: 0, until: 0 } // where the last grain left the playhead, and until when (ms) a drag goes on from there
/** Scrub audio, like a record under the finger: back-to-back 80 ms grains, each playing the output
 *  time the playhead crossed since the last one, forward or backward, pitch following the drag speed
 *  (up to 4x). The first grain, a jump, or a faster drag plays 80 ms at normal speed from the
 *  playhead. Grains are the same mix (stretched on sped-up clips), crossfaded by the worklet's 5 ms
 *  run fades. */
async function grains() {
  grainBusy = true
  try {
    let next = 0 // context frame where the next grain joins the current one
    while (grainAt !== null && !player.playing && plan && (await ensureAudio())) {
      const t = grainAt
      grainAt = null
      const d = performance.now() < grainFrom.until ? t - grainFrom.t : Infinity
      const span = Math.round(Math.abs(d) * SR)
      if (span < 48) continue // the playhead did not move
      const crossed = span <= 4 * GRAIN
      let [L, R] = await mix(`${session}-scrub`, plan, Math.round((crossed ? Math.min(t, grainFrom.t) : t) * SR), crossed ? span : GRAIN)
      if (crossed) [L, R] = [scrubGrain(L, GRAIN, d < 0), scrubGrain(R, GRAIN, d < 0)]
      grainFrom = { t, until: performance.now() + 250 }
      if (player.playing) break
      const at = Math.max(next, Math.round((ctx!.currentTime + 0.02) * SR))
      next = at + GRAIN - 240 // the worklet fades a run out over the 240 frames after its end
      run++
      post({ type: 'run', id: run, at })
      post({ type: 'chunk', run, at, L, R }, [L.buffer as ArrayBuffer, R.buffer as ArrayBuffer])
      post({ type: 'stop', at: next })
      stats.grains++
      // Mix the next grain shortly before this one ends, from wherever the scrub is by then.
      await new Promise((r) => setTimeout(r, (next / SR - ctx!.currentTime) * 1000 - 30))
    }
  } catch (e) {
    fail(e)
  } finally {
    grainBusy = false
  }
}

function post(m: PlaybackMessage, transfer: Transferable[] = []) {
  node?.port.postMessage(m, transfer)
}
