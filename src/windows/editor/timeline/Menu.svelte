<!-- Right-click menu for timeline items, and the Add menu. Acts on the selection (right-click selects what it hits). -->
<script lang="ts" module>
  import type { ItemTrack } from './model.ts'
  export type Target = { kind: 'clips' | ItemTrack } | { kind: 'lane'; track: ItemTrack } | { kind: 'empty' } | { kind: 'add' }
</script>

<script lang="ts">
  import { tick } from 'svelte'
  import { doc, selection } from '../../../lib/doc.svelte.ts'
  import * as A from './actions.svelte.ts'
  import { submenuAim } from '../../../ui/aim.ts'
  import { drop } from '../../../ui/motion.ts'

  // trigger: the button that opened the menu; pressing it again is not an outside press (it toggles)
  let { x, y, t, target, trigger, onclose }: { x: number; y: number; t: number; target: Target; trigger?: HTMLElement; onclose: () => void } = $props()

  let el: HTMLDivElement | undefined
  let openSub = $state('') // the submenu showing its choices
  const aim = submenuAim(() => openSub, (label) => (openSub = label))

  const clips = $derived(A.selected('clips'))
  const zooms = $derived(A.selected('zooms'))
  const layouts = $derived(A.selected('layouts'))
  const masks = $derived(A.selected('masks'))
  const uniform = <T,>(xs: T[]) => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : undefined)
  const speed = $derived(uniform(clips.map((c) => c.speed)))
  const volume = $derived(uniform(clips.map((c) => (c.muted ? 0 : c.volume))))
  const systemVolume = $derived(uniform(clips.map((c) => (c.muted ? 0 : (c.systemVolume ?? 1)))))
  const sources = $derived(doc.project?.sources)
  const cursor = $derived(doc.project?.style.cursor)
  const volumes = A.VOLUMES.map((v) => [v, v ? `${v * 100}%` : 'Mute'] as [number, string])
  const level = $derived(uniform(zooms.map((z) => z.level)))
  const layout = $derived(uniform(layouts.map((l) => l.kind)))
  const mask = $derived(uniform(masks.map((m) => m.kind)))
  const many = $derived(selection.ids.length > 1)

  /** Open the flyout to the side with room for it. */
  function flip(node: HTMLElement) {
    if (node.getBoundingClientRect().right > innerWidth - 8) Object.assign(node.style, { left: 'auto', right: 'calc(100% - 2px)', transformOrigin: 'top right' })
  }

  /** Open at the pointer, kept inside the window. */
  function place(node: HTMLDivElement) {
    el = node
    // offset sizes, not the bounding rect: the opening scale animation shrinks the rect
    const left = Math.max(8, Math.min(x, innerWidth - node.offsetWidth - 8))
    const top = Math.max(8, Math.min(y, innerHeight - node.offsetHeight - 8))
    Object.assign(node.style, { left: `${left}px`, top: `${top}px`, transformOrigin: `${x - left}px ${y - top}px` }) // grows out of the pointer
    node.focus() // arrows move into the items; a mouse-opened menu shows no highlight yet
  }

  // Act first: closing unmounts the menu, and its props (t) read the parent's state, gone by then.
  function act(fn: () => void) {
    try {
      fn()
    } finally {
      onclose()
    }
  }

  /** Open a submenu's choices by click or keyboard, with the current (or the first) one focused. */
  async function openFlyout(label: string) {
    aim.stop()
    openSub = label
    await tick()
    const f = el!.querySelector<HTMLElement>('.flyout')
    ;(f?.querySelector<HTMLElement>('[aria-checked="true"]') ?? f?.querySelector<HTMLElement>('button'))?.focus()
  }

  function onkeydown(e: KeyboardEvent) {
    const active = document.activeElement as HTMLElement | null
    const fly = active?.closest('.flyout')
    // arrows move within the open flyout, or within the menu's own rows
    const items = [...el!.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')].filter((b) => (fly ? fly.contains(b) : !b.closest('.flyout')))
    const i = items.indexOf(active as HTMLElement)
    if (e.key === 'ArrowRight' && active?.ariaHasPopup) openFlyout(active.closest<HTMLElement>('.sub')!.dataset.sub!)
    else if (e.key === 'ArrowLeft' && fly) {
      aim.stop()
      openSub = ''
      fly.parentElement!.querySelector<HTMLElement>('[aria-haspopup]')!.focus()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') return
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    else if (e.key === 'Home') items[0]?.focus()
    else if (e.key === 'End') items.at(-1)?.focus()
    else if (e.key === 'Escape' || e.key === 'Tab') onclose()
    else if (e.key !== ' ' && e.key !== 'Enter') return onclose() // any other key: close, and its shortcut still runs
    else return
    e.preventDefault()
  }

  function outside(e: PointerEvent) {
    if (!el?.contains(e.target as Node) && !trigger?.contains(e.target as Node)) onclose()
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
{#snippet submenu(label: string, options: Array<[any, string]>, current: unknown, fn: (v: any) => void)}
  <div class="sub" role="none" data-sub={label}>
    <button role="menuitem" aria-haspopup="menu" aria-expanded={openSub === label} onclick={() => openFlyout(label)}>
      <span>{label}</span><kbd>{options.find(([v]) => v === current)?.[1] ?? ''}<i aria-hidden="true">›</i></kbd>
    </button>
    {#if openSub === label}
      <div class="flyout" role="menu" aria-label={label} {@attach flip} in:drop>
        {#each options as [value, text] (text)}
          <button role="menuitemradio" aria-checked={value === current} class:on={value === current} onclick={() => act(() => fn(value))}>{text}</button>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div
  class="menu"
  role="menu"
  tabindex="-1"
  transition:drop|global
  {@attach place}
  {onkeydown}
  onpointermove={(e) => aim.move(e, (e.target as Element).closest<HTMLElement>('.sub')?.dataset.sub ?? '', el?.querySelector('.flyout'))}
>
  {#if target.kind === 'clips'}
    {@render submenu('Speed', A.SPEEDS.map((s) => [s, `${s}×`]), speed, A.setSpeed)}
    {#if sources?.mic}
      {@render submenu(sources.system ? 'Mic volume' : 'Volume', volumes, volume, A.setVolume)}
    {/if}
    {#if sources?.system}
      {@render submenu(sources.mic ? 'System audio volume' : 'Volume', volumes, systemVolume, A.setSystemVolume)}
    {/if}
    <hr />
    {@render item('Split here', () => A.cut(t), '⌘B')}
    {@render item(many ? 'Duplicate clips' : 'Duplicate clip', A.duplicate, '⌘D')}
    {@render item('Copy', A.copy, '⌘C')}
    {@render item('Reset trim', A.resetTrim, '', !A.canResetTrim())}
    {@render item('Merge with previous', () => A.merge(-1), '', !A.canMerge(-1))}
    {@render item('Merge with next', () => A.merge(1), '', !A.canMerge(1))}
    {@render item('Apply speed to all clips', A.speedToAll, '', speed === undefined)}
    {#if A.hasCursor() && cursor}
      <hr />
      {@render item(clips.every((c) => c.rawCursor) ? 'Enable cursor smoothing' : 'Disable cursor smoothing', () => A.toggleClips('rawCursor'), '', cursor.animation === 'none')}
      {@render item(clips.every((c) => c.hideCursor) ? 'Show cursor' : 'Hide cursor', () => A.toggleClips('hideCursor'), '', !cursor.visible)}
    {/if}
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
  {:else if target.kind === 'add'}
    {@render item('Zoom', () => A.add('zooms', t), 'Z')}
    {#if sources?.camera}
      {@render item('Camera layout', () => A.add('layouts', t), 'L')}
    {/if}
    {@render item('Blur', () => A.add('masks', t), 'B')}
  {:else if target.kind === 'lane'}
    {@render item({ zooms: 'Add zoom here', layouts: 'Add camera layout here', masks: 'Add blur here' }[target.track], () => A.add(target.track, t))}
    {@render item('Paste at playhead', A.paste, '⌘V', !A.canPaste())}
  {:else}
    {@render item('Paste at playhead', A.paste, '⌘V', !A.canPaste())}
  {/if}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 50;
    min-width: 232px;
    padding: 6px;
    background: var(--surface-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    font-size: 13px;
    outline: none;
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
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
  }
  /* [data-aiming]: on its way into the open submenu, the pointer lights up no row it crosses */
  .menu:not([data-aiming]) button[role='menuitem']:hover:not(:disabled),
  button[role='menuitem']:focus-visible,
  button[aria-expanded='true'] {
    background: var(--surface-hover);
    outline: none;
  }
  button:disabled {
    color: var(--fg-secondary);
    opacity: 0.6;
  }
  kbd {
    font: inherit;
    color: var(--fg-secondary);
  }
  .menu:not([data-aiming]) button:hover:not(:disabled) kbd,
  button:focus-visible kbd,
  button[aria-expanded='true'] kbd {
    color: var(--fg-default);
  }
  hr {
    border: 0;
    height: 0.5px;
    margin: 6px 10px;
    background: var(--border-default);
  }
  .sub {
    position: relative;
  }
  .flyout {
    position: absolute;
    top: -6px;
    left: calc(100% - 2px);
    min-width: 96px;
    padding: 6px;
    background: var(--surface-elevated);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    transform-origin: top left;
  }
  .flyout button {
    display: block;
    width: 100%;
    height: 26px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    font-variant-numeric: tabular-nums;
  }
  .flyout button:hover,
  .flyout button:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }
  .flyout button.on {
    background: var(--brand);
    color: var(--color-white);
  }
  kbd i {
    margin-left: 8px;
    font-style: normal;
  }
  .choices {
    padding: 4px 6px 6px;
  }
  .label {
    display: block;
    margin: 0 4px 5px;
    font-size: 11px;
    color: var(--fg-secondary);
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
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .row button:hover,
  .row button:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }
  .row button.on {
    background: var(--brand);
    color: var(--color-white);
    box-shadow: none;
  }
</style>
