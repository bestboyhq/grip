<!-- Compositor lab: renders a real project through the GPU compositor with style overrides.
     #/dev?lab=Render&project=<absolute .studio path>
     Frames come from <video> elements (new VideoFrame(video)); the media engine replaces this in the app.
     Driven over CDP through window.lab: set(patch), render(), capture(), bench(), offscreen(). -->
<script lang="ts">
  import { onMount } from 'svelte'
  import type { Aspect, CameraLayoutKind, Mask, Project, Style } from '../../../shared/project.ts'
  import { parseEvents, type InputEvent } from '../../../shared/events.ts'
  import { outputSize, prepare, sceneAt, type FaceSample, type Scene } from '../../../engine/scene.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import { Renderer, type Motion } from '../../../engine/gpu/renderer.ts'
  import { motionAt } from '../../../engine/compose.ts'
  import { WALLPAPERS } from '../../../engine/backgrounds/index.ts'
  import { wallpaperThumbnails } from '../../../engine/backgrounds/thumbnails.ts'
  import { invoke } from '../../../lib/ipc.ts'

  let { params }: { params: URLSearchParams } = $props()
  const bundle = $derived(params.get('project') ?? '')

  const s = $state({
    t: 3,
    height: 1080,
    aspect: 'auto' as string,
    bg: 'wallpaper:dusk',
    blur: 0,
    padding: 80,
    radius: 14,
    shadow: 0.6,
    device: 'none' as Style['device'],
    layout: 'pip' as CameraLayoutKind,
    shape: 'rounded' as Style['camera']['shape'],
    position: 'bottom-right' as Style['camera']['position'],
    mirror: true,
    masks: false,
    zoom: 1,
    zx: 0.5,
    zy: 0.5,
    loupe: false,
    motion: 0, // simulated zoom speed: scale change across the shutter
    cursor: '' as string, // built-in override: arrow, pointer, ibeam
    cursorSize: 1.6,
    inspect: 4, // inspector magnification
    ix: 0.5,
    iy: 0.5,
    layoutStart: 0, // source seconds where the layout item starts (render just after it to see the transition)
    removeBg: false,
    followFace: false,
    lut: true,
    overlay: false,
  })
  let status = $state('loading')
  let thumbs = $state(new Map<string, string>())
  let canvas: HTMLCanvasElement
  let inspector: HTMLCanvasElement
  let screenVideo: HTMLVideoElement
  let cameraVideo: HTMLVideoElement
  let matteVideo: HTMLVideoElement
  let faces: FaceSample[] = []
  let base: Project | null = null
  let events: InputEvent[] = []
  let renderer: Renderer | null = null
  let busy: Promise<void> = Promise.resolve()

  const url = (rel: string) => fileUrl(`${bundle}/${rel}`)

  function project(): Project {
    const p = structuredClone(base!)
    const st = p.style
    st.aspect = (s.aspect.includes(':') ? s.aspect : s.aspect === 'auto' ? 'auto' : JSON.parse(s.aspect)) as Aspect
    const [kind, value] = s.bg.split(':')
    st.background =
      kind === 'wallpaper' ? { kind, id: value }
      : kind === 'color' ? { kind, color: value }
      : kind === 'image' ? { kind, file: value }
      : { kind: 'gradient', stops: value.split(','), angle: 135 }
    Object.assign(st, { backgroundBlur: s.blur, padding: s.padding, radius: s.radius, shadow: s.shadow, device: s.device })
    Object.assign(st.camera, { shape: s.shape, mirror: s.mirror, position: s.position, removeBackground: s.removeBg, followFace: s.followFace })
    if (!s.lut) st.camera.lut = undefined
    st.cursor.size = s.cursorSize
    const d = p.sources.duration
    p.layouts = s.layout === 'pip' ? [] : [{ id: 'l', start: s.layoutStart, end: d, kind: s.layout }]
    const mask = (kind: Mask['kind'], x: number, y: number, w: number, h: number): Mask => ({ id: kind, start: 0, end: d, kind, rect: { x, y, w, h } })
    p.masks = s.masks ? [mask('blur', 0.27, 0.19, 0.24, 0.07), mask('pixelate', 0.27, 0.36, 0.36, 0.07), mask('highlight', 0.24, 0.46, 0.5, 0.2)] : []
    return p
  }

  async function frameAt(v: HTMLVideoElement, t: number): Promise<VideoFrame> {
    const target = Math.min(t, v.duration - 0.001)
    if (Math.abs(v.currentTime - target) > 1e-4 || v.readyState < 2) {
      await new Promise<void>((resolve) => {
        v.addEventListener('seeked', () => resolve(), { once: true })
        v.currentTime = target
      })
    }
    return new VideoFrame(v, { timestamp: Math.round(target * 1e6) })
  }

  function sceneFor(p: Project, width: number, height: number): { scene: Scene; motion?: Motion } {
    const prepared = prepare({ project: p, events, transcript: null, width, height, faces })
    const scene = sceneAt(prepared, s.t)
    let motion = motionAt(prepared, s.t)
    if (s.zoom !== 1 || s.motion) {
      scene.view = { center: { x: s.zx * width, y: s.zy * height }, scale: s.zoom }
      if (motion) motion = { ...motion, views: motion.views.map(() => scene.view) }
    }
    if (scene.cursor && s.cursor) scene.cursor.image = s.cursor
    if (s.loupe && scene.cursor) scene.loupe = { x: scene.cursor.x, y: scene.cursor.y, radius: 150 * scene.unit, scale: 2.2, opacity: 1 }
    if (s.overlay) scene.keystrokes = [{ keys: ['⌘', 'K'], opacity: 1, age: 0.2 }]
    if (s.motion) {
      const n = 9
      const views = Array.from({ length: n }, (_, i) => ({ ...scene.view, scale: scene.view.scale * (1 + s.motion * (i / (n - 1) - 0.5)) }))
      motion = { views, cursors: motion?.cursors ?? views.map(() => scene.cursor) }
    }
    return { scene, motion }
  }

  async function draw(r: Renderer, width: number, height: number) {
    const { scene, motion } = sceneFor(project(), width, height)
    const screen = scene.screen ? await frameAt(screenVideo, scene.src) : null
    const camera = scene.camera ? await frameAt(cameraVideo, scene.camera.src) : null
    const matte = scene.camera?.removeBackground ? await frameAt(matteVideo, scene.camera.src) : null
    try {
      await r.draw(scene, { screen, camera, matte }, motion)
    } finally {
      screen?.close()
      camera?.close()
      matte?.close()
    }
  }

  let snap: ImageData | null = null

  function render(snapshot = false): Promise<void> {
    busy = busy.then(async () => {
      if (!renderer || !base) return
      const { width, height } = outputSize(project(), s.height)
      const t0 = performance.now()
      await draw(renderer, width, height)
      drawInspector()
      if (snapshot) {
        const ctx = new OffscreenCanvas(width, height).getContext('2d')!
        ctx.drawImage(canvas, 0, 0)
        snap = ctx.getImageData(0, 0, width, height)
      }
      await renderer.finished()
      status = `${width}x${height} t=${s.t.toFixed(2)}s ${(performance.now() - t0).toFixed(1)} ms`
    }).catch((e) => {
      status = 'error: ' + (e?.message ?? e)
      console.error(e)
    })
    return busy
  }

  function drawInspector() {
    const ctx = inspector.getContext('2d')!
    const k = s.inspect
    const w = inspector.width / k, h = inspector.height / k
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, inspector.width, inspector.height)
    ctx.drawImage(canvas, s.ix * canvas.width - w / 2, s.iy * canvas.height - h / 2, w, h, 0, 0, inspector.width, inspector.height)
  }

  /** The preview canvas as RGBA bytes, read right after a render. */
  async function capture(): Promise<ImageData> {
    await render(true)
    return snap!
  }

  async function hash(d: ImageData): Promise<string> {
    const h = await crypto.subtle.digest('SHA-256', new Uint8Array(d.data))
    return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  /** The current render as a base64 PNG at full output resolution. */
  async function png(patch: Partial<typeof s> = {}): Promise<string> {
    Object.assign(s, patch)
    const d = await capture()
    const c = new OffscreenCanvas(d.width, d.height)
    c.getContext('2d')!.putImageData(d, 0, 0)
    const bytes = new Uint8Array(await (await c.convertToBlob()).arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }

  /** Same scene through an OffscreenCanvas renderer (the export path); returns both hashes. */
  async function offscreen() {
    const a = await capture()
    const c = new OffscreenCanvas(a.width, a.height)
    const r = await Renderer.create(c, url)
    await draw(r, a.width, a.height)
    const bmp = c.transferToImageBitmap()
    const c2 = new OffscreenCanvas(a.width, a.height).getContext('2d')!
    c2.drawImage(bmp, 0, 0)
    r.destroy()
    return { preview: await hash(a), offscreen: await hash(c2.getImageData(0, 0, a.width, a.height)) }
  }

  /** GPU throughput at an output height: frames per second over `n` frames (one decoded frame reused). */
  async function bench(n = 120, height = 2160) {
    const p = project()
    const { width } = outputSize(p, height)
    const c = new OffscreenCanvas(width, height)
    const r = await Renderer.create(c, url)
    const { scene, motion } = sceneFor(p, width, height)
    const screen = await frameAt(screenVideo, scene.src)
    const camera = scene.camera ? await frameAt(cameraVideo, scene.camera.src) : null
    const matte = scene.camera?.removeBackground ? await frameAt(matteVideo, scene.camera.src) : null
    await r.draw(scene, { screen, camera, matte }, motion)
    await r.finished()
    const t0 = performance.now()
    for (let i = 0; i < n; i++) {
      await r.draw(scene, { screen, camera, matte }, motion)
      if (i % 4 === 3) await r.finished() // keep a few frames in flight, like an encoder would
    }
    await r.finished()
    const ms = (performance.now() - t0) / n
    screen.close()
    camera?.close()
    matte?.close()
    r.destroy()
    return { width, height, msPerFrame: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1) }
  }

  onMount(() => {
    ;(window as any).lab = { s, render, capture, hash, offscreen, bench, png, set: (patch: Partial<typeof s>) => (Object.assign(s, patch), render()) }
    ;(async () => {
      if (!bundle) return (status = 'Open with #/dev?lab=Render&project=<absolute path of a .studio bundle>')
      base = (await invoke('projects:open', bundle)).project as Project
      if (base.sources.events) events = parseEvents(await (await fetch(url(base.sources.events))).text())
      if (base.sources.screen) screenVideo.src = url(base.sources.screen.file)
      if (base.sources.camera) cameraVideo.src = url(base.sources.camera.file)
      if (base.sources.camera?.matte) matteVideo.src = url(base.sources.camera.matte)
      if (base.sources.camera?.faces) faces = await (await fetch(url(base.sources.camera.faces))).json()
      await Promise.all([screenVideo, cameraVideo, matteVideo].filter((v) => v.src).map((v) => new Promise((r) => v.addEventListener('loadeddata', r, { once: true }))))
      renderer = await Renderer.create(canvas, url)
      status = 'ready'
      await render()
      thumbs = await wallpaperThumbnails()
    })().catch((e) => {
      status = 'error: ' + (e?.message ?? e)
      console.error(e)
    })
    return () => renderer?.destroy()
  })

  $effect(() => {
    JSON.stringify(s)
    if (renderer) render()
  })
</script>

<div class="lab">
  <aside>
    <label>t <input type="range" min="0" max="23.9" step="0.05" bind:value={s.t} /> {s.t.toFixed(2)}</label>
    <label>height <select bind:value={s.height}><option value={480}>480</option><option value={720}>720</option><option value={1080}>1080</option><option value={2160}>2160</option></select></label>
    <label>aspect <select bind:value={s.aspect}>{#each ['auto', '16:9', '9:16', '4:5', '1:1', '{"w":21,"h":9}'] as a}<option value={a}>{a}</option>{/each}</select></label>
    <label>background <select bind:value={s.bg}>
      {#each WALLPAPERS as w}<option value={'wallpaper:' + w.id}>{w.name}</option>{/each}
      <option value="gradient:#ff7a59,#7b5cff">Gradient</option>
      <option value="color:#202227">Dark color</option>
      <option value="color:#f2f2f4">Light color</option>
      <option value="image:sources/missing.jpg">Missing image</option>
    </select></label>
    <label>blur <input type="range" min="0" max="1" step="0.05" bind:value={s.blur} /></label>
    <label>padding <input type="range" min="0" max="200" step="2" bind:value={s.padding} /> {s.padding}</label>
    <label>radius <input type="range" min="0" max="60" step="1" bind:value={s.radius} /> {s.radius}</label>
    <label>shadow <input type="range" min="0" max="1" step="0.05" bind:value={s.shadow} /></label>
    <label>device <select bind:value={s.device}>{#each ['none', 'macbook', 'iphone', 'ipad'] as d}<option>{d}</option>{/each}</select></label>
    <label>layout <select bind:value={s.layout}>{#each ['pip', 'fullscreen', 'hidden', 'split'] as k}<option>{k}</option>{/each}</select></label>
    <label>camera <select bind:value={s.shape}>{#each ['rounded', 'circle', 'square'] as k}<option>{k}</option>{/each}</select></label>
    <label>position <select bind:value={s.position}>{#each ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as k}<option>{k}</option>{/each}</select></label>
    <label><input type="checkbox" bind:checked={s.mirror} /> mirror</label>
    <label><input type="checkbox" bind:checked={s.masks} /> masks</label>
    <label><input type="checkbox" bind:checked={s.loupe} /> loupe</label>
    <label><input type="checkbox" bind:checked={s.removeBg} /> remove background</label>
    <label><input type="checkbox" bind:checked={s.followFace} /> follow face</label>
    <label><input type="checkbox" bind:checked={s.lut} /> LUT</label>
    <label><input type="checkbox" bind:checked={s.overlay} /> overlay</label>
    <label>zoom <input type="range" min="1" max="4" step="0.05" bind:value={s.zoom} /> {s.zoom}</label>
    <label>motion <input type="range" min="0" max="0.3" step="0.01" bind:value={s.motion} /></label>
    <label>cursor <select bind:value={s.cursor}><option value="">recorded</option><option>arrow</option><option>pointer</option><option>ibeam</option></select></label>
    <p class="status">{status}</p>
  </aside>
  <main>
    <canvas bind:this={canvas}></canvas>
    <div class="bottom">
      <canvas class="inspector" bind:this={inspector} width="360" height="200"></canvas>
      <div class="thumbs">
        {#each WALLPAPERS as w}
          <button class:on={s.bg === 'wallpaper:' + w.id} onclick={() => (s.bg = 'wallpaper:' + w.id)} title={w.name}>
            {#if thumbs.get(w.id)}<img src={thumbs.get(w.id)} alt={w.name} />{/if}
          </button>
        {/each}
      </div>
    </div>
  </main>
  <video bind:this={screenVideo} muted playsinline preload="auto" crossorigin="anonymous"></video>
  <video bind:this={cameraVideo} muted playsinline preload="auto" crossorigin="anonymous"></video>
  <video bind:this={matteVideo} muted playsinline preload="auto" crossorigin="anonymous"></video>
</div>

<style>
  .lab { display: flex; height: 100vh; background: var(--bg); }
  aside { width: 230px; padding: 10px; display: flex; flex-direction: column; gap: 6px; overflow: auto; border-right: 1px solid var(--border); font-size: 12px; }
  aside label { display: flex; align-items: center; gap: 6px; }
  aside input[type='range'] { flex: 1; min-width: 0; }
  .status { color: var(--text-dim); font: 11px var(--mono); word-break: break-all; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 10px; gap: 10px; }
  main > canvas { flex: 1; min-height: 0; width: 100%; object-fit: contain; }
  .bottom { display: flex; gap: 10px; height: 200px; }
  .inspector { image-rendering: pixelated; border: 1px solid var(--border); }
  .thumbs { display: grid; grid-template-columns: repeat(7, 72px); gap: 6px; align-content: start; }
  .thumbs button { width: 72px; height: 45px; padding: 0; border: 2px solid transparent; border-radius: 6px; overflow: hidden; background: var(--bg-raised); }
  .thumbs button.on { border-color: var(--accent); }
  .thumbs img { width: 100%; height: 100%; display: block; }
  video { display: none; }
</style>
