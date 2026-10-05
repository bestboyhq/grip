<!-- Picking overlay, one transparent window per display (#/area?display=<id>).
     Display mode: highlight the hovered display. Window mode: highlight the window under the mouse,
     with preset sizes. Area mode: drag out a rectangle, resize it by its handles, type its size, lock
     an aspect; the last area is remembered. Then a 3-2-1 countdown over the recorded region. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke, on } from '../../lib/ipc.ts'
  import Icon from '../recorder/Icon.svelte'
  import { fromEngine, setSettings, shell, startRequest, toEngine, windowList, type Rect, type StartRequest, type WindowSource } from '../recorder/shell.svelte.ts'
  import { ASPECTS, constrain, formAt, presetFrame, presetSize, PRESETS, resize, type Handle } from './geometry.ts'

  let { params }: { params: URLSearchParams } = $props()

  interface DisplayInfo {
    id: number
    label: string
    bounds: Rect
    workArea: Rect
    scaleFactor: number
    toolbarTop: number // the recording toolbar's top edge, local points
  }
  let display = $state<DisplayInfo | null>(null)
  let windows = $state<WindowSource[]>([])
  let mouse = $state<{ x: number; y: number } | null>(null) // local points
  let locked = $state<WindowSource | null>(null) // keeps the window while the mouse is on its card
  let choice = $state({ id: 0, preset: 'current' }) // preset size picked for window `id`
  let target = $state<Rect | null>(null) // region being counted down, local points
  let count = $state(0)
  let drag = $state<{ kind: 'new' | 'move' | Handle; x: number; y: number; orig: Rect } | null>(null)
  let formW = $state(0)
  let formH = $state(0)

  const W = $derived(display?.bounds.width ?? innerWidth)
  const H = $derived(display?.bounds.height ?? innerHeight)
  const floor = $derived(display?.toolbarTop ?? H) // cards stay above the toolbar
  const scale = $derived(display?.scaleFactor ?? 2)
  const px = (pt: number) => Math.round(pt * scale)
  const toLocal = (r: Rect): Rect => ({ ...r, x: r.x - (display?.bounds.x ?? 0), y: r.y - (display?.bounds.y ?? 0) })
  const toGlobal = (r: Rect): Rect => ({ ...r, x: r.x + (display?.bounds.x ?? 0), y: r.y + (display?.bounds.y ?? 0) })
  const inside = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

  onMount(() => {
    invoke('shell:display', Number(params.get('display'))).then((d) => (display = d))
    const offs = [
      on('shell:escape', () => {
        target = null
        count = 0
      }),
    ]
    return () => offs.forEach((off) => off())
  })

  // Window mode: the engine's window list (front to back), minus our own windows.
  $effect(() => {
    if (shell.mode === 'window') windowList().then((list) => (windows = list))
  })
  const hovered = $derived(locked ?? (mouse && display ? (windows.find((w) => inside(toLocal(fromEngine(w.frame)), mouse!)) ?? null) : null))
  const preset = $derived(hovered && choice.id === hovered.id ? choice.preset : 'current')
  const frame = $derived(hovered && display ? toLocal(presetFrame(fromEngine(hovered.frame), preset, display.workArea)) : null)

  // Area mode: the remembered area (settings) belongs to one display; picking on another clears it
  // here. Local edits override it until they are saved back.
  const remembered = $derived(shell.settings?.area)
  let sel = $derived<Rect | null>(remembered && display && remembered.display === display.id ? constrain(remembered.rect, null, W, H) : null)
  let aspect = $derived(remembered?.aspect ?? 'free')
  const save = () => setSettings({ area: sel && display ? { display: display.id, rect: $state.snapshot(sel), aspect } : null })

  function down(e: PointerEvent, kind: 'new' | 'move' | Handle) {
    if (shell.mode !== 'area' || target || e.button !== 0) return
    e.stopPropagation()
    ;(document.body as Element).setPointerCapture(e.pointerId)
    const orig = kind === 'new' ? { x: e.clientX, y: e.clientY, width: 0, height: 0 } : sel!
    drag = { kind, x: e.clientX, y: e.clientY, orig }
    if (kind === 'new') sel = orig
  }
  function move(e: PointerEvent) {
    mouse = { x: e.clientX, y: e.clientY }
    if (!drag) return
    const { kind, orig } = drag
    if (kind === 'move') {
      const x = Math.min(Math.max(orig.x + e.clientX - drag.x, 0), W - orig.width)
      const y = Math.min(Math.max(orig.y + e.clientY - drag.y, 0), H - orig.height)
      sel = { ...orig, x, y }
    } else sel = resize(orig, kind === 'new' ? 'new' : kind, e.clientX, e.clientY, ASPECTS[aspect], W, H)
  }
  function up() {
    if (!drag) return
    const wasNew = drag.kind === 'new'
    drag = null
    if (sel && (sel.width < 32 || sel.height < 32)) sel = wasNew ? null : sel // a click is not an area
    save()
  }

  function setSize(axis: 'width' | 'height', input: HTMLInputElement) {
    if (!sel) return
    const value = +input.value
    if (Number.isFinite(value) && value > 0 && value !== px(sel[axis])) {
      const ratio = ASPECTS[aspect]
      const pt = value / scale
      const next = { ...sel, [axis]: pt }
      if (ratio) axis === 'width' ? (next.height = pt / ratio) : (next.width = pt * ratio)
      sel = constrain(next, ratio, W, H)
      save()
    }
    input.value = String(px(sel[axis])) // the size it really is: clamped to the display, or the entry undone
  }
  function setAspect(a: string) {
    aspect = a
    if (sel) sel = constrain(sel, ASPECTS[a], W, H)
    save()
  }

  const form = $derived(sel && formAt(sel, formW, formH, W, floor))

  let takes = 0 // countdowns started; a newer one (Esc, then start again) ends the older loop
  async function begin(req: StartRequest, region: Rect) {
    if (target) return
    const take = ++takes
    target = region
    invoke('shell:countdown', true)
    if (shell.settings?.countdown) {
      for (count = 3; count > 0; count--) {
        await new Promise((r) => setTimeout(r, 1000))
        if (!target || take !== takes) return // Esc, or a newer countdown owns `count`
      }
    }
    count = 0
    invoke('shell:start', req)
  }
  function startDisplay() {
    if (display) begin(startRequest({ kind: 'display', displayId: display.id }), { x: 0, y: 0, width: W, height: H })
  }
  function startWindow() {
    if (!hovered || !frame) return
    locked = hovered
    begin(startRequest({ kind: 'window', windowId: hovered.id, ...(preset === 'current' ? {} : { frame: toEngine(toGlobal(frame)) }) }), frame)
  }
  function startArea() {
    // The engine takes an area relative to its display, which is exactly the overlay's space.
    if (sel && display) begin(startRequest({ kind: 'area', displayId: display.id, rect: toEngine(sel) }), sel)
  }
  function key(e: KeyboardEvent) {
    if (e.key !== 'Enter' || target || (e.target as Element).tagName === 'INPUT') return
    if (shell.mode === 'area') startArea()
    else if (shell.mode === 'window') startWindow()
    else if (shell.mode === 'display' && mouse) startDisplay()
  }
  const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
</script>

<svelte:window onkeydown={key} />
<svelte:body onpointermove={move} onpointerup={up} onpointerleave={() => drag || (mouse = null)} />

{#snippet startButton(onclick: () => void)}
  <button class="start" {onclick}><span class="dot"></span>Start recording</button>
{/snippet}

<main class:area={shell.mode === 'area' && !target} onpointerdown={(e) => down(e, 'new')}>
  {#if target}
    {#if count > 0}
      <div class="target" style:left="{target.x}px" style:top="{target.y}px" style:width="{target.width}px" style:height="{target.height}px">
        {#key count}<div class="count" role="status" aria-live="assertive">{count}</div>{/key}
      </div>
    {/if}
  {:else if shell.counting}
    <!-- Another display is counting down. -->
  {:else if shell.mode === 'display'}
    <div class="display" role="presentation" onpointerenter={(e) => (mouse = { x: e.clientX, y: e.clientY })}>
      {#if mouse}
        <div class="card">
          <Icon name="display" width={34} height={26} stroke={1.4} />
          <div class="title">{display?.label || 'Display'}</div>
          <div class="sub">{px(W)} × {px(H)}</div>
          {@render startButton(startDisplay)}
        </div>
      {/if}
    </div>
  {:else if shell.mode === 'window'}
    {#if hovered && frame}
      <div class="frame" style:left="{frame.x}px" style:top="{frame.y}px" style:width="{frame.width}px" style:height="{frame.height}px"></div>
      <div
        class="card window-card"
        role="group"
        aria-label="Record {hovered.app}"
        style:left="{Math.min(Math.max(frame.x + frame.width / 2, 170), W - 170)}px"
        style:top="{Math.min(Math.max(frame.y + frame.height / 2, 120), floor - 120)}px"
        onpointerenter={() => (locked = hovered)}
        onpointerleave={() => (locked = null)}
      >
        <div class="title">{hovered.app}</div>
        {#if hovered.title}<div class="sub ellipsis">{hovered.title}</div>{/if}
        <div class="segmented" role="radiogroup" aria-label="Window size">
          {#each ['current', ...PRESETS.map((p) => p.id)] as id (id)}
            {@const disabled = id !== 'current' && !(display && presetSize(id, display.workArea))}
            <button role="radio" aria-checked={preset === id} class:on={preset === id} {disabled} onclick={() => hovered && (choice = { id: hovered.id, preset: id })}>{id === 'current' ? 'Current' : id}</button>
          {/each}
        </div>
        <div class="sub">{px(frame.width)} × {px(frame.height)}</div>
        {@render startButton(startWindow)}
      </div>
    {:else}
      <div class="hint">Move the pointer over a window to record it</div>
    {/if}
  {:else if shell.mode === 'area'}
    {#if sel}
      <div class="sel" class:dragging={drag} style:left="{sel.x}px" style:top="{sel.y}px" style:width="{sel.width}px" style:height="{sel.height}px" role="presentation" onpointerdown={(e) => down(e, 'move')}>
        {#if drag}<div class="grid"></div>{/if}
        {#each HANDLES as h (h)}
          <span class="handle {h}" role="presentation" onpointerdown={(e) => down(e, h)}></span>
        {/each}
      </div>
      {#if form}
        <div class="form" style:left="{form.x}px" style:top="{form.y}px" bind:offsetWidth={formW} bind:offsetHeight={formH} role="group" aria-label="Area" onpointerdown={(e) => e.stopPropagation()}>
          <label class="size"
            ><input
              type="number"
              min="64"
              aria-label="Width in pixels"
              value={px(sel.width)}
              onchange={(e) => setSize('width', e.currentTarget)}
              onblur={(e) => setSize('width', e.currentTarget)}
            /><span>×</span><input
              type="number"
              min="64"
              aria-label="Height in pixels"
              value={px(sel.height)}
              onchange={(e) => setSize('height', e.currentTarget)}
              onblur={(e) => setSize('height', e.currentTarget)}
            /></label
          >
          <div class="segmented" role="radiogroup" aria-label="Aspect ratio">
            {#each Object.keys(ASPECTS) as a (a)}
              <button role="radio" aria-checked={aspect === a} class:on={aspect === a} onclick={() => setAspect(a)}>{a === 'free' ? 'Free' : a}</button>
            {/each}
          </div>
          {@render startButton(startArea)}
        </div>
      {/if}
    {:else}
      <div class="hint">Drag to select an area · Esc to cancel</div>
    {/if}
  {/if}
</main>

<style>
  :global(body) {
    background: transparent;
  }
  main {
    position: fixed;
    inset: 0;
    cursor: default;
  }
  main.area {
    cursor: crosshair;
    background: rgb(0 0 0 / 0.28);
  }
  main.area:has(.sel) {
    background: none;
  }
  .display {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .display:has(.card) {
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    box-shadow: inset 0 0 0 3px color-mix(in oklab, var(--accent) 90%, transparent);
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 220px;
    padding: 20px 22px 18px;
    border-radius: 16px;
    background: rgb(28 28 30 / 0.92);
    box-shadow:
      0 0 0 0.5px rgb(255 255 255 / 0.14) inset,
      0 18px 50px rgb(0 0 0 / 0.45);
    color: #f4f4f5;
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
  }
  .window-card {
    position: absolute;
    transform: translate(-50%, -50%);
    max-width: 340px;
  }
  .title {
    margin-top: 4px;
    font-size: 15px;
    font-weight: 600;
  }
  .sub {
    font-size: 12px;
    color: rgb(255 255 255 / 0.6);
    font-variant-numeric: tabular-nums;
  }
  .ellipsis {
    max-width: 296px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .start {
    margin-top: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 16px 0 13px;
    border: 0;
    border-radius: 10px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .start:hover {
    background: var(--accent-hover);
  }
  .start:focus-visible,
  .segmented button:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #fff;
  }
  .frame {
    position: absolute;
    border-radius: 10px;
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    box-shadow: inset 0 0 0 3px color-mix(in oklab, var(--accent) 90%, transparent);
    transition:
      left 120ms ease-out,
      top 120ms ease-out,
      width 120ms ease-out,
      height 120ms ease-out;
    pointer-events: none;
  }
  .segmented {
    display: flex;
    margin-top: 8px;
    padding: 2px;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.08);
  }
  .segmented button {
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: rgb(255 255 255 / 0.75);
    font-size: 12px;
    white-space: nowrap;
  }
  .segmented button.on {
    background: rgb(255 255 255 / 0.18);
    color: #fff;
  }
  .hint {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 9px 16px;
    border-radius: 10px;
    background: rgb(28 28 30 / 0.88);
    color: rgb(255 255 255 / 0.85);
    font-size: 13px;
    pointer-events: none;
  }
  .sel {
    position: absolute;
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.95),
      0 0 0 100vmax rgb(0 0 0 / 0.42);
    cursor: move;
  }
  .grid {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, transparent calc(25% - 0.5px), rgb(255 255 255 / 0.35) calc(25% - 0.5px) calc(25% + 0.5px), transparent calc(25% + 0.5px)),
      linear-gradient(90deg, transparent calc(50% - 0.5px), rgb(255 255 255 / 0.5) calc(50% - 0.5px) calc(50% + 0.5px), transparent calc(50% + 0.5px)),
      linear-gradient(90deg, transparent calc(75% - 0.5px), rgb(255 255 255 / 0.35) calc(75% - 0.5px) calc(75% + 0.5px), transparent calc(75% + 0.5px)),
      linear-gradient(transparent calc(25% - 0.5px), rgb(255 255 255 / 0.35) calc(25% - 0.5px) calc(25% + 0.5px), transparent calc(25% + 0.5px)),
      linear-gradient(transparent calc(50% - 0.5px), rgb(255 255 255 / 0.5) calc(50% - 0.5px) calc(50% + 0.5px), transparent calc(50% + 0.5px)),
      linear-gradient(transparent calc(75% - 0.5px), rgb(255 255 255 / 0.35) calc(75% - 0.5px) calc(75% + 0.5px), transparent calc(75% + 0.5px));
    pointer-events: none;
  }
  .handle {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.5), 0 1px 3px rgb(0 0 0 / 0.4);
  }
  .handle::before {
    content: '';
    position: absolute;
    inset: -7px; /* a bigger target than it looks */
  }
  .nw { left: 0; top: 0; cursor: nwse-resize; }
  .n { left: 50%; top: 0; cursor: ns-resize; }
  .ne { left: 100%; top: 0; cursor: nesw-resize; }
  .e { left: 100%; top: 50%; cursor: ew-resize; }
  .se { left: 100%; top: 100%; cursor: nwse-resize; }
  .s { left: 50%; top: 100%; cursor: ns-resize; }
  .sw { left: 0; top: 100%; cursor: nesw-resize; }
  .w { left: 0; top: 50%; cursor: ew-resize; }
  .form {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 12px;
    border-radius: 12px;
    background: rgb(28 28 30 / 0.92);
    box-shadow:
      0 0 0 0.5px rgb(255 255 255 / 0.14) inset,
      0 12px 36px rgb(0 0 0 / 0.4);
    color: #f4f4f5;
    cursor: default;
  }
  .form .segmented,
  .form .start {
    margin-top: 0;
  }
  .size {
    display: flex;
    align-items: center;
    gap: 6px;
    color: rgb(255 255 255 / 0.5);
    font-size: 12px;
  }
  .size input {
    width: 62px;
    height: 26px;
    padding: 0 7px;
    border: 0;
    border-radius: 7px;
    background: rgb(255 255 255 / 0.1);
    color: #fff;
    font: 13px var(--font);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .size input:focus {
    outline: 2px solid var(--accent);
  }
  .size input::-webkit-inner-spin-button {
    display: none;
  }
  .target {
    position: absolute;
    display: grid;
    place-items: center;
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.35);
  }
  .count {
    display: grid;
    place-items: center;
    width: 132px;
    height: 132px;
    border-radius: 50%;
    background: rgb(20 20 22 / 0.78);
    color: #fff;
    font-size: 68px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.45);
    animation: tick 1s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes tick {
    from { transform: scale(0.82); opacity: 0; }
    18% { transform: scale(1); opacity: 1; }
    82% { transform: scale(1); opacity: 1; }
    to { transform: scale(0.96); opacity: 0.2; }
  }
  @media (prefers-reduced-motion: reduce) {
    .count { animation: none; }
    .frame { transition: none; }
  }
</style>
