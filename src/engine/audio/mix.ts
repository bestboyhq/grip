// The audio graph: one pure mixer for preview and export (parity). Output samples [start, start+n)
// at 48 kHz stereo are a function of (plan, start): sources mapped through the shared time map,
// pitch-preserving stretch for speed != 1, 10 ms crossfades at cuts, clip and track volume, the
// voice chain on the mic (RNNoise -> static loudness gain), looped music, click sounds, and a true-peak
// limiter on the master so the mix never clips. Stateful stages (stretch, RNNoise, limiter) run
// sequentially; any jump re-primes them with a pre-roll, so chunk boundaries never click.

import type { Source } from 'mediabunny'
import type { Clip, Project } from '../../shared/project.ts'
import type { InputEvent } from '../../shared/events.ts'
import { timeMap, toOutput } from '../../shared/timemap.ts'
import { fileUrl } from '../media/index.ts'
import { DENOISE_FRAME, DENOISE_LATENCY, Denoiser, Limiter, SR, Stretcher, clickSound, voiceGain } from './dsp.ts'
import { Reader, loudness, openAudio, type AudioFile } from './source.ts'

export interface PlanTrack {
  url: string
  label: string // bundle-relative path, for error messages
  volume: number
  voice?: boolean // enhance: noise reduction + a static loudness gain, which the mixer measures
}

/** Everything the mixer needs, as plain data (it crosses into the audio worker). */
export interface Plan {
  duration: number // output seconds
  clips: Clip[] // the time map, in output order; drives every source track
  tracks: PlanTrack[] // mic and system audio, already without muted tracks
  music: { url: string; label: string; volume: number } | null // plays in output time, looped
  clicks: number[] // output seconds of click sounds
}

/** Build the plan for a project. */
export function planOf(project: Project, events: InputEvent[], bundle: string): Plan {
  const map = timeMap(project.clips)
  const src = project.sources
  const { mic, system, music } = project.audio
  const url = (file: string) => fileUrl(file.startsWith('/') ? file : `${bundle}/${file}`)
  const tracks: PlanTrack[] = []
  if (src.mic && !mic.muted && mic.volume > 0) {
    tracks.push({ url: url(src.mic.file), label: src.mic.file, volume: mic.volume, ...(mic.enhance ? { voice: true } : {}) })
  }
  if (src.system && !system.muted && system.volume > 0) tracks.push({ url: url(src.system.file), label: src.system.file, volume: system.volume })
  const clicks = project.style.cursor.clickSound
    ? events.flatMap((e) => (e.type === 'down' ? [toOutput(map, e.t)] : [])).filter((t): t is number => t !== null).sort((a, b) => a - b)
    : []
  return {
    duration: map.duration,
    clips: project.clips.map(({ id, start, end, speed, volume, muted }) => ({ id, start, end, speed, volume, ...(muted ? { muted } : {}) })),
    tracks,
    music: music && music.volume > 0 ? { url: url(music.file), label: music.file, volume: music.volume } : null,
    clicks,
  }
}

/** Platform hooks, so the same mixer runs in the browser worker and in node tests. */
export interface Env {
  open(url: string): Source
  rnnoise(): Promise<WebAssembly.Module>
}

const H = 240 // half crossfade (5 ms): cuts, speed and volume changes blend over 10 ms
const PRE = SR / 2 // pre-roll after a jump, primes RNNoise, the limiter, and stretch
const BLOCK = 480 // stretch and RNNoise work on 10 ms blocks of the absolute output grid
const STRETCH_PRE = 10 // blocks of stretch pre-roll (its output fades in over ~60 ms after a seek)
const MAX_SPEED = 16 // beyond this, speech is noise: the segment is silent
const MUSIC_FADE = 2 * SR // music fades out over the last 2 s

/** Smooth step centered on boundary b: 0 before b-H, 1 after b+H. Neighbors sum to exactly 1. */
const step = (n: number, b: number) => (n <= b - H ? 0 : n >= b + H ? 1 : (n - b + H) / (2 * H))

/** A stretch of output with one linear source mapping (merged clips: contiguous source, same speed). */
interface Seg {
  o0: number // output samples
  o1: number
  s0: number // source samples at o0
  speed: number
  first: boolean // no fade in: nothing before it
  last: boolean // no fade out: nothing after it
}

function segsOf(clips: Clip[]): Seg[] {
  const m = timeMap(clips)
  const out: Seg[] = []
  clips.forEach((c, i) => {
    const o0 = m.outStarts[i] * SR
    const o1 = o0 + ((c.end - c.start) / c.speed) * SR
    const prev = out[out.length - 1]
    const p = clips[i - 1]
    if (prev && p && Math.abs(p.end - c.start) < 1e-6 && p.speed === c.speed) prev.o1 = o1
    else out.push({ o0, o1, s0: c.start * SR, speed: c.speed, first: !out.length, last: false })
  })
  if (out.length) out[out.length - 1].last = true
  return out
}

const weight = (s: Seg, n: number) => (s.first ? 1 : step(n, s.o0)) - (s.last ? 0 : step(n, s.o1))
const zeros = (ch: number, n: number) => Array.from({ length: ch }, () => new Float32Array(n))

const files = new Map<string, Promise<AudioFile>>()
/** Open (once) the audio of `url`; shared by every mixer and analysis in this thread. */
export function openFile(env: Env, url: string, label: string): Promise<AudioFile> {
  let f = files.get(url)
  if (!f) {
    f = openAudio(env.open(url), label)
    f.catch(() => files.delete(url)) // a later attempt may succeed (file restored)
    files.set(url, f)
  }
  return f
}

const gains = new WeakMap<AudioFile, Promise<number>>()
/** The static loudness gain of a voice (see loudness()), measured once per file in this thread and
 *  awaited before the first sample is mixed, so it never changes while playing. */
function voiceGainOf(f: AudioFile): Promise<number> {
  let g = gains.get(f)
  if (!g) {
    gains.set(f, (g = loudness(f).then(voiceGain)))
    g.catch(() => gains.delete(f)) // a later attempt may succeed
  }
  return g
}

/** Renders one segment's audio on the output grid. Sequential reads are cheap; jumps re-seek. */
class SegReader {
  private seg: Seg
  private reader: Reader
  private ch: number
  private stretch: Stretcher | null = null
  private nextBlock = NaN // the next block the stretcher will produce
  private fed = 0 // next source sample to feed it
  private block: Float32Array[] // last produced block
  private blockAt = NaN

  constructor(seg: Seg, file: AudioFile) {
    this.seg = seg
    this.reader = new Reader(file)
    this.ch = Math.min(2, file.channels)
    this.block = zeros(this.ch, BLOCK)
  }

  async read(a: number, n: number): Promise<Float32Array[]> {
    const s = this.seg
    if (s.speed === 1) return (await this.reader.read(a + Math.round(s.s0 - s.o0), n)).slice(0, 2)
    if (s.speed > MAX_SPEED) return zeros(this.ch, n)
    const out = zeros(this.ch, n)
    for (let b = Math.floor(a / BLOCK); b * BLOCK < a + n; b++) {
      if (this.blockAt !== b) await this.produce(b)
      const from = Math.max(a, b * BLOCK)
      const to = Math.min(a + n, (b + 1) * BLOCK)
      for (let c = 0; c < this.ch; c++) out[c].set(this.block[c].subarray(from - b * BLOCK, to - b * BLOCK), from - a)
    }
    return out
  }

  /** Source sample that must have been fed for output up to sample n (see Stretcher). */
  private feedTarget(n: number) {
    const st = this.stretch!
    return Math.round(this.seg.s0 + (n - this.seg.o0) * this.seg.speed) + st.inLat + Math.round(st.outLat * this.seg.speed)
  }

  private async produce(b: number) {
    if (b !== this.nextBlock) {
      // A fresh stretcher per jump: output must not depend on what it played before (parity).
      const st = (this.stretch = await Stretcher.create(this.ch))
      const start = b - STRETCH_PRE
      const p = this.feedTarget(start * BLOCK)
      const win = st.inLat + st.outLat
      st.seek((await this.reader.read(p - win, win)).slice(0, this.ch), this.seg.speed)
      this.fed = p
      this.nextBlock = start
    }
    const st = this.stretch!
    while (this.nextBlock <= b) {
      const target = this.feedTarget((this.nextBlock + 1) * BLOCK)
      const input = (await this.reader.read(this.fed, target - this.fed)).slice(0, this.ch)
      st.process(input, target - this.fed, this.block, 0, BLOCK)
      this.fed = target
      this.blockAt = this.nextBlock++
    }
  }

  dispose() {
    this.reader.close()
  }
}

/** One time-mapped source: assembles segments with crossfades. */
class Track {
  readonly file: AudioFile
  readonly ch: number
  private segs: Seg[]
  private open = new Map<Seg, SegReader>()

  constructor(file: AudioFile, segs: Seg[]) {
    this.file = file
    this.ch = Math.min(2, file.channels)
    this.segs = segs
  }

  async assemble(pos: number, n: number): Promise<Float32Array[]> {
    const out = zeros(this.ch, n)
    const used = new Set<Seg>()
    // First segment that can reach pos (segments are in output order).
    let lo = 0
    let hi = this.segs.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.segs[mid].last || this.segs[mid].o1 + H > pos) hi = mid
      else lo = mid + 1
    }
    for (let i = lo; i < this.segs.length; i++) {
      const s = this.segs[i]
      const a = Math.max(pos, s.first ? -Infinity : Math.ceil(s.o0 - H))
      const b = Math.min(pos + n, s.last ? Infinity : Math.ceil(s.o1 + H))
      if (a >= pos + n) break
      if (b <= a) continue
      let r = this.open.get(s)
      if (!r) this.open.set(s, (r = new SegReader(s, this.file)))
      used.add(s)
      const data = await r.read(a, b - a)
      for (let c = 0; c < this.ch; c++) {
        const o = out[c]
        const d = data[c]
        for (let j = a; j < b; j++) o[j - pos] += weight(s, j) * d[j - a]
      }
    }
    for (const [s, r] of this.open) if (!used.has(s)) (r.dispose(), this.open.delete(s))
    return out
  }

  reset() {
    for (const r of this.open.values()) r.dispose()
    this.open.clear()
  }
}

/** Music looped back to back: output sample n plays source sample n mod len. A seam is a plain
 *  splice, so music made to loop loops seamlessly; a crossfade there would blend tail and head,
 *  which cancel or dip unless they happen to line up. */
class Loop {
  readonly ch: number
  private reader: Reader
  private len: number

  constructor(file: AudioFile, len: number) {
    this.ch = Math.min(2, file.channels)
    this.reader = new Reader(file)
    this.len = len
  }

  async read(pos: number, n: number): Promise<Float32Array[]> {
    const out = zeros(this.ch, n)
    for (let i = 0; i < n; ) {
      const s = (pos + i) % this.len
      const k = Math.min(n - i, this.len - s)
      const chs = await this.reader.read(s, k)
      for (let c = 0; c < this.ch; c++) out[c].set(chs[c], i)
      i += k
    }
    return out
  }

  reset() {
    this.reader.close()
  }
}

/** RNNoise in front of a track, on the absolute 10 ms grid, latency compensated. */
class Voice {
  private track: Track
  private den: Denoiser
  private v: Float32Array[] // denoised audio aligned to its input: v[i] is sample vStart + i
  private vStart = NaN
  private vLen = 0
  private uNext = 0 // next input frame to feed

  constructor(track: Track, den: Denoiser) {
    this.track = track
    this.den = den
    this.v = zeros(track.ch, 4 * PRE)
  }

  async read(pos: number, n: number): Promise<Float32Array[]> {
    if (!(pos >= this.vStart && pos <= this.vStart + this.vLen)) {
      this.vStart = this.uNext = Math.floor(pos / DENOISE_FRAME) * DENOISE_FRAME
      this.vLen = 0
      this.den.reset()
      await this.feed() // its output belongs to the frame before vStart: warm-up only
    }
    while (this.vStart + this.vLen < pos + n) {
      const out = await this.feed() // frame q in, denoised frame q - 1 out
      if (this.vLen + DENOISE_FRAME > this.v[0].length) this.v = this.v.map((ch) => grow(ch, 2 * ch.length))
      for (let c = 0; c < out.length; c++) this.v[c].set(out[c], this.vLen)
      this.vLen += DENOISE_FRAME
    }
    const drop = pos - this.vStart
    for (const ch of this.v) ch.copyWithin(0, drop, this.vLen)
    this.vStart = pos
    this.vLen -= drop
    return this.v.map((ch) => ch.slice(0, n))
  }

  private async feed() {
    const raw = await this.track.assemble(this.uNext, DENOISE_FRAME)
    this.den.frame(raw)
    this.uNext += DENOISE_FRAME
    return raw
  }

  reset() {
    this.vStart = NaN
    this.track.reset()
  }
}

function grow(a: Float32Array, size: number) {
  const b = new Float32Array(size)
  b.set(a)
  return b
}

export class Mixer {
  private env: Env
  private plan: Plan | null = null
  private key = ''
  private ready: Promise<void> | null = null
  private tracks: Array<{ t: Track; voice: Voice | null; gain: number }> = []
  private music: { t: Loop; volume: number } | null = null
  private gainSegs: Array<{ o0: number; o1: number; v: number; first: boolean; last: boolean }> = []
  private clicks: number[] = []
  private total = 0
  private limiter = new Limiter()
  private denoisers = new Map<number, Promise<Denoiser>>() // by channel count, reused across plans
  private next = NaN

  constructor(env: Env) {
    this.env = env
  }

  /** Use this plan from the next render on. A different plan re-primes the mix (a jump). */
  setPlan(plan: Plan) {
    const key = JSON.stringify(plan)
    if (key === this.key) return
    this.key = key
    this.plan = plan
    this.ready = null
    this.next = NaN
  }

  /** Output samples [start, start+n) as [left, right]. */
  async render(start: number, n: number): Promise<[Float32Array, Float32Array]> {
    if (!this.plan) throw new Error('Mixer has no plan')
    await (this.ready ??= this.build(this.plan))
    if (start !== this.next) await this.jump(start)
    const out = await this.bus(start + Limiter.latency, n)
    this.limiter.process(out[0], out[1])
    this.next = start + n
    return out
  }

  private async build(plan: Plan) {
    this.dispose()
    this.total = Math.round(plan.duration * SR)
    const segs = segsOf(plan.clips)
    const m = timeMap(plan.clips)
    this.gainSegs = plan.clips.map((c, i) => ({
      o0: m.outStarts[i] * SR,
      o1: (m.outStarts[i] + (c.end - c.start) / c.speed) * SR,
      v: c.muted ? 0 : c.volume,
      first: i === 0,
      last: i === plan.clips.length - 1,
    }))
    this.tracks = await Promise.all(
      plan.tracks.map(async (p) => {
        const t = new Track(await openFile(this.env, p.url, p.label), segs)
        const voice = p.voice ? new Voice(t, await this.denoiser(t.ch)) : null
        return { t, voice, gain: p.volume * (p.voice ? await voiceGainOf(t.file) : 1) }
      }),
    )
    if (plan.music) {
      const f = await openFile(this.env, plan.music.url, plan.music.label)
      const len = Math.round(f.duration * SR)
      if (len > SR / 10) this.music = { t: new Loop(f, len), volume: plan.music.volume }
    }
    this.clicks = plan.clicks.map((t) => Math.round(t * SR))
  }

  private denoiser(ch: number) {
    let d = this.denoisers.get(ch)
    if (!d) this.denoisers.set(ch, (d = this.env.rnnoise().then((m) => Denoiser.create(m, ch))))
    return d
  }

  /** Re-prime every stateful stage so output from `start` sounds as if played from the beginning. */
  private async jump(start: number) {
    for (const t of this.tracks) (t.voice ?? t.t).reset()
    this.music?.t.reset()
    this.limiter.reset()
    let p = start - PRE
    while (p < start) {
      const n = Math.min(start - p, 4800)
      const out = await this.bus(p + Limiter.latency, n)
      this.limiter.process(out[0], out[1])
      p += n
    }
  }

  /** The mix before the limiter, for output samples [pos, pos+n). */
  private async bus(pos: number, n: number): Promise<[Float32Array, Float32Array]> {
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const a = Math.max(pos, 0)
    const b = Math.min(pos + n, this.total)
    if (b <= a) return [L, R]
    const len = b - a
    const off = a - pos
    const G = this.gain(a, len)
    for (const { t, voice, gain } of this.tracks) {
      const chs = voice ? await voice.read(a, len) : await t.assemble(a, len)
      const l = chs[0]
      const r = chs[1] ?? chs[0] // a mono source plays centered on both channels
      for (let i = 0; i < len; i++) {
        const g = G[i] * gain
        L[off + i] += l[i] * g
        R[off + i] += r[i] * g
      }
    }
    if (this.music) {
      const chs = await this.music.t.read(a, len)
      const r = chs[1] ?? chs[0]
      for (let i = 0; i < len; i++) {
        const g = this.music.volume * Math.min(1, (this.total - (a + i)) / MUSIC_FADE)
        L[off + i] += chs[0][i] * g
        R[off + i] += r[i] * g
      }
    }
    const click = clickSound()
    let lo = 0
    let hi = this.clicks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.clicks[mid] + click.length > a) hi = mid
      else lo = mid + 1
    }
    for (let k = lo; k < this.clicks.length && this.clicks[k] < b; k++) {
      const c = this.clicks[k]
      for (let i = Math.max(a, c); i < Math.min(b, c + click.length); i++) {
        L[i - pos] += click[i - c]
        R[i - pos] += click[i - c]
      }
    }
    // Short fades at the very start and end, so a trimmed edge never starts or stops mid-wave.
    for (let i = a; i < b; i++) {
      const f = Math.min(1, (i + 1) / H, (this.total - i) / H)
      if (f < 1) {
        L[i - pos] *= f
        R[i - pos] *= f
      }
    }
    return [L, R]
  }

  /** Clip volume (0 when muted) over output samples [a, a+n), ramped at clip boundaries. */
  private gain(a: number, n: number): Float32Array {
    const G = new Float32Array(n)
    const segs = this.gainSegs
    let lo = 0
    let hi = segs.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (segs[mid].last || segs[mid].o1 + H > a) hi = mid
      else lo = mid + 1
    }
    for (let k = lo; k < segs.length; k++) {
      const s = segs[k]
      if (!s.first && s.o0 - H >= a + n) break
      if (!s.v) continue
      for (let i = 0; i < n; i++) G[i] += s.v * ((s.first ? 1 : step(a + i, s.o0)) - (s.last ? 0 : step(a + i, s.o1)))
    }
    return G
  }

  dispose() {
    for (const t of this.tracks) t.t.reset()
    this.music?.t.reset()
    this.tracks = []
    this.music = null
  }
}
