// The audio graph on synthetic WAV sources (mediabunny decodes PCM without WebCodecs, so this runs
// in plain node). Decoding of real AAC/H.264/HEVC files runs in Electron: src/engine/media/media.test.ts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BlobSource } from 'mediabunny'
import type { Clip } from '../../shared/project.ts'
import { createProject } from '../../shared/project.ts'
import { timeMap, toOutput } from '../../shared/timemap.ts'
import { CEILING, Limiter, LoudnessMeter, SR, VOICE_LUFS, scrubGrain, sincTable, interpolate, voiceGain } from './dsp.ts'
import { Mixer, planOf, type Env, type Plan } from './mix.ts'
import { analyze, openAudio, queryPeaks, rawPeaks, Reader } from './source.ts'
import type { PlaybackMessage } from './playback.worklet.ts'

const files = new Map<string, Blob>()
const env: Env = { open: (url) => new BlobSource(files.get(url)!) }

/** 32-bit float WAV. */
function wav(chs: Float32Array[], rate = SR): Blob {
  const n = chs[0].length
  const buf = new ArrayBuffer(44 + n * chs.length * 4)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'), v.setUint32(4, 36 + n * chs.length * 4, true), str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true), v.setUint16(20, 3, true), v.setUint16(22, chs.length, true), v.setUint32(24, rate, true)
  v.setUint32(28, rate * chs.length * 4, true), v.setUint16(32, chs.length * 4, true), v.setUint16(34, 32, true)
  str(36, 'data'), v.setUint32(40, n * chs.length * 4, true)
  const f = new Float32Array(buf, 44)
  for (let i = 0; i < n; i++) for (let c = 0; c < chs.length; c++) f[i * chs.length + c] = chs[c][i]
  return new Blob([buf])
}

const tone = (seconds: number, hz: number, amp: number, rate = SR) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))
/** Silence with 50 ms 1 kHz bursts at the given seconds. */
function bursts(seconds: number, at: number[], rate = SR) {
  const x = new Float32Array(Math.round(seconds * rate))
  for (const t of at) for (let i = 0; i < 0.05 * rate; i++) x[Math.round(t * rate) + i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate) * Math.sin((Math.PI * i) / (0.05 * rate))
  return x
}
/** Centers of energy bursts (seconds), from a 10 ms RMS envelope. */
function onsets(x: Float32Array) {
  const out: number[] = []
  const w = 480
  let start = -1
  for (let i = 0; i + w <= x.length; i += 48) {
    let e = 0
    for (let j = i; j < i + w; j++) e += x[j] * x[j]
    const on = Math.sqrt(e / w) > 0.05
    if (on && start < 0) start = i
    if (!on && start >= 0) {
      out.push((start + i + w) / 2 / SR)
      start = -1
    }
  }
  return out
}
const clip = (start: number, end: number, speed = 1, volume = 1): Clip => ({ id: `${start}`, start, end, speed, volume })
const plan = (clips: Clip[], tracks: Plan['tracks'], extra: Partial<Plan> = {}): Plan => ({
  duration: clips.reduce((d, c) => d + (c.end - c.start) / c.speed, 0),
  clips,
  tracks,
  music: null,
  clicks: [],
  ...extra,
})
async function render(p: Plan, start = 0, n = Math.round(p.duration * SR), chunk = n) {
  const m = new Mixer(env)
  m.setPlan(p)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  for (let o = 0; o < n; o += chunk) {
    const [l, r] = await m.render(start + o, Math.min(chunk, n - o))
    L.set(l, o)
    R.set(r, o)
  }
  m.dispose()
  return [L, R]
}
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (±${tol})`)
/** Pitch (Hz) by autocorrelation in [lo, hi] Hz. */
function pitch(x: Float32Array, from: number, lo = 300, hi = 600) {
  let best = -Infinity
  let lag = 0
  for (let l = Math.floor(SR / hi); l <= Math.ceil(SR / lo); l++) {
    let c = 0
    for (let i = from; i < from + 4800; i++) c += x[i] * x[i + l]
    if (c > best) (best = c), (lag = l)
  }
  return SR / lag
}

files.set('marks', wav([bursts(6, [0.5, 1.5, 2.5, 3.5, 4.5])]))
const marks = { url: 'marks', label: 'marks.wav', volume: 1 }

test('output stays in sync with the time map through cuts and speed changes', async () => {
  // source 0-1 at 1x, cut 1-2, 2-3 at 1x, 3-5 at 2x (stretched), output 3 s
  const p = plan([clip(0, 1), clip(2, 3), clip(3, 5, 2)], [marks])
  const [L, R] = await render(p)
  assert.equal(L.length, 3 * SR)
  const got = onsets(L)
  // burst centers at source 0.525, 2.525, 3.525, 4.525 -> 0.525, 1.525, 2 + 0.525/2, 2 + 1.525/2
  const want = [0.525, 1.525, 2.2625, 2.7625]
  assert.equal(got.length, want.length, `onsets ${got}`)
  got.forEach((t, i) => near(t, want[i], 0.002, 'burst center'))
  assert.deepEqual(L, R, 'a mono source plays centered on both channels')
})

test('hundreds of cuts and speed changes stay in sync to the millisecond', async () => {
  // 100 bursts, one every 0.5 s. Each lives in a clip with its own speed; between bursts the source
  // is cut or split into more clips at other speeds: 300 clips, 100 cuts.
  const at = Array.from({ length: 100 }, (_, i) => 0.25 + i * 0.5)
  files.set('many', wav([bursts(51, at)]))
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const clips: Clip[] = []
  for (const t of at) {
    clips.push(clip(t - 0.1, t + 0.1, [1, 1.25, 1.5, 2, 2.5][Math.floor(rnd() * 5)]))
    clips.push(clip(t + 0.1, t + 0.15, 1 + rnd()))
    clips.push(clip(t + 0.15 + rnd() * 0.1, t + 0.4, 1 + rnd() * 2)) // the gap before it is cut
  }
  const p = plan(clips, [{ url: 'many', label: 'many.wav', volume: 1 }])
  const [L] = await render(p, 0, Math.round(p.duration * SR), 9600)
  const got = onsets(L)
  assert.equal(got.length, at.length)
  const m = timeMap(clips)
  got.forEach((t, i) => near(t, toOutput(m, at[i] + 0.025)!, 0.002, `burst ${i}`))
})

test('a 2x clip renders half the duration at the same pitch', async () => {
  files.set('tone', wav([tone(4, 440, 0.3)]))
  const p = plan([clip(0, 4, 2)], [{ url: 'tone', label: 'tone.wav', volume: 1 }])
  assert.equal(p.duration, 2)
  const [L] = await render(p)
  assert.equal(L.length, 2 * SR)
  near(pitch(L, SR / 2), 440, 3, 'pitch')
  let peak = 0
  for (let i = SR / 2; i < SR * 1.5; i++) peak = Math.max(peak, Math.abs(L[i]))
  near(peak, 0.3, 0.03, 'level')
})

test('chunked rendering is identical to one pass, and a jump primes without clicks', async () => {
  const p = plan([clip(0, 1), clip(2, 3), clip(3, 5, 1.5)], [marks])
  const [whole] = await render(p)
  const [chunked] = await render(p, 0, whole.length, 1237)
  assert.ok(chunked.every((v, i) => v === whole[i]), 'bit-identical')
  // Start cold in the middle of the stretched part: matches the continuous render after pre-roll.
  const at = Math.round(2.4 * SR)
  const [cold] = await render(p, at, SR / 2)
  let diff = 0
  for (let i = 0; i < cold.length; i++) diff = Math.max(diff, Math.abs(cold[i] - whole[at + i]))
  assert.ok(diff < 0.02, `jump differs by ${diff}`)
})

test('cuts crossfade instead of clicking', async () => {
  files.set('dc', wav([new Float32Array(3 * SR).fill(0.5).map((v, i) => (i < SR ? v : -v))]))
  // Splice +0.5 straight into -0.5: the step must be a 10 ms ramp, not a jump.
  const [L] = await render(plan([clip(0, 0.5), clip(2, 2.5)], [{ url: 'dc', label: 'dc.wav', volume: 1 }]))
  let maxStep = 0
  for (let i = SR / 4; i < (3 * SR) / 4; i++) maxStep = Math.max(maxStep, Math.abs(L[i] - L[i - 1]))
  assert.ok(maxStep < 0.01, `largest sample step at the cut ${maxStep}`)
  near(L[SR / 2 - 300], 0.5, 1e-6)
  near(L[SR / 2 + 300], -0.5, 1e-6)
})

test('clip volume and mute apply with ramps; muted clips are silent', async () => {
  const c = [clip(0, 1), { ...clip(1, 2), volume: 0.5 }, { ...clip(2, 3), muted: true }]
  files.set('dc1', wav([new Float32Array(3 * SR).fill(0.4)]))
  const [L] = await render(plan(c, [{ url: 'dc1', label: 'dc1.wav', volume: 1 }]))
  near(L[SR / 2], 0.4, 1e-6)
  near(L[SR + SR / 2], 0.2, 1e-6)
  near(L[2 * SR + SR / 2], 0, 1e-6)
})

test('clip volume drives the mic, systemVolume the system audio', async () => {
  const c = [{ ...clip(0, 1), volume: 0.5 }, { ...clip(1, 2), systemVolume: 0 }, { ...clip(2, 3), volume: 0, systemVolume: 2, muted: true }]
  const mic = { url: 'dc1', label: 'dc1.wav', volume: 1 }
  const [L] = await render(plan(c, [mic]))
  const [S] = await render(plan(c, [{ ...mic, system: true }]))
  near(L[SR / 2], 0.2, 1e-6)
  near(S[SR / 2], 0.4, 1e-6)
  near(L[SR + SR / 2], 0.4, 1e-6)
  near(S[SR + SR / 2], 0, 1e-6)
  near(S[2 * SR + SR / 2], 0, 1e-6) // muted silences both
})

test('the limiter holds the true-peak ceiling', async () => {
  files.set('loud', wav([tone(1, 3000, 0.9), tone(1, 3000, 0.9)]))
  const t = { url: 'loud', label: 'loud.wav', volume: 2 }
  const [L, R] = await render(plan([clip(0, 1)], [t, t]))
  const table = sincTable(16, 1)
  let tp = 0
  for (const x of [L, R]) for (let i = 64; i < x.length - 64; i++) for (const f of [0, 0.25, 0.5, 0.75]) tp = Math.max(tp, Math.abs(f ? interpolate(x, i + f, table, 16) : x[i]))
  assert.ok(tp <= CEILING * 1.01, `true peak ${tp}`)
  assert.ok(tp > CEILING * 0.9, 'limits, does not mute')
  const lim = new Limiter()
  const a = Float32Array.from({ length: 4800 }, () => Math.random() * 8 - 4)
  const b = a.slice()
  lim.process(a, b)
  assert.ok(a.every((v) => Math.abs(v) <= CEILING))
})

const rms = (a: Float32Array, s: number, e: number) => Math.sqrt(a.subarray(s, e).reduce((acc, v) => acc + v * v, 0) / (e - s))
/** A harmonic "voice" at 160 Hz, peak about 3. */
function voiced(i: number) {
  let v = 0
  for (let h = 1; h < 12; h++) v += Math.sin((2 * Math.PI * 160 * h * i) / SR) / h
  return v
}

test('music made to loop plays straight through its seams', async () => {
  // 1 s of 440 Hz is exactly 440 periods: looped, it is one continuous sine. At 44.1 kHz it is resampled.
  for (const rate of [SR, 44100]) {
    files.set(`loop${rate}`, wav([tone(1, 440, 0.2, rate)], rate))
    const [L] = await render(plan([clip(0, 6)], [], { music: { url: `loop${rate}`, label: 'loop.wav', volume: 1 } }))
    let err = 0
    for (let i = 0.5 * SR; i < 3.5 * SR; i++) err = Math.max(err, Math.abs(L[i] - 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR)))
    assert.ok(err < 1e-3, `${rate} Hz: largest deviation from the continuous sine across the seams at 1, 2, 3 s: ${err}`)
  }
})

test('loudness meter matches BS.1770 on a reference sine', () => {
  const m = new LoudnessMeter()
  const s = tone(5, 997, 0.1)
  m.push([s, s])
  near(m.integrated()!, -20, 0.1, 'LUFS')
  assert.equal(new LoudnessMeter().integrated(), null)
})

test('click sounds land at their output times; music loops and fades out', async () => {
  files.set('music', wav([tone(0.3, 220, 0.2), tone(0.3, 220, 0.2)]))
  const p = plan([clip(0, 3)], [], { clicks: [0.5, 1.25], music: { url: 'music', label: 'music.wav', volume: 1 } })
  const [L] = await render(p)
  const rms = (s: number, e: number) => Math.sqrt(L.subarray(s * SR, e * SR).reduce((a, v) => a + v * v, 0) / ((e - s) * SR))
  near(rms(0.6, 1.2), 0.2 / Math.SQRT2, 0.01, 'music still playing after its first loop')
  assert.ok(rms(2.95, 2.999) < 0.01, 'music fades out at the end')
  const only = (await render(plan([clip(0, 3)], [], { clicks: [0.5, 1.25] })))[0]
  const peakAt = (from: number, to: number) => {
    let k = from * SR
    for (let i = from * SR; i < to * SR; i++) if (Math.abs(only[i]) > Math.abs(only[k])) k = i
    return k / SR
  }
  near(peakAt(0.3, 1), 0.5, 0.005, 'click')
  near(peakAt(1, 2), 1.25, 0.005, 'click')
})

test('planOf maps clicks through cuts and leaves muted tracks out', () => {
  const p = createProject('t', { duration: 10, mic: { file: 'sources/mic.m4a', channels: 1, sampleRate: SR }, system: { file: 'sources/system.m4a', channels: 2, sampleRate: SR } })
  p.clips = [clip(0, 2), clip(4, 10)]
  p.style.cursor.clickSound = true
  p.audio.system.muted = true
  const plan = planOf(p, [{ t: 1, type: 'down', x: 0, y: 0, button: 'left' }, { t: 3, type: 'down', x: 0, y: 0, button: 'left' }, { t: 5, type: 'down', x: 0, y: 0, button: 'left' }], '/x/A #1.grip')
  assert.deepEqual(plan.clicks, [1, 3]) // 3 s is cut; 5 s plays at 2 + 1
  assert.equal(plan.tracks.length, 1)
  assert.equal(plan.tracks[0].url, 'media://local/' + encodeURIComponent('/x/A #1.grip/sources/mic.m4a'))
})

test('an enhanced mic plays its voice track at -14 LUFS, and the raw mic until the voice pass made it', async () => {
  // A voice track at its natural level (about -38 LUFS): a harmonic voice in 1.5 s phrases.
  const x = Float32Array.from({ length: 12 * SR }, (_, i) => ((i / SR) % 2 < 1.5 ? 0.012 * voiced(i) : 0))
  const natural = new LoudnessMeter()
  natural.push([x], x.length, 2) // a mono track plays on both channels
  const lufs = natural.integrated()!
  const bundle = '/x/Voice #1 ✨.grip'
  const voice = { file: 'sources/mic-voice-1.m4a', chain: 1, lufs }
  const p = createProject('t', { duration: 12, mic: { file: 'sources/mic.m4a', channels: 1, sampleRate: SR, voice } })
  p.audio.mic.volume = 0.5
  const url = (file: string) => 'media://local/' + encodeURIComponent(`${bundle}/${file}`)
  const track = (q: typeof p) => planOf(q, [], bundle).tracks[0]
  assert.equal(track(p).url, url(voice.file))
  near(track(p).volume, 0.5 * voiceGain(lufs), 1e-9, 'track volume times the voice gain')
  // Played: the speech lands on the target (at volume 1).
  p.audio.mic.volume = 1
  files.set(url(voice.file), wav([x]))
  const [L, R] = await render(planOf(p, [], bundle))
  const played = new LoudnessMeter()
  played.push([L, R])
  near(played.integrated()!, VOICE_LUFS, 0.3, 'the voice plays at the target loudness')
  // Enhance off, or no voice track yet: the raw mic at its volume.
  const off = structuredClone(p)
  off.audio.mic.enhance = false
  const pending = structuredClone(p)
  delete pending.sources.mic!.voice
  for (const q of [off, pending]) assert.deepEqual([track(q).url, track(q).volume], [url('sources/mic.m4a'), 1])
  // A take without speech is never boosted; the boost stays within -20..+30 dB.
  assert.equal(voiceGain(null), 1)
  near(20 * Math.log10(voiceGain(-80)), 30, 1e-9, 'boost cap')
  near(20 * Math.log10(voiceGain(10)), -20, 1e-9, 'cut cap')
})

test('a scrub grain plays the crossed audio in one grain, backward when dragging back', () => {
  const ramp = Float32Array.from({ length: 7681 }, (_, i) => i) // 160 ms crossed by a fast drag
  const fwd = scrubGrain(ramp, 3841, false)
  assert.equal(fwd.length, 3841)
  assert.deepEqual([fwd[0], fwd[1], fwd[3840]], [0, 2, 7680]) // twice as fast, ends on the playhead
  const back = scrubGrain(ramp, 3841, true)
  assert.deepEqual([back[0], back[3840]], [7680, 0]) // starts where the drag started, ends on the playhead
  const slow = scrubGrain(ramp.subarray(0, 961), 3841, false) // a slow drag: stretched, pitch drops
  near(slow[1], 0.25, 1e-6, 'quarter speed')
  assert.equal(slow[3840], 960)
})

test('reader resamples 44.1 kHz onto the 48 kHz grid', async () => {
  const f = await openAudio(new BlobSource(wav([tone(2, 1000, 0.5, 44100)], 44100)), 'tone44.wav')
  const r = new Reader(f)
  const x = await r.read(SR / 2, SR / 2)
  r.close()
  let zc = 0
  for (let i = 1; i < x[0].length; i++) if (x[0][i - 1] < 0 && x[0][i] >= 0) zc++
  near(zc, 500, 1, 'zero crossings in 0.5 s of 1 kHz')
  near(Math.max(...x[0]), 0.5, 0.01, 'amplitude')
})

test('peaks: shape, exactness against brute force, any zoom, across parallel segments', async () => {
  const x = bursts(10, [1, 4.2, 9.5])
  const f = await openAudio(new BlobSource(wav([x])), 'p.wav')
  const a = analyze(f, 76800) // 1.6 s segments: ranges below span several, decoded 4 at a time
  await a.ready(9.4, 9.6) // the last segment only; earlier ones may still be decoding
  near(queryPeaks(a.base, 9.4, 9.6, 1)[1], 0.5, 0.01, 'last segment ready on its own')
  await a.ready(0, 10)
  for (const [from, to, buckets] of [[0, 10, 1000], [0, 10, 7], [4, 4.5, 333], [9.4, 9.6, 50]] as const) {
    const pk = queryPeaks(a.base, from, to, buckets)
    assert.equal(pk.length, 2 * buckets)
    for (let k = 0; k < buckets; k++) {
      const s = Math.floor(((from + ((to - from) * k) / buckets) * SR) / 256) * 256
      const e = Math.ceil(((from + ((to - from) * (k + 1)) / buckets) * SR) / 256) * 256
      let hi = 0
      for (let i = s; i < e && i < x.length; i++) hi = Math.max(hi, x[i])
      near(pk[2 * k + 1], hi, 1e-4, `bucket ${k} of ${buckets}`)
      assert.ok(pk[2 * k] <= 0 && pk[2 * k] >= -1)
    }
  }
})

test('preview worklet: a first chunk that arrives late fades in instead of starting mid-wave', async () => {
  const g = globalThis as any
  let Processor: any
  g.AudioWorkletProcessor = class { port = { postMessage() {}, onmessage: null as any } }
  g.registerProcessor = (_name: string, c: unknown) => (Processor = c)
  await import('./playback.worklet.ts')
  const p = new Processor()
  const send = (data: PlaybackMessage) => p.port.onmessage({ data })
  const quantum = (f: number) => {
    g.currentFrame = f
    const out = [new Float32Array(128), new Float32Array(128)]
    p.process([], [out])
    return out[0]
  }
  send({ type: 'run', id: 1, at: 0 })
  for (let f = 0; f < 1280; f += 128) quantum(f) // the first mix is late: 10 quanta with nothing to play
  const dc = new Float32Array(48000).fill(0.5)
  send({ type: 'chunk', run: 1, at: 0, L: dc, R: dc })
  assert.ok(quantum(1280)[0] < 0.01, 'starts from silence')
  assert.equal(quantum(1280 + 256)[0], 0.5, 'then plays at full level, in place')
})
