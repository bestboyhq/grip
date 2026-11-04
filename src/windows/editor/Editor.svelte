<!-- The editor window: #/editor?project=<bundle path>[&recovered]. Loads the project, events, and
     transcript into doc, restores the saved playhead, and lays out title bar, preview, inspector, and
     timeline (which owns the one transport bar). Keys go through the command registry (CommandMenu). -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { doc, canUndo, canRedo, edit, hear, pruneSelection, save, selection, zoomLook } from '../../lib/doc.svelte.ts'
  import { player, seek, stats } from '../../lib/player.svelte.ts'
  import { dropFiles, invoke, on } from '../../lib/ipc.ts'
  import { fileUrl } from '../../engine/media/index.ts'
  import { parseEvents } from '../../shared/events.ts'
  import type { Project, Sources, Style, Transcript } from '../../shared/project.ts'
  import { applyEdits, type Edit } from '../../shared/edits.ts'
  import { timeMap, toSource } from '../../shared/timemap.ts'
  import { autoZoomOnce } from '../../engine/zoom/index.ts'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'
  import { tooltip } from '../../ui/tooltip.ts'
  import Preview from './Preview.svelte'
  import Inspector from './Inspector.svelte'
  import AspectPicker from './AspectPicker.svelte'
  import CropDialog from './CropDialog.svelte'
  import Timeline from './timeline/Timeline.svelte'
  import { keepingPlayhead } from './timeline/actions.svelte.ts'
  import ExportButton, { exportVideo } from './export/ExportButton.svelte'
  import ShareButton from './share/ShareButton.svelte'
  import { take, stopTake } from '../../lib/take.svelte.ts'
  import { commandForMenu, keyOf, registerCommands, run } from './commands/registry.ts'
  import { reason } from './helpers.ts'
  import { renderStills, sendThumbnail } from './thumbnail.ts'

  let { params }: { params: URLSearchParams } = $props()

  let error = $state('')
  let cropOpen = $state(false)
  let notice = $state('')
  let gone = false // moved to the Trash: nothing may write to the bundle any more
  let opened: Promise<void> = Promise.resolve()

  async function load(requested: string) {
    if (!requested) throw new Error('No project was given to open.')
    const opened = (await invoke('projects:open', requested)) as { project: Project; path: string; notice?: string } // path follows renames
    const { project, path } = opened
    const [events, transcript, takes] = await Promise.all([
      project.sources.events
        ? fetch(fileUrl(`${path}/${project.sources.events}`)).then((r) => (r.ok ? r.text() : '')).then(parseEvents, () => [])
        : [],
      invoke('transcript:load', path).catch((e: unknown) => {
        flash(`Couldn’t read the transcript: ${reason(e)}`)
        return null
      }) as Promise<Transcript | null>,
      takeWords(path, project.sources, {}),
    ])
    doc.path = path
    doc.events = events
    // First open after recording or import: auto zooms are part of the starting document, not an edit.
    const fresh = autoZoomOnce(project, events)
    doc.project = project // the player seeks to the saved playhead when the preview attaches
    hear({ mic: transcript, takes })
    if (fresh) {
      doc.dirty = true
      save().catch(() => {}) // a failure shows as doc.saveError
    }
    if (opened.notice) notice = opened.notice
    else if (params.has('recovered')) notice = 'This recording was recovered after Grip quit unexpectedly.'
    afterFirstFrame(thumbnail)
  }

  onMount(() => {
    opened = load(params.get('project') ?? '').catch((e) => void (error = reason(e)))
    // Closing: '' once the edits are on disk, or why not (the main process asks what to do then).
    return on('editor:close', async () => {
      const failed = gone ? '' : await save().then(() => '', (e) => reason(e) || 'The project couldn’t be saved.')
      if (!failed && !gone) await thumbnail()
      invoke('editor:closed', failed)
    })
  })

  // Edit menu items (clicked, or their shortcut when the page left it alone): the editor's command,
  // or native editing in a text field.
  $effect(() =>
    on('editor:edit', (item: string) => {
      if (take.phase) return // a take records what plays: editing waits for it
      const c = commandForMenu(item, document.activeElement)
      if (c) c.run()
      else invoke('editor:nativeEdit', item)
    }),
  )

  // Agents (electron/agents.ts) reach the open project here: their edits land as one undo step, saved
  // before the reply; a time moves the playhead; a frame renders as the export does, as JPEG bytes; a
  // bare request reads the project as it is.
  $effect(() => {
    const off = on('agents:request', async (id: string, r: { edits?: Edit[]; time?: number; frame?: { t: number; height: number } }) => {
      let reply: { project?: Project; frame?: Uint8Array; error?: string }
      try {
        await opened
        if (!doc.project || gone) throw new Error(error || 'The project is not open any more.')
        if (take.phase && (r.edits || r.time !== undefined)) throw new Error('A voiceover is recording in this project. Try again once it stops.')
        if (r.edits) {
          applyEdits($state.snapshot(doc.project) as Project, r.edits, zoomLook(), doc.transcript) // throws before anything changes
          await keepingPlayhead(() => edit((p) => applyEdits(p, r.edits!, zoomLook(), doc.transcript))) // as after the editor's own cuts
          pruneSelection()
          await save()
        }
        if (r.time !== undefined) {
          seek(r.time)
          doc.project.playhead = toSource(timeMap(doc.project.clips), r.time) // before the first frame, the preview opens here
        }
        let frame: Uint8Array | undefined
        if (r.frame) {
          const length = timeMap(doc.project.clips).duration
          if (r.frame.t > length) throw new Error(`time is past the end of the ${Math.round(length * 100) / 100} s video.`)
          const t = Math.min(r.frame.t, length - 1 / 120) // the end itself is past the last frame
          await renderStills([$state.snapshot(doc.project.style) as Style], r.frame.height, t, async (_, jpeg) => (frame = new Uint8Array(await jpeg.arrayBuffer())), 'image/jpeg')
        }
        reply = { project: $state.snapshot(doc.project) as Project, ...(frame && { frame }) }
      } catch (e) {
        reply = { error: reason(e) }
      }
      invoke('agents:reply', id, reply)
    })
    invoke('agents:ready')
    return off
  })

  const aiming = $derived(!!doc.project?.zooms.some((z) => selection.ids.includes(z.id)))
  const masking = $derived(!aiming && !!doc.project?.masks.some((m) => selection.ids.includes(m.id)))
  const undoable = $derived.by(() => (doc.rev, { undo: canUndo(), redo: canRedo() }))

  $effect(() => {
    document.title = doc.project?.name || 'Grip'
  })

  $effect(() =>
    registerCommands([
      { id: 'project.reveal', group: 'Project', title: 'Show in Finder', run: reveal, enabled: () => !!doc.project },
      { id: 'project.crop', group: 'Project', title: 'Crop…', run: () => (cropOpen = true), enabled: () => !!doc.project?.sources.screen },
    ]),
  )

  function flash(text: string) {
    notice = text
    setTimeout(() => notice === text && (notice = ''), 5000)
  }

  $effect(() => {
    if (take.error) flash(take.error)
  })

  // While a take runs, the editor is its stage: Space, V, and Esc stop it (cancel the 3-2-1), Stop is the
  // one control that clicks, and other keys and clicks do nothing, so nothing moves the video under the
  // voice. ⌘ shortcuts go on to the app menu (its Edit items wait, see editor:edit), not to the page.
  function takeKey(e: KeyboardEvent) {
    if (!take.phase) return
    e.stopImmediatePropagation()
    if (e.metaKey) return
    e.preventDefault()
    if (!e.repeat && ['Space', 'V', '⎋'].includes(keyOf(e))) void stopTake()
  }
  function takeClick(e: Event) {
    if (!take.phase || (e.target as Element).closest?.('[data-take-stop]')) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  // Main-process domains (camera analysis, transcription) add sources; keep the open document current.
  // A transcript made outside this window (an agent's transcribe_project) arrives as its source.
  $effect(() =>
    on('projects:sources', async (path: string, sources: Sources) => {
      if (path !== doc.path || !doc.project) return
      doc.project.sources = sources
      doc.rev++
      const [mic, takes] = await Promise.all([
        sources.transcript && !doc.heard.mic ? (invoke('transcript:load', path).catch(() => null) as Promise<Transcript | null>) : doc.heard.mic,
        takeWords(path, sources, doc.heard.takes),
      ])
      if (path === doc.path && (mic !== doc.heard.mic || takes !== doc.heard.takes)) hear({ mic, takes })
    }),
  )

  /** `have` with the words of each voiceover take in `sources` it lacks (sources.takes[].transcript). */
  async function takeWords(path: string, sources: Sources, have: Record<string, Transcript>): Promise<Record<string, Transcript>> {
    const missing = (sources.takes ?? []).filter((t) => t.transcript && !have[t.id])
    if (!missing.length) return have
    const got = await Promise.all(missing.map((t) => fetch(fileUrl(`${path}/${t.transcript}`)).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    const out = { ...have }
    missing.forEach((t, i) => Array.isArray(got[i]?.words) && (out[t.id] = got[i]))
    return out
  }

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

<svelte:window
  onbeforeunload={() => gone || save()}
  ondragover={(e) => e.preventDefault()}
  {ondrop}
  onkeydowncapture={takeKey}
  onpointerdowncapture={takeClick}
  onmousedowncapture={takeClick}
  onclickcapture={takeClick}
  ondblclickcapture={takeClick}
  oncontextmenucapture={takeClick}
/>

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
        <span class="sep"></span>
        <button class="icon-btn" aria-label="Undo" disabled={!undoable.undo} onclick={() => run('timeline.undo')} {@attach tooltip('Undo', '⌘Z')}><Icon name="undo" /></button>
        <button class="icon-btn" aria-label="Redo" disabled={!undoable.redo} onclick={() => run('timeline.redo')} {@attach tooltip('Redo', '⇧⌘Z')}><Icon name="redo" /></button>
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
        <!-- Says the edits are on disk, and where the project waits once this window closes. -->
        <span class="saved" class:failed={!!doc.saveError} {@attach tooltip('Edits save as you go. Find this project again under Recent Projects in Grip’s menu.')}>
          {#if !doc.dirty && !doc.saveError}<Icon name="check" size={14} />{/if}{doc.saveError ? 'Not saved' : doc.dirty ? 'Edited' : 'Saved'}
        </span>
        <ShareButton {exportVideo} />
        <ExportButton />
      </div>
    {/if}
  </header>

  {#if error}
    <div class="error" role="alert">
      <Icon name="none" size={28} />
      <h1>This project can’t be opened</h1>
      <p>{error}</p>
    </div>
  {:else if doc.project}
    <main class="body">
      <Inspector />
      <section class="stage">
        <div class="toolbar">
          <AspectPicker />
          {#if doc.project.sources.screen}
            <button class="btn ghost crop" onclick={() => (cropOpen = true)} {@attach tooltip('Crop the recording')}><Icon name="crop" size={16} />Crop</button>
            <button class="btn ghost crop" onclick={() => run('timeline.addMask')} {@attach tooltip('Blur a name or email for a few seconds', 'B')}><Icon name="blur" size={16} />Blur</button>
          {/if}
          {#if aiming}<span class="aim-hint" transition:fade={{ duration: 180 }}><Icon name="target" size={15} /><span>Click the preview to aim the selected zoom</span></span>
          {:else if masking}<span class="aim-hint"><Icon name="target" size={15} /><span>Drag on the preview to place the mask</span></span>{/if}
        </div>
        {#if doc.saveError}
          <!-- Stays until a save lands: the edits are only in this window until then. -->
          <p class="notice" role="alert">
            {doc.saveError}<button class="btn ghost" onclick={() => save().catch(() => {})}>Try Again</button>
          </p>
        {:else if notice}
          <p class="notice" role="alert">
            {notice}<button class="icon-btn" aria-label="Dismiss" onclick={() => (notice = '')}><Icon name="close" size={14} /></button>
          </p>
        {/if}
        <Preview />
      </section>
    </main>
    <div class="timeline"><Timeline /></div>
    <CropDialog bind:open={cropOpen} />
  {/if}
</div>

<style>
  :global(html[data-window='editor']), :global(html[data-window='editor'] body) { background: var(--surface-frame); }
  .editor { display: flex; flex-direction: column; height: 100vh; background: var(--surface-frame); }

  /* Three columns: the name stays centered in the window while both sides fit, and in a narrow window
     it shrinks between them instead of covering their buttons. */
  .titlebar {
    flex: none; display: grid; grid-template-columns: 1fr minmax(0, 420px) 1fr; align-items: center; gap: 12px;
    height: 40px; padding: 0 12px; -webkit-app-region: drag;
  }
  .titlebar :global(button), .titlebar :global(input), .titlebar :global(a), .titlebar :global([popover]) { -webkit-app-region: no-drag; }
  .file { display: flex; align-items: center; gap: 2px; margin-left: 68px; /* 80 px from the edge, clear of the traffic lights */ }
  .saved { display: flex; align-items: center; gap: 3px; margin-right: 8px; color: var(--fg-faint); font-size: 12px; white-space: nowrap; -webkit-app-region: no-drag; }
  .saved.failed { color: var(--warm); }
  .name {
    width: 100%; height: 28px; padding: 0 10px;
    border: 0; border-radius: 6px; background: transparent; text-align: center; font-size: 13px; font-weight: 600; text-overflow: ellipsis;
  }
  .name:hover { background: var(--surface-hover); }
  .name:focus { background: var(--surface-100); box-shadow: var(--hairline); }
  .actions { justify-self: end; display: flex; align-items: center; gap: 4px; }
  .sep { width: 0.5px; height: 18px; margin: 0 6px; background: var(--border-default); }
  .confirm { width: 280px; padding: 6px 6px 2px; }
  .confirm p { margin: 0 0 12px; font-size: 12.5px; line-height: 1.45; color: var(--fg-secondary); }
  .confirm strong { display: block; margin-bottom: 4px; color: var(--fg-default); font-weight: 600; overflow-wrap: anywhere; }
  .buttons { display: flex; justify-content: flex-end; gap: 6px; }
  .btn.danger { background: var(--error-bg); color: var(--error-content); }
  .btn.danger:hover { background: var(--error-bg-hover); }

  .body { flex: 1; min-height: 0; display: flex; }
  .stage { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .toolbar { flex: none; display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; }
  .crop { height: 28px; padding: 0 10px 0 8px; }
  .crop :global(.icon) { color: var(--fg-secondary); }
  .aim-hint { display: flex; align-items: center; gap: 6px; min-width: 0; margin-left: auto; color: var(--fg-faint); font-size: 12px; white-space: nowrap; }
  .aim-hint span { overflow: hidden; text-overflow: ellipsis; }

  /* A panel as tall as its lanes, so every lane shows; the preview takes the rest. 60vh fits all seven lanes
     (342 px) at the 600 px minimum window height, so lanes never scroll out of reach (the canvas takes the wheel). */
  .timeline {
    flex: none; max-height: 60vh; overflow: auto; margin: var(--gutter); border-radius: var(--radius-lg);
    background: var(--surface-root); box-shadow: var(--hairline);
  }

  /* Over the top of the preview, under its toolbar: a notice that stays until dismissed never hides Crop or Blur. */
  .notice {
    position: absolute; z-index: 10; top: 50px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; margin: 0;
    padding: 4px 4px 4px 12px; border-radius: var(--radius-lg); background: var(--surface-root); box-shadow: var(--shadow-pop);
    width: max-content; max-width: calc(100% - 32px); font-size: 12.5px; line-height: 1.4;
  }
  .notice .icon-btn { width: 22px; height: 22px; }
  .error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 40px; color: var(--fg-secondary); text-align: center; }
  .error h1 { margin: 10px 0 0; font-size: 15px; font-weight: 600; color: var(--fg-default); }
  .error p { margin: 0; max-width: 460px; user-select: text; }
</style>
