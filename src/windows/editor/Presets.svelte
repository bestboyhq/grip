<!-- Presets menu in the title bar: apply a saved look, save the current one, import, export, and delete
     preset files. Storage, asset bundling, and file dialogs live in the main process (electron/presets.ts,
     projects:presets:*). Applying is an ordinary edit, so undo reverts it. -->
<script lang="ts">
  import { doc, edit } from '../../lib/doc.svelte.ts'
  import { invoke } from '../../lib/ipc.ts'
  import type { Style } from '../../shared/project.ts'
  import { setAutoZoom } from '../../engine/zoom/index.ts'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'
  import { tooltip } from '../../ui/tooltip.ts'
  import { reason } from './helpers.ts'

  type Preset = { id: string; name: string }
  let open = $state(false)
  let presets = $state<Preset[]>([])
  let unavailable = $state(false)
  let status = $state('')
  let name = $state('')
  let busy = $state(false)
  let doomed = $state('') // id of the preset whose delete awaits confirmation

  async function refresh() {
    try {
      const list = (await invoke('projects:presets:list')) as unknown
      presets = (Array.isArray(list) ? list : [])
        .map((p) => ({ id: String(p?.id ?? p?.name ?? ''), name: String(p?.name ?? p?.id ?? '') }))
        .filter((p) => p.id)
      unavailable = false
    } catch (e) {
      unavailable = /No handler registered/.test(String(e))
      if (!unavailable) status = reason(e)
    }
  }
  $effect(() => {
    if (open) {
      status = ''
      doomed = ''
      refresh()
    }
  })

  /** Run a preset action, reporting failures inline instead of throwing. */
  async function run(fn: () => Promise<unknown>) {
    busy = true
    status = ''
    try {
      await fn()
    } catch (e) {
      status = reason(e)
    } finally {
      busy = false
    }
  }

  const isStyle = (s: unknown): s is Style => !!s && typeof s === 'object' && 'background' in s && 'cursor' in s && 'camera' in s

  const apply = (p: Preset, close: () => void) =>
    run(async () => {
      const r = (await invoke('projects:presets:apply', p.id, doc.path)) as unknown
      const style = isStyle(r) ? r : isStyle((r as { style?: unknown })?.style) ? (r as { style: Style }).style : null
      if (!style) throw new Error(`“${p.name}” is not a valid preset.`)
      edit((pr) => {
        setAutoZoom(pr, doc.events, style.autoZoom) // the auto zooms follow the preset's auto zoom
        pr.style = style
      })
      close()
    })

  const saveNew = () =>
    run(async () => {
      const n = name.trim()
      if (!n) return
      await invoke('projects:presets:save', n, doc.path, $state.snapshot(doc.project!.style))
      name = ''
      status = `Saved “${n}”.`
      await refresh()
    })

  const importOne = () =>
    run(async () => {
      const p = (await invoke('projects:presets:import')) as Preset | null // the main process shows the open panel
      if (!p) return
      status = `Imported “${p.name}”.`
      await refresh()
    })

  const exportOne = (p: Preset) =>
    run(async () => {
      if (await invoke('projects:presets:export', p.id)) status = `Exported “${p.name}”.`
    })

  const remove = (p: Preset) =>
    run(async () => {
      await invoke('projects:presets:delete', p.id)
      doomed = ''
      status = `Deleted “${p.name}”.`
      await refresh()
    })
</script>

<Popover label="Presets" bind:open>
  {#snippet trigger(props)}
    <button class="btn ghost" {...props}><Icon name="sparkle" size={16} />Presets<Icon name="chevron" size={14} /></button>
  {/snippet}
  {#snippet children(close)}
    <div class="menu">
      {#if unavailable}
        <p class="empty">Presets aren’t available in this build yet.</p>
      {:else}
        {#if presets.length}
          <ul aria-label="Saved presets">
            {#each presets as p (p.id)}
              <li>
                {#if doomed === p.id}
                  <!-- Deleting can't be undone, so it asks first, in place. -->
                  <span class="ask">Delete “{p.name}”?</span>
                  <button class="btn ghost confirm" onclick={() => (doomed = '')}>Cancel</button>
                  <button class="btn danger confirm" disabled={busy} onclick={() => remove(p)}>Delete</button>
                {:else}
                  <button class="item" disabled={busy} onclick={() => apply(p, close)}>{p.name}</button>
                  <button class="icon-btn small" disabled={busy} onclick={() => exportOne(p)} {@attach tooltip(`Export “${p.name}”…`)}><Icon name="download" size={14} /></button>
                  <button class="icon-btn small" disabled={busy} onclick={() => (doomed = p.id)} {@attach tooltip(`Delete “${p.name}”`)}><Icon name="trash" size={14} /></button>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">No presets yet. Save this project’s look to reuse it on the next recording.</p>
        {/if}
        <form class="save" onsubmit={(e) => (e.preventDefault(), saveNew())}>
          <input bind:value={name} placeholder="New preset name" aria-label="New preset name" maxlength="80" />
          <button class="btn primary" disabled={busy || !name.trim()}>Save</button>
        </form>
        <button class="item import" disabled={busy} onclick={importOne}><Icon name="upload" size={14} />Import preset…</button>
      {/if}
      {#if status}<p class="status" role="status">{status}</p>{/if}
    </div>
  {/snippet}
</Popover>

<style>
  .menu { width: 260px; display: flex; flex-direction: column; gap: 4px; }
  ul { margin: 0; padding: 0; list-style: none; max-height: 260px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 2px; }
  .item {
    flex: 1; min-width: 0; display: block; height: 28px; padding: 0 8px; border: 0; border-radius: var(--radius-sm);
    background: none; font-size: 12.5px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .item:hover { background: var(--surface-50-hover); }
  .item:disabled { opacity: 0.5; }
  .small { width: 26px; height: 26px; }
  .ask { flex: 1; min-width: 0; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .confirm { height: 24px; padding: 0 8px; font-size: 12px; }
  .danger { background: var(--danger); color: #fff; }
  .danger:hover { background: var(--danger-hover); }
  .import { display: flex; align-items: center; gap: 6px; color: var(--text-dim); box-shadow: var(--hairline-t); border-radius: 0 0 var(--radius-sm) var(--radius-sm); margin-top: 2px; height: 32px; }
  .save { display: flex; gap: 6px; padding: 6px 2px 2px; box-shadow: var(--hairline-t); margin-top: 2px; }
  .save input { flex: 1; min-width: 0; height: var(--control-h); padding: 0 8px; border: 0; border-radius: var(--radius-sm); background: var(--surface-100); box-shadow: var(--hairline); font-size: 12.5px; }
  .save input:focus-visible { outline-offset: -1px; }
  .empty, .status { margin: 0; padding: 6px 8px; font-size: 12px; line-height: 1.45; color: var(--text-dim); }
  .status { color: var(--text-faint); }
</style>
