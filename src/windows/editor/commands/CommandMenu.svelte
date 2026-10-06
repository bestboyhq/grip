<!-- The ⌘K command menu and the editor's keyboard shortcuts. Mount once per editor window. -->
<script lang="ts">
  import { tick } from 'svelte'
  import { commandFor, commands, isEnabled, keyOf, registerCommands, search, type Command } from './registry.ts'

  let open = $state(false)
  let query = $state('')
  let active = $state(0)
  let opened = $state(0) // re-reads the registry each time the menu opens
  let returnFocus: HTMLElement | null = null

  const results = $derived.by(() => {
    opened
    return search(commands().filter((c) => c.id !== 'menu.toggle' && isEnabled(c)), query)
  })
  // Sections in registration order while browsing; one ranked list while searching.
  const sections = $derived.by(() => {
    if (!results.length) return []
    if (query.trim()) return [{ group: '', items: results }]
    const groups = new Map<string, Command[]>()
    for (const c of results) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
    return [...groups].map(([group, items]) => ({ group, items }))
  })
  const flat = $derived(sections.flatMap((s) => s.items))

  $effect(() => registerCommands([{ id: 'menu.toggle', title: 'Command menu', group: 'General', keys: ['⌘K'], run: toggle }]))

  function toggle() {
    if (open) return close()
    returnFocus = document.activeElement as HTMLElement | null
    query = ''
    active = 0
    opened++
    open = true
  }

  function close() {
    open = false
    returnFocus?.focus?.()
  }

  async function runCommand(c: Command | undefined) {
    if (!c) return
    close()
    await tick()
    c.run()
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return
    const c = commandFor(e)
    if (!c) return
    e.preventDefault()
    c.run()
  }

  async function oninputkey(e: KeyboardEvent) {
    const n = flat.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (n) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    } else if (e.key === 'Enter') runCommand(flat[active])
    else if (e.key === 'Escape' || keyOf(e) === '⌘K') close()
    else return
    e.preventDefault()
    await tick()
    document.getElementById(`command-${active}`)?.scrollIntoView({ block: 'nearest' })
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <div class="scrim" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div class="menu" role="dialog" aria-modal="true" aria-label="Command menu">
      <input
        {@attach (el) => el.focus()}
        bind:value={query}
        oninput={() => (active = 0)}
        onkeydown={oninputkey}
        placeholder="Type a command…"
        spellcheck="false"
        autocomplete="off"
        role="combobox"
        aria-expanded="true"
        aria-controls="command-list"
        aria-activedescendant={flat[active] ? `command-${active}` : undefined}
      />
      <div class="list" id="command-list" role="listbox">
        {#each sections as s (s.group)}
          {#if s.group}<div class="group" role="presentation">{s.group}</div>{/if}
          {#each s.items as c (c.id)}
            {@const i = flat.indexOf(c)}
            <div
              class="item"
              id="command-{i}"
              role="option"
              tabindex="-1"
              aria-selected={i === active}
              onpointermove={() => (active = i)}
              onclick={() => runCommand(c)}
              onkeydown={() => {}}
            >
              <span class="title">{c.title}</span>
              {#if c.hint}<span class="hint">{c.hint}</span>{/if}
              {#if query.trim()}<span class="hint">{c.group}</span>{/if}
              <span class="keys">
                {#each c.keys?.slice(0, 2) ?? [] as k (k)}<kbd>{k}</kbd>{/each}
              </span>
            </div>
          {/each}
        {:else}
          <p class="empty">No matching commands</p>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 14vh;
    background: rgb(0 0 0 / 0.28);
    animation: fade 120ms ease-out;
  }
  .menu {
    width: min(560px, calc(100vw - 48px));
    overflow: hidden;
    background: var(--surface-50);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
    animation: rise 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes fade {
    from { opacity: 0; }
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim, .menu { animation: none; }
  }
  input {
    width: 100%;
    height: 48px;
    padding: 0 18px;
    border: 0;
    background: none;
    box-shadow: var(--hairline-b);
    color: var(--text);
    font: 15px var(--font);
    outline: none;
  }
  input::placeholder {
    color: var(--text-faint);
  }
  .list {
    max-height: min(400px, 56vh);
    overflow-y: auto;
    padding: 6px;
    scrollbar-width: thin;
  }
  .group {
    padding: 10px 12px 4px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dim);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border-radius: var(--radius-sm);
  }
  .item[aria-selected='true'] {
    background: var(--surface-50-selected);
  }
  .title {
    white-space: nowrap;
  }
  .hint {
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .keys {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }
  kbd {
    min-width: 20px;
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    background: var(--surface-150);
    box-shadow: var(--hairline);
    color: var(--text-dim);
    font: 11px/18px var(--font);
    text-align: center;
  }
  .empty {
    margin: 0;
    padding: 18px 12px;
    color: var(--text-dim);
    text-align: center;
  }
</style>
