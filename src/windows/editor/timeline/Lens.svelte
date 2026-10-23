<!-- The trim lens: a magnifier over a clip edge while it is dragged. It shows the recording around the
     edge in source time, frames, voice, and words, with what lies outside the clip ghosted, so the user
     sees what they cut and what they can bring back. Moving the pointer up into it trims at its scale
     (Timeline.svelte). The timeline's frame loop drives it through show and hide: no reactive state per frame. -->
<script module lang="ts">
  import type { Clip } from '../../../shared/project.ts'
  import type { Audio } from './draw.ts'
  import type { Chip } from './model.ts'
  import type { Waveforms } from './waveform.ts'

  export const LENS = { w: 560, k: 220 } // css px wide; k: px per source second, ~7 px a frame at 30 fps

  export interface LensVideo {
    url: string
    width: number
    height: number
    fps: number
  }

  export interface LensScene {
    side: 'start' | 'end'
    clip: Clip // as trimmed so far
    was: Clip // before the drag
    lim: { lo: number; hi: number } // how far the edge can go
    duration: number // of the recording
    fine: boolean // the pointer is in the lens
    video: LensVideo | null
    mic: Audio | null
    system: Audio | null
    waves: Waveforms
    words: Chip[]
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import { openVideo, type FrameSource } from '../../../engine/media/index.ts'
  import { formatTime } from '../helpers.ts'

  let { redraw }: { redraw: () => void } = $props()

  const ROW = 114 // css px: frames, then the words over the voice
  const HEIGHT = 28 + ROW + 8 // head, row, bottom padding: .lens in css
  const FRAMES = 64
  const WORDS = 16 // the words' line under the frames; the voice rises from the row's bottom edge below it
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'

  let box: HTMLDivElement
  let canvas: HTMLCanvasElement
  let notch: HTMLElement
  let what: HTMLSpanElement
  let hint: HTMLSpanElement
  let delta: HTMLSpanElement
  let frames: Frames | null = null
  let x = 0 // where the lens sits, kept while the pointer is in it so it holds still under the hand
  let hatch: CanvasPattern | null = null

  /** Thumbnails of one video at the lens's height, decoded on their own decoder so the preview's is
   *  never disturbed, latest request first served, oldest evicted. */
  class Frames {
    readonly url: string
    private src: Promise<FrameSource | null>
    private cache = new Map<number, ImageBitmap>() // by source millisecond
    private want: number[] = []
    private busy = false
    private closed = false

    constructor(url: string) {
      this.url = url
      this.src = openVideo(url).catch((e) => {
        console.warn('timeline: lens frames unavailable:', e)
        return null
      })
    }

    get = (t: number) => this.cache.get(Math.round(t * 1000)) ?? null

    /** Decode these times, in order, dropping what an earlier call still wanted. */
    request(ts: number[], w: number, h: number) {
      this.want = ts.filter((t) => !this.cache.has(Math.round(t * 1000)))
      if (this.want.length) void this.pump(w, h)
    }

    private async pump(w: number, h: number) {
      if (this.busy) return
      this.busy = true
      const src = await this.src
      while (src && !this.closed && this.want.length) {
        const t = this.want.shift()!
        const f = await src.frameAt(t).catch(() => null)
        if (!f) continue
        try {
          const bmp = await createImageBitmap(f, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' })
          if (this.closed) bmp.close()
          else this.cache.set(Math.round(t * 1000), bmp)
        } finally {
          f.close()
        }
        // ponytail: FIFO eviction; a lens shows ~8 thumbnails, so 160 covers dragging back and forth.
        if (this.cache.size > 160) {
          const [k, old] = this.cache.entries().next().value!
          old.close()
          this.cache.delete(k)
        }
        redraw()
      }
      this.busy = false
    }

    close() {
      this.closed = true
      this.want = []
      void this.src.then((s) => s?.close())
      for (const b of this.cache.values()) b.close()
      this.cache.clear()
    }
  }

  function use(video: LensVideo | null) {
    if (frames && frames.url !== video?.url) {
      frames.close()
      frames = null
    }
    if (video && !frames) frames = new Frames(video.url)
  }

  /** Open the video before the first trim, so its frames are there when the lens opens. */
  export function warm(video: LensVideo | null) {
    use(video)
  }

  /** Show the lens for `s` above the edge at page x `edge`, its bottom at page y `bottom`, inside [left, right]. */
  export function show(s: LensScene, edge: number, bottom: number, left: number, right: number) {
    use(s.video)
    if (!s.fine || !box.classList.contains('on')) x = Math.min(Math.max(edge - LENS.w / 2, left + 8), right - 8 - LENS.w)
    box.style.translate = `${Math.round(x)}px ${Math.max(4, Math.round(bottom - HEIGHT))}px`
    notch.style.left = `${Math.min(Math.max(edge - x, 18), LENS.w - 18)}px`
    box.classList.add('on')
    const e = s.clip[s.side]
    const d = s.side === 'end' ? s.clip.end - s.was.end : s.was.start - s.clip.start // more of the recording is positive
    const fr = s.video ? Math.round(Math.abs(d) * s.video.fps) : 0
    what.textContent = `${s.side === 'end' ? 'Ends' : 'Starts'} at ${formatTime(e)}`
    hint.textContent = s.fine ? 'Frame precision' : 'Drag up into the lens for frame precision'
    hint.classList.toggle('fine', s.fine)
    const same = Math.abs(d) < 0.005 // what the readout rounds to zero
    delta.textContent = same ? 'No change' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}s${s.video ? ` · ${fr} ${fr === 1 ? 'frame' : 'frames'}` : ''}`
    delta.dataset.sign = same ? '' : d > 0 ? 'more' : 'less'
    draw(s, e)
  }

  export function hide() {
    box.classList.remove('on')
  }

  onDestroy(() => frames?.close())

  function draw(s: LensScene, e: number) {
    const dpr = devicePixelRatio
    const W = canvas.clientWidth
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(ROW * dpr)) {
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(ROW * dpr)
    }
    const g = canvas.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, ROW)
    hatch ??= stripes(g)
    // Source time s sits at x = mid + (s - e) * k: the edge in the middle, the recording passing under it.
    const k = LENS.k
    const mid = W / 2
    const X = (t: number) => mid + (t - e) * k
    const sL = e - mid / k
    const sR = e + (W - mid) / k
    const kept = s.side === 'end' ? [s.clip.start, e] : [e, s.clip.end]
    const xLo = Math.max(0, X(s.lim.lo))
    const xHi = Math.min(W, X(s.lim.hi))
    const kA = Math.min(Math.max(X(kept[0]), 0), W)
    const kB = Math.min(Math.max(X(kept[1]), 0), W)

    g.save()
    g.beginPath()
    g.roundRect(0, 0, W, ROW, 8)
    g.clip()
    // Source another clip uses, or beyond the recording: out of reach.
    g.fillStyle = '#111110'
    g.fillRect(0, 0, W, ROW)
    g.fillStyle = hatch
    g.fillRect(0, 0, W, ROW)
    if (xHi > xLo) {
      g.save()
      g.beginPath()
      g.rect(xLo, 0, xHi - xLo, ROW)
      g.clip()
      if (s.video && frames) {
        const tw = (FRAMES * s.video.width) / s.video.height
        const T = tw / k // thumbnails pinned to source time, so they ride with the recording
        const ts: number[] = []
        for (let n = Math.floor(Math.max(sL, s.lim.lo) / T); n * T < Math.min(sR, s.lim.hi); n++) {
          const t = Math.max(0, n * T)
          ts.push(t)
          const bmp = frames.get(t)
          if (bmp) g.drawImage(bmp, X(n * T), 0, tw - 1, FRAMES)
        }
        frames.request(ts, Math.round(tw * dpr), Math.round(FRAMES * dpr))
      }
      const fill = g.createLinearGradient(0, FRAMES, 0, ROW)
      fill.addColorStop(0, '#3754cc') // the clip's colours, see draw.ts
      fill.addColorStop(1, '#263d9c')
      g.fillStyle = fill
      g.fillRect(xLo, FRAMES, xHi - xLo, ROW - FRAMES)
      voice(g, s, sL, xLo, xHi)
      words(g, s, sL, sR, X, kept)
      // Outside the clip, within reach: ghosted, there to bring back.
      g.fillStyle = 'rgba(17,17,16,0.66)'
      if (kA > xLo) g.fillRect(xLo, 0, kA - xLo, ROW)
      if (xHi > kB) g.fillRect(kB, 0, xHi - kB, ROW)
      g.fillStyle = hatch
      if (kA > xLo) g.fillRect(xLo, 0, kA - xLo, ROW)
      if (xHi > kB) g.fillRect(kB, 0, xHi - kB, ROW)
      g.restore()
    }
    if (kB > kA) {
      g.strokeStyle = 'rgba(196,212,255,0.55)'
      g.lineWidth = 1
      g.beginPath()
      g.roundRect(kA + 0.5, 0.5, kB - kA - 1, ROW - 1, 6)
      g.stroke()
    }
    g.font = `500 10px ${FONT}`
    g.fillStyle = 'rgba(244,244,243,0.4)'
    g.textBaseline = 'middle'
    if (xLo > 120) {
      g.textAlign = 'right'
      g.fillText(s.lim.lo <= 1e-3 ? 'Start of recording' : 'In another clip', xLo - 10, ROW / 2)
    }
    if (W - xHi > 120) {
      g.textAlign = 'left'
      g.fillText(s.lim.hi >= s.duration - 1e-3 ? 'End of recording' : 'In another clip', xHi + 10, ROW / 2)
    }
    g.restore()
    // The edge.
    g.save()
    g.fillStyle = '#fff'
    g.shadowColor = 'rgba(255,255,255,0.6)'
    g.shadowBlur = 6
    g.fillRect(Math.round(mid) - 1, 0, 2, ROW)
    g.restore()
  }

  /** Mic behind, system audio in front, as the timeline draws them (draw.ts wave). */
  function voice(g: CanvasRenderingContext2D, s: LensScene, sL: number, x0: number, x1: number) {
    const k = LENS.k
    const level = s.waves.level(1 / k)
    const base = ROW + 1 // silence sits just under the edge, so its contour does not show (draw.ts)
    const max = ROW - FRAMES - WORDS - 2
    const c = s.clip
    for (const [src, volume, color, edge] of [[s.mic, c.volume, 'rgba(214,224,255,0.3)', 'rgba(232,238,255,0.8)'], [s.system, c.systemVolume ?? 1, 'rgba(249,120,0,0.5)', 'rgba(255,154,64,0.95)']] as const) {
      const gain = src ? src.gain * (c.muted ? 0 : volume) : 0
      if (!src || gain <= 0) continue
      const top = new Path2D()
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const t = sL + x / k
        const p = s.waves.peak(src.url, level, t, t + 1 / k, src.voice)
        const y = base - (p > 0 ? Math.min(1, Math.sqrt(p * gain)) * max : 0)
        if (x === Math.floor(x0)) top.moveTo(x, y)
        else top.lineTo(x, y)
      }
      const body = new Path2D(top)
      body.lineTo(Math.ceil(x1), base + 1)
      body.lineTo(Math.floor(x0), base + 1)
      body.closePath()
      g.fillStyle = color
      g.fill(body)
      g.lineWidth = 1
      g.lineJoin = 'round'
      g.strokeStyle = edge
      g.stroke(top)
    }
  }

  /** The transcript's words under the voice, bright inside the clip. */
  function words(g: CanvasRenderingContext2D, s: LensScene, sL: number, sR: number, X: (t: number) => number, kept: number[]) {
    const w = s.words
    let lo = 0
    let hi = w.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (w[m].end < sL) lo = m + 1
      else hi = m
    }
    g.font = `500 10px ${FONT}`
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    let right = -Infinity
    for (let i = lo; i < w.length && w[i].start < sR; i++) {
      const x = X(w[i].start)
      if (x < right + 6) continue
      const inside = w[i].start >= kept[0] - 0.02 && w[i].end <= kept[1] + 0.02
      g.fillStyle = inside && !w[i].dim ? 'rgba(244,244,243,0.88)' : 'rgba(244,244,243,0.34)'
      g.fillText(w[i].label, Math.max(x, 2), FRAMES + WORDS - 4)
      right = Math.max(x, 2) + g.measureText(w[i].label).width
    }
  }

  function stripes(g: CanvasRenderingContext2D): CanvasPattern {
    const c = new OffscreenCanvas(7, 7)
    const p = c.getContext('2d')!
    p.strokeStyle = 'rgba(255,255,255,0.075)'
    p.beginPath()
    p.moveTo(-1, 8)
    p.lineTo(8, -1)
    p.stroke()
    return g.createPattern(c, 'repeat')!
  }
</script>

<div class="lens" bind:this={box} aria-hidden="true">
  <div class="head">
    <span class="what" bind:this={what}></span>
    <span class="hint" bind:this={hint}></span>
    <span class="delta" bind:this={delta}></span>
  </div>
  <canvas bind:this={canvas}></canvas>
  <i class="notch" bind:this={notch}></i>
</div>

<style>
  .lens {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 30;
    width: 560px;
    padding: 0 8px 8px;
    border-radius: var(--radius-lg);
    background: var(--surface-root);
    box-shadow: var(--shadow-pop);
    pointer-events: none;
    opacity: 0;
    scale: var(--drop-scale);
    transform-origin: 50% 100%;
    transition: opacity var(--drop-out) var(--ease-out), scale var(--drop-out) var(--ease-out);
  }
  .lens:global(.on) {
    opacity: 1;
    scale: 1;
    transition-duration: var(--come);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 28px;
    padding: 0 4px;
    font: 500 11px var(--mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .what {
    color: var(--fg-default);
  }
  .hint {
    flex: 1;
    text-align: center;
    font: 500 10.5px var(--font);
    color: var(--fg-faint);
  }
  .hint:global(.fine) {
    color: var(--fg-default);
  }
  .delta {
    color: var(--fg-faint);
  }
  .delta:global([data-sign='more']) {
    color: var(--brand-text); /* towards the clip's blue: more of the recording */
  }
  .delta:global([data-sign='less']) {
    color: var(--record-text); /* towards the cut marker's orange: more cut away */
  }
  canvas {
    display: block;
    width: 100%;
    height: 114px;
  }
  .notch {
    position: absolute;
    bottom: -7px;
    width: 12px;
    height: 12px;
    background: inherit;
    box-shadow: inset -0.5px -0.5px 0 var(--border-default);
    transform: translateX(-50%) rotate(45deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .lens {
      scale: 1;
    }
  }
</style>
