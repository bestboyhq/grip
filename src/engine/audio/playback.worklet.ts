// AudioWorklet for preview output: plays pre-rendered stereo chunks (from the mixer) at exact
// context frames, so chunks join sample-exactly and a late chunk plays from where it should be
// (audio stays in sync, the gap is silence). A run is one stretch of playback: starting a new run
// (seek, edit, pause) fades the old one out over 5 ms while the new one fades in.

declare const currentFrame: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

export type PlaybackMessage =
  | { type: 'run'; id: number; at: number } // new run from frame `at`; earlier runs end there
  | { type: 'chunk'; run: number; at: number; L: Float32Array; R: Float32Array }
  | { type: 'stop'; at: number } // every run ends at `at`

const FADE = 240

interface Run {
  id: number
  start: number
  end: number
  chunks: Array<{ at: number; L: Float32Array; R: Float32Array }>
}

class Playback extends AudioWorkletProcessor {
  private runs: Run[] = []
  private starved = 0 // frames a live run had nothing to play, reported for timing logs
  private reported = 0

  constructor() {
    super()
    this.port.onmessage = ({ data: m }: MessageEvent<PlaybackMessage>) => {
      if (m.type === 'chunk') this.runs.find((r) => r.id === m.run)?.chunks.push(m)
      else {
        for (const r of this.runs) r.end = Math.min(r.end, m.at)
        if (m.type === 'run') this.runs.push({ id: m.id, start: m.at, end: Infinity, chunks: [] })
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const [L, R] = outputs[0]
    const f0 = currentFrame
    const n = L.length
    for (const run of this.runs) {
      let covered = 0
      for (const c of run.chunks) {
        const a = Math.max(f0, c.at)
        const b = Math.min(f0 + n, c.at + c.L.length)
        for (let f = a; f < b; f++) {
          const g = Math.min(1, (f - run.start) / FADE, (run.end + FADE - f) / FADE)
          if (g <= 0) continue
          L[f - f0] += c.L[f - c.at] * g
          R[f - f0] += c.R[f - c.at] * g
        }
        covered += Math.max(0, b - a)
      }
      const live = Math.max(0, Math.min(f0 + n, run.end) - Math.max(f0, run.start))
      this.starved += Math.max(0, live - covered)
      run.chunks = run.chunks.filter((c) => c.at + c.L.length > f0 + n)
    }
    this.runs = this.runs.filter((r) => r.end + FADE > f0 + n)
    if (this.starved !== this.reported && f0 % 12000 < n) this.port.postMessage({ starved: (this.reported = this.starved) })
    return true
  }
}

registerProcessor('studio-playback', Playback)
