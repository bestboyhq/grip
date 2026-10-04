// Audio worker: the mixer (preview and export) and source analysis (peaks, loudness), off the main
// thread. ./index.ts runs two of these, so a long analysis never delays real-time mixing.

import rnnoiseUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import { fileLabel as label, fileUrl, urlSource } from '../media/index.ts'
import { SR, voiceGain } from './dsp.ts'
import { Mixer, openFile, type Env, type Plan } from './mix.ts'
import { PEAK_SPP, analyze, cachePath, decodeAnalysis, encodeAnalysis, queryPeaks, rawPeaks, type Analysis } from './source.ts'

export type Request =
  | { op: 'render'; session: string; plan: Plan; start: number; frames: number }
  | { op: 'peaks'; url: string; from: number; to: number; buckets: number }
  | { op: 'gain'; url: string }

let rnnoise: Promise<WebAssembly.Module> | undefined
const env: Env = {
  open: urlSource,
  rnnoise: () => (rnnoise ??= fetch(rnnoiseUrl).then(async (r) => WebAssembly.compile(await r.arrayBuffer()))),
}

// ---- Mixing sessions (the preview player, each export, scrub grains), LRU-bounded ----
const sessions = new Map<string, { mixer: Mixer; queue: Promise<unknown> }>()
function render({ session, plan, start, frames }: Extract<Request, { op: 'render' }>) {
  let s = sessions.get(session)
  if (s) sessions.delete(session)
  else s = { mixer: new Mixer(env), queue: Promise.resolve() }
  sessions.set(session, s)
  for (const [k, old] of sessions) {
    if (sessions.size <= 4) break
    old.queue.finally(() => old.mixer.dispose())
    sessions.delete(k)
  }
  const run = s.queue.then(() => {
    s.mixer.setPlan(plan)
    return s.mixer.render(start, frames)
  })
  s.queue = run.catch(() => {})
  return run
}

// ---- Analysis, cached in <bundle>/cache/ (written through the media: protocol) ----
const analyses = new Map<string, Promise<Analysis>>()
function analysis(url: string): Promise<Analysis> {
  let a = analyses.get(url)
  if (!a) {
    a = (async () => {
      const f = await openFile(env, url, label(url))
      const cache = url.startsWith('media://local/') ? cachePath(decodeURIComponent(url.slice(14)), f.size) : null
      if (cache) {
        const r = await fetch(fileUrl(cache), { cache: 'no-store' }).catch(() => null)
        const hit = r?.ok ? decodeAnalysis(await r.arrayBuffer()) : null
        if (hit) return hit
      }
      const job = analyze(f)
      job.lufs.then(
        (lufs) => void (cache && fetch(fileUrl(cache), { method: 'PUT', body: encodeAnalysis(job.base, lufs) }).catch((e) => console.warn(`Could not cache the waveform of ${f.label}: ${e}`))),
        () => void analyses.delete(url), // a later request retries
      )
      return job
    })()
    a.catch(() => analyses.delete(url))
    analyses.set(url, a)
  }
  return a
}

async function peaks({ url, from, to, buckets }: Extract<Request, { op: 'peaks' }>) {
  // Finer than the analysis buckets, and short enough to decode on the spot: exact samples.
  if (((to - from) * SR) / buckets < PEAK_SPP && to - from <= 60) return rawPeaks(await openFile(env, url, label(url)), from, to, buckets)
  const a = await analysis(url)
  await a.ready(from, to)
  return queryPeaks(a.base, from, to, buckets)
}

self.onmessage = async ({ data }: MessageEvent<Request & { id: number }>) => {
  try {
    if (data.op === 'render') {
      const [L, R] = await render(data)
      postMessage({ id: data.id, value: [L, R] }, { transfer: [L.buffer, R.buffer] })
    } else if (data.op === 'peaks') {
      const v = await peaks(data)
      postMessage({ id: data.id, value: v }, { transfer: [v.buffer] })
    } else if (data.op === 'gain') {
      postMessage({ id: data.id, value: voiceGain(await (await analysis(data.url)).lufs) })
    }
  } catch (e) {
    postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) })
  }
}
