// Audio DSP building blocks for the mixer (./mix.ts): time stretch, noise reduction, true-peak
// limiter, loudness meter, resampling, click sound. Plain JS plus two small WASM cores and no Web
// Audio, so the same code runs in the audio worker (preview and export) and in node tests.

export const SR = 48000

// ---- Time stretch: Signalsmith Stretch (MIT, signalsmith-stretch on npm) ----
// The package wraps its WASM core in an AudioWorkletProcessor. The mixer runs in a worker (one code
// path for preview and export) and in node tests, so we import the package under a minimal
// worklet-scope shim, keep the processor class it registers, and drive each instance's WASM directly.

interface StretchWasm {
  _presetDefault(channels: number, sampleRate: number): void
  _setBuffers(channels: number, length: number): number
  _inputLatency(): number
  _outputLatency(): number
  _reset(): void
  _seek(inputSamples: number, rate: number): void
  _process(inputSamples: number, outputSamples: number): void
  exports?: { memory: WebAssembly.Memory }
  HEAP8?: Int8Array
}
type StretchProcessor = new (options: object) => { ready: Promise<void>; wasmModule: StretchWasm }

let stretchClass: Promise<StretchProcessor> | undefined
function stretchProcessor(): Promise<StretchProcessor> {
  return (stretchClass ??= (async () => {
    const g = globalThis as any
    const prev = [g.AudioWorkletProcessor, g.registerProcessor]
    let cls: StretchProcessor | undefined
    g.AudioWorkletProcessor = class {
      port: { postMessage(m: unknown): void; onmessage: unknown } = { postMessage() {}, onmessage: null }
      // The processor posts ['ready', ...] once its WASM is instantiated and configured.
      ready = new Promise<void>((resolve) => (this.port.postMessage = (m) => Array.isArray(m) && m[0] === 'ready' && resolve()))
    }
    g.registerProcessor = (_name: string, c: StretchProcessor) => (cls = c)
    g.sampleRate ??= SR // read by the processor when it configures itself
    try {
      // @ts-expect-error untyped package
      await import('signalsmith-stretch')
    } finally {
      ;[g.AudioWorkletProcessor, g.registerProcessor] = prev
    }
    if (!cls) throw new Error('The time-stretch engine failed to load')
    return cls
  })())
}

const STRETCH_BUF = 16384 // max samples per channel per seek/process call

/** Pitch-preserving time stretch. Output sample k lines up with input sample Q + k*rate when the
 *  stretcher was seeked with the input just before Q + inLat + outLat*rate (see mix.ts). */
export class Stretcher {
  readonly channels: number
  readonly inLat: number
  readonly outLat: number
  private w: StretchWasm
  private ptr: number

  static async create(channels: number): Promise<Stretcher> {
    const Processor = await stretchProcessor()
    const p = new Processor({ numberOfOutputs: 1, outputChannelCount: [channels] })
    await p.ready
    return new Stretcher(p.wasmModule, channels)
  }

  private constructor(w: StretchWasm, channels: number) {
    this.w = w
    this.channels = channels
    w._presetDefault(channels, SR)
    this.ptr = w._setBuffers(channels, STRETCH_BUF)
    this.inLat = w._inputLatency()
    this.outLat = w._outputLatency()
  }

  private heap(): Float32Array {
    return new Float32Array((this.w.exports?.memory.buffer ?? this.w.HEAP8!.buffer) as ArrayBuffer)
  }

  /** Jump to a new input position: `input` holds the samples just before the next input.
   *  Only a fresh instance is deterministic (reset keeps random state), so seek once per instance. */
  seek(input: Float32Array[], rate: number) {
    const n = input[0].length
    if (n > STRETCH_BUF) throw new RangeError('stretch seek window too long')
    const h = this.heap()
    for (let c = 0; c < this.channels; c++) h.set(input[c], (this.ptr >> 2) + c * STRETCH_BUF)
    this.w._seek(n, rate)
  }

  /** Consume input[c][0..nIn) and write nOut samples to out[c][at..at+nOut). */
  process(input: Float32Array[], nIn: number, out: Float32Array[], at: number, nOut: number) {
    if (nIn > STRETCH_BUF || nOut > STRETCH_BUF) throw new RangeError('stretch block too long')
    let h = this.heap()
    const base = this.ptr >> 2
    for (let c = 0; c < this.channels; c++) h.set(input[c].subarray(0, nIn), base + c * STRETCH_BUF)
    this.w._process(nIn, nOut)
    h = this.heap()
    for (let c = 0; c < this.channels; c++) {
      const o = base + (this.channels + c) * STRETCH_BUF
      out[c].set(h.subarray(o, o + nOut), at)
    }
  }
}

// ---- Noise reduction: RNNoise (BSD-3) ----
// The standalone WASM build shipped by @sapphi-red/web-noise-suppressor (MIT). It needs only three
// trivial imports, so we instantiate it directly instead of loading its worklet glue.

export const DENOISE_FRAME = 480 // RNNoise works on 10 ms frames at 48 kHz
export const DENOISE_LATENCY = 480 // output frame k is input frame k-1

interface RnnoiseExports {
  memory: WebAssembly.Memory
  __wasm_call_ctors(): void
  rnnoise_create(model: number): number
  rnnoise_destroy(state: number): void
  rnnoise_process_frame(state: number, out: number, input: number): number
  malloc(n: number): number
}

export class Denoiser {
  private x: RnnoiseExports
  private states: number[]
  private inp: number
  private out: number

  static async create(module: WebAssembly.Module, channels: number): Promise<Denoiser> {
    let mem: WebAssembly.Memory | undefined
    const instance = await WebAssembly.instantiate(module, {
      env: {
        emscripten_memcpy_big: (d: number, s: number, n: number) => {
          new Uint8Array(mem!.buffer).copyWithin(d, s, s + n)
          return d // an i32 result: returning the array would stringify all of memory per call
        },
        emscripten_resize_heap: (size: number) => {
          try {
            mem!.grow(Math.ceil((size - mem!.buffer.byteLength) / 65536))
            return 1
          } catch {
            return 0
          }
        },
        __assert_fail: () => {
          throw new Error('noise reduction failed')
        },
      },
    })
    const x = instance.exports as unknown as RnnoiseExports
    mem = x.memory
    x.__wasm_call_ctors()
    return new Denoiser(x, channels)
  }

  private constructor(x: RnnoiseExports, channels: number) {
    this.x = x
    this.states = Array.from({ length: channels }, () => x.rnnoise_create(0))
    this.inp = x.malloc(DENOISE_FRAME * 4)
    this.out = x.malloc(DENOISE_FRAME * 4)
  }

  /** Forget all history (after a jump). */
  reset() {
    this.states = this.states.map((s) => (this.x.rnnoise_destroy(s), this.x.rnnoise_create(0)))
  }

  /** Denoise one frame per channel in place (floats in -1..1). */
  frame(chs: Float32Array[]) {
    const pi = this.inp >> 2
    const po = this.out >> 2
    chs.forEach((ch, c) => {
      const h = new Float32Array(this.x.memory.buffer)
      for (let i = 0; i < DENOISE_FRAME; i++) h[pi + i] = ch[i] * 32768 // RNNoise expects 16-bit scale
      this.x.rnnoise_process_frame(this.states[c], this.out, this.inp)
      const o = new Float32Array(this.x.memory.buffer)
      for (let i = 0; i < DENOISE_FRAME; i++) ch[i] = o[po + i] / 32768
    })
  }
}

// ---- Windowed-sinc interpolation (resampling and true-peak detection) ----

const PHASES = 256

/** Kernel table for interpolation with `half` taps per side and cutoff `fc` (1 = input Nyquist). */
export function sincTable(half: number, fc: number): Float32Array {
  const taps = 2 * half
  const t = new Float32Array((PHASES + 1) * taps)
  for (let ph = 0; ph <= PHASES; ph++) {
    const frac = ph / PHASES
    for (let j = 0; j < taps; j++) {
      const d = j - (half - 1) - frac // tap distance from the interpolated point
      const x = Math.PI * fc * d
      const sinc = d === 0 ? 1 : Math.sin(x) / x
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half) // Blackman
      t[ph * taps + j] = fc * sinc * (Math.abs(d) < half ? w : 0)
    }
  }
  return t
}

/** Value of `buf` at fractional index `pos`; needs buf[floor(pos)-half+1 .. floor(pos)+half]. */
export function interpolate(buf: Float32Array, pos: number, table: Float32Array, half: number): number {
  const i0 = Math.floor(pos)
  const fp = (pos - i0) * PHASES
  const ph = Math.floor(fp)
  const a = fp - ph
  const taps = 2 * half
  const k0 = ph * taps
  const k1 = k0 + taps
  let s = 0
  for (let j = 0, b = i0 - half + 1; j < taps; j++, b++) s += buf[b] * (table[k0 + j] + a * (table[k1 + j] - table[k0 + j]))
  return s
}

// ---- True-peak brickwall limiter ----
// Gain is the min of the required gain over a 5 ms look-ahead, released over 80 ms, then smoothed
// with a 5 ms moving average. Every gain in that average is <= the gain the peak needs, so the
// output never exceeds the ceiling, including inter-sample peaks (4x oversampled detection).

const LOOK = 240 // 5 ms
const TP_HALF = 4 // 8-tap interpolator for inter-sample peaks
const TP_TABLE = sincTable(TP_HALF, 1)
const TP = [1, 2, 3].map((q) => TP_TABLE.subarray(q * 64 * 2 * TP_HALF, (q * 64 + 1) * 2 * TP_HALF)) // phases 1/4, 1/2, 3/4
const RELEASE = 1 - Math.exp(-1 / (0.08 * SR))
export const CEILING = 10 ** (-1 / 20) // -1 dBTP

export class Limiter {
  static readonly latency = LOOK + TP_HALF - 1
  private hist = [new Float32Array(2 * TP_HALF), new Float32Array(2 * TP_HALF)] // last 8 inputs
  private delay = [new Float32Array(Limiter.latency + 1), new Float32Array(Limiter.latency + 1)]
  private di = 0
  private dqI = new Int32Array(LOOK + 1) // monotonic deque for the sliding min (indices into time)
  private dqV = new Float32Array(LOOK + 1)
  private dqHead = 0
  private dqLen = 0
  private box = new Float32Array(LOOK).fill(1)
  private bi = 0
  private sum = LOOK
  private env = 1
  private k = 0 // samples seen

  reset() {
    Object.assign(this, new Limiter())
  }

  /** Limit stereo audio in place. Output is delayed by Limiter.latency samples. */
  process(L: Float32Array, R: Float32Array, n = L.length) {
    const io = [L, R]
    for (let i = 0; i < n; i++) {
      // 1. peak of the interval just before the newest input, including inter-sample peaks
      let peak = 0
      for (let c = 0; c < 2; c++) {
        const h = this.hist[c]
        h.copyWithin(0, 1)
        h[2 * TP_HALF - 1] = io[c][i]
        peak = Math.max(peak, Math.abs(h[TP_HALF - 1]))
        for (const k of TP) {
          let s = 0
          for (let j = 0; j < 2 * TP_HALF; j++) s += h[j] * k[j]
          peak = Math.max(peak, Math.abs(s))
        }
      }
      const need = peak > CEILING ? CEILING / peak : 1
      // 2. sliding min of the needed gain over the look-ahead window
      const t = this.k++
      while (this.dqLen && this.dqV[(this.dqHead + this.dqLen - 1) % (LOOK + 1)] >= need) this.dqLen--
      const tail = (this.dqHead + this.dqLen) % (LOOK + 1)
      this.dqI[tail] = t
      this.dqV[tail] = need
      this.dqLen++
      if (this.dqI[this.dqHead] <= t - LOOK) {
        this.dqHead = (this.dqHead + 1) % (LOOK + 1)
        this.dqLen--
      }
      const min = this.dqV[this.dqHead]
      // 3. instant attack, smooth release, then a moving average for a click-free gain curve
      this.env = min < this.env ? min : this.env + (min - this.env) * RELEASE
      this.sum += this.env - this.box[this.bi]
      this.box[this.bi] = this.env
      this.bi = (this.bi + 1) % LOOK
      if (this.bi === 0) this.sum = this.box.reduce((a, b) => a + b, 0) // no float drift over hours
      const g = Math.min(1, this.sum / LOOK)
      // 4. apply to the delayed input the gain was computed for
      for (let c = 0; c < 2; c++) {
        const d = this.delay[c]
        d[this.di] = io[c][i]
        const y = d[(this.di + 1) % d.length] * g
        io[c][i] = y > CEILING ? CEILING : y < -CEILING ? -CEILING : y
      }
      this.di = (this.di + 1) % this.delay[0].length
    }
  }
}

// ---- Loudness: ITU-R BS.1770-4 integrated loudness (LUFS) of 48 kHz audio ----

// K-weighting: a high shelf (b0 b1 b2 / 1 a1 a2), then the RLB high-pass (1 -2 1 / 1 c1 c2).
const B0 = 1.53512485958697, B1 = -2.69169618940638, B2 = 1.19839281085285, A1 = -1.69065929318241, A2 = 0.73248077421585
const C1 = -1.99004745483398, C2 = 0.99007225036621
const BLOCK_LEN = SR / 10

export class LoudnessMeter {
  /** Channel-summed mean square of each complete 100 ms of input. Blocks of consecutive meters concatenate. */
  readonly blocks: number[] = []
  private z: Float64Array[] = [] // per channel: x1 x2 (input), y1 y2 (shelf out), v1 v2 (high-pass out)
  private acc = 0
  private n = 0

  /** Push audio as it will be heard. `weight` 2 counts a mono source played on both channels. */
  push(chs: Float32Array[], len = chs[0].length, weight = 1) {
    while (this.z.length < chs.length) this.z.push(new Float64Array(6))
    for (let i = 0; i < len; ) {
      const e = Math.min(len, i + BLOCK_LEN - this.n)
      for (let c = 0; c < chs.length; c++) {
        const x = chs[c]
        const z = this.z[c]
        let x1 = z[0], x2 = z[1], y1 = z[2], y2 = z[3], v1 = z[4], v2 = z[5], acc = 0
        for (let j = i; j < e; j++) {
          const x0 = x[j]
          const y = B0 * x0 + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2
          const v = y - 2 * y1 + y2 - C1 * v1 - C2 * v2
          x2 = x1, x1 = x0, y2 = y1, y1 = y, v2 = v1, v1 = v
          acc += v * v
        }
        z[0] = x1, z[1] = x2, z[2] = y1, z[3] = y2, z[4] = v1, z[5] = v2
        this.acc += acc * weight
      }
      this.n += e - i
      i = e
      if (this.n === BLOCK_LEN) {
        this.blocks.push(this.acc / BLOCK_LEN)
        this.acc = 0
        this.n = 0
      }
    }
  }

  /** Integrated loudness in LUFS, or null for silence. */
  integrated(): number | null {
    return integratedLoudness(this.blocks)
  }
}

/** BS.1770 gated loudness of 100 ms mean-square blocks (400 ms windows, 75% overlap). */
export function integratedLoudness(sub: number[]): number | null {
  const blocks: number[] = []
  for (let i = 3; i < sub.length; i++) blocks.push((sub[i - 3] + sub[i - 2] + sub[i - 1] + sub[i]) / 4)
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p)
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
  const abs = blocks.filter((p) => lufs(p) > -70)
  if (!abs.length) return null
  const rel = lufs(mean(abs)) - 10
  return lufs(mean(abs.filter((p) => lufs(p) > rel)))
}

/** Static gain that brings speech measured at `lufs` to -16 LUFS, within sane bounds. */
export function voiceGain(lufs: number | null): number {
  return lufs === null ? 1 : 10 ** (Math.min(24, Math.max(-20, -16 - lufs)) / 20)
}

// ---- Click sound: our own, synthesized (no asset) ----

let click: Float32Array | undefined
/** A short, soft mechanical click, mono, peak 0.25. */
export function clickSound(): Float32Array {
  if (click) return click
  const n = Math.round(0.035 * SR)
  const out = new Float32Array(n)
  let seed = 12345
  let prev = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    seed = (seed * 1103515245 + 12345) % 2147483648
    const noise = seed / 1073741824 - 1
    const hp = noise - prev // brighten the transient
    prev = noise
    const tick = hp * Math.exp(-t / 0.0006)
    const body = 0.6 * Math.sin(2 * Math.PI * 2300 * t) * Math.exp(-t / 0.004) + 0.35 * Math.sin(2 * Math.PI * 3900 * t) * Math.exp(-t / 0.0025) + 0.25 * Math.sin(2 * Math.PI * 950 * t) * Math.exp(-t / 0.008)
    out[i] = 0.5 * tick + body * Math.min(1, t / 0.0003)
  }
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  for (let i = 0; i < n; i++) out[i] *= 0.25 / peak
  return (click = out)
}
