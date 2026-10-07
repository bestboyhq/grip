<!-- The card after a recording or a screenshot, bottom right of the display (#/result?bundle=<path>
     or ?shot=<path>[&saved][&reopened], electron/shell/recorder.ts showResult), and again from
     Recent Captures (reopened: nothing copied or saved yet). A recording copies as an MP4 that fits
     under 20 MB or a GIF under 10 MB, ready to paste anywhere, or shares as a link, each styled like
     the project (plain by default, as it was on screen); or it opens in the editor. Exports keep
     running if the card closes. A new screenshot is already on the clipboard (or on the Desktop) and
     the card leaves by itself. Drag the picture into another app to drop the file. -->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { invoke, on } from '../../lib/ipc.ts'
  import { fileUrl } from '../../engine/media/index.ts'
  import { defaultOptions, formatBytes, type ExportOptions, type JobInfo } from '../../engine/export/options.ts'
  import Icon from '../../ui/Icon.svelte'
  import { formatTime } from '../recorder/shell.svelte.ts'

  let { params }: { params: URLSearchParams } = $props()
  const query = untrack(() => params) // a window's route never changes
  const bundle = query.get('bundle') ?? ''
  let shot = $state(query.get('shot') ?? '')
  let saved = $state(query.has('saved')) // the file is on the Desktop
  /** What the card did, checked next to the title: a new screenshot is copied or saved already. */
  let did = $state<'copied' | 'saved' | ''>(query.has('reopened') ? '' : query.has('saved') ? 'saved' : 'copied')

  // One tuned preset per button. Copy: an MP4 that pastes into Slack, Discord, WhatsApp, or Mail.
  // GIF: under GitHub's 10 MB, for READMEs and issues.
  const PRESETS: Record<'mp4' | 'gif', ExportOptions> = {
    mp4: { ...defaultOptions(), maxMB: 20 },
    gif: { ...defaultOptions(), format: 'gif', size: 720, fps: 15, maxMB: 10 },
  }

  let job = $state<JobInfo | null>(null)
  const seen = new Map<string, JobInfo>() // updates can arrive before enqueue answers
  let duration = $state(0)
  let hovered = $state(false)
  let card: HTMLElement
  let picture = $state<HTMLVideoElement | HTMLImageElement>()

  const active = $derived(!!job && ['queued', 'running', 'uploading'].includes(job.state))
  const file = $derived(shot || (job?.state === 'done' && job.dest !== 'share' ? job.path : ''))
  const close = () => window.close()

  // The card fits its height to its content, and shows then: only once the picture has its size, so
  // it never appears at one size and jumps to another.
  let sized = false
  const fit = () => sized && invoke('shell:fit', Math.ceil(card.getBoundingClientRect().height))
  const pictureSized = () => {
    sized = true
    fit()
  }

  onMount(() => {
    const refit = new ResizeObserver(fit)
    refit.observe(card)
    const off = on('export:update', (j: JobInfo) => {
      seen.set(j.id, j)
      if (j.id === job?.id) job = j
    })
    return () => {
      refit.disconnect()
      off()
    }
  })

  // A screenshot's card leaves a few seconds after it copied or saved, unless the pointer rests on it.
  $effect(() => {
    if (!shot || !did || hovered) return
    const t = setTimeout(close, 6000)
    return () => clearTimeout(t)
  })

  async function run(dest: 'clipboard' | 'share', options: ExportOptions) {
    if (active) return
    try {
      const [j]: JobInfo[] = await invoke('export:enqueue', [{ bundle, options, dest }])
      job = seen.get(j.id) ?? j
    } catch (e) {
      job = { state: 'failed', error: (e as Error).message } as JobInfo
    }
  }

  async function edit() {
    await invoke('shell:open-project', bundle)
    close()
  }

  async function copyShot() {
    await invoke('shell:shot-copy', shot)
    did = 'copied'
  }

  async function saveShot() {
    shot = (await invoke('shell:shot-save', shot)) ?? shot
    saved = true
    did = 'saved'
  }

  /** Dragging the picture drops its file: the screenshot, or the last copied export. */
  function drag(e: DragEvent) {
    e.preventDefault()
    if (!file || !picture) return
    // The drag image: the picture as it shows, drawn now (the drag must start in this event).
    const c = document.createElement('canvas')
    const w = picture instanceof HTMLVideoElement ? picture.videoWidth : picture.naturalWidth
    const h = picture instanceof HTMLVideoElement ? picture.videoHeight : picture.naturalHeight
    c.width = 160
    c.height = Math.max(1, Math.round((160 * h) / Math.max(w, 1)))
    c.getContext('2d')!.drawImage(picture, 0, 0, c.width, c.height)
    invoke('shell:drag', file, c.toDataURL('image/png'))
  }

  function status(j: JobInfo): string {
    const what = j.options?.format === 'gif' ? 'GIF' : j.dest === 'share' ? 'link' : 'video'
    if (j.state === 'failed') return j.error ?? 'The export failed.'
    if (j.state === 'canceled') return 'Canceled'
    if (j.state === 'done') return j.dest === 'share' ? 'Link copied' : `${what === 'GIF' ? 'GIF' : 'Video'} copied · ${formatBytes(j.bytes ?? 0)}`
    if (j.state === 'uploading') return 'Uploading…'
    if (j.state === 'queued') return 'Waiting…'
    return `${j.phase?.startsWith('Fitting') ? j.phase : `Making the ${what}`} · ${Math.floor(j.progress * 100)}%`
  }
</script>

<main class="card hud" bind:this={card} onpointerenter={() => (hovered = true)} onpointerleave={() => (hovered = false)}>
  <div class="picture" class:grab={!!file} draggable={!!file} ondragstart={drag} role="img" aria-label={shot ? 'Screenshot' : 'Recording'}>
    {#if shot}
      <img bind:this={picture} src={fileUrl(shot)} alt="" onload={pictureSized} onerror={pictureSized} />
    {:else}
      <video
        bind:this={picture}
        src={fileUrl(`${bundle}/sources/screen.mp4`)}
        muted
        preload="auto"
        onloadedmetadata={(e) => {
          duration = e.currentTarget.duration
          e.currentTarget.currentTime = Math.min(0.5, duration / 2) // past a black first frame
          pictureSized()
        }}
        onerror={pictureSized}
      ></video>
    {/if}
    <button class="close" aria-label="Close" onclick={close}><Icon name="close" size={14} /></button>
  </div>

  <div class="title">
    <span>{shot ? 'Screenshot' : 'Recording'}</span>
    {#if shot}
      {#if did}<span class="meta ok"><Icon name="check" size={14} />{did === 'saved' ? 'Saved to Desktop' : 'Copied to clipboard'}</span>{/if}
    {:else if duration}
      <span class="meta">{formatTime(duration)}</span>
    {/if}
  </div>

  {#if shot}
    <div class="actions">
      {#if did !== 'copied'}
        <button class="btn" onclick={copyShot}><Icon name="copy" size={16} />Copy</button>
      {/if}
      {#if saved}
        <button class="btn" onclick={() => invoke('shell:reveal', shot)}><Icon name="folder" size={16} />Show in Finder</button>
      {:else}
        <button class="btn" onclick={saveShot}><Icon name="download" size={16} />Save to Desktop</button>
      {/if}
    </div>
  {:else}
    <div class="actions">
      <button class="btn primary" disabled={active} onclick={() => run('clipboard', PRESETS.mp4)} title="Copy an MP4 under 20 MB, to paste anywhere"><Icon name="copy" size={16} />Copy</button>
      <button class="btn" disabled={active} onclick={() => run('clipboard', PRESETS.gif)} title="Copy a GIF under 10 MB"><span class="gif">GIF</span></button>
      <button class="btn" disabled={active} onclick={() => run('share', defaultOptions())} title="Upload and copy a link"><Icon name="link" size={16} />Link</button>
      <button class="btn" onclick={edit} title="Open in the editor"><Icon name="edit" size={16} />Edit</button>
    </div>
    {#if job}
      <div class="status" class:failed={job.state === 'failed'} role="status">
        {#if active}<div class="bar"><span style:width="{Math.max(2, job.progress * 100)}%"></span></div>{/if}
        <span class="text">
          {#if job.state === 'done'}<Icon name="check" size={14} />{/if}
          {#if job.state === 'done' && job.url}
            Link copied ·<a href={job.url} target="_blank" rel="noreferrer">{job.url.replace(/^https?:\/\//, '')}</a>
          {:else}
            {status(job)}
          {/if}
        </span>
      </div>
    {/if}
  {/if}
</main>

<style>
  :global(body) {
    background: transparent;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 8px 10px;
    color: var(--text);
    background: var(--surface-50);
    border-radius: var(--radius-lg);
    box-shadow: var(--hairline);
  }
  .picture {
    position: relative;
    display: grid;
    place-items: center;
    max-height: 200px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: rgb(0 0 0 / 0.35);
    box-shadow: var(--hairline);
  }
  .picture.grab {
    cursor: grab;
  }
  img,
  video {
    display: block;
    max-width: 100%;
    max-height: 200px;
    object-fit: contain;
    pointer-events: none;
  }
  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(20 20 22 / 0.72);
    color: rgb(255 255 255 / 0.85);
    box-shadow: 0 0 0 0.5px rgb(255 255 255 / 0.18);
    transition: background-color 120ms;
  }
  .close:hover {
    background: rgb(40 40 44 / 0.9);
    color: #fff;
  }
  .title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    padding: 0 4px;
    font-size: 13px;
    font-weight: 600;
  }
  .meta {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 400;
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .meta.ok :global(svg) {
    color: var(--success);
    align-self: center;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .actions .btn {
    flex: 1;
    height: 30px;
    padding: 0 8px;
    gap: 5px;
  }
  .gif {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .status {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .status.failed {
    color: var(--danger);
  }
  .text {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .text :global(svg) {
    color: var(--success);
  }
  .text a {
    color: var(--text);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .text a:hover {
    text-decoration: underline;
  }
  .bar {
    height: 3px;
    border-radius: 1.5px;
    background: var(--surface-200);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 1.5px;
    background: var(--accent);
    transition: width 200ms linear;
  }
</style>
