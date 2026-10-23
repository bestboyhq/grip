<!-- Crop the screen recording: the whole frame at the playhead with the crop on top. Drag an edge or
     corner to resize it (⇧ keeps its shape, ⌥ resizes from the center), its inside to move it, or
     outside it to draw a new one; or type its size and position in recording pixels. The draft
     becomes the project's crop, one undo step, on Confirm. -->
<script lang="ts">
  import { untrack } from 'svelte'
  import { doc, edit } from '../../lib/doc.svelte.ts'
  import { currentScene, pause } from '../../lib/player.svelte.ts'
  import { fileUrl } from '../../engine/media/index.ts'
  import { screenCrop, type Rect } from '../../shared/project.ts'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'
  import { tooltip } from '../../ui/tooltip.ts'
  import { dragCrop, type CropHandle } from './helpers.ts'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  const MIN = 32 // recording px, the smallest side
  const RATIOS: Array<[string, number]> = [['Any', 0], ['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['4:5', 4 / 5], ['9:16', 9 / 16]]
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
  const CURSORS: Record<CropHandle | 'new', string> = {
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move', new: 'crosshair',
  }

  const screen = $derived(doc.project?.sources.screen)
  const W = $derived(screen?.width ?? 1)
  const H = $derived(screen?.height ?? 1)

  let dialog: HTMLDialogElement
  let frame = $state<HTMLElement>()
  let r = $state<Rect>({ x: 0, y: 0, w: 1, h: 1 }) // the draft, recording px
  let ratio = $state(0) // locked w / h, 0 = any
  let at = $state(0) // source seconds of the frame shown
  // A drag from pointer (x, y) on `from`; 'new' draws a crop from `p` once the pointer moves.
  let drag = $state<{ handle: CropHandle | 'new'; from: Rect; x: number; y: number; p: { x: number; y: number } } | null>(null)

  const full = $derived(r.x === 0 && r.y === 0 && r.w === W && r.h === H)
  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  const opts = (lock = ratio, center = false) => ({ W, H, ratio: lock, center, min: MIN })

  $effect(() => {
    if (open && !dialog.open) {
      untrack(begin)
      dialog.showModal()
    } else if (!open && dialog.open) dialog.close()
  })

  function begin() {
    pause()
    const c = screenCrop(doc.project!)
    r = { x: Math.round(c.x * W), y: Math.round(c.y * H), w: Math.round(c.w * W), h: Math.round(c.h * H) }
    ratio = 0
    drag = null
    at = currentScene()?.src ?? 0
  }

  function confirm() {
    const c = full ? undefined : { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H }
    if (JSON.stringify(c) !== JSON.stringify(doc.project?.crop)) {
      edit((p) => {
        if (c) p.crop = c
        else delete p.crop
      })
    }
    open = false
  }

  function setSize(key: 'w' | 'h', v: number) {
    if (!(v > 0)) return
    let w = key === 'w' ? v : r.w
    let h = key === 'h' ? v : r.h
    if (ratio) key === 'w' ? (h = w / ratio) : (w = h * ratio)
    // Moved back first when the new size would reach past the recording's edge.
    const from = { ...r, x: Math.max(0, Math.min(r.x, W - w)), y: Math.max(0, Math.min(r.y, H - h)) }
    r = dragCrop(from, 'se', w - r.w, h - r.h, opts())
  }

  const setPos = (key: 'x' | 'y', v: number) => Number.isFinite(v) && (r = dragCrop(r, 'move', key === 'x' ? v - r.x : 0, key === 'y' ? v - r.y : 0, opts()))

  /** Lock the shape: the largest crop of it inside the current one, centered on it. */
  function setRatio(k: number) {
    ratio = k
    if (!k) return
    const w = Math.min(r.w, r.h * k)
    const h = w / k
    r = dragCrop({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }, 'move', 0, 0, opts())
  }

  function reset() {
    r = { x: 0, y: 0, w: W, h: H }
    ratio = 0
  }

  function pointerdown(e: PointerEvent) {
    if (e.button !== 0 || !frame) return
    const b = frame.getBoundingClientRect()
    const p = { x: Math.min(Math.max(((e.clientX - b.left) / b.width) * W, 0), W), y: Math.min(Math.max(((e.clientY - b.top) / b.height) * H, 0), H) }
    const handle = (e.target as HTMLElement).dataset.handle as CropHandle | undefined
    const inside = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    drag = { handle: handle ?? (inside ? 'move' : 'new'), from: r, x: e.clientX, y: e.clientY, p }
    frame.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function pointermove(e: PointerEvent) {
    if (!drag || !frame) return
    const b = frame.getBoundingClientRect()
    const dx = ((e.clientX - drag.x) / b.width) * W
    const dy = ((e.clientY - drag.y) / b.height) * H
    let { handle, from } = drag
    if (handle === 'new') {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return // a click outside is not a crop
      handle = `${dy < 0 ? 'n' : 's'}${dx < 0 ? 'w' : 'e'}` as CropHandle
      from = { ...drag.p, w: 0, h: 0 }
    }
    const resize = handle !== 'move'
    const lock = ratio || (e.shiftKey && resize ? (from.h ? from.w / from.h : 1) : 0)
    r = dragCrop(from, handle, dx, dy, opts(lock, e.altKey && resize))
  }

  function keydown(e: KeyboardEvent) {
    e.stopPropagation() // the editor's shortcuts (Space plays, ⌫ deletes) wait until the crop is done
    if (e.key === 'Escape' && drag) {
      r = drag.from
      drag = null
      e.preventDefault()
      return
    }
    const t = e.target
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Enter' && !(t instanceof HTMLButtonElement)) {
      e.preventDefault()
      confirm()
      return
    }
    const d = e.shiftKey ? 10 : 1
    const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
    const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
    if (!dx && !dy) return
    e.preventDefault()
    r = dragCrop(r, 'move', dx, dy, opts())
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} onkeydown={keydown} aria-labelledby="crop-title">
  {#if open && screen}
    <div class="sheet">
      <header>
        <h2 id="crop-title">Crop</h2>
        <span class="label">Size</span>
        <input type="number" min={MIN} max={W} step="1" value={r.w} aria-label="Width in pixels" onchange={(e) => { setSize('w', Number(e.currentTarget.value)); e.currentTarget.value = String(r.w) }} />
        <span class="times" aria-hidden="true">×</span>
        <input type="number" min={MIN} max={H} step="1" value={r.h} aria-label="Height in pixels" onchange={(e) => { setSize('h', Number(e.currentTarget.value)); e.currentTarget.value = String(r.h) }} />
        <label class="pick">
          <Icon name="aspect" size={16} />
          <select aria-label="Shape" value={String(ratio)} onchange={(e) => setRatio(Number(e.currentTarget.value))}>
            {#each RATIOS as [label, k] (label)}<option value={String(k)}>{label}</option>{/each}
          </select>
          <Icon name="chevron" size={14} />
        </label>
        <span class="label">Position</span>
        <input type="number" min="0" max={W - r.w} step="1" value={r.x} aria-label="Left edge in pixels" onchange={(e) => { setPos('x', Number(e.currentTarget.value)); e.currentTarget.value = String(r.x) }} />
        <input type="number" min="0" max={H - r.h} step="1" value={r.y} aria-label="Top edge in pixels" onchange={(e) => { setPos('y', Number(e.currentTarget.value)); e.currentTarget.value = String(r.y) }} />
        <button class="btn reset" disabled={full && !ratio} onclick={reset} {@attach tooltip('Show the whole recording')}><Icon name="reset" size={15} />Reset</button>
        <Popover label="Crop shortcuts">
          {#snippet trigger(props)}
            <button class="icon-btn" aria-label="Shortcuts" {...props} {@attach tooltip('Shortcuts')}><Icon name="keyboard" /></button>
          {/snippet}
          <dl class="keys">
            <dt>Drag an edge or corner</dt><dd>Resize</dd>
            <dt>Drag outside the crop</dt><dd>Draw a new one</dd>
            <dt>⇧ while resizing</dt><dd>Keep the shape</dd>
            <dt>⌥ while resizing</dt><dd>Resize from the center</dd>
            <dt>Arrow keys</dt><dd>Move 1 px, with ⇧ 10 px</dd>
            <dt>↩</dt><dd>Confirm</dd>
            <dt>⎋</dt><dd>Discard</dd>
          </dl>
        </Popover>
      </header>

      <div class="stage">
        <div class="fit">
          <div
            bind:this={frame}
            class="frame"
            style:--ar={W / H}
            style:cursor={drag ? CURSORS[drag.handle] : undefined}
            role="presentation"
            onpointerdown={pointerdown}
            onpointermove={pointermove}
            onpointerup={() => (drag = null)}
            onpointercancel={() => (drag = null)}
          >
            <video src={fileUrl(`${doc.path}/${screen.file}`)} muted playsinline preload="auto" aria-hidden="true" {@attach (v) => { v.currentTime = at }}></video>
            <div class="shade" aria-hidden="true">
              <div class="hole" style:left={pct(r.x, W)} style:top={pct(r.y, H)} style:width={pct(r.w, W)} style:height={pct(r.h, H)}></div>
            </div>
            <div class="crop" style:left={pct(r.x, W)} style:top={pct(r.y, H)} style:width={pct(r.w, W)} style:height={pct(r.h, H)} aria-hidden="true">
              {#each [25, 50, 75] as k (k)}
                <span class="guide v" class:mid={k === 50} style:left="{k}%"></span>
                <span class="guide h" class:mid={k === 50} style:top="{k}%"></span>
              {/each}
              {#each HANDLES as h (h)}<span class="handle {h}" data-handle={h}></span>{/each}
            </div>
          </div>
        </div>
      </div>

      <footer>
        <!-- svelte-ignore a11y_autofocus -->
        <button class="btn primary" autofocus onclick={confirm}>Confirm changes<kbd aria-hidden="true">↩</kbd></button>
        <button class="btn" onclick={() => (open = false)}>Discard changes</button>
      </footer>
    </div>
  {/if}
</dialog>

<style>
  dialog { max-width: none; max-height: none; padding: 0; border: 0; background: transparent; color: var(--fg-default); overflow: visible; }
  dialog::backdrop { background: rgb(0 0 0 / 0.45); }
  .sheet {
    display: flex; flex-direction: column; width: min(1280px, 100vw - 64px); height: min(900px, 100vh - 64px);
    border-radius: var(--radius-lg); background: var(--surface-root); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: come var(--come) var(--ease-out);
  }

  header { flex: none; display: flex; align-items: center; gap: 6px; height: 52px; padding: 0 12px 0 20px; box-shadow: var(--hairline-b); }
  h2 { margin: 0 auto 0 0; font-size: 13px; font-weight: 600; }
  .label { margin: 0 2px 0 10px; color: var(--fg-secondary); font-size: 12.5px; }
  .times { color: var(--fg-faint); font-size: 12px; }
  input {
    width: 64px; height: var(--control-h); padding: 0 6px; border: 0; border-radius: var(--radius-sm);
    background: var(--surface-100); box-shadow: var(--hairline); font-size: 12.5px; text-align: center; font-variant-numeric: tabular-nums;
  }
  input::-webkit-inner-spin-button { display: none; }
  .pick { position: relative; display: flex; align-items: center; height: var(--control-h); margin-left: 4px; border-radius: var(--radius-sm); background: var(--surface-100); box-shadow: var(--hairline); }
  .pick:hover { background: var(--surface-hover); }
  .pick:has(select:focus-visible) { outline: 2px solid var(--brand); }
  .pick > :global(.icon:first-child) { position: absolute; left: 8px; color: var(--fg-secondary); pointer-events: none; }
  .pick > :global(.icon:last-child) { position: absolute; right: 6px; color: var(--fg-secondary); pointer-events: none; }
  select { field-sizing: content; min-width: 84px; height: 100%; padding: 0 26px 0 30px; border: 0; background: none; appearance: none; font-size: 12.5px; font-weight: 500; }
  select:focus-visible { outline: none; }
  .reset { margin-left: 10px; padding: 0 10px 0 8px; }
  .reset :global(.icon) { color: var(--fg-secondary); }
  .keys { display: grid; grid-template-columns: auto auto; gap: 6px 16px; margin: 0; padding: 6px 8px; font-size: 12px; }
  .keys dt { color: var(--fg-default); }
  .keys dd { margin: 0; color: var(--fg-secondary); }

  .stage { flex: 1; min-height: 0; display: flex; padding: 32px; background: var(--control-track); }
  .fit { flex: 1; min-width: 0; container-type: size; display: grid; place-items: center; }
  .frame { position: relative; aspect-ratio: var(--ar); width: min(100cqw, 100cqh * var(--ar)); background: #000; cursor: crosshair; touch-action: none; }
  video { display: block; width: 100%; height: 100%; object-fit: fill; pointer-events: none; }
  .shade { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .hole { position: absolute; box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.6); }
  .crop { position: absolute; cursor: move; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.85), 0 0 0 2px rgb(0 0 0 / 0.25); }
  .guide { position: absolute; pointer-events: none; border: 0 dashed rgb(255 255 255 / 0.5); filter: drop-shadow(0 0 0.5px rgb(0 0 0 / 0.7)); } /* reads on light and dark */
  .guide.v { top: 0; bottom: 0; border-left-width: 1px; }
  .guide.h { left: 0; right: 0; border-top-width: 1px; }
  .guide.mid { border-color: rgb(255 255 255 / 0.75); }

  /* Corners grab a 24 px square, edges their whole length; each shows a ring at its middle. */
  .handle { position: absolute; display: grid; place-items: center; }
  .handle::after {
    content: ''; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid #fff; background: rgb(0 0 0 / 0.45);
    box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.4), 0 1px 3px rgb(0 0 0 / 0.4);
  }
  .nw, .ne, .se, .sw { width: 24px; height: 24px; }
  .nw { left: -12px; top: -12px; cursor: nwse-resize; }
  .ne { right: -12px; top: -12px; cursor: nesw-resize; }
  .se { right: -12px; bottom: -12px; cursor: nwse-resize; }
  .sw { left: -12px; bottom: -12px; cursor: nesw-resize; }
  .n, .s { left: 12px; right: 12px; height: 16px; cursor: ns-resize; }
  .n { top: -8px; }
  .s { bottom: -8px; }
  .e, .w { top: 12px; bottom: 12px; width: 16px; cursor: ew-resize; }
  .e { right: -8px; }
  .w { left: -8px; }

  footer { flex: none; display: flex; justify-content: center; gap: 8px; padding: 14px; box-shadow: var(--hairline-t); }
  footer .btn { height: 30px; padding: 0 14px; }
  kbd { margin-left: 2px; font: inherit; opacity: 0.55; }
</style>
