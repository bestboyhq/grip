<!-- Owner: sharing. The editor top bar's Share button: a popover that shares the video or the whole editable project
     as a link, with upload progress, copy link, and a private toggle. Uploads run in the main process
     (electron/share.ts) and carry on when the popover closes, the window closes, or the app restarts.
     Mount: <ShareButton exportVideo={...} />, where exportVideo(progress?, signal?) exports the open project and resolves
     to the MP4 path (the file must stay until the upload is done), reporting 0..1 progress and stopping when signal aborts. -->
<script lang="ts">
  import type { Job } from '../../../../electron/share.ts'
  import { doc, save } from '../../../lib/doc.svelte.ts'
  import { invoke, on } from '../../../lib/ipc.ts'

  let { exportVideo }: { exportVideo?: (progress?: (p: number) => void, signal?: AbortSignal) => Promise<string> } = $props()

  const uid = $props.id()
  let jobs = $state.raw<Job[]>([])
  let kind = $state<'video' | 'project'>('video')
  let wantPrivate = $state(false) // privacy of the next share
  let exporting = $state<{ p: number; stop: AbortController } | null>(null)
  let error = $state('')
  let toast = $state('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  invoke('share:jobs').then((all: Job[]) => (jobs = all))
  $effect(() =>
    on('share:progress', (j: Job) => {
      const rest = jobs.filter((x) => x.id !== j.id)
      jobs = j.state === 'canceled' ? rest : [...rest, j]
    }),
  )

  const latest = (k: 'video' | 'project') =>
    jobs.filter((j) => j.kind === k && j.project === doc.path).sort((a, b) => b.createdAt - a.createdAt)[0]
  const job = $derived(latest(kind))
  const busy = (j?: Job) => !!j && !['done', 'failed'].includes(j.state)
  const active = $derived([latest('video'), latest('project')].find(busy))
  const isPrivate = $derived(job && job.state !== 'failed' ? job.private : wantPrivate)
  const pct = (j: Job) => (j.size ? Math.min(100, Math.floor((j.sent / j.size) * 100)) : 0)
  const ring = $derived(exporting ? Math.floor(exporting.p * 100) : active ? pct(active) : null) // the trigger's progress
  const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`) // decimal, like Finder
  const count = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const plain = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  function flash(text: string) {
    toast = text
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = ''), 1800)
  }

  async function share() {
    error = ''
    const stop = new AbortController()
    try {
      let path = doc.path
      if (kind === 'video') {
        exporting = { p: 0, stop }
        path = await exportVideo!((p) => exporting && (exporting.p = p), stop.signal)
        exporting = null
      } else await save()
      const opts = { title: doc.project?.name, private: wantPrivate, project: doc.path }
      // The link exists (and is on the clipboard) as soon as the server knows the upload; null = canceled first.
      if (await invoke('share:upload', path, opts)) flash('Link copied')
    } catch (e) {
      const msg = plain(e)
      // Canceled here: nothing to report. A failed job already says why.
      if (!stop.signal.aborted && !jobs.some((j) => j.note === msg)) error = msg
    } finally {
      exporting = null
    }
  }

  async function copy() {
    if (!job?.link) return
    await invoke('share:copy', job.link)
    flash('Link copied')
  }

  async function setPrivate(value: boolean) {
    error = ''
    if (!job || job.state === 'failed') return void (wantPrivate = value)
    try {
      const next: Job = await invoke('share:update', job.id, { private: value })
      // Going private retires the old link: hand out the new one right away.
      if (value && next.link) {
        await invoke('share:copy', next.link)
        flash('Private link copied')
      }
    } catch (e) {
      error = plain(e)
    }
  }

  async function remove() {
    if (!job) return
    const done = job.state === 'done'
    if (done && !confirm('Delete this link? Anyone who has it will no longer be able to open it.')) return
    try {
      await invoke('share:cancel', job.id)
    } catch (e) {
      error = plain(e)
    }
  }

  function toggled(e: ToggleEvent) {
    if (e.newState !== 'open') return
    error = ''
    for (const j of [latest('video'), latest('project')]) if (j?.state === 'done') invoke('share:status', j.id)
  }
</script>

<button class="trigger" popovertarget="{uid}-share" style:anchor-name="--{uid}-share" aria-label={ring !== null ? `Sharing, ${ring}%` : 'Share'}>
  {#if ring !== null}
    <svg class="ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" />
      <circle cx="7" cy="7" r="5.5" class="fill" pathLength="100" stroke-dasharray="{ring} 100" />
    </svg>
  {:else}
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
      <path d="M6.6 9.4a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9" />
      <path d="M9.4 6.6a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 0 0 4.2 4.2l.9-.9" />
    </svg>
  {/if}
  Share
</button>

<div id="{uid}-share" class="pop" popover ontoggle={toggled} style:position-anchor="--{uid}-share">
  <div class="head">
    <h2>Share</h2>
    {#if toast}<span class="toast" role="status">{toast}</span>{/if}
  </div>

  <div class="seg" role="tablist" aria-label="What to share">
    <button role="tab" aria-selected={kind === 'video'} onclick={() => (kind = 'video')}>Video</button>
    <button role="tab" aria-selected={kind === 'project'} onclick={() => (kind = 'project')}>Project</button>
  </div>

  <div class="body">
    {#if exporting}
      <div class="row status">
        <span>Exporting the video…</span>
        <span class="num">{Math.floor(exporting.p * 100)}%</span>
      </div>
      <div class="bar"><div style:width="{exporting.p * 100}%"></div></div>
      <div class="row actions"><button class="text" onclick={() => exporting?.stop.abort()}>Cancel</button></div>
    {:else if !job}
      <p class="lead">
        {kind === 'video'
          ? 'Upload the video and get a link that plays in any browser, phones included.'
          : 'Send the editable project. It opens in Grip with every edit intact.'}
      </p>
      <button class="primary wide" onclick={share} disabled={kind === 'video' && !exportVideo}>Create link</button>
      {#if kind === 'video' && !exportVideo}<p class="hint">Video export is not available yet.</p>{/if}
    {:else}
      <!-- A failed upload's link never plays: the server dropped the item or never got all of it. -->
      {#if job.link && job.state !== 'failed'}
        <div class="link">
          <span class="url" title={job.link}>{job.link.replace(/^https?:\/\//, '')}</span>
          <button class="primary" onclick={copy}>Copy</button>
        </div>
      {/if}

      {#if job.state === 'preparing'}
        <p class="status">Packing the project…</p>
        <div class="bar indeterminate"><div></div></div>
      {:else if job.state === 'uploading' || job.state === 'waiting'}
        <div class="row status">
          <span>{job.state === 'waiting' ? 'Paused' : 'Uploading'} · {mb(job.sent)} of {mb(job.size)}</span>
          <span class="num">{pct(job)}%</span>
        </div>
        <div class="bar" class:paused={job.state === 'waiting'}><div style:width="{pct(job)}%"></div></div>
        {#if job.note}<p class="hint">{job.note}</p>{/if}
        <p class="hint">The link already works and shows the progress. Keep editing; the upload continues in the background.</p>
      {:else if job.state === 'processing'}
        <p class="status">Finishing…</p>
        <div class="bar indeterminate"><div></div></div>
      {:else if job.state === 'done'}
        <div class="row status">
          <span>
            {job.kind === 'video' && job.remote
              ? `${count(job.remote.views ?? 0, 'view')} · ${count(job.remote.comments ?? 0, 'comment')}`
              : `Ready · ${mb(job.size)}`}
          </span>
          <button class="text" onclick={() => invoke('share:open', job.id)}>Open in browser</button>
        </div>
      {:else if job.state === 'failed'}
        <p class="error">{job.note}</p>
      {/if}

      <div class="row actions">
        {#if busy(job)}
          <button class="text" onclick={remove}>Cancel upload</button>
        {:else}
          <button class="text" onclick={share} disabled={kind === 'video' && !exportVideo}>{job.state === 'failed' ? 'Try again' : 'New link'}</button>
          {#if job.state === 'done'}<button class="text danger" onclick={remove}>Delete link</button>{/if}
        {/if}
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>

  <label class="private">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
    <span>
      <b>Private</b>
      <small>{isPrivate ? 'Only this exact link opens it.' : 'Anyone with the link can open it.'}</small>
    </span>
    <input type="checkbox" role="switch" checked={isPrivate} onchange={(e) => setPrivate(e.currentTarget.checked)} />
  </label>
</div>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px 0 9px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    font-weight: 500;
  }
  .trigger:hover {
    background: var(--surface-100-hover);
  }
  .ring {
    transform: rotate(-90deg);
    fill: none;
    stroke-width: 2;
    stroke: var(--surface-200);
  }
  .ring .fill {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dasharray 0.2s;
  }

  .pop {
    inset: auto;
    top: anchor(bottom);
    right: anchor(right);
    position-try-fallbacks: flip-block;
    margin: 8px 0 0;
    width: 320px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--surface-50);
    color: var(--text);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .toast {
    font-size: 12px;
    color: var(--success);
  }

  .seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    margin: 0 14px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--surface-25);
    box-shadow: var(--hairline);
  }
  .seg button {
    height: 24px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-dim);
    font-weight: 500;
  }
  .seg button:hover {
    background: var(--surface-25-hover);
    color: var(--text);
  }
  .seg button[aria-selected='true'] {
    background: var(--surface-150);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3), var(--hairline);
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 14px;
  }
  .lead {
    margin: 0;
    color: var(--text-dim);
  }
  .status {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .num {
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .error {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }

  button.primary {
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 500;
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  button.wide {
    width: 100%;
  }
  button:disabled {
    opacity: 0.45;
  }
  button.text {
    height: 22px;
    padding: 0 4px;
    margin: 0 -4px;
    border: 0;
    border-radius: var(--radius-xs);
    background: none;
    color: var(--accent-text);
    font-weight: 500;
  }
  button.text:hover:not(:disabled) {
    background: var(--surface-50-hover);
  }
  button.text.danger {
    color: var(--danger);
  }
  button.text.danger:hover {
    background: rgb(255 95 87 / 0.12);
  }
  .actions {
    justify-content: flex-start;
    gap: 16px;
  }

  .link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 3px 3px 10px;
    border-radius: calc(var(--radius-sm) + 3px); /* concentric around the Copy button, 3 px in */
    background: var(--surface-25);
    box-shadow: var(--hairline);
  }
  .url {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: 12px;
    user-select: text;
  }

  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-200);
    overflow: hidden;
  }
  .bar > div {
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 0.2s linear;
  }
  .bar.paused > div {
    background: var(--warning);
  }
  .bar.indeterminate > div {
    width: 35%;
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(290%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar.indeterminate > div {
      animation: none;
      width: 100%;
      opacity: 0.5;
    }
  }

  .private {
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    background: var(--surface-25);
    box-shadow: var(--hairline-t);
    color: var(--text-dim);
  }
  .private b {
    display: block;
    color: var(--text);
    font-weight: 500;
  }
  .private small {
    font-size: 12px;
  }
  input[role='switch'] {
    appearance: none;
    position: relative;
    width: 30px;
    height: 18px;
    margin: 0;
    border-radius: 9px;
    background: var(--surface-200);
    box-shadow: var(--hairline);
    transition: background 0.15s;
  }
  input[role='switch']::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--knob);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.35);
    transition: transform 0.15s;
  }
  input[role='switch']:checked {
    background: var(--accent);
  }
  input[role='switch']:checked::after {
    transform: translateX(12px);
    background: var(--accent-ink);
  }
  :focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
