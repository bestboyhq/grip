// Waveform peaks for the timeline, fetched lazily in tiles at power-of-two resolutions (mipmaps), so a
// 2-hour track costs a handful of requests at any zoom. While a fine tile loads, a cached coarser one
// stands in, which keeps pinch-zooming smooth.

export type PeaksFn = (url: string, from: number, to: number, buckets: number) => Promise<Float32Array>

const BASE = 1 / 200 // seconds per bucket at level 0
const TILE = 256 // buckets per request
const MAX_LEVEL = 24

export class Waveforms {
  // ponytail: unbounded cache (a 2-hour track at the finest level is ~12 MB); add LRU eviction if memory matters.
  private tiles = new Map<string, Float32Array | null>() // null = loading
  private failed = false

  private fetch: PeaksFn
  private loaded: () => void

  constructor(fetch: PeaksFn, loaded: () => void) {
    this.fetch = fetch
    this.loaded = loaded
  }

  /** Level whose buckets are no wider than `seconds` (one screen pixel of source time). */
  level(seconds: number): number {
    return Math.min(MAX_LEVEL, Math.max(0, Math.floor(Math.log2(seconds / BASE))))
  }

  /** Max |amplitude| of `url` over source [s0, s1), 0..1. Starts fetching what is missing and answers
   *  from up to 4 coarser levels meanwhile; -1 when none is cached yet. */
  peak(url: string, level: number, s0: number, s1: number): number {
    for (let l = level; l <= Math.min(MAX_LEVEL, level + 4); l++) {
      const v = this.sample(url, l, s0, s1, l === level)
      if (v >= 0) return v
    }
    return -1
  }

  private sample(url: string, level: number, s0: number, s1: number, load: boolean): number {
    const d = BASE * 2 ** level
    const b0 = Math.floor(Math.max(0, s0) / d)
    const b1 = Math.max(b0 + 1, Math.ceil(s1 / d))
    let v = 0
    for (let b = b0; b < b1; b++) {
      const ti = Math.floor(b / TILE)
      const tile = this.tile(url, level, ti, load)
      if (!tile) return -1
      const j = (b - ti * TILE) * 2
      v = Math.max(v, -(tile[j] ?? 0), tile[j + 1] ?? 0)
    }
    return v
  }

  private tile(url: string, level: number, ti: number, load: boolean): Float32Array | null {
    const key = `${level}|${ti}|${url}`
    const t = this.tiles.get(key)
    if (t !== undefined || !load) return t ?? null
    this.tiles.set(key, null)
    const span = BASE * 2 ** level * TILE
    this.fetch(url, ti * span, (ti + 1) * span, TILE)
      .catch((err) => {
        if (!this.failed) console.warn('timeline: waveform unavailable:', err)
        this.failed = true
        return new Float32Array(TILE * 2)
      })
      .then((peaks) => {
        this.tiles.set(key, peaks)
        this.loaded()
      })
    return null
  }
}
