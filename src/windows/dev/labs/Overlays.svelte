<!-- Overlays lab: click effects, keystrokes, and captions from drawOverlays() over a screen.
     #/dev?lab=Overlays&t=7                     one 16:9 canvas at output time 7 s
     &grid=1                                    16:9, 9:16, and 1:1 side by side
     &w=1280&h=720&aspect=16:9                  output size and aspect (default 1920x1080, auto)
     &bundle=<abs path .grip>                 the recording's screen, events, and transcript (else a mock)
     &cut=8.8-11.2                              cut a source range out; &zoom=2 zooms on the latest click
     &click=ripple|circle|shockwave  &mode=line|word  &anim=appear|fade|slide  &pos=bottom|top
     &dark=1 (dark mock screen)  &color=%23ffd60a  &font=Georgia  &size=44  &keys=1.5  &play=1  &px=1 (one canvas px per device px)
     Exact pixels: eval document.querySelectorAll('canvas')[i].toDataURL() -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { createProject, type Aspect, type Project, type Transcript } from '../../../shared/project.ts'
  import { parseEvents, type InputEvent, type Modifier } from '../../../shared/events.ts'
  import { removeSourceRange } from '../../../shared/timemap.ts'
  import { outputSize, prepare, sceneAt } from '../../../engine/scene.ts'
  import { drawOverlays } from '../../../engine/overlays/index.ts'
  import { fileUrl } from '../../../engine/media/index.ts'

  let { params }: { params: URLSearchParams } = $props()
  const p = (k: string, d = '') => params.get(k) ?? d

  // The fixture's mic.m4a, segmented with ffmpeg silencedetect; words spread over each segment by length.
  const SPEECH: Array<[number, number, string]> = [
    [0.62, 1.0, 'Hi!'], [1.23, 1.52, 'Um,'], [1.75, 4.89, 'so today I want to show you how to create a new project.'],
    [5.7, 6.02, 'Uh,'], [6.25, 6.72, 'first,'], [6.94, 8.8, 'you click on the project name field,'], [9.06, 10.09, 'and you type a name.'],
    [11.21, 12.71, 'Then you hit create project,'], [12.93, 13.27, 'and,'], [13.48, 13.78, 'um,'], [14.01, 15.07, 'that is basically it.'],
    [16.78, 19.47, 'You can scroll down to see all of your projects here.'], [19.72, 20.72, 'Thanks for watching!'],
  ]
  const speech = (): Transcript => ({
    language: 'en',
    words: SPEECH.flatMap(([a, b, text]) => {
      const ws = text.split(' ')
      const per = (b - a) / ws.reduce((n, w) => n + w.length + 1, 0)
      let t = a
      return ws.map((w) => ({ start: t, end: (t += (w.length + 1) * per) - per, text: w, filler: /^(um|uh)\W*$/i.test(w) }))
    }),
  })

  // Shortcuts on top of the recording's own events, one of each keycap kind.
  const key = (t: number, k: string, ...mods: Modifier[]): InputEvent[] => [
    { t, type: 'key', down: true, key: k, code: 0, mods },
    { t: t + 0.1, type: 'key', down: false, key: k, code: 0, mods },
  ]
  const DEMO: InputEvent[] = [
    ...key(1, 'p', '⌘', '⇧'), ...key(1.5, 'Return'), ...key(2, 'z', '⌘'), ...key(2.3, 'z', '⌘'), ...key(2.6, 'z', '⌘'),
    ...key(12, 'Escape'), ...key(12.6, '←', 'fn'), ...key(13.2, 'k', '⌃', '⌥', '⇧', '⌘'), ...key(13.8, 'Space', '⌘'),
    ...key(14.4, 'F5', 'fn'), ...key(18, 'Tab', '⌘'), ...key(18.5, 'Delete', '⌥'),
  ]
  const MOCK_CLICKS: InputEvent[] = [6, 11.2, 15.5].map((t, i) => ({ t, type: 'down', x: 900 + i * 500, y: 500 + i * 300, button: 'left' }))

  const views: Array<{ w: number; h: number; aspect: Aspect }> = p('grid')
    ? [{ w: 1920, h: 1080, aspect: '16:9' }, { w: 1080, h: 1920, aspect: '9:16' }, { w: 1080, h: 1080, aspect: '1:1' }]
    : [{ w: +p('w', '1920'), h: +p('h', '1080'), aspect: (p('aspect', 'auto') as Aspect) }]

  let t = $state(+p('t', '7'))
  let playing = $state(!!p('play'))
  let error = $state('')
  let data = $state.raw<{ project: Project; events: InputEvent[]; transcript: Transcript; video: HTMLVideoElement | null } | null>(null)
  const canvases: HTMLCanvasElement[] = $state([])

  async function load() {
    const bundle = p('bundle')
    let project = createProject('Overlays lab', { duration: 24, screen: { file: '', width: 2880, height: 1800, fps: 30, scale: 2 } })
    let events = MOCK_CLICKS
    let transcript = speech()
    let video: HTMLVideoElement | null = null
    if (bundle) {
      const get = async (rel: string) => {
        const r = await fetch(fileUrl(`${bundle}/${rel}`))
        if (!r.ok) throw new Error(`${rel}: ${r.status}`)
        return r
      }
      project = await (await get('project.json')).json()
      if (project.sources.events) events = parseEvents(await (await get(project.sources.events)).text())
      if (project.sources.transcript) transcript = await (await get(project.sources.transcript)).json()
      if (project.sources.screen) {
        video = document.createElement('video')
        video.muted = true
        video.src = fileUrl(`${bundle}/${project.sources.screen.file}`)
        await new Promise((ok, fail) => ((video!.onloadeddata = ok), (video!.onerror = () => fail(new Error('screen video did not load')))))
      }
    }
    const st = project.style
    const cut = p('cut').split('-').map(Number)
    if (cut.length === 2) project.clips = removeSourceRange(project.clips, cut[0], cut[1])
    st.cursor.click = (p('click') || st.cursor.click) as typeof st.cursor.click
    st.keystrokes.size = +p('keys', String(st.keystrokes.size))
    Object.assign(st.captions, {
      visible: true,
      mode: p('mode', st.captions.mode),
      animation: p('anim', st.captions.animation),
      position: p('pos', st.captions.position),
      color: p('color', st.captions.color),
      font: p('font', st.captions.font),
      size: +p('size', String(st.captions.size)),
    })
    data = { project, events: [...events, ...DEMO].sort((a, b) => a.t - b.t), transcript, video }
  }

  const prepared = $derived(
    data &&
      views.map((v) => {
        const project = structuredClone(data!.project)
        if (v.aspect !== 'auto' || p('grid')) project.style.aspect = v.aspect
        const size = p('w') || p('grid') ? { width: v.w, height: v.h } : outputSize(project, v.h)
        return prepare({ project, events: data!.events, transcript: data!.transcript, ...size })
      }),
  )
  const duration = $derived(prepared ? prepared[0].map.duration : 24)

  let seq = 0
  async function render(time: number) {
    if (!prepared || !data) return
    const n = ++seq
    const scenes = prepared.map((pr) => sceneAt(pr, time))
    const v = data.video
    if (v && Math.abs(v.currentTime - scenes[0].src) > 1e-3) {
      // Paused: wait for the exact frame. Playing: draw the last decoded frame, seek again once idle.
      if (playing) {
        if (!v.seeking) v.currentTime = scenes[0].src
      } else {
        v.currentTime = scenes[0].src
        await new Promise((ok) => (v.onseeked = ok))
        if (n !== seq) return
      }
    }
    scenes.forEach((scene, i) => {
      const canvas = canvases[i]
      if (!canvas) return
      canvas.width = scene.width
      canvas.height = scene.height
      const ctx = canvas.getContext('2d')!
      const zoom = +p('zoom', '1')
      const target = scene.clicks.at(-1) ?? scene.cursor
      if (zoom > 1 && target) scene.view = { center: { x: target.x, y: target.y }, scale: zoom }
      const bg = ctx.createLinearGradient(0, 0, scene.width, scene.height)
      bg.addColorStop(0, '#2b2a6b')
      bg.addColorStop(0.55, '#8a4f8f')
      bg.addColorStop(1, '#f0a37a')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, scene.width, scene.height)
      ctx.save()
      const vw = scene.view
      ctx.translate(scene.width / 2, scene.height / 2)
      ctx.scale(vw.scale, vw.scale)
      ctx.translate(-vw.center.x, -vw.center.y)
      if (scene.screen) {
        const r = scene.screen.rect
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(r.x, r.y, r.w, r.h, scene.screen.radius)
        ctx.shadowColor = 'rgb(0 0 0 / 0.4)'
        ctx.shadowBlur = 40 * scene.unit
        const dark = !!p('dark')
        ctx.fillStyle = dark ? '#1f1f23' : '#f7f7f9'
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.clip()
        if (v) ctx.drawImage(v, r.x, r.y, r.w, r.h)
        else {
          ctx.fillStyle = dark ? '#2a2a30' : '#ececf1'
          ctx.fillRect(r.x, r.y, r.w * 0.22, r.h)
          ctx.fillStyle = dark ? '#3a3a42' : '#d9d9e0'
          for (let j = 0; j < 9; j++) ctx.fillRect(r.x + r.w * 0.28, r.y + r.h * (0.12 + j * 0.09), r.w * (0.6 - (j % 3) * 0.12), r.h * 0.03)
        }
        ctx.restore()
      }
      if (scene.cursor) {
        const c = scene.cursor
        const s = 14 * scene.unit * 1.6
        ctx.beginPath()
        ctx.moveTo(c.x, c.y)
        ctx.lineTo(c.x, c.y + s * 1.45)
        ctx.lineTo(c.x + s * 0.38, c.y + s * 1.08)
        ctx.lineTo(c.x + s * 1.02, c.y + s * 1.02)
        ctx.closePath()
        ctx.fillStyle = '#111'
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2 * scene.unit
        ctx.stroke()
        ctx.fill()
      }
      ctx.restore()
      drawOverlays(ctx, scene)
    })
  }

  $effect(() => {
    render(t)
  })

  $effect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      t = (t + (now - last) / 1000) % duration
      last = now
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  })

  onMount(() => {
    load().catch((e) => (error = String(e?.message ?? e)))
    const reload = () => location.reload() // new params in the hash = a fresh lab
    addEventListener('hashchange', reload)
    return () => removeEventListener('hashchange', reload)
  })
</script>

<main>
  <header>
    <button onclick={() => (playing = !playing)}>{playing ? 'Pause' : 'Play'}</button>
    <input type="range" min="0" max={duration} step={1 / 30} bind:value={t} aria-label="Output time" />
    <span class="time">{t.toFixed(2)} s</span>
    {#if error}<span class="error">{error}</span>{/if}
  </header>
  <div class="views" class:grid={views.length > 1}>
    {#each views as v, i (i)}
      <canvas
        bind:this={canvases[i]}
        width={v.w}
        height={v.h}
        style:aspect-ratio="{v.w} / {v.h}"
        style:width={p('px') ? `${v.w / devicePixelRatio}px` : null}
      ></canvas>
    {/each}
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
  }
  input[type='range'] {
    flex: 1;
  }
  .time {
    font: 12px var(--mono);
    color: var(--text-dim);
    min-width: 56px;
  }
  .error {
    color: var(--danger);
  }
  .views {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 12px;
    padding: 12px;
    align-items: center;
    justify-content: center;
  }
  canvas {
    max-width: 100%;
    max-height: 100%;
    min-width: 0;
    background: #000;
  }
  .grid canvas {
    flex: 1;
    height: 100%;
    object-fit: contain;
    background: none;
  }
</style>
