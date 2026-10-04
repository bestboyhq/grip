<!-- The editor window: #/editor?project=<bundle path>. Loads the project, events, and transcript into
     doc, restores the saved playhead, and lays out title bar, preview, inspector, and timeline. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { doc, undo, redo, canUndo, canRedo, save, selection } from '../../lib/doc.svelte.ts'
  import { player, toggle, seek } from '../../lib/player.svelte.ts'
  import { invoke, on } from '../../lib/ipc.ts'
  import { fileUrl } from '../../engine/media/index.ts'
  import { parseEvents } from '../../shared/events.ts'
  import type { Project, Sources, Transcript } from '../../shared/project.ts'
  import { timeMap, toSource } from '../../shared/timemap.ts'
  import { autoZoomOnce } from '../../engine/zoom/index.ts'
  import type { FaceSample } from '../../engine/scene.ts'
  import Icon from '../../ui/Icon.svelte'
  import { tooltip } from '../../ui/tooltip.ts'
  import Preview from './Preview.svelte'
  import Inspector from './Inspector.svelte'
  import Presets from './Presets.svelte'
  import AspectPicker from './AspectPicker.svelte'
  import Timeline from './timeline/Timeline.svelte'
  import ExportDialog from './export/ExportDialog.svelte'
  import ShareButton from './share/ShareButton.svelte'
  import { formatTime, reason, resumeAt } from './helpers.ts'
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
    const [events, transcript, faces] = await Promise.all([
      project.sources.events
        ? fetch(url(project.sources.events)).then((r) => (r.ok ? r.text() : '')).then(parseEvents, () => [])
        : [],
      project.sources.transcript
        ? fetch(url(project.sources.transcript)).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : null,
      loadFaces(path, project.sources),
    ])
    doc.path = path
    const t = transcript as Transcript | null
    doc.events = raw(events)
    doc.transcript = t && Array.isArray(t.words) ? { ...t, words: raw(t.words) } : null
    doc.faces = faces
    // First open after recording or import: auto zooms are part of the starting document, not an edit.
    const fresh = autoZoomOnce(project, events)
    doc.project = project
    if (fresh) {
      doc.dirty = true
      void save()
    }
    // seek() clamps to player.duration, which the player may only learn once it attaches.
    player.duration ||= timeMap(project.clips).duration
    seek(resumeAt(project.clips, project.playhead))
  }

  /** The camera's face track (written by camera analysis), or none. Face follow is optional, so a
   *  missing or damaged file just means no follow, in preview and export alike. */
  async function loadFaces(path: string, sources: Sources): Promise<FaceSample[]> {
    const rel = sources.camera?.faces
    if (!rel) return []
    const faces = await fetch(fileUrl(`${path}/${rel}`)).then((r) => (r.ok ? r.json() : []), () => []).catch(() => [])
    return raw(Array.isArray(faces) ? faces : [])
  }

  onMount(() => {
    load(params.get('project') ?? '').catch((e) => (error = reason(e)))
  })

  const map = $derived(doc.project ? timeMap(doc.project.clips) : null)
  const aiming = $derived(!!doc.project?.zooms.some((z) => selection.ids.includes(z.id)))
  const duration = $derived(map?.duration ?? 0)
  const history = $derived.by(() => (doc.rev, { undo: canUndo(), redo: canRedo() }))

  $effect(() => {
    document.title = doc.project?.name || 'Studio'
  })

  // Reopen where the user left off: persist the playhead (source time, so it survives cuts) once it
  // settles. It is view state, not an edit, so it bypasses undo.
  function persistPlayhead() {
    const p = doc.project
    if (!p || !map) return
    const src = toSource(map, player.time)
    if (Math.abs(p.playhead - src) < 1e-3) return
    p.playhead = src
    doc.dirty = true
    save()
  }
  $effect(() => {
    if (!doc.project || player.playing) return
    player.time
    const id = setTimeout(persistPlayhead, 1000)
    return () => clearTimeout(id)
  })

  /** Jump to the previous/next clip boundary (or the start/end). */
  function step(dir: -1 | 1) {
    if (!map) return
    const marks = [0, ...map.outStarts, map.duration]
    const t = player.time
    const next = dir < 0 ? marks.filter((m) => m < t - 0.05).at(-1) ?? 0 : marks.find((m) => m > t + 0.05) ?? map.duration
    seek(next)
  }

  // Main-process domains (camera analysis) add sources after recording; keep the open document current.
  $effect(() =>
    on('projects:sources', async (path: string, sources: Sources) => {
      if (path !== doc.path || !doc.project) return
      if (sources.camera?.faces !== doc.project.sources.camera?.faces) doc.faces = await loadFaces(path, sources)
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

<svelte:window {onkeydown} onbeforeunload={() => (persistPlayhead(), save())} />

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
        <div class="transport" role="toolbar" aria-label="Playback">
          <span class="time">{formatTime(player.time)}</span>
          <button class="icon-btn" onclick={() => step(-1)} {@attach tooltip('Previous clip')}><Icon name="skip-back" /></button>
          <button class="icon-btn play" onclick={toggle} {@attach tooltip(player.playing ? 'Pause' : 'Play', 'Space')}>
            <Icon name={player.playing ? 'pause' : 'play'} size={20} />
          </button>
          <button class="icon-btn" onclick={() => step(1)} {@attach tooltip('Next clip')}><Icon name="skip-forward" /></button>
          <span class="time dim">{formatTime(duration)}</span>
        </div>
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
  .transport { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 48px; }
  .time { width: 76px; font-size: 12.5px; font-variant-numeric: tabular-nums; text-align: right; color: var(--text); }
  .time.dim { text-align: left; color: var(--text-faint); }
  .play { width: 34px; height: 34px; border-radius: 50%; color: var(--text); }

  .timeline { flex: none; height: clamp(170px, 30vh, 340px); border-top: 1px solid var(--border); overflow: auto; }

  .notice {
    position: fixed; z-index: 10; top: 58px; left: 50%; transform: translateX(-50%); margin: 0; padding: 7px 12px; border-radius: 8px;
    background: var(--bg-panel); box-shadow: var(--shadow-pop), inset 0 0 0 0.5px rgb(255 255 255 / 0.1); font-size: 12.5px;
  }
  .error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px; color: var(--text-dim); text-align: center; }
  .error h1 { margin: 10px 0 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .error p { margin: 0; max-width: 460px; user-select: text; }
</style>
