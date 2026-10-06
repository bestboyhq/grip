<!-- Motion lab: the built-in cursor set (src/assets/cursors.ts) at 1x/2x/4x (red dot = hotspot), the recorded path (grey)
     against the smoothed one (accent) with clicks, and the cursor itself in motion.
     #/dev?lab=Cursor[&bundle=<abs .grip path>][&t=<output s, freezes playback>][&set=builtin|touch]
     [&cut=<source a>-<source b>][&loop=1][&anim=smooth|medium|rapid|none][&zoom=<view scale around the cursor>] -->
<script lang="ts">
  import { createProject, type Project } from '../../../shared/project.ts'
  import { parseEvents, type InputEvent } from '../../../shared/events.ts'
  import { removeSourceRange, timeMap } from '../../../shared/timemap.ts'
  import { layoutAt, prepareLayout } from '../../../engine/layout.ts'
  import { cursorAt, cursorPoint, prepareCursor } from '../../../engine/motion/index.ts'
  import { CURSORS, type BuiltinName } from '../../../assets/cursors.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import { invoke } from '../../../lib/ipc.ts'

  let { params }: { params: URLSearchParams } = $props()
  const W = 600
  const H = 380
  const names = Object.keys(CURSORS) as BuiltinName[]
  let pathCanvas = $state<HTMLCanvasElement>()
  let playCanvas = $state<HTMLCanvasElement>()
  let info = $state('loading')

  /** A figure with pauses, two clicks, a drag, and a jump (cut it out with &cut=5.5-6.5). */
  function synthetic(): InputEvent[] {
    const ev: InputEvent[] = []
    const keys: Array<[number, number, number]> = [[0, 600, 500], [1.2, 2200, 400], [2.2, 2200, 400], [3, 900, 1300], [4.4, 900, 1300], [5.5, 1800, 900], [6.5, 2500, 1500], [8, 400, 300], [10, 400, 300]]
    for (let t = 0; t <= 10; t += 1 / 120) {
      const i = Math.max(0, keys.findIndex((k) => k[0] > t) - 1)
      const [t0, x0, y0] = keys[i]
      const [t1, x1, y1] = keys[i + 1] ?? keys[i]
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0
      const e = u * u * (3 - 2 * u)
      const jump = t0 === 5.5 // teleport mid-way
      const w = Math.sin(t * 40) * 3 // hand jitter
      ev.push({ t, type: 'move', x: jump ? (u < 0.5 ? x0 : x1) : x0 + (x1 - x0) * e + w, y: jump ? (u < 0.5 ? y0 : y1) : y0 + (y1 - y0) * e - w })
    }
    ev.push({ t: 1.4, type: 'down', x: 2200, y: 400, button: 'left' }, { t: 1.5, type: 'up', x: 2200, y: 400, button: 'left' })
    ev.push({ t: 3.1, type: 'down', x: 900, y: 1300, button: 'left' }, { t: 3.2, type: 'up', x: 900, y: 1300, button: 'left' })
    return ev.sort((a, b) => a.t - b.t)
  }

  async function load(): Promise<{ project: Project; events: InputEvent[] }> {
    const bundle = params.get('bundle')
    if (!bundle) {
      return { project: createProject('lab', { duration: 10, screen: { file: '', width: 2880, height: 1800, fps: 60, scale: 2 } }), events: synthetic() }
    }
    const { project } = (await invoke('projects:open', bundle)) as { project: Project }
    const text = project.sources.events ? await (await fetch(fileUrl(`${bundle}/${project.sources.events}`))).text() : ''
    return { project, events: parseEvents(text) }
  }

  /** A built-in cursor at s CSS px per point, sharp at the device pixel ratio. */
  const paint = (n: BuiltinName, s: number) => (canvas: HTMLCanvasElement) => {
    const a = CURSORS[n]
    const k = s * devicePixelRatio
    canvas.width = Math.ceil(a.w * k)
    canvas.height = Math.ceil(a.h * k)
    const ctx = canvas.getContext('2d')!
    ctx.scale(k, k)
    a.draw(ctx, k)
  }

  $effect(() => {
    if (!pathCanvas || !playCanvas) return
    let raf = 0
    let alive = true
    load().then(({ project, events }) => {
      if (!alive) return
      const cut = params.get('cut')?.split('-').map(Number)
      if (cut?.length === 2) project.clips = removeSourceRange(project.clips, cut[0], cut[1])
      if (params.get('set')) project.style.cursor.set = params.get('set') as 'builtin' | 'touch'
      project.style.cursor.loop = params.get('loop') === '1'
      project.style.cursor.animation = (params.get('anim') ?? 'smooth') as Project['style']['cursor']['animation']
      const input = { project, events, transcript: null, width: W, height: H }
      const map = timeMap(project.clips)
      const layout = prepareLayout(input, map, Math.min(W, H) / 1080)
      const t0 = performance.now()
      const c = prepareCursor(input, map, layout)
      const prepMs = performance.now() - t0
      const screen = layoutAt(layout, 0).screen!
      const k = screen.rect.w / project.sources.screen!.width

      const fixed = params.get('t')
      const zoom = Number(params.get('zoom') ?? 1)
      const p = setup(pathCanvas!)
      const focus = zoom !== 1 && fixed !== null && cursorPoint(c, Number(fixed))
      if (focus) {
        p.translate(W / 2, H / 2)
        p.scale(zoom, zoom)
        p.translate(-focus.x, -focus.y)
      }
      frameScreen(p, screen.rect)
      p.strokeStyle = 'rgb(255 255 255 / 0.35)'
      p.lineWidth = 1 / zoom
      p.beginPath()
      for (const e of events) if (e.type === 'move') p.lineTo(screen.rect.x + e.x * k, screen.rect.y + e.y * k)
      p.stroke()
      p.strokeStyle = '#ffffff'
      p.lineWidth = 2 / zoom
      p.beginPath()
      for (let t = 0; t <= map.duration; t += 1 / 240) {
        const q = cursorPoint(c, t)
        if (q) p.lineTo(q.x, q.y)
      }
      p.stroke()
      p.fillStyle = '#ff5f57'
      for (const e of events) {
        if (e.type !== 'down') continue
        p.beginPath()
        p.arc(screen.rect.x + e.x * k, screen.rect.y + e.y * k, 4 / zoom, 0, Math.PI * 2)
        p.fill()
      }

      const g = setup(playCanvas!)
      const start = performance.now()
      const draw = () => {
        const t = fixed !== null ? Number(fixed) : ((performance.now() - start) / 1000) % map.duration
        const at = cursorPoint(c, t)
        g.resetTransform()
        g.scale(devicePixelRatio, devicePixelRatio)
        g.clearRect(0, 0, W, H)
        if (at && zoom !== 1) {
          // Zoom camera stand-in, centered on the cursor.
          g.translate(W / 2, H / 2)
          g.scale(zoom, zoom)
          g.translate(-at.x, -at.y)
        }
        frameScreen(g, screen.rect)
        for (let i = 24; i > 0; i--) {
          const q = cursorPoint(c, t - i / 60)
          if (!q) continue
          g.fillStyle = `rgb(255 255 255 / ${0.5 * (1 - i / 25)})`
          g.beginPath()
          g.arc(q.x, q.y, 2, 0, Math.PI * 2)
          g.fill()
        }
        const l = cursorAt(c, t)
        if (l) {
          // Recorded images are not loaded here: they show as the arrow at its own hotspot.
          const own = CURSORS[l.image as BuiltinName]
          const a = own ?? CURSORS.arrow
          g.save()
          g.globalAlpha = l.opacity
          g.translate(l.x, l.y)
          g.rotate(l.angle)
          g.scale(l.scale, l.scale)
          g.translate(-(own ? l.hotX : a.hotX), -(own ? l.hotY : a.hotY))
          a.draw(g, l.scale * zoom * devicePixelRatio)
          g.restore()
        }
        info = `t ${t.toFixed(3)} / ${map.duration.toFixed(2)} s · prepare ${prepMs.toFixed(1)} ms · ${events.length} events, ${project.clips.length} clips · ` +
          (l ? `${l.image} angle ${l.angle.toFixed(3)} opacity ${l.opacity.toFixed(2)} scale ${l.scale.toFixed(3)}` : 'hidden')
        if (fixed === null) raf = requestAnimationFrame(draw)
      }
      draw()
    }, (e) => (info = String(e)))
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  })

  function setup(canvas: HTMLCanvasElement) {
    const dpr = devicePixelRatio
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    return ctx
  }
  function frameScreen(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }) {
    ctx.fillStyle = '#121216'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#26262c'
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, 8)
    ctx.fill()
  }
</script>

<main>
  <section class="set">
    {#each ['light', 'dark'] as tone (tone)}
      <div class="tiles {tone}">
        {#each names as n (n)}
          {#each [1, 2, 4] as s (s)}
            <figure style:width="{CURSORS[n].w * s}px" style:height="{CURSORS[n].h * s}px">
              <canvas {@attach paint(n, s)} aria-label={n} style:width="{CURSORS[n].w * s}px" style:height="{CURSORS[n].h * s}px"></canvas>
              <i style:left="{CURSORS[n].hotX * s}px" style:top="{CURSORS[n].hotY * s}px"></i>
            </figure>
          {/each}
        {/each}
      </div>
    {/each}
  </section>
  <p>{info}</p>
  <div class="canvases">
    <canvas bind:this={pathCanvas} style:width="{W}px" style:height="{H}px"></canvas>
    <canvas bind:this={playCanvas} style:width="{W}px" style:height="{H}px"></canvas>
  </div>
</main>

<style>
  main {
    height: 100%;
    overflow: auto;
    padding: 16px;
    background: var(--surface-root);
  }
  .tiles {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    padding: 12px 16px;
  }
  .light {
    background: #f4f4f6;
    border-radius: var(--radius) var(--radius) 0 0;
  }
  .dark {
    background: #0e0e11;
    border-radius: 0 0 var(--radius) var(--radius);
  }
  figure {
    position: relative;
    margin: 0;
  }
  figure canvas {
    display: block;
    border-radius: 0;
  }
  i {
    position: absolute;
    width: 2px;
    height: 2px;
    margin: -1px 0 0 -1px;
    background: #ff2d2d;
  }
  p {
    margin: 10px 0;
    font: 12px var(--mono);
    color: var(--text-dim);
  }
  .canvases {
    display: flex;
    flex-direction: row;
    gap: 12px;
  }
  canvas {
    border-radius: var(--radius);
  }
</style>
