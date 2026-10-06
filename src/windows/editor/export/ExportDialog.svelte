<!-- Owner: export. Export dialog (format, resolution, frame rate, quality, size estimate,
     destination: file, clipboard, share link, batch) and the export queue with progress, cancel,
     and reveal. Mounted by Editor.svelte as <ExportDialog bind:open />. Exports run in the
     background (electron/export.ts): closing the dialog never stops them. -->
<script module lang="ts">
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke, on } from '../../../lib/ipc.ts'
  import { cleanOptions, type JobInfo } from '../../../engine/export/options.ts'

  const KEY = 'studio.export.options'
  const saved = () => cleanOptions(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  const active = (j: JobInfo) => j.state === 'queued' || j.state === 'running' || j.state === 'uploading'
  const clean = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  /** For the Share button: export the open project as MP4 with the user's export settings into
   *  Grip's temp folder, and resolve to the file once it is complete. The file stays on disk while
   *  a share upload reads it, across restarts. `progress` hears 0..1 while it exports; aborting
   *  `signal` cancels the export. */
  export async function exportVideo(progress?: (p: number) => void, signal?: AbortSignal): Promise<string> {
    const project = doc.project
    if (!project) throw new Error('No project is open.')
    const seen = new Map<string, JobInfo>() // updates can arrive before enqueue answers
    let settle = (_: JobInfo) => {}
    const off = on('export:update', (j: JobInfo) => (seen.set(j.id, j), settle(j)))
    let cancel = () => {}
    try {
      const [job]: JobInfo[] = await invoke('export:enqueue', [{ bundle: doc.path, project: $state.snapshot(project), options: saved(), dest: 'temp' }])
      cancel = () => void invoke('export:cancel', job.id)
      if (signal?.aborted) cancel()
      signal?.addEventListener('abort', cancel)
      const end = await new Promise<JobInfo>((resolve) => {
        settle = (j) => void (j.id === job.id && (active(j) ? progress?.(j.progress) : resolve(j)))
        settle(seen.get(job.id) ?? job)
      })
      if (end.state === 'done') return end.path
      throw new Error(end.state === 'canceled' ? 'The export was canceled.' : (end.error ?? 'The export failed.'))
    } catch (e) {
      throw new Error(clean(e))
    } finally {
      off()
      signal?.removeEventListener('abort', cancel)
    }
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import { canEncodeVideo } from 'mediabunny'
  import { timeMap } from '../../../shared/timemap.ts'
  import { formatTime } from '../helpers.ts'
  import { outputSize } from '../../../engine/scene.ts'
  import { fitEncoder } from '../../../engine/export/index.ts'
  import { estimateBytes, formatBytes, LIMITS, LOOPS, mp4Plan, QUALITIES, RATES, SIZES, tooLong, type Destination, type ExportOptions, type Format } from '../../../engine/export/options.ts'
  import Segmented from '../../../ui/Segmented.svelte'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let o = $state<ExportOptions>(saved())
  let jobs = $state<JobInfo[]>([])
  let error = $state('')
  let copied = $state('')
  let hevc = $state(true)
  let fit = $state<{ width: number; height: number } | null>(null)
  let dialog: HTMLDialogElement

  const duration = $derived(doc.project ? timeMap(doc.project.clips).duration : 0)
  const base = $derived(doc.project ? outputSize(doc.project, o.size) : null)
  // What the MP4 will be under its size limit; null when it cannot fit.
  const plan = $derived(o.format === 'mp4' && fit ? mp4Plan(duration, o.maxMB * 1e6, fit, o) : undefined)
  const size = $derived(o.format === 'gif' ? base : (plan ?? fit))
  const shrunk = $derived(o.format === 'mp4' && base && fit && fit.width < base.width)
  const estimate = $derived(size && duration ? estimateBytes(duration, size.width, size.height, o) : 0)

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

  async function start(dest: Destination | 'batch') {
    if (!doc.project) return
    error = ''
    try {
      if (dest === 'batch') await invoke('export:batch', $state.snapshot(o))
      else await invoke('export:enqueue', [{ bundle: doc.path, project: $state.snapshot(doc.project), options: $state.snapshot(o), dest }])
    } catch (e) {
      error = clean(e)
    }
  }

  async function copyLink(j: JobInfo) {
    await navigator.clipboard.writeText(j.url!)
    copied = j.id
    setTimeout(() => copied === j.id && (copied = ''), 1500)
  }

  const file = (j: JobInfo) => j.path.split('/').pop()

  function detail(j: JobInfo): string {
    if (j.state === 'queued') return 'Waiting'
    if (j.state === 'uploading') return 'Uploading…'
    if (j.state === 'canceled') return 'Canceled'
    if (j.state === 'failed') return j.error ?? 'Failed'
    if (j.state === 'done') return `${{ clipboard: 'Copied to clipboard', share: 'Link ready', temp: 'Ready to share', file: 'Saved' }[j.dest]} · ${formatBytes(j.bytes ?? 0)}`
    const pct = `${Math.floor(j.progress * 100)}%`
    const elapsed = (Date.now() - (j.startedAt ?? Date.now())) / 1000
    const left = j.progress > 0.02 && elapsed > 1 ? ` · ${formatTime((elapsed * (1 - j.progress)) / j.progress, 0)} left` : ''
    return `${pct} · ${j.phase}${left}`
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} onclick={(e) => e.target === dialog && dialog.close()} aria-labelledby="export-title">
  <div class="sheet">
    <header>
      <h2 id="export-title">Export</h2>
      <button class="link batch" disabled={!doc.project} title="Export several projects with these settings, unattended" onclick={() => start('batch')}>Batch Export…</button>
      <button class="icon" aria-label="Close" onclick={() => dialog.close()}>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
    </header>

    <div class="rows">
      <Segmented label="Format" value={o.format} onchange={setFormat} options={[{ value: 'mp4', label: 'MP4' }, { value: 'gif', label: 'GIF' }]} />
      <Segmented label="Resolution" value={o.size} onchange={(v) => (o.size = v)} options={SIZES[o.format].map((v) => ({ value: v, label: p(v) }))} />
      <Segmented label="Frame rate" value={o.fps} onchange={(v) => (o.fps = v)} options={RATES[o.format].map((v) => ({ value: v, label: `${v} fps` }))} />
      {#if o.format === 'mp4'}
        <Segmented label="Quality" value={o.quality} onchange={(v) => (o.quality = v)} options={QUALITIES.map((v) => ({ value: v, label: label[v], title: quality[v] }))} />
        <p class="hint">{quality[o.quality]}</p>
        <Segmented
          label="Codec"
          value={o.codec}
          onchange={(v) => (o.codec = v)}
          options={[
            { value: 'h264', label: 'H.264', title: 'Plays everywhere' },
            { value: 'hevc', label: 'HEVC', disabled: !hevc, title: hevc ? 'About a third smaller; some older players need H.264' : 'This Mac cannot encode HEVC' },
          ]}
        />
      {:else}
        <Segmented label="Loop" value={o.loop} onchange={(v) => (o.loop = v)} options={LOOPS.map((v) => ({ value: v, label: v === 0 ? 'Forever' : v === 1 ? 'Once' : `${v}×` }))} />
      {/if}
      <Segmented label="Size limit" value={o.maxMB} onchange={(v) => (o.maxMB = v)} options={LIMITS.map((v) => ({ value: v, label: v ? `${v} MB` : 'None' }))} />
      <p class="hint">{o.maxMB ? `Scaled down if needed to stay under ${o.maxMB} MB` : 'Size follows length and motion'}</p>
    </div>

    <p class="summary">
      {#if size}
        <span>{size.width} × {size.height}</span><span>{formatTime(duration, 0)}</span><span>{o.format === 'gif' && !o.maxMB ? '≈' : 'up to'} {formatBytes(estimate)}</span>
      {:else}
        <span>No project open</span>
      {/if}
    </p>
    {#if plan === null}
      <p class="note error">{tooLong(o.maxMB)}</p>
    {:else if plan && fit && (plan.width < fit.width || plan.fps < o.fps)}
      <p class="note">Exports at {plan.width} × {plan.height}{plan.fps < o.fps ? `, ${plan.fps} fps` : ''} to stay under {o.maxMB} MB.</p>
    {:else if shrunk && base && fit}
      <p class="note">H.264 tops out at 4096 pixels, so this exports at {fit.width} × {fit.height}. HEVC keeps {base.width} × {base.height}.</p>
    {:else if o.format === 'gif' && duration > 60}
      <p class="note">GIFs over a minute get large and slow. MP4 is usually the better choice.</p>
    {/if}
    {#if error}<p class="note error" role="alert">{error}</p>{/if}

    <footer>
      <button class="secondary" disabled={!doc.project} onclick={() => start('clipboard')}>Copy to Clipboard</button>
      <button class="secondary" disabled={!doc.project} title="Uploads an H.264 MP4, which plays in every browser" onclick={() => start('share')}>Share Link</button>
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
                {#if j.state === 'queued' || j.state === 'running'}
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
    border-radius: var(--radius-lg);
    background: var(--surface-50);
    box-shadow: var(--shadow-modal);
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
  }
  header h2 {
    margin-right: auto;
  }
  .batch {
    font-size: 12px;
  }
  .batch:disabled {
    opacity: 0.4;
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
    background: var(--surface-100);
    color: var(--text-dim);
  }
  .icon:hover {
    color: var(--text);
    background: var(--surface-100-hover);
  }
  .rows {
    --label-w: 112px; /* fixed, so switching MP4/GIF never shifts the controls */
    display: grid;
    gap: 6px;
    margin: 4px 0 14px;
  }
  .hint {
    margin: -2px 0 2px calc(var(--label-w) + 8px);
    font-size: 12px;
    color: var(--text-faint);
  }
  .summary {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 10px 0 0;
    box-shadow: var(--hairline-t);
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
    border-radius: var(--radius-sm);
    font-weight: 500;
    white-space: nowrap;
  }
  .secondary {
    background: var(--surface-100);
    box-shadow: var(--hairline);
  }
  .secondary:hover:not(:disabled) {
    background: var(--surface-100-hover);
  }
  .primary {
    margin-left: auto;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  footer button:disabled {
    opacity: 0.4;
  }
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .queue {
    margin-top: 18px;
    padding-top: 12px;
    box-shadow: var(--hairline-t);
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
  .link:hover:not(:disabled) {
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
    box-shadow: var(--hairline-t);
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
    border-radius: var(--radius-sm);
    font-size: 12px;
    background: var(--surface-100);
    box-shadow: var(--hairline);
  }
  .small:hover {
    background: var(--surface-100-hover);
  }
  progress {
    width: 100%;
    height: 4px;
    appearance: none;
    border: 0;
    border-radius: 2px;
    overflow: hidden;
    background: var(--surface-200);
  }
  progress::-webkit-progress-bar {
    background: var(--surface-200);
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
