// Owner: audio/media. Preview playback of doc.project: playback clock, synced audio, and
// rendering through src/engine/compose.ts (the same path export uses).
// Times are OUTPUT seconds.
//
// While playing, the audio context clock is the master: the time shown is the output time being
// heard right now. A requestAnimationFrame loop renders the latest time and skips a tick while the
// previous frame is still rendering, so video drops frames instead of drifting. Audio is mixed
// ahead in the audio worker (the same graph export uses) and played by a worklet at exact frames.

import { doc } from './doc.svelte.ts'
import type { InputEvent } from '../shared/events.ts'
import type { Project, Transcript } from '../shared/project.ts'
import { outputSize, prepare, type Prepared } from '../engine/scene.ts'
import { renderFrame, type Media } from '../engine/compose.ts'
import { Renderer } from '../engine/gpu/renderer.ts'
import { fileUrl, openVideo } from '../engine/media/index.ts'
import { SR, mix, planOf, voiceGain, type Plan } from '../engine/audio/index.ts'
import type { PlaybackMessage } from '../engine/audio/playback.worklet.ts'
import workletUrl from '../engine/audio/playback.worklet.ts?worker&url'

export const player = $state({ time: 0, duration: 0, playing: false, error: null as string | null })

/** Timing for labs and logs; plain (not reactive) so the hot loop stays cheap. */
export const stats = { frames: 0, dropped: 0, renderMs: 0, maxRenderMs: 0, prepares: 0, prepareMs: 0, starved: 0 }

const LEAD = 0.1 // s between asking for audio and hearing it (first chunk renders meanwhile)
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
  c.style.objectFit = 'contain'
  const stopEffects = $effect.root(() => {
    $effect(() => {
      void doc.rev
      void doc.project
      void doc.path
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
  if (player.time >= player.duration - 1e-3) player.time = 0
  player.playing = true
  startRun(false)
  void ensureAudio().then((ok) => ok && player.playing && startRun(false))
}

export function pause() {
  if (!player.playing) return
  player.time = Math.min(clock(), player.duration)
  player.playing = false
  run++
  if (ctx) post({ type: 'stop', at: Math.round(ctx.currentTime * SR) })
}

export const toggle = () => (player.playing ? pause() : play())

export function seek(t: number) {
  player.time = Math.min(Math.max(t, 0), player.duration)
  if (player.playing) startRun(false)
}

/** Seek while dragging the playhead: when paused, also plays a short grain of audio at t. */
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
    })
    .catch(fail)
    .finally(() => (inFlight = false))
}

function rebuild(project: Project, width: number, height: number) {
  stale = false
  preparedAt = performance.now()
  try {
    // The render path must not touch reactive proxies: the project is copied; events and transcript
    // are raw state (plain already, and replaced rather than edited).
    if (events.from !== doc.events) events = { from: doc.events, value: doc.events }
    if (transcript.from !== doc.transcript) transcript = { from: doc.transcript, value: doc.transcript }
    const p = $state.snapshot(project) as Project
    prepared = prepare({ project: p, events: events.value, transcript: transcript.value, width, height })
    stats.prepares++
    stats.prepareMs = performance.now() - preparedAt
    player.duration = prepared.map.duration
    if (player.time > player.duration) player.time = player.duration
    syncMedia(p)
    syncAudio(p)
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

function closeMedia(k: keyof Media) {
  media[k]?.close()
  media[k] = undefined
  opened[k] = undefined
}

// ---- Audio ----

function syncAudio(p: Project) {
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
  if (player.playing) startRun(true) // an edit while playing: splice in the new mix, clock continues
}

function ensureAudio(): Promise<boolean> {
  return (audioReady ??= (async () => {
    try {
      const c = new AudioContext({ sampleRate: SR, latencyHint: 'playback' })
      await c.audioWorklet.addModule(workletUrl)
      const n = new AudioWorkletNode(c, 'studio-playback', { numberOfInputs: 0, outputChannelCount: [2] })
      n.port.onmessage = ({ data }) => (stats.starved = data.starved)
      n.connect(c.destination)
      await c.resume()
      ctx = c
      node = n
      return true
    } catch (e) {
      fail(new Error(`Audio output is unavailable, playing without sound (${e instanceof Error ? e.message : e})`))
      return false
    }
  })())
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
  const frames = Math.min(CHUNK, Math.round(plan.duration * SR) - start)
  if (frames <= 0) return
  requesting = true
  try {
    const [L, R] = await mix(session, plan, start, frames)
    if (id !== run || !player.playing) return
    post({ type: 'chunk', run: id, at: Math.round(runCtx * SR) + runFrames, L, R }, [L.buffer as ArrayBuffer, R.buffer as ArrayBuffer])
    runFrames += frames
  } catch (e) {
    fail(e)
  } finally {
    requesting = false
  }
  void feed()
}

let grainAt: number | null = null
let grainBusy = false
/** Scrub audio: the latest requested position only, 80 ms with fades, from the same mix. */
async function grains() {
  grainBusy = true
  try {
    while (grainAt !== null && !player.playing && plan && (await ensureAudio())) {
      const t = grainAt
      grainAt = null
      const [L, R] = await mix(`${session}-scrub`, plan, Math.round(t * SR), GRAIN)
      if (player.playing || grainAt !== null) continue
      for (let i = 0; i < 240; i++) {
        const g = i / 240
        L[i] *= g
        R[i] *= g
        L[GRAIN - 1 - i] *= g
        R[GRAIN - 1 - i] *= g
      }
      const at = Math.round((ctx!.currentTime + 0.02) * SR)
      run++
      post({ type: 'run', id: run, at })
      post({ type: 'chunk', run: run, at, L, R }, [L.buffer as ArrayBuffer, R.buffer as ArrayBuffer])
      post({ type: 'stop', at: at + GRAIN })
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
