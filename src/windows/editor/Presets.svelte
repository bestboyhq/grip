<!-- Owner: projects. The inspector's Presets tab: every saved look, each shown on this project's own frame.
     Hovering a preset previews it in the player, nothing applied; a click applies it as one undoable edit.
     The project remembers the preset its look came from (project.preset), so changes since show as Edited,
     with Update and Revert. One preset can be the look new recordings start with (settings.preset).
     Storage, assets, and file dialogs live in the main process (electron/presets.ts, projects:presets:*). -->
<script lang="ts" module>
  import { invoke, on } from '../../lib/ipc.ts'
  import { player } from '../../lib/player.svelte.ts'
  import type { Style } from '../../shared/project.ts'
  import { reason } from './helpers.ts'
  import { renderStills } from './thumbnail.ts'

  type Preset = { id: string; name: string; style: Style; look: Style }

  // Kept for the window, not the tab, which remounts on every visit: the list, the new-recordings
  // preset, and the thumbnails show at once and refresh behind. The list loads when the editor opens.
  let presets = $state.raw<Preset[] | null>(null) // null until the first list arrives
  let def = $state<string | null>(null) // the preset new recordings start with
  const thumbs = $state<Record<string, string>>({}) // look as JSON -> PNG of this project in it
  const pending = new Set<string>() // looks being rendered

  async function refresh() {
    presets = await invoke('projects:presets:list')
  }
  refresh().catch((e) => console.warn('[presets] list:', reason(e)))
  invoke('settings:get').then((s: { preset: string | null }) => (def = s.preset))
  on('settings:changed', (s: { preset: string | null }) => (def = s.preset))

  /** This project at the playhead in each look not rendered yet; thumbnails of looks no preset has any
   *  more are let go. */
  // ponytail: a thumbnail keeps the frame of its first render; render again on edits if they drift visibly.
  function thumbnails(looks: Style[]) {
    const keys = looks.map((l) => JSON.stringify(l))
    for (const k of Object.keys(thumbs)) if (!keys.includes(k)) (URL.revokeObjectURL(thumbs[k]), delete thumbs[k])
    const todo = looks.filter((_, i) => !(keys[i] in thumbs) && !pending.has(keys[i]))
    const todoKeys = todo.map((l) => JSON.stringify(l))
    if (!todo.length) return
    for (const k of todoKeys) pending.add(k)
    renderStills(todo, 180, player.time, (i, png) => (thumbs[todoKeys[i]] = URL.createObjectURL(png)))
      .catch((e) => console.warn('[presets] thumbnails:', reason(e)))
      .finally(() => todoKeys.forEach((k) => pending.delete(k)))
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { doc, edit, zoomLook } from '../../lib/doc.svelte.ts'
  import { showLook } from '../../lib/player.svelte.ts'
  import { lookOn, sameLook } from '../../shared/project.ts'
  import { setAutoZoom } from '../../engine/zoom/index.ts'
  import { wallpaper } from '../../engine/backgrounds/index.ts'
  import Icon from '../../ui/Icon.svelte'
  import Select from '../../ui/Select.svelte'

  let naming = $state(false)
  let renaming = $state('') // id of the preset whose name is being edited
  let status = $state('')
  let busy = $state(false)

  const list = $derived(presets ?? [])
  const base = $derived(list.find((p) => p.id === doc.project?.preset))
  const edited = $derived(!!base && !!doc.project && !sameLook(base.style, doc.project.style))
  const options = $derived([{ value: '', label: 'No preset' }, ...list.map((p) => ({ value: p.id, label: p.name }))])

  refresh().catch((e) => (status = reason(e))) // behind what is already shown
  $effect(() => () => showLook(null)) // leaving the tab ends a preview
  $effect(() => {
    const looks = list.map((p) => p.look)
    untrack(() => thumbnails(looks))
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

  /** Show `p` in the player while the pointer is on it; the look already in use needs no preview. */
  function preview(p: Preset) {
    if (p !== base || edited) showLook({ name: p.name, style: p.look })
  }

  const apply = (p: Preset) =>
    run(async () => {
      showLook(null)
      const { style } = (await invoke('projects:presets:apply', p.id, doc.path)) as { style: Style }
      edit((pr) => {
        pr.style = lookOn(style, pr.style)
        pr.preset = p.id
        setAutoZoom(pr, doc.events, pr.style.autoZoom, zoomLook()) // the auto zooms follow the preset's auto zoom
      })
    })

  const save = (name: string, id?: string) => invoke('projects:presets:save', name, doc.path, $state.snapshot(doc.project!.style), id) as Promise<Preset>

  const saveNew = (name: string) =>
    run(async () => {
      const p = await save(name.trim())
      edit((pr) => (pr.preset = p.id))
      naming = false
      status = `Saved “${p.name}”.`
      await refresh()
    })

  const update = () =>
    run(async () => {
      await save(base!.name, base!.id)
      status = `Saved the changes to “${base!.name}”.`
      await refresh()
    })

  const rename = (p: Preset, name: string) =>
    run(async () => {
      renaming = ''
      if (!name.trim() || name.trim() === p.name) return
      await invoke('projects:presets:rename', p.id, name.trim())
      await refresh()
    })

  async function more(p: Preset, e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const items = [
      { id: 'default', label: 'Use for New Recordings', checked: def === p.id },
      { separator: true },
      { id: 'rename', label: 'Rename…' },
      { id: 'export', label: 'Export Preset File…' },
      { separator: true },
      { id: 'delete', label: 'Delete…' },
    ]
    const picked = await invoke('shell:popup', items, r.left, r.bottom + 4)
    if (picked === 'default') await invoke('settings:set', { preset: def === p.id ? null : p.id })
    else if (picked === 'rename') renaming = p.id
    else if (picked === 'export') await run(async () => (await invoke('projects:presets:export', p.id)) && (status = `Exported “${p.name}”.`))
    else if (picked === 'delete' && confirm(`Delete the preset “${p.name}”? Projects keep their look; the preset itself can’t be brought back.`))
      await run(async () => {
        await invoke('projects:presets:delete', p.id)
        if (def === p.id) await invoke('settings:set', { preset: null })
        await refresh()
      })
  }

  const importOne = () =>
    run(async () => {
      const p = (await invoke('projects:presets:import')) as Preset | null // the main process shows the open panel
      if (!p) return
      status = `Imported “${p.name}”.`
      await refresh()
    })

  /** The background, in words: what tells looks apart besides the picture. */
  function describe(s: Style) {
    const b = s.background
    return b.kind === 'wallpaper' ? `Wallpaper, ${wallpaper(b.id).name}` : b.kind === 'color' ? `Color, ${b.color.toUpperCase()}` : b.kind === 'gradient' ? 'Gradient' : 'Image'
  }

  const focus = (node: HTMLInputElement) => {
    node.focus()
    node.select()
  }
</script>

<div class="presets">
  <div class="head">
    <h2>Presets</h2>
    {#if !naming}<button class="btn" disabled={busy} onclick={() => (naming = true)}><Icon name="plus" size={14} />Save current look</button>{/if}
  </div>
  {#if naming}
    <form class="naming" onsubmit={(e) => (e.preventDefault(), saveNew(new FormData(e.currentTarget).get('name') as string))}>
      <input name="name" placeholder="Preset name" aria-label="Preset name" maxlength="100" {@attach focus} onkeydown={(e) => e.key === 'Escape' && (naming = false)} />
      <button class="btn primary" disabled={busy}>Save</button>
    </form>
  {/if}

  <div class="list">
    {#if base && edited}
      <div class="edited">
        <p><span class="dot"></span>You changed <b>{base.name}</b> in this project.</p>
        <div class="buttons">
          <button class="btn primary" disabled={busy} onclick={update}>Update “{base.name}”</button>
          <button class="btn" disabled={busy} onclick={() => apply(base!)}>Revert</button>
        </div>
      </div>
    {/if}
    {#each list as p (p.id)}
      {@const thumb = thumbs[JSON.stringify(p.look)]}
      <div class="row" class:on={p === base} {@attach (node) => void (p === base && node.scrollIntoView({ block: 'nearest' }))}>
        {#if renaming === p.id}
          <span class="thumb">{#if thumb}<img src={thumb} alt="" decoding="sync" in:fade={{ duration: 150 }} />{/if}</span>
          <input
            class="rename"
            value={p.name}
            aria-label="Preset name"
            maxlength="100"
            {@attach focus}
            onblur={(e) => rename(p, e.currentTarget.value)}
            onkeydown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') ((e.currentTarget.value = p.name), (renaming = '')) // its blur then renames nothing
            }}
          />
        {:else}
          <button class="pick" disabled={busy} onclick={() => apply(p)} onpointerenter={() => preview(p)} onpointerleave={() => showLook(null)}>
            <span class="thumb">{#if thumb}<img src={thumb} alt="" decoding="sync" in:fade={{ duration: 150 }} />{/if}</span>
            <span class="text">
              <b>{p.name}</b>
              <small>{#if p === base}{#if edited}<span class="dot"></span>In use, edited{:else}In use{/if}{:else}{describe(p.style)}{/if}</small>
              {#if def === p.id}<small><span class="rec"></span>New recordings</small>{/if}
            </span>
          </button>
        {/if}
        <button class="icon-btn more" aria-label="More for {p.name}" onclick={(e) => more(p, e)}><Icon name="more" size={16} /></button>
      </div>
    {:else}
      {#if presets}<p class="empty">No presets yet. Save this project’s look to apply it to any recording in one click.</p>{/if}
    {/each}
    {#if status}<p class="status" role="status">{status}</p>{/if}
  </div>

  <div class="foot">
    <Select label="New recordings" value={def ?? ''} {options} onchange={(v) => invoke('settings:set', { preset: v || null })} />
    <button class="link" disabled={busy} onclick={importOne}>Import preset file…</button>
  </div>
</div>

<style>
  /* The tab's own title bar and edges: it fills the inspector panel (Inspector.svelte gives it a bare
     content box, 16 px in from each side). */
  .presets { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0 -16px; }
  .head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; padding: 10px 12px 4px 16px; } /* the title where the other tabs have theirs */
  h2 { margin: 0; font-size: 13px; font-weight: 600; }
  .naming { flex: none; display: flex; gap: 6px; padding: 2px 12px 8px 16px; }
  .naming input, .rename {
    flex: 1; min-width: 0; height: var(--control-h); padding: 0 8px; border: 0; border-radius: var(--radius-sm);
    background: var(--surface-100); box-shadow: var(--hairline); font-size: 12.5px;
  }
  .naming input:focus-visible, .rename:focus-visible { outline-offset: -1px; }
  .list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 4px 8px 8px; mask-image: linear-gradient(transparent, #000 6px); }

  .edited { display: grid; gap: 8px; margin: 0 2px 8px; padding: 10px; border-radius: var(--radius); background: var(--control-track); box-shadow: var(--hairline); }
  .edited p { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--fg-secondary); }
  .edited b { color: var(--fg-default); font-weight: 500; }
  .buttons { display: flex; gap: 6px; }
  .dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--warm); }
  .rec { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--record); }

  .row { position: relative; display: grid; grid-template-columns: 1fr auto; align-items: center; border-radius: 10px; }
  .row:hover, .row:focus-within { background: var(--surface-hover); }
  .row:has(.rename) { grid-template-columns: auto 1fr auto; gap: 12px; padding: 6px; }
  .pick { display: grid; grid-template-columns: 112px 1fr; align-items: center; gap: 12px; min-width: 0; padding: 6px; border: 0; border-radius: 10px; background: none; text-align: left; }
  .pick:disabled { cursor: progress; }
  .thumb {
    display: grid; place-items: center; width: 112px; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 5px;
    background: var(--control-track); box-shadow: 0 0 0 0.5px var(--ring-faint); transition: box-shadow 120ms;
  }
  .thumb img { width: 100%; height: 100%; object-fit: contain; }
  .on .thumb { box-shadow: 0 0 0 2px var(--surface-root), 0 0 0 3.5px var(--brand); }
  .row.on:is(:hover, :focus-within) .thumb { box-shadow: 0 0 0 2px var(--surface-hover), 0 0 0 3.5px var(--brand); }
  .text { display: grid; gap: 3px; min-width: 0; }
  .text b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .text small { display: flex; align-items: center; gap: 5px; overflow: hidden; white-space: nowrap; font-size: 11.5px; color: var(--fg-secondary); }
  .more { margin-right: 6px; opacity: 0; }
  .row:is(:hover, :focus-within) .more, .more:focus-visible { opacity: 1; }

  .empty, .status { margin: 0; padding: 6px 8px; font-size: 12px; line-height: 1.45; color: var(--fg-secondary); }
  .status { color: var(--fg-faint); }
  .foot { flex: none; display: grid; gap: 6px; padding: 10px 16px 12px; box-shadow: var(--hairline-t); --label-w: 104px; }
  .link {
    justify-self: start; height: 24px; margin: 0 -4px; padding: 0 4px; border: 0; border-radius: var(--radius-xs);
    background: none; color: var(--fg-secondary); font-size: 12px; font-weight: 500;
  }
  .link:hover:not(:disabled) { background: var(--ghost-hover); color: var(--fg-default); }
</style>
