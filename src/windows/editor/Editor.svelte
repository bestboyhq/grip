<!-- The editor window: #/editor?project=<bundle path>. Loads the project, events, and transcript into
     doc, restores the saved playhead, and lays out title bar, preview, inspector, and timeline. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { doc, undo, redo, canUndo, canRedo, save, selection } from '../../lib/doc.svelte.ts'
  import { toggle } from '../../lib/player.svelte.ts'
  import { invoke, on } from '../../lib/ipc.ts'
  import { fileUrl } from '../../engine/media/index.ts'
  import { parseEvents } from '../../shared/events.ts'
  import type { Project, Sources, Transcript } from '../../shared/project.ts'
  import Icon from '../../ui/Icon.svelte'
  import { tooltip } from '../../ui/tooltip.ts'
  import Preview from './Preview.svelte'
  import Inspector from './Inspector.svelte'
  import Presets from './Presets.svelte'
  import AspectPicker from './AspectPicker.svelte'
  import Timeline from './timeline/Timeline.svelte'
  import ExportDialog from './export/ExportDialog.svelte'
  import ShareButton from './share/ShareButton.svelte'
  import { reason } from './helpers.ts'
  import { sendThumbnail } from './thumbnail.ts'

  let { params }: { params: URLSearchParams } = $props()

  // Svelte deep-proxies plain arrays put in $state; a 2-hour recording has ~1M events and ~20k words.
  // A subclass instance is stored as is, so the engine reads these immutable lists at full speed.
  class Raw<T> extends Array<T> {}
  const raw = <T,>(list: T[]): T[] => Object.setPrototypeOf(list, Raw.prototype)

  let error = $state('')
  let exportOpen = $state(false)

  async function load(requested: string) {
    if (!requested) throw new Error('No project was given to open.')
    const opened = (await invoke('projects:open', requested)) as { project: Project; path?: string }
    const { project } = opened
    const path = opened.path ?? requested // follows renames
    const url = (rel: string) => fileUrl(`${path}/${rel}`)
    const [events, transcript] = await Promise.all([
      project.sources.events
        ? fetch(url(project.sources.events)).then((r) => (r.ok ? r.text() : '')).then(parseEvents, () => [])
        : [],
      project.sources.transcript
        ? fetch(url(project.sources.transcript)).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : null,
    ])
    doc.path = path
    const t = transcript as Transcript | null
    doc.events = raw(events)
    doc.transcript = t && Array.isArray(t.words) ? { ...t, words: raw(t.words) } : null
    doc.project = project // the player seeks to the saved playhead when the preview attaches
  }

  onMount(() => {
    load(params.get('project') ?? '').catch((e) => (error = reason(e)))
  })

  const aiming = $derived(!!doc.project?.zooms.some((z) => selection.ids.includes(z.id)))
  const history = $derived.by(() => (doc.rev, { undo: canUndo(), redo: canRedo() }))

  $effect(() => {
    document.title = doc.project?.name || 'Studio'
  })

  // Main-process domains (camera analysis) add sources after recording; keep the open document current.
  $effect(() =>
    on('projects:sources', (path: string, sources: Sources) => {
      if (path !== doc.path || !doc.project) return
      doc.project.sources = sources
      doc.rev++
    }),
  )

  // Refresh the Finder thumbnail once edits settle.
  $effect(() => {
    doc.rev
    if (!doc.project) return
    const id = setTimeout(() => sendThumbnail().catch((e) => console.warn('[editor] thumbnail not updated:', reason(e))), 10_000)
    return () => clearTimeout(id)
  })

  // The name is the bundle's folder name, so renaming moves the bundle (like renaming in Finder) and is
  // not an undoable edit.
  let nameInput = $state<HTMLInputElement>()
  let notice = $state('')
  async function rename(value: string) {
    const p = doc.project
    const name = value.trim()
    if (!p || !name || name === p.name) return nameInput && (nameInput.value = p?.name ?? '')
    try {
      const r = (await invoke('projects:rename', doc.path, name)) as { path: string; name: string }
      doc.path = r.path
      p.name = r.name
    } catch (e) {
      if (!/No handler registered/.test(String(e))) {
        notice = `Couldn’t rename: ${reason(e)}`
        setTimeout(() => (notice = ''), 5000)
        if (nameInput) nameInput.value = p.name
        return
      }
      p.name = name // no bundle renaming in this build: keep the name in the document
    }
    if (nameInput) nameInput.value = p.name
    doc.dirty = true
    save()
  }

  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || t.matches('textarea, select, input:not([type=range], [type=checkbox], [type=radio], [type=color], [type=button])'))

  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || !doc.project || typing(e.target)) return
    const mod = e.metaKey && !e.ctrlKey && !e.altKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (e.key === ' ' && !e.metaKey && !(e.target as Element | null)?.matches?.(':focus-visible')) {
      e.preventDefault()
      toggle()
    }
  }
</script>

<svelte:window {onkeydown} onbeforeunload={() => void save()} />

<div class="editor">
  <header class="titlebar">
    {#if doc.project}
      <input
        bind:this={nameInput}
        class="name"
        value={doc.project.name}
        aria-label="Project name"
        spellcheck="false"
        onchange={(e) => rename(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') ((e.currentTarget.value = doc.project?.name ?? ''), e.currentTarget.blur())
        }}
      />
      <div class="actions">
        <button class="icon-btn" disabled={!history.undo} onclick={undo} {@attach tooltip('Undo', '⌘Z')}><Icon name="undo" /></button>
        <button class="icon-btn" disabled={!history.redo} onclick={redo} {@attach tooltip('Redo', '⇧⌘Z')}><Icon name="redo" /></button>
        <span class="sep"></span>
        <Presets />
        <ShareButton />
        <button class="btn primary export" onclick={() => (exportOpen = true)}><Icon name="export" size={16} />Export</button>
      </div>
    {/if}
  </header>

  {#if notice}<p class="notice" role="alert">{notice}</p>{/if}

  {#if error}
    <div class="error" role="alert">
      <Icon name="none" size={28} />
      <h1>This project can’t be opened</h1>
      <p>{error}</p>
    </div>
  {:else if doc.project}
    <main class="body">
      <section class="stage">
        <div class="toolbar">
          <AspectPicker />
          {#if aiming}<span class="aim-hint"><Icon name="target" size={15} />Click the preview to aim the selected zoom</span>{/if}
        </div>
        <Preview />
      </section>
      <Inspector />
    </main>
    <section class="timeline" aria-label="Timeline"><Timeline /></section>
    <ExportDialog bind:open={exportOpen} />
  {/if}
</div>

<style>
  :global(html[data-window='editor']), :global(html[data-window='editor'] body) { background: var(--bg); }
  .editor { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }

  .titlebar {
    position: relative; flex: none; display: flex; align-items: center; justify-content: flex-end;
    height: 52px; padding: 0 12px 0 84px; border-bottom: 1px solid var(--border); -webkit-app-region: drag;
  }
  .titlebar :global(button), .titlebar :global(input), .titlebar :global(a), .titlebar :global([popover]) { -webkit-app-region: no-drag; }
  .name {
    position: absolute; left: 50%; transform: translateX(-50%); width: min(420px, 36vw); height: 28px; padding: 0 10px;
    border: 0; border-radius: 6px; background: transparent; text-align: center; font-size: 13px; font-weight: 600; text-overflow: ellipsis;
  }
  .name:hover { background: rgb(255 255 255 / 0.05); }
  .name:focus { background: var(--bg-raised); }
  .actions { display: flex; align-items: center; gap: 4px; }
  .sep { width: 1px; height: 18px; margin: 0 6px; background: var(--border-strong); }
  .export { margin-left: 4px; padding: 0 12px 0 10px; height: 28px; }

  .body { flex: 1; min-height: 0; display: flex; }
  .stage { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .toolbar { flex: none; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; }
  .aim-hint { display: flex; align-items: center; gap: 6px; margin-left: auto; color: var(--text-faint); font-size: 12px; }

  .timeline { flex: none; height: clamp(170px, 30vh, 340px); border-top: 1px solid var(--border); overflow: auto; }

  .notice {
    position: fixed; z-index: 10; top: 58px; left: 50%; transform: translateX(-50%); margin: 0; padding: 7px 12px; border-radius: 8px;
    background: var(--bg-panel); box-shadow: var(--shadow-pop), inset 0 0 0 0.5px rgb(255 255 255 / 0.1); font-size: 12.5px;
  }
  .error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px; color: var(--text-dim); text-align: center; }
  .error h1 { margin: 10px 0 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .error p { margin: 0; max-width: 460px; user-select: text; }
</style>
