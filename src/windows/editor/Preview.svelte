<!-- The preview: a canvas the player renders into, letterboxed to the output aspect (pure CSS: container
     query units). Clicking or dragging on it aims the selected zooms, or draws and moves the selected mask;
     dragging the camera moves it to the corner it is dropped in. Hit-testing uses the same Scene the
     renderer draws, so it matches. -->
<script lang="ts">
  import { untrack } from 'svelte'
  import { doc, edit, selection } from '../../lib/doc.svelte.ts'
  import { player, attach } from '../../lib/player.svelte.ts'
  import { prepare, sceneAt, outputSize, type Prepared, type Scene } from '../../engine/scene.ts'
  import type { CameraPosition } from '../../shared/project.ts'
  import { cornerAt, outputPoint, reason, screenPoint } from './helpers.ts'

  const project = $derived(doc.project!)
  // Geometry is resolution independent (style units scale with min(width, height)), so any output
  // size works for hit-testing; 1080p keeps the numbers familiar.
  const size = $derived(outputSize(project, 1080))
  const zooms = $derived(project.zooms.filter((z) => selection.ids.includes(z.id)))
  const mask = $derived(zooms.length ? undefined : project.masks.find((m) => selection.ids.includes(m.id)))

  let frame = $state<HTMLElement>()
  let failed = $state('')

  /** Hand the canvas to the player for the component's lifetime. */
  function render(canvas: HTMLCanvasElement) {
    try {
      return untrack(() => attach(canvas))
    } catch (e) {
      failed = reason(e)
    }
  }

  let cache: { rev: number; events: unknown; w: number; h: number; prepared: Prepared } | undefined
  function scene(): Scene | null {
    const { width: w, height: h } = size
    try {
      if (!cache || cache.rev !== doc.rev || cache.events !== doc.events || cache.w !== w || cache.h !== h) {
        const prepared = prepare({ project: $state.snapshot(project), events: doc.events, transcript: doc.transcript, width: w, height: h })
        cache = { rev: doc.rev, events: doc.events, w, h, prepared }
      }
      return sceneAt(cache.prepared, player.time)
    } catch {
      return null // an engine module mid-rewrite must not take the editor down
    }
  }

  /** Pointer position in output px of the 1080p hit-test frame. */
  function local(e: PointerEvent) {
    const r = frame!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * size.width, y: ((e.clientY - r.top) / r.height) * size.height }
  }

  const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

  // Zoom target marker for the first selected point zoom, in % of the frame.
  const marker = $derived.by(() => {
    const z = zooms[0]
    if (!z || z.target.kind !== 'point') return null
    doc.rev
    player.time
    const s = untrack(scene)
    const p = s && outputPoint(s, z.target.x, z.target.y)
    return p && { x: (p.x / s.width) * 100, y: (p.y / s.height) * 100 }
  })

  // The selected mask's area, in % of the frame (it zooms with the content).
  const maskBox = $derived.by(() => {
    if (!mask) return null
    doc.rev
    player.time
    const s = untrack(scene)
    const r = mask.rect
    const a = s && outputPoint(s, r.x, r.y)
    const b = s && outputPoint(s, r.x + r.w, r.y + r.h)
    return a && b && { left: pct(a.x, s.width), top: pct(a.y, s.height), width: pct(b.x - a.x, s.width), height: pct(b.y - a.y, s.height) }
  })

  let gesture = 0
  let aiming = false
  // Dragging inside the selected mask moves it; dragging anywhere else draws it anew. Screen-normalized.
  let shaping: { id: string; from: { x: number; y: number }; move: { x: number; y: number } | null } | null = null

  function shape(e: PointerEvent) {
    const s = scene()
    const p = s && screenPoint(s, local(e).x, local(e).y)
    if (!p || !shaping) return
    const { id, from, move } = shaping
    edit((pr) => {
      const m = pr.masks.find((x) => x.id === id)
      if (!m) return
      if (move) {
        m.rect = { ...m.rect, x: Math.min(Math.max(p.x - move.x, 0), 1 - m.rect.w), y: Math.min(Math.max(p.y - move.y, 0), 1 - m.rect.h) }
      } else {
        const w = Math.abs(p.x - from.x)
        const h = Math.abs(p.y - from.y)
        if (w > 0.005 && h > 0.005) m.rect = { x: Math.min(p.x, from.x), y: Math.min(p.y, from.y), w, h }
      }
    }, `mask:${gesture}`)
  }
  let drag = $state<{ ox: number; oy: number; x: number; y: number; w: number; h: number; corner: CameraPosition } | null>(null)
  let hover = $state<'camera' | 'aim' | 'move' | ''>('')
  const onMask = (q: { x: number; y: number }) => !!mask && inside(q, mask.rect)

  function aim(e: PointerEvent) {
    const s = scene()
    const p = s && screenPoint(s, local(e).x, local(e).y)
    if (!p) return
    const ids = zooms.map((z) => z.id)
    edit((pr) => {
      for (const z of pr.zooms) if (ids.includes(z.id)) z.target = { kind: 'point', x: p.x, y: p.y }
    }, `aim:${gesture}`)
  }

  function pointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    const s = scene()
    const p = local(e)
    const cam = s?.camera
    if (cam && cam.opacity > 0.01 && inside(p, cam.rect)) {
      const { x, y, w, h } = cam.rect
      drag = { ox: p.x - x, oy: p.y - y, x, y, w, h, corner: project.style.camera.position }
    } else if (zooms.length) {
      aiming = true
      gesture++
      aim(e)
    } else if (mask && s) {
      const q = screenPoint(s, p.x, p.y)
      if (!q) return
      shaping = { id: mask.id, from: q, move: onMask(q) ? { x: q.x - mask.rect.x, y: q.y - mask.rect.y } : null }
      gesture++
    } else return
    frame!.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function pointermove(e: PointerEvent) {
    const p = local(e)
    if (drag) {
      const x = p.x - drag.ox
      const y = p.y - drag.oy
      drag = { ...drag, x, y, corner: cornerAt(x + drag.w / 2, y + drag.h / 2, size.width, size.height) }
    } else if (aiming) aim(e)
    else if (shaping) shape(e)
    else if (e.buttons === 0) {
      const s = scene()
      const cam = s?.camera
      const q = mask && s && screenPoint(s, p.x, p.y)
      hover = cam && cam.opacity > 0.01 && inside(p, cam.rect) ? 'camera' : q && onMask(q) ? 'move' : zooms.length || mask ? 'aim' : ''
    }
  }

  function pointerup() {
    if (drag && drag.corner !== project.style.camera.position) {
      const corner = drag.corner
      edit((p) => (p.style.camera.position = corner))
    }
    drag = null
    aiming = false
    shaping = null
  }

  const pct = (v: number, of: number) => `${(v / of) * 100}%`
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && drag && ((drag = null), e.preventDefault())} />

<div class="viewport">
  <div class="fit">
    <div
      bind:this={frame}
      class="frame {hover}"
      class:dragging={drag}
      style:--ar={size.width / size.height}
      role="presentation"
      onpointerdown={pointerdown}
      onpointermove={pointermove}
      onpointerup={pointerup}
      onpointercancel={() => ((drag = null), (aiming = false), (shaping = null))}
      onpointerleave={() => !drag && !aiming && (hover = '')}
    >
      <canvas {@attach render}>Video preview</canvas>
      {#if marker}
        <span class="marker" style:left="{marker.x}%" style:top="{marker.y}%" aria-hidden="true"></span>
      {/if}
      {#if maskBox}
        <span class="mask-box" style:left={maskBox.left} style:top={maskBox.top} style:width={maskBox.width} style:height={maskBox.height} aria-hidden="true"></span>
      {/if}
      {#if drag}
        <span class="quadrant {drag.corner}" aria-hidden="true"></span>
        <span class="ghost" style:left={pct(drag.x, size.width)} style:top={pct(drag.y, size.height)} style:width={pct(drag.w, size.width)} style:height={pct(drag.h, size.height)} aria-hidden="true"></span>
      {/if}
      {#if failed}<p class="failed" role="alert">Preview unavailable: {failed}</p>
      {:else if player.error}<p class="failed" role="alert">{player.error}</p>{/if}
    </div>
  </div>
</div>

<style>
  .viewport { position: relative; flex: 1; min-height: 0; display: flex; padding: 4px 24px 10px; }
  .fit { flex: 1; min-width: 0; container-type: size; display: grid; place-items: center; }
  .frame {
    position: relative; aspect-ratio: var(--ar); width: min(100cqw, 100cqh * var(--ar));
    background: #0a0a0b; box-shadow: 0 0 0 1px var(--border); overflow: hidden; touch-action: none;
  }
  .frame.aim { cursor: crosshair; }
  .frame.move { cursor: move; }
  .frame.camera { cursor: grab; }
  .frame.dragging { cursor: grabbing; }
  canvas { display: block; width: 100%; height: 100%; }
  .marker {
    position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; pointer-events: none;
    border: 2px solid #fff; background: var(--accent); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35), 0 2px 8px rgb(0 0 0 / 0.5);
  }
  .mask-box { position: absolute; border: 1.5px dashed #fff; border-radius: 3px; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35); pointer-events: none; }
  .ghost { position: absolute; border-radius: 10px; border: 2px solid #fff; background: rgb(255 255 255 / 0.12); box-shadow: 0 6px 24px rgb(0 0 0 / 0.45); pointer-events: none; }
  .quadrant { position: absolute; width: 50%; height: 50%; background: var(--accent-soft); pointer-events: none; transition: inset 160ms var(--ease-out); }
  .quadrant.top-left { left: 0; top: 0; }
  .quadrant.top-right { left: 50%; top: 0; }
  .quadrant.bottom-left { left: 0; top: 50%; }
  .quadrant.bottom-right { left: 50%; top: 50%; }
  .failed { position: absolute; inset: auto 0 0; margin: 0; padding: 10px 14px; background: rgb(0 0 0 / 0.6); color: var(--text-dim); font-size: 12px; text-align: center; }
</style>
