<!-- The editor window: #/editor?project=<bundle path>[&recovered]. Loads the project, events, and
     transcript into doc, restores the saved playhead, and lays out title bar, preview, inspector, and
     timeline (which owns the one transport bar). Keys go through the command registry (CommandMenu). -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { doc, canUndo, canRedo, save, selection } from '../../lib/doc.svelte.ts'
  import { player, stats } from '../../lib/player.svelte.ts'
  import { dropFiles, invoke, on } from '../../lib/ipc.ts'
  import { fileUrl } from '../../engine/media/index.ts'
  import { parseEvents } from '../../shared/events.ts'
  import type { Project, Sources, Transcript } from '../../shared/project.ts'
  import { autoZoomOnce } from '../../engine/zoom/index.ts'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'
  import { tooltip } from '../../ui/tooltip.ts'
  import Preview from './Preview.svelte'
  import Inspector from './Inspector.svelte'
  import Presets from './Presets.svelte'
  import AspectPicker from './AspectPicker.svelte'
  import Timeline from './timeline/Timeline.svelte'
  import ExportDialog, { exportVideo } from './export/ExportDialog.svelte'
  import ShareButton from './share/ShareButton.svelte'
  import { registerCommands, run } from './commands/registry.ts'
  import { reason } from './helpers.ts'
  import { sendThumbnail } from './thumbnail.ts'

  let { params }: { params: URLSearchParams } = $props()

  let error = $state('')
  let exportOpen = $state(false)
  let notice = $state('')
  let gone = false // moved to the Trash: nothing may write to the bundle any more

  async function load(requested: string) {
    if (!requested) throw new Error('No project was given to open.')
    const { project, path } = (await invoke('projects:open', requested)) as { project: Project; path: string } // path follows renames
    const [events, transcript] = await Promise.all([
      project.sources.events
        ? fetch(fileUrl(`${path}/${project.sources.events}`)).then((r) => (r.ok ? r.text() : '')).then(parseEvents, () => [])
        : [],
      invoke('transcript:load', path).catch((e: unknown) => {
        flash(`Couldn’t read the transcript: ${reason(e)}`)
        return null
      }) as Promise<Transcript | null>,
    ])
    doc.path = path
    doc.events = events
    doc.transcript = transcript
    // First open after recording or import: auto zooms are part of the starting document, not an edit.
    const fresh = autoZoomOnce(project, events)
    doc.project = project // the player seeks to the saved playhead when the preview attaches
    if (fresh) {
      doc.dirty = true
      void save()
    }
    if (params.has('recovered')) notice = 'This recording was recovered after Studio quit unexpectedly.'
    afterFirstFrame(thumbnail)
  }

  onMount(() => {
    load(params.get('project') ?? '').catch((e) => (error = reason(e)))
    return on('editor:close', async () => {
      if (!gone) {
        await save().catch((e) => console.warn('[editor] not saved on close:', reason(e)))
        await thumbnail()
      }
      invoke('editor:closed')
    })
  })

  const aiming = $derived(!!doc.project?.zooms.some((z) => selection.ids.includes(z.id)))
  const undoable = $derived.by(() => (doc.rev, { undo: canUndo(), redo: canRedo() }))

  $effect(() => {
    document.title = doc.project?.name || 'Studio'
  })

  $effect(() =>
    registerCommands([
      { id: 'project.export', group: 'Project', title: 'Export…', keys: ['⌘E'], run: () => (exportOpen = true), enabled: () => !!doc.project },
      { id: 'project.reveal', group: 'Project', title: 'Show in Finder', run: reveal, enabled: () => !!doc.project },
    ]),
  )

  function flash(text: string) {
    notice = text
    setTimeout(() => notice === text && (notice = ''), 5000)
  }

  // Main-process domains (camera analysis, transcription) add sources; keep the open document current.
  $effect(() =>
    on('projects:sources', (path: string, sources: Sources) => {
      if (path !== doc.path || !doc.project) return
      doc.project.sources = sources
      doc.rev++
    }),
  )

  // The Finder, Quick Look, and recent-projects thumbnail: once the preview shows the project, and
  // again on close when edits or the playhead changed it.
  let thumbKey = ''
  async function thumbnail() {
    const key = `${doc.rev}:${doc.project?.playhead}`
    if (!doc.project || gone || key === thumbKey) return
    thumbKey = key
    await sendThumbnail().catch((e) => console.warn('[editor] thumbnail not updated:', reason(e)))
  }
  function afterFirstFrame(fn: () => void) {
    const from = stats.frames
    const wait = () => (stats.frames > from ? fn() : !player.error && requestAnimationFrame(wait))
    requestAnimationFrame(wait)
  }

  // The name is the bundle's folder name, so renaming moves the bundle (like renaming in Finder) and is
  // not an undoable edit.
  let nameInput = $state<HTMLInputElement>()
  async function rename(value: string) {
    const p = doc.project
    const name = value.trim()
    if (p && name && name !== p.name) {
      try {
        const r = (await invoke('projects:rename', doc.path, name)) as { path: string; name: string }
        p.name = r.name
        doc.path = r.path
        doc.rev++ // media and waveform URLs follow the path
        history.replaceState(null, '', `#/editor?project=${encodeURIComponent(r.path)}`) // a reload or reopen finds it
      } catch (e) {
        flash(`Couldn’t rename: ${reason(e)}`)
      }
    }
    if (nameInput) nameInput.value = doc.project?.name ?? ''
  }

  function reveal() {
    invoke('projects:reveal', doc.path).catch((e) => flash(reason(e)))
  }

  async function trash() {
    try {
      await save() // the Trash keeps the latest edits
      await invoke('projects:remove', doc.path)
      gone = true
      window.close()
    } catch (e) {
      flash(`Couldn’t move to the Trash: ${reason(e)}`)
    }
  }

  async function ondrop(e: DragEvent) {
    try {
      await dropFiles(e)
    } catch (err) {
      flash(reason(err))
    }
  }
</script>

<svelte:window onbeforeunload={() => gone || save()} ondragover={(e) => e.preventDefault()} {ondrop} />

<div class="editor">
  <header class="titlebar">
    {#if doc.project}
      <div class="file">
        <button class="icon-btn" aria-label="Show in Finder" onclick={reveal} {@attach tooltip('Show in Finder')}><Icon name="folder" /></button>
        <Popover label="Move to Trash" align="start">
          {#snippet trigger(props)}
            <button class="icon-btn" aria-label="Move to Trash" {...props} {@attach tooltip('Move to Trash')}><Icon name="trash" /></button>
          {/snippet}
          {#snippet children(close)}
            <div class="confirm">
              <p><strong>Move “{doc.project?.name}” to the Trash?</strong>The recording and its edits go with it. You can put it back from the Trash in Finder.</p>
              <div class="buttons">
                <button class="btn ghost" onclick={close}>Cancel</button>
                <button class="btn danger" onclick={trash}>Move to Trash</button>
              </div>
            </div>
          {/snippet}
        </Popover>
      </div>
      <input
        bind:this={nameInput}
        class="name"
        value={doc.project.name}
        aria-label="Project name"
        spellcheck="false"
        onchange={(e) => rename(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            e.currentTarget.value = doc.project?.name ?? ''
            e.currentTarget.blur()
          }
        }}
      />
      <div class="actions">
        <button class="icon-btn" aria-label="Undo" disabled={!undoable.undo} onclick={() => run('timeline.undo')} {@attach tooltip('Undo', '⌘Z')}><Icon name="undo" /></button>
        <button class="icon-btn" aria-label="Redo" disabled={!undoable.redo} onclick={() => run('timeline.redo')} {@attach tooltip('Redo', '⇧⌘Z')}><Icon name="redo" /></button>
        <span class="sep"></span>
        <Presets />
        <ShareButton {exportVideo} />
        <button class="btn primary export" onclick={() => (exportOpen = true)} {@attach tooltip('Export', '⌘E')}><Icon name="export" size={16} />Export</button>
      </div>
    {/if}
  </header>

  {#if notice}
    <p class="notice" role="alert">
      {notice}<button class="icon-btn" aria-label="Dismiss" onclick={() => (notice = '')}><Icon name="close" size={14} /></button>
    </p>
  {/if}

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
    <div class="timeline"><Timeline /></div>
    <ExportDialog bind:open={exportOpen} />
  {/if}
</div>

<style>
  :global(html[data-window='editor']), :global(html[data-window='editor'] body) { background: var(--bg); }
  .editor { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }

  .titlebar {
    position: relative; flex: none; display: flex; align-items: center; justify-content: space-between;
    height: 52px; padding: 0 12px 0 84px; border-bottom: 1px solid var(--border); -webkit-app-region: drag;
  }
  .titlebar :global(button), .titlebar :global(input), .titlebar :global(a), .titlebar :global([popover]) { -webkit-app-region: no-drag; }
  .file { display: flex; gap: 2px; }
  .name {
    position: absolute; left: 50%; transform: translateX(-50%); width: min(420px, 36vw); height: 28px; padding: 0 10px;
    border: 0; border-radius: 6px; background: transparent; text-align: center; font-size: 13px; font-weight: 600; text-overflow: ellipsis;
  }
  .name:hover { background: rgb(255 255 255 / 0.05); }
  .name:focus { background: var(--bg-raised); }
  .actions { display: flex; align-items: center; gap: 4px; }
  .sep { width: 1px; height: 18px; margin: 0 6px; background: var(--border-strong); }
  .export { margin-left: 4px; padding: 0 12px 0 10px; height: 28px; }
  .confirm { width: 280px; padding: 6px 6px 2px; }
  .confirm p { margin: 0 0 12px; font-size: 12.5px; line-height: 1.45; color: var(--text-dim); }
  .confirm strong { display: block; margin-bottom: 4px; color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
  .buttons { display: flex; justify-content: flex-end; gap: 6px; }
  .btn.danger { background: var(--danger); color: #fff; }
  .btn.danger:hover { background: #ff7a73; }

  .body { flex: 1; min-height: 0; display: flex; }
  .stage { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .toolbar { flex: none; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; }
  .aim-hint { display: flex; align-items: center; gap: 6px; margin-left: auto; color: var(--text-faint); font-size: 12px; }

  /* As tall as its lanes, so every lane shows; the preview takes the rest. */
  .timeline { flex: none; max-height: 45vh; overflow: auto; }

  .notice {
    position: fixed; z-index: 10; top: 58px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; margin: 0;
    padding: 4px 4px 4px 12px; border-radius: 8px; background: var(--bg-panel); box-shadow: var(--shadow-pop), inset 0 0 0 0.5px rgb(255 255 255 / 0.1);
    font-size: 12.5px; white-space: nowrap;
  }
  .notice .icon-btn { width: 22px; height: 22px; }
  .error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px; color: var(--text-dim); text-align: center; }
  .error h1 { margin: 10px 0 0; font-size: 15px; font-weight: 600; color: var(--text); }
  .error p { margin: 0; max-width: 460px; user-select: text; }
</style>
