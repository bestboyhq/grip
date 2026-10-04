// Owner: audio. One audio graph for preview and export (parity): mic + system + music, per-clip
// volume, pitch-preserving time-stretch for speed changes, voice chain (noise reduction ->
// loudness normalization -> limiter), click sounds. Everything in output time via the time map.

import type { Prepared } from '../scene.ts'

/** Render output-time audio [from, to) as 48 kHz stereo, for export. Memory stays flat: callers
 *  ask for chunks of a few seconds at a time. */
export async function renderAudio(_p: Prepared, _bundle: string, _from: number, _to: number): Promise<AudioBuffer> {
  return new AudioBuffer({ length: Math.max(1, Math.round((_to - _from) * 48000)), numberOfChannels: 2, sampleRate: 48000 })
}

/** Min/max peaks of a source audio file between source times [from, to), `buckets` pairs.
 *  Lazy and cached, so hours-long tracks render without stalling. */
export async function peaks(_url: string, _from: number, _to: number, buckets: number): Promise<Float32Array> {
  return new Float32Array(buckets * 2)
}
