// Source audio, decoded in chunks with mediabunny (WebCodecs) and resampled onto the 48 kHz grid.
// A Reader holds a few seconds at most, so multi-hour tracks never sit in memory. Also the analysis
// of a source: waveform peaks and integrated loudness, computed once and cached.

import { ALL_FORMATS, AudioSampleSink, Input, type AudioSample, type Source } from 'mediabunny'
import { LoudnessMeter, SR, integratedLoudness, interpolate, sincTable } from './dsp.ts'

export interface AudioFile {
  label: string // bundle-relative name for error messages
  rate: number
  channels: number
  duration: number // seconds
  size: number // bytes, part of the cache key
  sink: AudioSampleSink
  input: Input
}

/** Open the primary audio track of any container (m4a, wav, or an imported .mp4/.mov). */
export async function openAudio(source: Source, label: string): Promise<AudioFile> {
  const input = new Input({ source, formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new Error(`${label} has no audio track`)
    if (!(await track.canDecode())) throw new Error(`${label} uses ${(await track.getCodec()) ?? 'an unknown'} audio, which this Mac cannot decode`)
    const [rate, channels, duration, size] = await Promise.all([track.getSampleRate(), track.getNumberOfChannels(), track.computeDuration(), source.getSize()])
    return { label, rate, channels, duration, size, sink: new AudioSampleSink(track), input }
  } catch (e) {
    input.dispose()
    if (e instanceof Error && e.message.startsWith(label)) throw e
    throw new Error(`Could not read ${label}: ${e instanceof Error ? e.message : e}`)
  }
}

const HALF = 16 // resampler taps per side
const KEEP = 16384 // native samples kept behind the read position (stretch seek windows look back)
const PREROLL = 0.1 // seconds decoded before a seek target, so the codec's overlap is settled

/** Sequential-fast, random-access-correct reader on the 48 kHz output grid. Zeros outside the track. */
export class Reader {
  private f: AudioFile
  private ratio: number // native samples per output sample
  private table: Float32Array | null
  private buf: Float32Array[]
  private b0 = 0 // native index of buf[c][0]
  private len = 0
  private it: AsyncGenerator<AudioSample, void, unknown> | null = null
  private done = false
  private total: number // native samples in the track

  constructor(f: AudioFile) {
    this.f = f
    this.ratio = f.rate / SR
    this.table = f.rate === SR ? null : sincTable(HALF, Math.min(1, SR / f.rate) * 0.97)
    this.buf = Array.from({ length: f.channels }, () => new Float32Array(1 << 16))
    this.total = Math.round(f.duration * f.rate)
  }

  get channels() {
    return this.f.channels
  }

  /** Samples [start, start+n) of the 48 kHz grid (sample k = source time k/48000), one array per channel. */
  async read(start: number, n: number): Promise<Float32Array[]> {
    const out = Array.from({ length: this.f.channels }, () => new Float32Array(n))
    if (!this.table) {
      const a = Math.max(start, 0)
      const b = Math.min(start + n, this.total)
      if (b > a) {
        await this.need(a, b)
        const e = Math.min(b, this.b0 + this.len) // the track can end early
        for (let c = 0; c < out.length && e > a; c++) out[c].set(this.buf[c].subarray(a - this.b0, e - this.b0), a - start)
      }
      return out
    }
    const p0 = start * this.ratio
    const p1 = (start + n) * this.ratio
    const a = Math.max(Math.floor(p0) - HALF, 0)
    const b = Math.min(Math.ceil(p1) + HALF + 1, this.total)
    if (b <= a) return out
    await this.need(a, b)
    // A zero-padded window so the kernel can read past both ends of the track.
    const e = Math.max(a, Math.min(b, this.b0 + this.len))
    const w = Array.from({ length: out.length }, (_, c) => {
      const pad = new Float32Array(b - a + 2 * HALF + 2)
      pad.set(this.buf[c].subarray(a - this.b0, e - this.b0), HALF)
      return pad
    })
    for (let i = 0; i < n; i++) {
      const pos = (start + i) * this.ratio
      if (pos < 0 || pos >= this.total) continue
      for (let c = 0; c < out.length; c++) out[c][i] = interpolate(w[c], pos - a + HALF, this.table, HALF)
    }
    return out
  }

  /** Make native samples [a, b) resident. */
  private async need(a: number, b: number) {
    const jump = 2 * this.f.rate // decoding through up to 2 s beats a seek
    if (!this.it || a < this.b0 || a > this.b0 + this.len + jump) await this.restart(a)
    // Drop what is far behind, keeping a little for windows that look back.
    const drop = Math.min(a - KEEP - this.b0, this.len)
    if (drop > 0) {
      for (const ch of this.buf) ch.copyWithin(0, drop, this.len)
      this.b0 += drop
      this.len -= drop
    }
    while (this.b0 + this.len < b && !this.done) {
      const r = await this.it!.next()
      if (r.done) {
        this.done = true
        break
      }
      this.append(r.value)
    }
  }

  private append(s: AudioSample) {
    try {
      const at = Math.round(s.timestamp * this.f.rate) // samples are placed by timestamp, so gaps stay gaps
      const end = this.b0 + this.len
      const skip = Math.max(0, end - at) // overlap with what we have (or priming before b0)
      if (skip >= s.numberOfFrames) return
      const gap = Math.max(0, at - end)
      const count = s.numberOfFrames - skip
      this.grow(this.len + gap + count)
      const to = this.len + gap
      for (let c = 0; c < this.buf.length; c++) {
        this.buf[c].fill(0, this.len, to)
        s.copyTo(this.buf[c].subarray(to, to + count), { planeIndex: Math.min(c, s.numberOfChannels - 1), format: 'f32-planar', frameOffset: skip, frameCount: count })
      }
      this.len += gap + count
    } finally {
      s.close()
    }
  }

  private grow(size: number) {
    if (size <= this.buf[0].length) return
    const cap = 1 << Math.ceil(Math.log2(size))
    this.buf = this.buf.map((ch) => {
      const next = new Float32Array(cap)
      next.set(ch.subarray(0, this.len))
      return next
    })
  }

  private async restart(at: number) {
    await this.it?.return()
    this.b0 = Math.max(0, at - Math.round(PREROLL * this.f.rate))
    this.len = 0
    this.done = false
    // Decode from PREROLL before `at` even when that is before 0: AAC needs the packet before the
    // first one it should output (the priming packet at the start), else the head comes out silent.
    this.it = this.f.sink.samples(at / this.f.rate - PREROLL)
    // The first decoded sample may start before b0; append() trims it, but we want b0 covered.
    const first = await this.it.next()
    if (first.done) {
      this.done = true
      return
    }
    this.b0 = Math.max(0, Math.min(this.b0, Math.round(first.value.timestamp * this.f.rate)))
    this.append(first.value)
  }

  close() {
    void this.it?.return()
    this.it = null
  }
}

// ---- Analysis: waveform peaks + loudness, decoded in parallel segments ----
// WebCodecs decodes on its own threads, so a few segments decoding at once scale almost linearly.
// A segment's peaks are usable as soon as it is done: the waveform of a 2-hour file starts drawing
// from its first minutes while the rest still decodes.

export const PEAK_SPP = 256 // output-grid samples per peak bucket (5.3 ms)
const SEG = 20 * 76800 // output samples per segment (32 s, so the waveform fills in from the first seconds): whole peak buckets, whole 100 ms loudness blocks
const LANES = 4 // segments decoding at once

export interface Analysis {
  base: Int16Array // [min, max] pairs, one per PEAK_SPP samples, valid where ready() has resolved
  ready(from: number, to: number): Promise<void> // seconds
  lufs: Promise<number | null> // integrated loudness as heard (mono counts on both channels)
}

/** Analyze the whole file, LANES segments at a time, in time order. */
export function analyze(f: AudioFile, seg = SEG): Analysis {
  const total = Math.ceil(f.duration * SR)
  const base = new Int16Array(2 * Math.ceil(total / PEAK_SPP))
  const segs: Promise<number[]>[] = []
  for (let a = 0; a < total; a += seg) {
    const b = Math.min(total, a + seg)
    segs.push((segs[segs.length - LANES] ?? Promise.resolve()).then(() => segment(f, a, b, base)))
  }
  const lufs = Promise.all(segs).then((blocks) => integratedLoudness(blocks.flat()))
  lufs.catch(() => {}) // callers see the error through ready() or lufs
  const ready = async (from: number, to: number) => void (await Promise.all(segs.slice(Math.max(0, Math.floor((from * SR) / seg)), Math.ceil((to * SR) / seg))))
  return { base, ready, lufs }
}

/** Peaks of output samples [a, b) into `base`; returns their 100 ms loudness blocks. */
async function segment(f: AudioFile, a: number, b: number, base: Int16Array): Promise<number[]> {
  const r = new Reader(f)
  const meter = new LoudnessMeter()
  const STEP = PEAK_SPP * 750 // 4 s
  try {
    for (let pos = a; pos < b; pos += STEP) {
      const n = Math.min(STEP, b - pos)
      const chs = await r.read(pos, n)
      meter.push(chs.slice(0, 2), n, chs.length === 1 ? 2 : 1)
      for (let i = 0; i < n; i += PEAK_SPP) {
        let lo = 0
        let hi = 0
        for (const ch of chs) {
          for (let j = i, e = Math.min(i + PEAK_SPP, n); j < e; j++) {
            const v = ch[j]
            if (v < lo) lo = v
            if (v > hi) hi = v
          }
        }
        const k = 2 * ((pos + i) / PEAK_SPP)
        base[k] = q16(lo)
        base[k + 1] = q16(hi)
      }
    }
  } finally {
    r.close()
  }
  return meter.blocks
}

const q16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)))

/** Min/max pairs for `buckets` equal slices of [from, to) seconds, exact to the 5.3 ms bucket. A
 *  linear scan: all of a 2-hour track is 1.35M pairs, about a millisecond. */
export function queryPeaks(base: Int16Array, from: number, to: number, buckets: number): Float32Array {
  const out = new Float32Array(2 * buckets)
  const count = base.length / 2
  const span = ((to - from) * SR) / PEAK_SPP / buckets
  for (let k = 0; k < buckets; k++) {
    let i = Math.max(0, Math.floor((from * SR) / PEAK_SPP + k * span))
    const e = Math.min(count, Math.max(i + 1, Math.ceil((from * SR) / PEAK_SPP + (k + 1) * span)))
    let lo = 0
    let hi = 0
    for (; i < e; i++) {
      if (base[2 * i] < lo) lo = base[2 * i]
      if (base[2 * i + 1] > hi) hi = base[2 * i + 1]
    }
    out[2 * k] = lo / 32767
    out[2 * k + 1] = hi / 32767
  }
  return out
}

/** Exact min/max per bucket straight from decoded samples, for zoom levels finer than the base. */
export async function rawPeaks(f: AudioFile, from: number, to: number, buckets: number): Promise<Float32Array> {
  const out = new Float32Array(2 * buckets)
  const a = Math.round(from * SR)
  const n = Math.max(1, Math.round(to * SR) - a)
  const r = new Reader(f)
  try {
    const chs = await r.read(a, n)
    for (let k = 0; k < buckets; k++) {
      const s = Math.floor((k * n) / buckets)
      const e = Math.max(s + 1, Math.floor(((k + 1) * n) / buckets))
      let lo = 0
      let hi = 0
      for (const ch of chs) {
        for (let j = s; j < e && j < n; j++) {
          if (ch[j] < lo) lo = ch[j]
          if (ch[j] > hi) hi = ch[j]
        }
      }
      out[2 * k] = lo
      out[2 * k + 1] = hi
    }
  } finally {
    r.close()
  }
  return out
}

// ---- Cache file: <bundle>/cache/<source path with / as _>.<bytes>.analysis ----
// 'SPK1', f64 lufs (NaN = silent), u32 bucket count, then int16 [min, max] pairs.

export function encodeAnalysis(base: Int16Array, lufs: number | null): ArrayBuffer {
  const buf = new ArrayBuffer(16 + base.byteLength)
  const v = new DataView(buf)
  v.setUint32(0, 0x53504b31)
  v.setFloat64(4, lufs ?? NaN, true)
  v.setUint32(12, base.length / 2, true)
  new Int16Array(buf, 16).set(base)
  return buf
}

export function decodeAnalysis(buf: ArrayBuffer): Analysis | null {
  if (buf.byteLength < 16) return null
  const v = new DataView(buf)
  const n = v.getUint32(12, true)
  if (v.getUint32(0) !== 0x53504b31 || buf.byteLength !== 16 + 4 * n) return null
  const lufs = v.getFloat64(4, true)
  return { base: new Int16Array(buf.slice(16)), ready: async () => {}, lufs: Promise.resolve(Number.isNaN(lufs) ? null : lufs) }
}

/** Where the analysis of `path` (absolute) is cached, or null when it is not inside a .studio bundle. */
export function cachePath(path: string, size: number): string | null {
  const m = /^(.*\.studio)\/(.+)$/.exec(path)
  return m ? `${m[1]}/cache/${m[2].replaceAll('/', '_')}.${size}.analysis` : null
}
