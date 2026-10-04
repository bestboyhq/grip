<!-- The preview: a canvas the player renders into, letterboxed to the output aspect (pure CSS: container
     query units). Clicking or dragging on it aims the selected zooms, or draws and moves the selected mask;
     dragging the camera moves it to the corner it is dropped in. Hit-testing uses the same Scene the
     renderer draws, so it matches. -->
<script lang="ts">
  import { untrack } from 'svelte'
  import { doc, edit, selection } from '../../lib/doc.svelte.ts'
  import { player, attach, currentScene } from '../../lib/player.svelte.ts'
  import { outputSize, type Scene } from '../../engine/scene.ts'
  import type { CameraPosition } from '../../shared/project.ts'
  import { cornerAt, outputPoint, reason, screenPoint } from './helpers.ts'

  const project = $derived(doc.project!)
  const size = $derived(outputSize(project, 1080)) // the frame's aspect
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

  /** The frame the preview shows (the player's own preparation, so hit-testing sees exactly what is
   *  drawn: a camera hidden while silent, face-follow crops, the zoomed-in camera size). */
  function scene(): Scene | null {
    try {
      return currentScene()
    } catch {
      return null // an engine module mid-rewrite must not take the editor down
    }
  }

  /** Pointer position in px of scene s. */
  function local(e: PointerEvent, s: { width: number; height: number }) {
    const r = frame!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * s.width, y: ((e.clientY - r.top) / r.height) * s.height }
  }

  const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

  // Zoom target marker for the first selected point zoom, in % of the frame.
  const marker = $derived.by(() => {
    const z = zooms[0]
    if (!z || z.target.kind !== 'point') return null
    player.prepared
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
    const p = s && screenPoint(s, local(e, s).x, local(e, s).y)
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
  // In px of the scene the drag started on (W x H).
  let drag = $state<{ W: number; H: number; ox: number; oy: number; x: number; y: number; w: number; h: number; r: number; corner: CameraPosition } | null>(null)
  let hover = $state<'camera' | 'aim' | 'move' | ''>('')
  const onMask = (q: { x: number; y: number }) => !!mask && inside(q, mask.rect)

  function aim(e: PointerEvent) {
    const s = scene()
    const p = s && screenPoint(s, local(e, s).x, local(e, s).y)
    if (!p) return
    const ids = zooms.map((z) => z.id)
    edit((pr) => {
      for (const z of pr.zooms) if (ids.includes(z.id)) z.target = { kind: 'point', x: p.x, y: p.y }
    }, `aim:${gesture}`)
  }

  function pointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    const s = scene()
    const p = s && local(e, s)
    const cam = s?.camera
    if (s && p && cam && cam.opacity > 0.01 && inside(p, cam.rect)) {
      const { x, y, w, h } = cam.rect
      drag = { W: s.width, H: s.height, ox: p.x - x, oy: p.y - y, x, y, w, h, r: cam.radius, corner: project.style.camera.position }
    } else if (zooms.length) {
      aiming = true
      gesture++
      aim(e)
    } else if (mask && s && p) {
      const q = screenPoint(s, p.x, p.y)
      if (!q) return
      shaping = { id: mask.id, from: q, move: onMask(q) ? { x: q.x - mask.rect.x, y: q.y - mask.rect.y } : null }
      gesture++
    } else return
    frame!.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function pointermove(e: PointerEvent) {
    if (drag) {
      const p = local(e, { width: drag.W, height: drag.H })
      const x = p.x - drag.ox
      const y = p.y - drag.oy
      drag = { ...drag, x, y, corner: cornerAt(x + drag.w / 2, y + drag.h / 2, drag.W, drag.H) }
    } else if (aiming) aim(e)
    else if (shaping) shape(e)
    else if (e.buttons === 0) {
      const s = scene()
      const cam = s?.camera
      const p = s && local(e, s)
      const q = mask && s && p && screenPoint(s, p.x, p.y)
      hover = p && cam && cam.opacity > 0.01 && inside(p, cam.rect) ? 'camera' : q && onMask(q) ? 'move' : zooms.length || mask ? 'aim' : ''
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
        <span class="ghost" style:left={pct(drag.x, drag.W)} style:top={pct(drag.y, drag.H)} style:width={pct(drag.w, drag.W)} style:height={pct(drag.h, drag.H)} style:border-radius="{pct(drag.r, drag.w)} / {pct(drag.r, drag.h)}" aria-hidden="true"></span>
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
  .ghost { position: absolute; border: 2px solid #fff; background: rgb(255 255 255 / 0.12); box-shadow: 0 6px 24px rgb(0 0 0 / 0.45); pointer-events: none; }
  .quadrant { position: absolute; width: 50%; height: 50%; background: var(--accent-soft); pointer-events: none; transition: inset 160ms var(--ease-out); }
  .quadrant.top-left { left: 0; top: 0; }
  .quadrant.top-right { left: 50%; top: 0; }
  .quadrant.bottom-left { left: 0; top: 50%; }
  .quadrant.bottom-right { left: 50%; top: 50%; }
  .failed { position: absolute; inset: auto 0 0; margin: 0; padding: 10px 14px; background: rgb(0 0 0 / 0.6); color: var(--text-dim); font-size: 12px; text-align: center; }
</style>
