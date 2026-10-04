<!-- Owner: transcript. Edit the video by editing its text: the transcript with the word at the
     playhead lit, click a word to seek, select words and press Delete to cut them, double-click a
     word to fix its caption, one-click filler and pause cuts, SRT/VTT export, and transcription. -->
<script module lang="ts">
  import type { Clip, Transcript } from '../../../shared/project.ts'
  import { invoke, on } from '../../../lib/ipc.ts'

  type Phase = '' | 'queued' | 'download' | 'transcribe' | 'error'

  // A run outlives the panel (switching tabs, closing the sidebar): its state lives here.
  const job = $state({ bundle: '', phase: '' as Phase, progress: 0, received: 0, total: 0, error: '' })
  on('transcript:progress', (p: { bundle: string; phase: Phase; progress: number; received?: number; total?: number }) => {
    if (p.bundle === job.bundle && job.phase !== '' && job.phase !== 'error') Object.assign(job, p)
  })

  /** Electron wraps handler errors in "Error invoking remote method ...": keep the reason. */
  const reason = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  async function run(bundle: string, done: (t: Transcript) => void) {
    Object.assign(job, { bundle, phase: 'queued', progress: 0, received: 0, total: 0, error: '' })
    try {
      const t: Transcript | null = await invoke('transcript:run', bundle)
      if (t) done(t)
      job.phase = ''
    } catch (e) {
      Object.assign(job, { phase: 'error', error: reason(e) })
    }
  }
</script>

<script lang="ts">
  import { doc, edit, save } from '../../../lib/doc.svelte.ts'
  import { player, seek } from '../../../lib/player.svelte.ts'
  import { mapRange, timeMap, toSource } from '../../../shared/timemap.ts'
  import {
    deleteWords,
    fillers,
    keptWords,
    longPauses,
    PAUSE_KEEP,
    shortenPauses,
    toSRT,
    toVTT,
    wordAt,
    type Pause,
  } from '../../../engine/transcript/index.ts'

  // Plain copies: the hot paths below walk every word, and doc's deep proxies make that slow.
  const t = $derived(doc.transcript ? ($state.snapshot(doc.transcript) as Transcript) : null)
  const clips = $derived(doc.project ? $state.snapshot(doc.project.clips) : [])
  const edits = $derived(doc.project ? $state.snapshot(doc.project.captionEdits) : {})
  const map = $derived(timeMap(clips))
  const kept = $derived(t ? new Set(keptWords(t, map)) : new Set<number>())
  const fillerWords = $derived(t ? fillers(t, map) : [])
  const fillerSet = $derived(new Set(fillerWords))
  // Clicks, key presses, and scrolls: a pause with any of them is the demo, not dead air.
  const activity = $derived(
    doc.events.flatMap((e) => (e.type === 'down' || e.type === 'scroll' || (e.type === 'key' && e.down) ? [e.t] : [])),
  )
  const pauses = $derived(t ? longPauses(t, map, activity) : [])
  const suggested = $derived(pauses.filter((p) => !p.busy))
  const pauseAfter = $derived(new Map(pauses.map((p) => [p.after, p])))
  const active = $derived(t ? wordAt(t.words, toSource(map, player.time)) : -1)

  /** Paragraphs at long pauses after a sentence, so 2 hours of speech reads (and renders) in pieces. */
  const paragraphs = $derived.by(() => {
    const out: number[][] = []
    let cur: number[] = []
    t?.words.forEach((w, i) => {
      cur.push(i)
      const next = t.words[i + 1]
      const sentence = /[.!?…。？！]["'”’»)\]]*$/.test(w.text)
      if (!next || (sentence && (next.start - w.end >= 1 || cur.length >= 60)) || cur.length >= 120) {
        out.push(cur)
        cur = []
      }
    })
    return out
  })

  let model = $state<{ model: boolean; size: number } | null>(null)
  let error = $state('')
  let loadedFor = ''
  let confirming = $state<'' | 'fillers' | 'pauses'>('')
  let editing = $state(-1)
  let body = $state<HTMLElement>()

  const busyHere = $derived(job.bundle === doc.path && job.phase !== '' && job.phase !== 'error')
  const failedHere = $derived(job.bundle === doc.path && job.phase === 'error')
  const hasAudio = $derived(!!(doc.project?.sources.mic || doc.project?.sources.system || doc.project?.sources.imported))
  const mb = (n: number) => Math.round(n / 1e6)

  // Open project: pick up its transcript from disk, and learn whether the model is downloaded.
  $effect(() => {
    const path = doc.path
    if (!path || doc.transcript || loadedFor === path) return
    loadedFor = path
    invoke('transcript:load', path).then(
      (loaded: Transcript | null) => {
        if (loaded && doc.path === path) doc.transcript = loaded
      },
      (e: unknown) => (error = reason(e)),
    )
  })
  $effect(() => {
    if (!t && !model) invoke('transcript:status').then((s) => (model = s))
  })

  // The word at the playhead. Toggled directly: a reactive class on every word would re-run
  // thousands of effects each time the playhead crosses a word.
  let lit: Element | null = null
  $effect(() => {
    void paragraphs // re-light after the words re-render
    const el = active >= 0 ? body?.querySelector(`[data-i="${active}"]`) : null
    lit?.removeAttribute('data-on')
    el?.setAttribute('data-on', '')
    lit = el ?? null
    if (el && player.playing) el.scrollIntoView({ block: 'nearest' })
  })

  function transcribe() {
    const path = doc.path
    run(path, (transcript) => {
      if (doc.path !== path || !doc.project) return
      doc.transcript = transcript
      // The transcript is a recording source, not an edit: set outside undo (Cmd+Z must not
      // "undo" it), then saved like any change. The main process already wrote it to disk.
      doc.project.sources.transcript = 'sources/transcript.json'
      doc.rev++
      doc.dirty = true
      void save()
    })
  }

  const cancel = () => invoke('transcript:cancel', job.bundle)

  function seekTo(i: number) {
    const w = t!.words[i]
    const out = mapRange(map, w.start, w.end)[0]
    if (out) seek(out[0])
  }

  /** Words (and pause chips) the text selection covers; a word only touched at its edge is not in. */
  function selected(): { words: number[]; pauses: Pause[] } {
    const sel = getSelection()
    if (!body || !sel || sel.isCollapsed || !sel.rangeCount || !body.contains(sel.anchorNode)) return { words: [], pauses: [] }
    const r = sel.getRangeAt(0)
    const inside = (el: Element) => {
      const text = el.firstChild
      if (!r.intersectsNode(el)) return false
      if (r.startContainer === text && r.startOffset === text.textContent!.length) return false
      if (r.startContainer === el && r.startOffset === el.childNodes.length) return false
      return !((r.endContainer === text || r.endContainer === el) && r.endOffset === 0)
    }
    const words = [...body.querySelectorAll('[data-i]')].filter(inside).map((el) => Number((el as HTMLElement).dataset.i))
    const chips = [...body.querySelectorAll('[data-pause]')].filter(inside).map((el) => pauseAfter.get(Number((el as HTMLElement).dataset.pause)))
    return { words, pauses: chips.filter((p): p is Pause => !!p) }
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || editing >= 0 || !t) return
    const { words, pauses: gaps } = selected()
    if (!words.length && !gaps.length) return
    e.preventDefault()
    e.stopPropagation()
    edit((p) => {
      p.clips = shortenPauses(deleteWords($state.snapshot(p.clips), t.words, words), gaps)
    })
    getSelection()?.removeAllRanges()
  }

  function onclick(e: MouseEvent) {
    if (!getSelection()?.isCollapsed) return // a drag that selected text
    const el = (e.target as Element).closest<HTMLElement>('[data-i], [data-pause]')
    if (el?.dataset.i) seekTo(Number(el.dataset.i))
    else if (el?.dataset.pause) seek(mapRange(map, t!.words[Number(el.dataset.pause)].end, Infinity)[0]?.[0] ?? player.time)
  }

  function ondblclick(e: MouseEvent) {
    const el = (e.target as Element).closest<HTMLElement>('[data-i]')
    if (!el) return
    getSelection()?.removeAllRanges()
    editing = Number(el.dataset.i)
  }

  /** Caption fix for one word. Empty, or the original text, removes the fix. */
  function commit(i: number, value: string) {
    if (editing !== i) return
    editing = -1
    const text = value.replace(/\s+/g, ' ').trim()
    if (text === (edits[i] ?? t!.words[i].text)) return
    edit((p) => {
      if (!text || text === t!.words[i].text) delete p.captionEdits[i]
      else p.captionEdits[i] = text
    })
  }

  function confirm() {
    const w = t!.words
    const cut = confirming === 'fillers' ? (c: Clip[]) => deleteWords(c, w, fillerWords) : (c: Clip[]) => shortenPauses(c, suggested)
    edit((p) => {
      p.clips = cut($state.snapshot(p.clips))
    })
    confirming = ''
  }

  function exportAs(format: 'srt' | 'vtt') {
    if (!t) return
    const text = (format === 'srt' ? toSRT : toVTT)(t, clips, edits)
    invoke('transcript:export', doc.path, format, text).catch((e: unknown) => (error = reason(e)))
  }

  const focus = (el: HTMLInputElement) => {
    el.focus()
    el.select()
  }
</script>

<section class="panel" aria-label="Transcript">
  <header>
    <h2>Transcript</h2>
    {#if t}
      <div class="export" role="group" aria-label="Export subtitles">
        <span>Export</span>
        <button onclick={() => exportAs('srt')} title="Export subtitles as SRT">SRT</button>
        <button onclick={() => exportAs('vtt')} title="Export subtitles as WebVTT">VTT</button>
      </div>
    {/if}
  </header>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if t}
    {#if confirming}
      <div class="bar confirm" role="alertdialog" aria-label="Confirm cut">
        <span>
          {confirming === 'fillers'
            ? `Cut ${fillerWords.length} filler word${fillerWords.length === 1 ? '' : 's'} from the video?`
            : `Shorten ${suggested.length} pause${suggested.length === 1 ? '' : 's'} to ${PAUSE_KEEP} s?`}
        </span>
        <button class="ghost" onclick={() => (confirming = '')}>Cancel</button>
        <button class="primary" onclick={confirm}>{confirming === 'fillers' ? 'Cut' : 'Shorten'}</button>
      </div>
    {:else}
      <div class="bar">
        <button disabled={!fillerWords.length} onclick={() => (confirming = 'fillers')}>Remove filler words ({fillerWords.length})</button>
        <button disabled={!suggested.length} onclick={() => (confirming = 'pauses')}>Shorten pauses ({suggested.length})</button>
      </div>
    {/if}

    <div
      class="text"
      class:confirming={!!confirming}
      bind:this={body}
      tabindex="0"
      role="textbox"
      aria-readonly="true"
      aria-multiline="true"
      aria-label="Transcript. Select words and press Delete to cut them from the video."
      {onkeydown}
      {onclick}
      {ondblclick}
    >
      {#each paragraphs as para (para[0])}
        <p>
          {#each para as i (i)}
            {#if editing === i}
              <input
                class="fix"
                value={edits[i] ?? t.words[i].text}
                aria-label="Caption text for this word"
                {@attach focus}
                onkeydown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commit(i, e.currentTarget.value)
                  if (e.key === 'Escape') editing = -1
                }}
                onblur={(e) => commit(i, e.currentTarget.value)}
              />
            {:else}
              <span
                data-i={i}
                class={['w', !kept.has(i) && 'cut', t.words[i].filler && 'filler', i in edits && 'fixed', confirming === 'fillers' && fillerSet.has(i) && 'doomed']}
                title={i in edits ? `Spoken: ${t.words[i].text}` : undefined}>{edits[i] ?? t.words[i].text}</span
              >
            {/if}
            {#if pauseAfter.has(i)}
              {@const p = pauseAfter.get(i)!}
              {' '}<span
                class={['pause', p.busy && 'busy', confirming === 'pauses' && !p.busy && 'doomed']}
                data-pause={i}
                title={p.busy ? 'Pause with clicks, typing, or scrolling: not suggested. Select it and press Delete to shorten it.' : 'Long pause'}
                >{p.length.toFixed(1)}s</span
              >
            {/if}
            {' '}
          {/each}
        </p>
      {/each}
    </div>
    <footer>Select words and press Delete to cut them. Double-click a word to fix its caption.</footer>
  {:else if busyHere}
    <div class="state" aria-live="polite">
      <p class="title">
        {#if job.phase === 'download'}
          Downloading the speech model…
        {:else if job.phase === 'transcribe'}
          Transcribing…
        {:else}
          Preparing…
        {/if}
      </p>
      <!-- Until the first measured step (model loading, the first minute of audio), it just moves. -->
      <div
        class="meter"
        class:waiting={job.progress === 0}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={job.progress ? Math.round(job.progress * 100) : undefined}
      >
        <div style:width={job.progress ? `${job.progress * 100}%` : undefined}></div>
      </div>
      <p class="dim">
        {#if job.phase === 'download'}
          {mb(job.received)} of {mb(job.total)} MB · once, then it works offline
        {:else if job.phase === 'transcribe'}
          {job.progress ? `${Math.round(job.progress * 100)}% · on this Mac` : 'On this Mac'}
        {:else}
          &nbsp;
        {/if}
      </p>
      <button class="ghost" onclick={cancel}>Cancel</button>
    </div>
  {:else if doc.project && !hasAudio}
    <div class="state">
      <p class="title">No voice to transcribe</p>
      <p class="dim">This recording has no microphone audio.</p>
    </div>
  {:else if doc.project}
    <div class="state">
      <p class="title">Edit by text</p>
      <p class="dim">
        Transcribe the recording to cut words by deleting them, remove filler words and long pauses, and export
        subtitles. It runs on this Mac{model && !model.model ? `; the speech model (${mb(model.size)} MB) downloads once` : ''}.
      </p>
      {#if failedHere}
        <p class="error" role="alert">{job.error}</p>
      {/if}
      <button class="primary" onclick={transcribe}>{failedHere ? 'Try again' : 'Transcribe'}</button>
    </div>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    color: var(--text);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    padding: 0 12px 0 16px;
    flex: none;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .export {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .export span {
    margin-right: 2px;
  }
  button {
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-raised);
    font-size: 12px;
    cursor: default;
    white-space: nowrap;
  }
  button:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  button:disabled {
    color: var(--text-dim);
    opacity: 0.6;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 500;
  }
  .primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, white);
  }
  .ghost {
    background: transparent;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px 10px 16px;
    flex: none;
  }
  .bar button {
    flex: 1;
  }
  .confirm span {
    flex: 1;
    font-size: 12px;
  }
  .confirm button {
    flex: none;
  }
  .text {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 16px 16px;
    border-top: 1px solid var(--border);
    font-size: 14px;
    line-height: 1.7;
    user-select: text;
    outline: none;
    cursor: text;
  }
  .text:focus-visible {
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .text p {
    margin: 12px 0 0;
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
  }
  .text ::selection {
    background: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .w {
    border-radius: 3px;
    padding: 1px 2px;
    margin: 0 -2px; /* highlight past the glyphs without moving them */
    transition: background-color 80ms;
  }
  .w:hover {
    background: rgb(255 255 255 / 0.07);
  }
  .w:global([data-on]) {
    background: color-mix(in srgb, var(--accent) 55%, transparent);
    color: #fff;
  }
  .filler {
    text-decoration: underline dotted rgb(255 189 89 / 0.75);
    text-underline-offset: 3px;
  }
  .fixed {
    text-decoration: underline dashed color-mix(in srgb, var(--accent) 80%, white);
    text-underline-offset: 3px;
  }
  .cut {
    color: rgb(242 242 243 / 0.32);
    text-decoration: line-through rgb(242 242 243 / 0.32);
  }
  .doomed,
  .confirming .pause.doomed {
    background: color-mix(in srgb, var(--danger) 28%, transparent);
    color: #fff;
  }
  .pause.busy {
    background: none;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14);
  }
  .pause {
    display: inline-block;
    padding: 0 6px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.07);
    color: var(--text-dim);
    font: 11px/18px var(--font);
    font-variant-numeric: tabular-nums;
    vertical-align: 1px;
  }
  .fix {
    field-sizing: content;
    min-width: 2ch;
    margin: 0 -4px; /* the text stays where the word was, and the line keeps its height */
    padding: 0 3px;
    font: inherit;
    line-height: 1.35;
    color: #fff;
    background: var(--bg-raised);
    border: 1px solid var(--accent);
    border-radius: 4px;
    outline: none;
  }
  footer {
    flex: none;
    padding: 8px 16px 10px;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
  }
  .state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 16px;
  }
  .state p {
    margin: 0;
  }
  .title {
    font-weight: 600;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
  }
  .state .primary,
  .state .ghost {
    margin-top: 4px;
  }
  .meter {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.08);
    overflow: hidden;
  }
  .meter div {
    height: 100%;
    background: var(--accent);
    transition: width 120ms linear;
  }
  .waiting div {
    width: 30%;
    animation: waiting 1.2s ease-in-out infinite alternate;
  }
  @keyframes waiting {
    from {
      transform: translateX(-20%);
    }
    to {
      transform: translateX(253%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .waiting div {
      animation: none;
      width: 100%;
      opacity: 0.35;
    }
  }
  .error {
    margin: 0 16px 8px;
    color: var(--danger);
    font-size: 12px;
  }
  .state .error {
    margin: 0;
  }
</style>
