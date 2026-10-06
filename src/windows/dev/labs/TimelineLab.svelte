<!-- Timeline lab: the real <Timeline /> on a real bundle or the 2-hour stress project, plus a frame-time
     benchmark for scrolling, pinch-zooming, and dragging.
     #/dev?lab=TimelineLab&project=<encoded bundle path>            loads a bundle (edits autosave into it: use a copy)
     #/dev?lab=TimelineLab&stress&project=<encoded scratch path>    generated 2 h, 500 clips, 300 zooms; autosaves there
     window.__bench() runs the benchmark and resolves with the numbers (also shown on the page). -->
<script lang="ts">
  import { untrack } from 'svelte'
  import Timeline from '../../editor/timeline/Timeline.svelte'
  import { stressProject } from '../../editor/timeline/stress.ts'
  import { RULER, stats } from '../../editor/timeline/draw.ts'
  import { doc, selection } from '../../../lib/doc.svelte.ts'
  import { player } from '../../../lib/player.svelte.ts'
  import { invoke } from '../../../lib/ipc.ts'
  import { parseEvents } from '../../../shared/events.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import { timeMap } from '../../../shared/timemap.ts'
  import type { Project, Transcript } from '../../../shared/project.ts'

  let { params }: { params: URLSearchParams } = $props()
  const path = $derived(params.get('project') ?? '')
  const stress = $derived(params.has('stress'))
  let status = $state('')
  let report = $state('')

  // The player domain keeps duration in step with edits; its stub does not, so the lab does.
  $effect(() => {
    void doc.rev
    if (doc.project) player.duration = timeMap(doc.project.clips).duration
  })

  $effect(() => {
    void [path, stress]
    untrack(load)
  })
  async function load() {
    if (!path) return (status = 'Pass &project=<encoded path of a bundle copy> (and &stress for the 2-hour project).')
    try {
      if (stress) {
        const s = stressProject()
        Object.assign(doc, { path, events: s.events, transcript: s.transcript, project: s.project })
      } else {
        const { project } = (await invoke('projects:open', path)) as { project: Project }
        const res = project.sources.events ? await fetch(fileUrl(`${path}/${project.sources.events}`)) : null
        const events = res?.ok ? parseEvents(await res.text()) : []
        Object.assign(doc, { path, events, transcript: sampleTranscript(), project })
      }
    } catch (err) {
      status = `Could not open ${path}: ${err}`
    }
  }

  // The fixture has no transcript yet; spread its script over the speech so the captions lane has words.
  function sampleTranscript(): Transcript {
    const text = 'Hi! Um, so today I want to show you how to create a new project. Uh, first, you click on the project name field, and you type a name. Then you hit create project, and, um, that is basically it. You can scroll down to see all of your projects here. Thanks for watching!'
    const words = text.split(' ')
    return {
      language: 'en',
      words: words.map((w, i) => {
        const start = 0.7 + (i / words.length) * 17
        return { start, end: start + 0.28, text: w, filler: /^(um|uh),?$/i.test(w) }
      }),
    }
  }

  // Waveform peaks: decoded files for real bundles, a deterministic synthetic voice for the stress project.
  const decoded = new Map<string, Promise<Float32Array>>()
  async function peaks(url: string, from: number, to: number, buckets: number): Promise<Float32Array> {
    const out = new Float32Array(buckets * 2)
    if (stress) {
      await new Promise((r) => setTimeout(r, 20))
      for (let i = 0; i < buckets; i++) {
        const t = from + ((i + 0.5) * (to - from)) / buckets
        const env = Math.max(0, Math.sin(t * 1.3) * Math.sin(t * 0.21 + 1)) * (0.5 + 0.5 * Math.sin(t * 9.7) ** 2)
        out[i * 2] = -env * 0.8
        out[i * 2 + 1] = env * 0.8
      }
      return out
    }
    let p = decoded.get(url)
    if (!p) {
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => new OfflineAudioContext(1, 1, 48000).decodeAudioData(b))
        .then((a) => a.getChannelData(0))
      decoded.set(url, p)
    }
    const data = await p
    for (let i = 0; i < buckets; i++) {
      const a = Math.floor((from + ((to - from) * i) / buckets) * 48000)
      const b = Math.floor((from + ((to - from) * (i + 1)) / buckets) * 48000)
      let lo = 0
      let hi = 0
      for (let k = Math.max(a, 0); k < Math.min(b, data.length); k++) {
        lo = Math.min(lo, data[k])
        hi = Math.max(hi, data[k])
      }
      out[i * 2] = lo
      out[i * 2 + 1] = hi
    }
    return out
  }

  // ---- Benchmark: synthetic input, one event per frame, measuring frame intervals and draw cost ----

  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r))
  const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0

  async function scenario(name: string, frames: number, step: (i: number) => void) {
    const n0 = stats.n
    const gaps: number[] = []
    const work: number[] = []
    let prev = await nextFrame()
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now()
      step(i)
      await Promise.resolve() // let reactive effects run, they count as input work
      work.push(performance.now() - t0)
      const now = await nextFrame()
      gaps.push(now - prev)
      prev = now
    }
    const draws: number[] = []
    for (let k = Math.max(n0, stats.n - stats.ms.length); k < stats.n; k++) draws.push(stats.ms[k % stats.ms.length])
    const r = (x: number) => x.toFixed(2)
    return `${name.padEnd(16)} frames ${frames}  interval p50 ${r(pct(gaps, 0.5))} p95 ${r(pct(gaps, 0.95))} max ${r(Math.max(...gaps))} ms  >20ms ${gaps.filter((g) => g > 20).length}  draw p50 ${r(pct(draws, 0.5))} p95 ${r(pct(draws, 0.95))} max ${r(Math.max(...draws))} ms  input p95 ${r(pct(work, 0.95))} ms (${draws.length} draws)`
  }

  async function bench(): Promise<string> {
    const canvas = document.querySelector('.timeline canvas') as HTMLCanvasElement
    const box = canvas.getBoundingClientRect()
    const at = (x: number, y: number) => ({ clientX: box.left + x, clientY: box.top + y, bubbles: true, pointerId: 1, button: 0, buttons: 1 })
    const ptr = (type: string, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, at(x, y)))
    const wheel = (o: WheelEventInit) => canvas.dispatchEvent(new WheelEvent('wheel', { ...o, clientX: box.left + box.width / 2, clientY: box.top + 80, bubbles: true, cancelable: true }))
    // Find a spot by hovering until the timeline shows the wanted cursor.
    const find = async (y: number, cursor: string) => {
      for (let x = 60; x < box.width - 60; x += 3) {
        ptr('pointermove', x, y)
        await new Promise((r) => setTimeout(r)) // the cursor style lands after Svelte flushes
        if (canvas.style.cursor === cursor) return x
      }
      return -1
    }
    const lines = [`${doc.project!.name}  ${box.width.toFixed(0)}x${box.height.toFixed(0)} css px @${devicePixelRatio}x`]
    // Zoom in a little so blocks have labels, edges, and waveforms.
    for (let i = 0; i < 30; i++) wheel({ deltaY: -10, ctrlKey: true })
    await new Promise((r) => setTimeout(r, 600))
    lines.push(await scenario('scroll', 240, (i) => wheel({ deltaX: i < 120 ? 24 : -24 })))
    lines.push(await scenario('pinch zoom', 240, (i) => wheel({ deltaY: i < 120 ? -6 : 6, ctrlKey: true })))
    lines.push(await scenario('scroll zoomed out', 120, (i) => wheel({ deltaX: i < 60 ? 60 : -60 })))
    for (let i = 0; i < 40; i++) wheel({ deltaY: -10, ctrlKey: true })
    await new Promise((r) => setTimeout(r, 600))
    const zy = RULER + 4 + 52 + 6 + 18 // zoom lane center
    const zx = await find(zy, 'grab')
    if (zx > 0) {
      ptr('pointerdown', zx, zy)
      lines.push(await scenario('drag zoom', 180, (i) => ptr('pointermove', zx + Math.sin(i / 20) * 120, zy)))
      dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      ptr('pointerup', zx, zy)
    } else lines.push('drag zoom        no zoom block found in view')
    const cy = RULER + 4 + 26 // clip lane center
    const cx = await find(cy, 'ew-resize')
    if (cx > 0) {
      ptr('pointerdown', cx, cy)
      lines.push(await scenario('trim clip edge', 180, (i) => ptr('pointermove', cx + Math.sin(i / 20) * 80, cy)))
      dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) // cancel: leave the project untouched
      ptr('pointerup', cx, cy)
    } else lines.push('trim clip edge   no clip edge found in view')
    report = lines.join('\n')
    return report
  }
  ;Object.assign(window, { __bench: bench, __lab: { doc, player, selection } }) // for checks over CDP
</script>

<div class="lab">
  <header>
    <span>{doc.project ? `${doc.project.name}: ${doc.project.clips.length} clips, ${doc.project.zooms.length} zooms` : status}</span>
    {#if doc.project}<button class="btn" onclick={bench}>Run benchmark</button>{/if}
  </header>
  {#if report}<pre>{report}</pre>{/if}
  <div class="stage">Editor preview area</div>
  {#if doc.project}<div class="panel"><Timeline {peaks} /></div>{/if}
</div>

<style>
  .lab {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--surface-root);
  }
  header {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px 12px;
    color: var(--text-dim);
  }
  pre {
    margin: 0 12px 8px;
    font: 11px/1.5 var(--mono);
    color: var(--success);
    white-space: pre-wrap;
  }
  .stage {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }
  /* The editor's timeline panel. */
  .panel {
    flex: none;
    max-height: 60vh;
    overflow: auto;
    margin: var(--gutter);
    border-radius: var(--radius-lg);
    background: var(--surface-50);
    box-shadow: var(--hairline);
  }
</style>
