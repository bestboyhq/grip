<!-- Owner: export. Export dialog (format, resolution, frame rate, quality, size estimate,
     destination: file, clipboard, share link) and the export queue with progress, cancel, and
     reveal. Mounted by Editor.svelte as <ExportDialog bind:open />. Exports run in the background
     (electron/export.ts): closing the dialog never stops them. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { canEncodeVideo } from 'mediabunny'
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke, on } from '../../../lib/ipc.ts'
  import { timeMap } from '../../../shared/timemap.ts'
  import { outputSize } from '../../../engine/scene.ts'
  import { fitEncoder } from '../../../engine/export/index.ts'
  import { cleanOptions, estimateBytes, formatBytes, LIMITS, LOOPS, QUALITIES, RATES, SIZES, type Destination, type ExportOptions, type Format, type JobInfo } from '../../../engine/export/options.ts'
  import Segmented from './Segmented.svelte'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  const KEY = 'studio.export.options'
  let o = $state<ExportOptions>(cleanOptions(JSON.parse(localStorage.getItem(KEY) ?? 'null')))
  let jobs = $state<JobInfo[]>([])
  let error = $state('')
  let copied = $state('')
  let hevc = $state(true)
  let fit = $state<{ width: number; height: number } | null>(null)
  let dialog: HTMLDialogElement

  const duration = $derived(doc.project ? timeMap(doc.project.clips).duration : 0)
  const base = $derived(doc.project ? outputSize(doc.project, o.size) : null)
  const size = $derived(o.format === 'gif' ? base : fit)
  const shrunk = $derived(o.format === 'mp4' && base && fit && fit.width < base.width)
  const estimate = $derived(size && duration ? estimateBytes(duration, size.width, size.height, o) : 0)
  const active = (j: JobInfo) => j.state === 'queued' || j.state === 'running' || j.state === 'uploading'

  const p = (n: number) => (n === 2160 ? '4K' : `${n}p`)
  const label: Record<string, string> = { studio: 'Studio', social: 'Social', web: 'Web', small: 'Small' }
  const quality = { studio: 'Largest files, crisp text in fast motion', social: 'Sharp, sized for social uploads', web: 'Small files for sites and docs', small: 'Smallest files, softer motion' }

  $effect(() => {
    localStorage.setItem(KEY, JSON.stringify(o))
  })

  $effect(() => {
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  })

  // The size the encoder will really produce (hardware H.264 stops at 4096 px a side).
  $effect(() => {
    const b = base
    const opts = { codec: o.codec, fps: o.fps, quality: o.quality }
    if (!b || o.format !== 'mp4') return
    let stale = false
    fitEncoder(opts, b.width, b.height).then(
      (r) => !stale && (fit = r),
      () => !stale && (fit = b),
    )
    return () => (stale = true)
  })

  onMount(() => {
    void canEncodeVideo('hevc', { width: 1920, height: 1080 }).then((ok) => (hevc = ok))
    void invoke('export:list').then((list: JobInfo[]) => (jobs = list))
    return on('export:update', (j: JobInfo) => {
      const i = jobs.findIndex((x) => x.id === j.id)
      if (i < 0) jobs.push(j)
      else jobs[i] = j
    })
  })

  function setFormat(format: Format) {
    o = cleanOptions({ ...o, format })
  }

  const clean = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  async function start(dest: Destination) {
    if (!doc.project) return
    error = ''
    try {
      await invoke('export:enqueue', [{ bundle: doc.path, project: $state.snapshot(doc.project), options: $state.snapshot(o), dest }])
    } catch (e) {
      error = clean(e)
    }
  }

  async function copyLink(j: JobInfo) {
    await navigator.clipboard.writeText(j.url!)
    copied = j.id
    setTimeout(() => copied === j.id && (copied = ''), 1500)
  }

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const file = (j: JobInfo) => j.path.split('/').pop()

  function detail(j: JobInfo): string {
    if (j.state === 'queued') return 'Waiting'
    if (j.state === 'uploading') return 'Uploading…'
    if (j.state === 'canceled') return 'Canceled'
    if (j.state === 'failed') return j.error ?? 'Failed'
    if (j.state === 'done') return `${j.dest === 'clipboard' ? 'Copied to clipboard' : j.dest === 'share' ? 'Link ready' : 'Saved'} · ${formatBytes(j.bytes ?? 0)}`
    const pct = `${Math.floor(j.progress * 100)}%`
    const elapsed = (Date.now() - (j.startedAt ?? Date.now())) / 1000
    const left = j.progress > 0.02 && elapsed > 1 ? ` · ${clock((elapsed * (1 - j.progress)) / j.progress)} left` : ''
    return `${pct} · ${j.phase}${left}`
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && dialog.close()} aria-labelledby="export-title">
  <div class="sheet">
    <header>
      <h2 id="export-title">Export</h2>
      <button class="icon" aria-label="Close" onclick={() => dialog.close()}>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
    </header>

    <Segmented label="Format" wide bind:value={() => o.format, setFormat} options={[{ value: 'mp4', text: 'MP4' }, { value: 'gif', text: 'GIF' }]} />

    <div class="rows">
      <span class="name">Resolution</span>
      <Segmented label="Resolution" bind:value={o.size} options={SIZES[o.format].map((v) => ({ value: v, text: p(v) }))} />
      <span class="name">Frame rate</span>
      <Segmented label="Frame rate" bind:value={o.fps} options={RATES[o.format].map((v) => ({ value: v, text: `${v} fps` }))} />
      {#if o.format === 'mp4'}
        <span class="name">Quality</span>
        <Segmented label="Quality" bind:value={o.quality} options={QUALITIES.map((v) => ({ value: v, text: label[v], title: quality[v] }))} />
        <span class="name">Codec</span>
        <Segmented
          label="Codec"
          bind:value={o.codec}
          options={[
            { value: 'h264', text: 'H.264', title: 'Plays everywhere' },
            { value: 'hevc', text: 'HEVC', disabled: !hevc, title: hevc ? 'About a third smaller; some older players need H.264' : 'This Mac cannot encode HEVC' },
          ]}
        />
      {:else}
        <span class="name">Loop</span>
        <Segmented label="Loop" bind:value={o.loop} options={LOOPS.map((v) => ({ value: v, text: v === 0 ? 'Forever' : v === 1 ? 'Once' : `${v}×` }))} />
        <span class="name">Size limit</span>
        <Segmented label="Size limit" bind:value={o.maxMB} options={LIMITS.map((v) => ({ value: v, text: v ? `${v} MB` : 'None' }))} />
      {/if}
    </div>

    <p class="summary">
      {#if size}
        <span>{size.width} × {size.height}</span><span>{clock(duration)}</span><span>{o.format === 'gif' && !o.maxMB ? '≈' : 'up to'} {formatBytes(estimate)}</span>
      {:else}
        <span>No project open</span>
      {/if}
    </p>
    {#if shrunk && base && fit}
      <p class="note">H.264 tops out at 4096 pixels, so this exports at {fit.width} × {fit.height}. HEVC keeps {base.width} × {base.height}.</p>
    {:else if o.format === 'gif' && duration > 60}
      <p class="note">GIFs over a minute get large and slow. MP4 is usually the better choice.</p>
    {/if}
    {#if error}<p class="note error" role="alert">{error}</p>{/if}

    <footer>
      <button class="secondary" disabled={!doc.project} onclick={() => start('clipboard')}>Copy to Clipboard</button>
      <button class="secondary" disabled={!doc.project} onclick={() => start('share')}>Share Link</button>
      <!-- svelte-ignore a11y_autofocus -->
      <button class="primary" disabled={!doc.project} autofocus onclick={() => start('file')}>Export to File…</button>
    </footer>

    {#if jobs.length}
      <section class="queue" aria-label="Exports">
        <div class="qhead">
          <span>Exports</span>
          {#if jobs.some((j) => !active(j))}<button class="link" onclick={() => invoke('export:clear').then(() => (jobs = jobs.filter(active)))}>Clear finished</button>{/if}
        </div>
        <ul>
          {#each [...jobs].reverse() as j (j.id)}
            <li class={j.state}>
              <div class="line">
                <span class="file" title={j.path}>{file(j)}</span>
                {#if active(j)}
                  <button class="small" onclick={() => invoke('export:cancel', j.id)}>Cancel</button>
                {:else if j.state === 'done' && j.url}
                  <button class="small" onclick={() => copyLink(j)}>{copied === j.id ? 'Copied' : 'Copy Link'}</button>
                {:else if j.state === 'done' || (j.state === 'failed' && j.bytes)}
                  <button class="small" onclick={() => invoke('export:reveal', j.id)}>Show in Finder</button>
                {/if}
              </div>
              {#if j.state === 'running'}
                <progress max="1" value={j.progress} aria-label={`Exporting ${file(j)}`}></progress>
              {:else if j.state === 'uploading'}
                <progress aria-label={`Uploading ${file(j)}`}></progress>
              {/if}
              <span class="detail" title={j.state === 'failed' ? j.error : undefined}>{detail(j)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    overflow: visible;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  dialog[open] .sheet {
    animation: enter 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog[open] .sheet {
      animation: none;
    }
  }
  .sheet {
    width: 440px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 16px 20px 20px;
    border-radius: 12px;
    background: #252528;
    box-shadow:
      0 0 0 0.5px rgb(255 255 255 / 0.14),
      0 24px 64px rgb(0 0 0 / 0.55);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--bg-raised);
    color: var(--text-dim);
  }
  .icon:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .rows {
    display: grid;
    grid-template-columns: 1fr 300px; /* fixed, so switching MP4/GIF never shifts the controls */
    align-items: center;
    row-gap: 10px;
    margin: 16px 0 14px;
  }
  .name {
    color: var(--text-dim);
  }
  .summary {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 10px 0 0;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .summary span + span::before {
    content: '·';
    margin-right: 6px;
  }
  .summary span:first-child {
    color: var(--text);
  }
  .note {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .note.error {
    color: var(--danger);
  }
  footer {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  footer button {
    height: 30px;
    padding: 0 12px;
    border: 0;
    border-radius: 7px;
    font-weight: 500;
    white-space: nowrap;
  }
  .secondary {
    background: var(--bg-raised);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .primary {
    margin-left: auto;
    background: var(--accent);
    color: #fff;
  }
  .primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  footer button:disabled {
    opacity: 0.4;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .queue {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .qhead {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-dim);
  }
  .link:hover {
    color: var(--text);
  }
  ul {
    max-height: 196px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  li {
    display: grid;
    gap: 5px;
    padding: 8px 0;
  }
  li + li {
    border-top: 1px solid var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }
  .file {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .small {
    height: 22px;
    padding: 0 9px;
    border: 0;
    border-radius: 6px;
    font-size: 12px;
    background: var(--bg-raised);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .small:hover {
    background: var(--bg-hover);
  }
  progress {
    width: 100%;
    height: 4px;
    appearance: none;
    border: 0;
    border-radius: 2px;
    overflow: hidden;
    background: var(--bg-raised);
  }
  progress::-webkit-progress-bar {
    background: var(--bg-raised);
  }
  progress::-webkit-progress-value {
    background: var(--accent);
    transition: inline-size 200ms linear;
  }
  .detail {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .failed .detail {
    color: var(--danger);
    white-space: normal;
  }
</style>
