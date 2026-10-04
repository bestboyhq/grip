<!-- Right-click menu for timeline items. Acts on the selection (right-click selects what it hits). -->
<script lang="ts" module>
  import type { ItemTrack } from './model.ts'
  export type Target = { kind: 'clips' | ItemTrack } | { kind: 'lane'; track: ItemTrack } | { kind: 'empty' }
</script>

<script lang="ts">
  import { doc, selection } from '../../../lib/doc.svelte.ts'
  import * as A from './actions.svelte.ts'

  let { x, y, t, target, onclose }: { x: number; y: number; t: number; target: Target; onclose: () => void } = $props()

  let el: HTMLDivElement | undefined

  const clips = $derived(A.selected('clips'))
  const zooms = $derived(A.selected('zooms'))
  const layouts = $derived(A.selected('layouts'))
  const masks = $derived(A.selected('masks'))
  const uniform = <T,>(xs: T[]) => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : undefined)
  const speed = $derived(uniform(clips.map((c) => c.speed)))
  const volume = $derived(uniform(clips.map((c) => (c.muted ? 0 : c.volume))))
  const level = $derived(uniform(zooms.map((z) => z.level)))
  const layout = $derived(uniform(layouts.map((l) => l.kind)))
  const mask = $derived(uniform(masks.map((m) => m.kind)))
  const many = $derived(selection.ids.length > 1)

  /** Open at the pointer, kept inside the window. */
  function place(node: HTMLDivElement) {
    el = node
    const r = node.getBoundingClientRect()
    node.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`
    node.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`
    node.focus() // arrows move into the items; a mouse-opened menu shows no highlight yet
  }

  function act(fn: () => void) {
    onclose()
    fn()
  }

  function onkeydown(e: KeyboardEvent) {
    const items = [...el!.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (move) items[(i + move + items.length) % items.length]?.focus()
    else if (e.key === 'Home') items[0]?.focus()
    else if (e.key === 'End') items.at(-1)?.focus()
    else if (e.key === 'Escape' || e.key === 'Tab') onclose()
    else if (e.key !== ' ' && e.key !== 'Enter') return onclose() // any other key: close, and its shortcut still runs
    else return
    e.preventDefault()
  }

  function outside(e: PointerEvent) {
    if (!el?.contains(e.target as Node)) onclose()
  }
</script>

<svelte:window onpointerdowncapture={outside} onblur={onclose} onresize={onclose} />

{#snippet item(label: string, fn: () => void, keys = '', disabled = false)}
  <button role="menuitem" {disabled} onclick={() => act(fn)}><span>{label}</span><kbd>{keys}</kbd></button>
{/snippet}
{#snippet choices(label: string, options: Array<[any, string]>, current: unknown, fn: (v: any) => void)}
  <div class="choices" role="group" aria-label={label}>
    <span class="label">{label}</span>
    <div class="row">
      {#each options as [value, text] (text)}
        <button role="menuitemradio" aria-checked={value === current} class:on={value === current} onclick={() => act(() => fn(value))}>{text}</button>
      {/each}
    </div>
  </div>
{/snippet}

<div class="menu" role="menu" tabindex="-1" {@attach place} {onkeydown}>
  {#if target.kind === 'clips'}
    {@render choices('Speed', A.SPEEDS.map((s) => [s, `${s}×`]), speed, A.setSpeed)}
    {@render choices('Volume', A.VOLUMES.map((v) => [v, v ? `${v * 100}%` : 'Mute']), volume, A.setVolume)}
    <hr />
    {@render item('Split here', () => A.cut(t), 'C')}
    {@render item(many ? 'Duplicate clips' : 'Duplicate clip', A.duplicate, '⌘D')}
    {@render item('Copy', A.copy, '⌘C')}
    {@render item('Merge with previous', () => A.merge(-1), '', !A.canMerge(-1))}
    {@render item('Merge with next', () => A.merge(1), '', !A.canMerge(1))}
    {@render item('Apply speed to all clips', A.speedToAll, '', speed === undefined)}
    <hr />
    {@render item(many ? 'Delete clips' : 'Delete clip', A.remove, '⌫')}
  {:else if target.kind === 'zooms'}
    {@render choices('Zoom level', A.LEVELS.map((l) => [l, `${l}×`]), level, A.setLevel)}
    <hr />
    {@render item(zooms.every((z) => z.enabled) ? 'Disable' : 'Enable', A.toggleZooms, 'E')}
    {@render item('Apply level to all zooms', A.levelToAll, '', level === undefined)}
    {@render item('Duplicate', A.duplicate, '⌘D')}
    {@render item('Copy', A.copy, '⌘C')}
    <hr />
    {@render item('Delete', A.remove, '⌫')}
  {:else if target.kind === 'layouts'}
    {@render choices('Camera', A.LAYOUTS, layout, A.setLayout)}
    <hr />
    {@render item('Apply layout to all', A.layoutToAll, '', layout === undefined)}
    {@render item('Duplicate', A.duplicate, '⌘D')}
    {@render item('Copy', A.copy, '⌘C')}
    <hr />
    {@render item('Delete', A.remove, '⌫')}
  {:else if target.kind === 'masks'}
    {@render choices('Mask', A.MASKS, mask, A.setMask)}
    <hr />
    {@render item('Duplicate', A.duplicate, '⌘D')}
    {@render item('Copy', A.copy, '⌘C')}
    <hr />
    {@render item('Delete', A.remove, '⌫')}
  {:else if target.kind === 'lane'}
    {@render item({ zooms: 'Add zoom here', layouts: 'Add camera layout here', masks: 'Add mask here' }[target.track], () => A.add(target.track, t))}
    {@render item('Paste at playhead', A.paste, '⌘V')}
  {:else}
    {@render item('Paste at playhead', A.paste, '⌘V', !doc.project)}
  {/if}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 232px;
    padding: 5px;
    background: #232327;
    border: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 10px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.45), 0 0 0 0.5px rgb(0 0 0 / 0.6);
    font-size: 13px;
    outline: none;
    animation: pop 110ms ease-out;
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(0.97); }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu { animation: none; }
  }
  button[role='menuitem'] {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: default;
  }
  button[role='menuitem']:hover:not(:disabled),
  button[role='menuitem']:focus-visible {
    background: var(--accent);
    outline: none;
  }
  button:disabled {
    color: var(--text-dim);
    opacity: 0.6;
  }
  kbd {
    font: inherit;
    color: var(--text-dim);
  }
  button:hover:not(:disabled) kbd,
  button:focus-visible kbd {
    color: rgb(255 255 255 / 0.8);
  }
  hr {
    border: 0;
    height: 1px;
    margin: 5px 6px;
    background: rgb(255 255 255 / 0.08);
  }
  .choices {
    padding: 4px 6px 6px;
  }
  .label {
    display: block;
    margin: 0 4px 5px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .row button {
    height: 24px;
    min-width: 34px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.06);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    cursor: default;
  }
  .row button:hover,
  .row button:focus-visible {
    background: rgb(255 255 255 / 0.13);
    outline: none;
  }
  .row button.on {
    background: var(--accent);
  }
</style>
