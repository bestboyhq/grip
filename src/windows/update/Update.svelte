<!-- The update card under the menu bar icon (#/update, electron/shell/update.ts showCard), laid out as the
     result card: what Check for Updates… found. Checking, the download with what's new, ready to install,
     up to date (it goes by itself), what failed with Try Again, or whether to move Grip to Applications.
     A click anywhere else, or Esc, closes it; a download goes on, and a waiting update keeps its blue dot. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import appIcon from '../../../build/icon.png'
  import { invoke, on } from '../../lib/ipc.ts'
  import { formatBytes } from '../../engine/export/options.ts'
  import Icon from '../../ui/Icon.svelte'
  import type { Card } from '../../../electron/shell/update.ts'

  let {}: { params: URLSearchParams } = $props() // its route has none
  let c = $state<Card | null>(null)
  let hovered = $state(false)
  let card: HTMLElement
  const close = () => window.close()

  const failed = $derived(!!c?.step.endsWith('failed'))
  const moving = $derived(c?.step === 'move' || c?.step === 'move-failed')
  const loaded = $derived(!!c && c.progress.total > 0 && c.progress.done >= c.progress.total)
  const sub = $derived.by(() => {
    if (!c) return ''
    const { done, total } = c.progress
    return {
      checking: 'Checking for updates…',
      // Squirrel checks the download's signature before it is ready.
      downloading: loaded ? 'Checking the download…' : total ? `Downloading ${formatBytes(done)} of ${formatBytes(total)}` : 'Downloading…',
      ready: 'Ready to install',
      current: 'Up to date',
      'check-failed': 'Couldn’t check for updates',
      'download-failed': 'Couldn’t download the update',
      move: 'From there, it keeps itself up to date.',
      'move-failed': 'Couldn’t move Grip',
    }[c.step]
  })

  onMount(() => {
    const off = on('update:state', (next: Card) => (c = next))
    invoke('update:state').then((first: Card) => (c ??= first))
    // It fits its height to its content, and shows then: never at one size and then another.
    const refit = new ResizeObserver(() => c && invoke('update:fit', Math.ceil(card.getBoundingClientRect().height)))
    refit.observe(card)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', esc)
    return () => {
      off()
      refit.disconnect()
      removeEventListener('keydown', esc)
    }
  })

  // "Up to date" says so, then goes by itself, unless the pointer rests on it.
  $effect(() => {
    if (c?.step !== 'current' || hovered) return
    const t = setTimeout(close, 2500)
    return () => clearTimeout(t)
  })
</script>

<main class="card hud" bind:this={card} aria-label="Grip updates" onpointerenter={() => (hovered = true)} onpointerleave={() => (hovered = false)}>
  {#if c}
    <div class="top">
      <img class="app-icon" src={appIcon} alt="" />
      <div class="titles">
        <div class="title">{moving ? 'Move Grip to Applications?' : `Grip ${c.version}`}</div>
        <div class="sub" class:failed role="status">
          {#if c.step === 'current'}<Icon name="check" size={14} />{/if}{sub}
        </div>
      </div>
    </div>

    {#if c.step === 'downloading'}
      <div class="bar"><span style:width="{Math.max(2, (c.progress.total ? c.progress.done / c.progress.total : 0) * 100)}%"></span></div>
    {/if}

    {#if (c.step === 'downloading' || c.step === 'ready') && c.notes.length}
      <div class="notes">
        <div class="label">What’s new</div>
        <ul>
          {#each c.notes as note (note)}<li>{note}</li>{/each}
        </ul>
      </div>
    {/if}

    {#if c.step === 'current'}
      <p class="line">Grip checks again every few hours.</p>
    {:else if failed}
      <p class="line">{c.error}</p>
    {/if}

    {#if c.step === 'downloading' || c.step === 'ready'}
      <div class="actions">
        <button class="btn" onclick={close}>Later</button>
        <button class="btn primary" disabled={c.step !== 'ready'} onclick={() => invoke('update:restart')}>Restart to Update</button>
      </div>
    {:else if failed}
      <div class="actions">
        <button class="btn" onclick={close}>Close</button>
        <button class="btn primary" onclick={() => invoke(moving ? 'update:move' : 'update:check')}>Try Again</button>
      </div>
    {:else if c.step === 'move'}
      <div class="actions">
        <button class="btn" onclick={close}>Not Now</button>
        <button class="btn primary" onclick={() => invoke('update:move')}>Move to Applications</button>
      </div>
    {/if}
  {/if}
</main>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 8px;
    color: var(--fg-default);
    background: var(--surface-root);
    border-radius: var(--radius-lg);
    box-shadow: var(--hairline);
  }
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 4px 0;
  }
  /* The macOS icon pulled back by the margin macOS draws around its squircle (docs/design.md, "App icons"). */
  .app-icon {
    --s: 36px;
    flex: none;
    width: calc(var(--s) * 1024 / 824);
    height: auto;
    margin: calc(var(--s) * -100 / 824);
  }
  .titles {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .title {
    font-size: 13px;
    line-height: 18px;
    font-weight: 600;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    line-height: 16px;
    color: var(--fg-secondary);
    font-variant-numeric: tabular-nums;
  }
  .sub :global(svg) {
    margin-left: -2px;
    color: var(--success);
  }
  .sub.failed {
    color: var(--error-content);
  }
  .bar {
    height: 3px;
    margin: -2px 4px 0;
    border-radius: 1.5px;
    background: var(--surface-200);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 1.5px;
    background: var(--brand);
    transition: width 200ms linear;
  }
  .notes {
    margin: 0 -8px;
    padding: 12px 12px 0;
    box-shadow: var(--hairline-t);
  }
  .label {
    margin-bottom: 6px;
    font-size: 12px;
    line-height: 16px;
    font-weight: 500;
  }
  ul {
    display: grid;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    padding-left: 12px;
    font-size: 12.5px;
    line-height: 17px;
    color: var(--fg-secondary);
    text-wrap: pretty;
  }
  li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 7px;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--fg-faint);
  }
  .line {
    margin: -4px 0 0;
    padding: 0 4px;
    font-size: 12px;
    line-height: 16px;
    color: var(--fg-muted);
    text-wrap: balance;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .actions .btn {
    flex: 1;
    height: 30px;
    padding: 0 8px;
  }
</style>
