// Owner: audio. One audio graph for preview and export (parity): mic + system + music, per-clip
// volume, pitch-preserving time-stretch for speed changes, voice chain (noise reduction ->
// loudness normalization -> limiter), click sounds. Everything in output time via the time map.
// The graph is ./mix.ts; it runs in a worker (./worker.ts). This module is the main-thread API.

import type { Project } from '../../shared/project.ts'
import type { Prepared } from '../scene.ts'
import { SR } from './dsp.ts'
import { planOf, type Plan } from './mix.ts'
import type { Request } from './worker.ts'

export { SR, scrubGrain } from './dsp.ts'
export { planOf, type Plan } from './mix.ts'

/** Promise RPC over one lazily started worker. */
class Rpc {
  private w: Worker | null = null
  private id = 0
  private pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>()

  call<T>(req: Request): Promise<T> {
    if (!this.w) {
      this.w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.w.onmessage = ({ data }) => {
        const p = this.pending.get(data.id)
        this.pending.delete(data.id)
        if ('error' in data) p?.reject(new Error(data.error))
        else p?.resolve(data.value)
      }
      this.w.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new Error(`Audio engine crashed: ${e.message}`))
        this.pending.clear()
        this.w = null
      }
    }
    const id = ++this.id
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.w!.postMessage({ ...req, id })
    })
  }
}
const mixing = new Rpc() // real-time mixing only, never blocked by analysis
const analysis = new Rpc()

/** Render output samples [start, start+frames) of `plan` in mixing session `session`. Sequential
 *  calls in one session continue seamlessly; a jump primes the graph with a pre-roll. */
export function mix(session: string, plan: Plan, start: number, frames: number): Promise<[Float32Array, Float32Array]> {
  return mixing.call({ op: 'render', session, plan, start, frames })
}

/** Linear gain that brings the voice at `url` to about -16 LUFS. Measured once, cached in the bundle. */
const gains = new Map<string, Promise<number>>()
export function voiceGain(url: string): Promise<number> {
  let g = gains.get(url)
  if (!g) {
    gains.set(url, (g = analysis.call<number>({ op: 'gain', url })))
    g.catch(() => gains.delete(url))
  }
  return g
}

/** Loudness gains for the project's enhanced mic, keyed by url, for planOf(). */
export async function voiceGains(project: Project, bundle: string): Promise<Map<string, number>> {
  const urls = planOf(project, [], bundle).tracks.filter((t) => t.voice).map((t) => t.url)
  return new Map(await Promise.all(urls.map(async (u) => [u, await voiceGain(u)] as const)))
}

const exports_ = new WeakMap<Prepared, Promise<{ plan: Plan; session: string }>>()
let exportId = 0

/** Render output-time audio [from, to) as 48 kHz stereo, for export. Memory stays flat: callers
 *  ask for chunks of a few seconds at a time. Consecutive chunks of one Prepared continue the same
 *  graph, so they join without a seam; the length is exactly round(to*48000) - round(from*48000). */
export async function renderAudio(p: Prepared, bundle: string, from: number, to: number): Promise<AudioBuffer> {
  let e = exports_.get(p)
  if (!e) {
    e = voiceGains(p.input.project, bundle).then((g) => ({ plan: planOf(p.input.project, p.input.events, bundle, g), session: `export-${++exportId}` }))
    exports_.set(p, e)
    e.catch(() => exports_.delete(p))
  }
  const { plan, session } = await e
  const a = Math.round(from * SR)
  const b = Math.round(to * SR)
  if (!(b >= a)) throw new RangeError(`renderAudio: empty or reversed range ${from}..${to}`)
  const [L, R] = b > a ? await mix(session, plan, a, b - a) : [new Float32Array(1), new Float32Array(1)]
  const buf = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: 2, sampleRate: SR })
  buf.copyToChannel(L as Float32Array<ArrayBuffer>, 0)
  buf.copyToChannel(R as Float32Array<ArrayBuffer>, 1)
  return buf
}

/** Min/max peaks of a source audio file between source times [from, to), `buckets` pairs.
 *  Lazy and cached, so hours-long tracks render without stalling. */
export function peaks(url: string, from: number, to: number, buckets: number): Promise<Float32Array> {
  return analysis.call({ op: 'peaks', url, from, to, buckets: Math.max(1, Math.floor(buckets)) })
}
