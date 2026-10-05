<!-- Auto-zoom lab: the zoom camera on a real bundle, drawn with Canvas 2D (no GPU compositor needed).
     #/dev?lab=AutoZoom&project=<encoded bundle path>[&aspect=9:16][&t=6][&strip=4-15]
     Zooms come from the project, or from autoZoomOnce (the editor's first open) when it has none. The strip shows
     frames across a time range; the plot shows zoom spans (bars), scale (line), and the playhead. -->
<script lang="ts">
  import type { Aspect, Project, Rect } from '../../../shared/project.ts'
  import { parseEvents, type InputEvent } from '../../../shared/events.ts'
  import { mapRange } from '../../../shared/timemap.ts'
  import { prepare, sceneAt, outputSize, type Prepared, type Scene } from '../../../engine/scene.ts'
  import { autoZoomOnce } from '../../../engine/zoom/index.ts'
  import { fileUrl } from '../../../engine/media/index.ts'

  let { params }: { params: URLSearchParams } = $props()
  const STRIP = 10

  let error = $state('')
  let prepared = $state<Prepared | null>(null)
  let events: InputEvent[] = []
  let t = $state(0)
  let playing = $state(false)
  let main = $state<HTMLCanvasElement>()
  let plot = $state<HTMLCanvasElement>()
  let strip = $state<HTMLCanvasElement[]>([])
  const video = document.createElement('video')
  video.muted = true

  const stripTimes = $derived.by(() => {
    if (!prepared) return []
    const [a, b] = (params.get('strip') ?? `0-${prepared.map.duration}`).split('-').map(Number)
    return Array.from({ length: STRIP }, (_, i) => a + ((b - a) * i) / (STRIP - 1))
  })

  async function load() {
    const bundle = params.get('project') ?? ''
    t = Number(params.get('t') ?? 0)
    if (!bundle) throw new Error('Pass &project=<encoded path of a .grip bundle>')
    const get = async (rel: string) => {
      const r = await fetch(fileUrl(`${bundle}/${rel}`))
      if (!r.ok) throw new Error(`Cannot read ${rel} (${r.status})`)
      return r.text()
    }
    const project: Project = JSON.parse(await get('project.json'))
    if (!project.sources.screen) throw new Error('This project has no screen recording')
    events = project.sources.events ? parseEvents(await get(project.sources.events)) : []
    const aspect = params.get('aspect')
    if (aspect) project.style.aspect = aspect as Aspect
    autoZoomOnce(project, events)
    video.src = fileUrl(`${bundle}/${project.sources.screen.file}`)
    await new Promise((ok, fail) => ((video.onloadeddata = ok), (video.onerror = () => fail(new Error('Cannot decode the screen video')))))
    const { width, height } = outputSize(project, 1080)
    prepared = prepare({ project, events, transcript: null, width, height })
  }
  load().catch((e) => (error = String(e.message ?? e)))

  async function seek(src: number) {
    if (Math.abs(video.currentTime - src) < 1e-3) return
    video.currentTime = src
    await new Promise((ok) => (video.onseeked = ok))
  }

  function roundRect(c: CanvasRenderingContext2D, r: Rect, radius: number) {
    c.beginPath()
    c.roundRect(r.x, r.y, r.w, r.h, radius)
  }

  function drawScreen(c: CanvasRenderingContext2D, s: Scene) {
    if (!s.screen) return
    roundRect(c, s.screen.rect, s.screen.radius)
    c.save()
    c.clip()
    c.drawImage(video, s.screen.rect.x, s.screen.rect.y, s.screen.rect.w, s.screen.rect.h)
    c.restore()
  }

  function draw(canvas: HTMLCanvasElement, s: Scene) {
    canvas.width = s.width
    canvas.height = s.height
    const c = canvas.getContext('2d')!
    c.save()
    c.translate(s.width / 2, s.height / 2)
    c.scale(s.view.scale, s.view.scale)
    c.translate(-s.view.center.x, -s.view.center.y)
    const g = c.createLinearGradient(0, 0, s.width, s.height)
    g.addColorStop(0, '#3a2f6b')
    g.addColorStop(1, '#c0587e')
    c.fillStyle = g
    c.fillRect(0, 0, s.width, s.height)
    if (s.screen) {
      c.save()
      c.shadowColor = 'rgba(0,0,0,0.45)'
      c.shadowBlur = 40 * s.unit
      c.shadowOffsetY = 12 * s.unit
      roundRect(c, s.screen.rect, s.screen.radius)
      c.fillStyle = '#000'
      c.fill()
      c.restore()
    }
    drawScreen(c, s)
    // Clicks near t, as rings, to check they stay framed.
    const r = s.screen?.rect
    const sw = prepared!.input.project.sources.screen!
    for (const e of events) {
      if (e.type !== 'down' || !r || Math.abs(e.t - s.src) > 0.5) continue
      c.beginPath()
      c.arc(r.x + (e.x * r.w) / sw.width, r.y + (e.y * r.h) / sw.height, 14 * s.unit, 0, Math.PI * 2)
      c.lineWidth = 3 * s.unit
      c.strokeStyle = `rgb(255 255 255 / ${1 - Math.abs(e.t - s.src) * 2})`
      c.stroke()
    }
    if (s.loupe) {
      const l = s.loupe
      c.save()
      c.globalAlpha = l.opacity
      c.beginPath()
      c.arc(l.x, l.y, l.radius, 0, Math.PI * 2)
      c.clip()
      c.translate(l.x, l.y)
      c.scale(l.scale, l.scale)
      c.translate(-l.x, -l.y)
      drawScreen(c, s)
      c.restore()
      // Rim: a dark ring with a light inner edge, visible over light and dark content.
      for (const [width, color] of [[7, `rgba(0,0,0,${0.35 * l.opacity})`], [2, `rgba(255,255,255,${0.9 * l.opacity})`]] as const) {
        c.beginPath()
        c.arc(l.x, l.y, l.radius, 0, Math.PI * 2)
        c.lineWidth = width * s.unit
        c.strokeStyle = color
        c.stroke()
      }
    }
    if (s.cursor) {
      // A plain arrow; the real cursor art belongs to the compositor.
      const k = 11 * s.unit * prepared!.input.project.style.cursor.size
      c.save()
      c.translate(s.cursor.x, s.cursor.y)
      c.beginPath()
      c.moveTo(0, 0)
      c.lineTo(0, 1.6 * k)
      c.lineTo(0.42 * k, 1.22 * k)
      c.lineTo(0.7 * k, 1.8 * k)
      c.lineTo(0.92 * k, 1.7 * k)
      c.lineTo(0.66 * k, 1.13 * k)
      c.lineTo(1.15 * k, 1.13 * k)
      c.closePath()
      c.fillStyle = '#111'
      c.strokeStyle = '#fff'
      c.lineWidth = 0.12 * k
      c.stroke()
      c.fill()
      c.restore()
    }
    c.restore()
    const label = `t ${s.t.toFixed(2)}  ×${s.view.scale.toFixed(2)}`
    c.font = `${22 * s.unit}px ui-monospace, monospace`
    c.fillStyle = 'rgba(0,0,0,0.6)'
    c.beginPath()
    c.roundRect(12 * s.unit, 12 * s.unit, c.measureText(label).width + 20 * s.unit, 34 * s.unit, 8 * s.unit)
    c.fill()
    c.fillStyle = '#fff'
    c.fillText(label, 22 * s.unit, 36 * s.unit)
  }

  function drawPlot(canvas: HTMLCanvasElement, p: Prepared, now: number) {
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio)
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio)
    const c = canvas.getContext('2d')!
    const x = (t: number) => (t / p.map.duration) * w
    c.fillStyle = 'rgb(255 255 255 / 0.35)'
    for (const z of p.input.project.zooms) for (const [a, b] of mapRange(p.map, z.start, z.end)) c.fillRect(x(a), h * 0.7, x(b) - x(a), h * 0.25)
    const scales = Array.from({ length: Math.ceil(w) + 1 }, (_, i) => Math.log(sceneAt(p, (i / w) * p.map.duration).view.scale))
    const lo = Math.min(...scales)
    const span = Math.max(Math.max(...scales) - lo, Math.log(2))
    c.beginPath()
    scales.forEach((v, i) => c.lineTo(i, h * 0.62 * (1 - (v - lo) / span) + 4))
    c.strokeStyle = '#fff'
    c.lineWidth = devicePixelRatio
    c.stroke()
    c.fillStyle = '#ffcc00'
    c.fillRect(x(now) - devicePixelRatio, 0, 2 * devicePixelRatio, h)
  }

  // Render the main frame, then the strip, one seek at a time; a newer request supersedes an older one.
  let job = 0
  $effect(() => {
    const p = prepared
    const now = t
    const times = stripTimes
    if (!p || !main || !plot) return
    const id = ++job
    ;(async () => {
      for (const [canvas, at] of [[main, now], ...times.map((tt, i) => [strip[i], tt])] as Array<[HTMLCanvasElement, number]>) {
        if (!canvas) continue
        const s = sceneAt(p, at)
        await seek(s.src)
        if (id !== job) return
        draw(canvas, s)
        if (playing) break
      }
      drawPlot(plot!, p, now)
    })()
  })

  $effect(() => {
    if (!playing || !prepared) return
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      t = Math.min(t + (now - last) / 1000, prepared!.map.duration)
      last = now
      if (t >= prepared!.map.duration) playing = false
      else raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  })
</script>

<div class="lab">
  {#if error}
    <p class="error">{error}</p>
  {:else if !prepared}
    <p>Loading…</p>
  {:else}
    <canvas class="main" bind:this={main}></canvas>
    <div class="bar">
      <button onclick={() => (playing = !playing)}>{playing ? 'Pause' : 'Play'}</button>
      <input type="range" min="0" max={prepared.map.duration} step="0.01" bind:value={t} aria-label="Time" />
      <span>{t.toFixed(2)} s</span>
    </div>
    <canvas class="plot" bind:this={plot}></canvas>
    <div class="strip">
      {#each stripTimes as at, i (i)}
        <figure>
          <canvas bind:this={strip[i]}></canvas>
          <figcaption>{at.toFixed(2)} s</figcaption>
        </figure>
      {/each}
    </div>
  {/if}
</div>

<style>
  .lab {
    padding: 16px;
    display: grid;
    gap: 10px;
    color: #ddd;
    font: 12px system-ui;
    background: var(--bg);
    height: 100vh;
    overflow: auto;
  }
  .main {
    width: 100%;
    height: 38vh;
    object-fit: contain;
  }
  .bar {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .bar input {
    flex: 1;
  }
  .plot {
    width: 100%;
    height: 56px;
    background: var(--bg-raised);
    border-radius: var(--radius);
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }
  figure {
    margin: 0;
  }
  .strip canvas {
    width: 100%;
    display: block;
  }
  figcaption {
    text-align: center;
    opacity: 0.7;
    margin-top: 2px;
  }
  .error {
    color: #ff7b7b;
  }
</style>
