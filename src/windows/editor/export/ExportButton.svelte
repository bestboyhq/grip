<!-- Owner: export. The editor title bar's Export split button and its menu. One click (⌘E) repeats
     the last export: same settings, same destination (a file into the same folder without asking, or
     the clipboard), with a progress ring on the button; the very first opens the menu. The ▾ (⇧⌘E)
     opens the menu, like a macOS menu: destinations, then each setting with its choices in a submenu
     on hover (to the left: the button sits at the window's right edge), the size it makes, and batch.
     Exports run in the background (electron/export.ts): the menu bar shows their progress and a
     notification says when they are done. Mounted by Editor.svelte as <ExportButton />. -->
<script module lang="ts">
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke, on } from '../../../lib/ipc.ts'
  import { cleanOptions, type JobInfo } from '../../../engine/export/options.ts'

  const KEY = 'studio.export.options'
  const saved = () => cleanOptions(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  const LAST = 'studio.export.last'
  /** Where the last export from the menu went, which Export repeats, and the last folder a file
   *  went to, which the menu keeps one click away whatever the destination. */
  type Last = { dest: 'file'; dir: string } | { dest: 'clipboard'; dir?: string }
  function savedLast(): Last | null {
    const l = JSON.parse(localStorage.getItem(LAST) ?? 'null')
    const dir = typeof l?.dir === 'string' && l.dir.startsWith('/') ? (l.dir as string) : undefined
    if (l?.dest === 'file' && dir) return { dest: 'file', dir }
    return l?.dest === 'clipboard' ? { dest: 'clipboard', dir } : null
  }
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
  import { onMount, tick } from 'svelte'
  import { canEncodeVideo } from 'mediabunny'
  import Icon from '../../../ui/Icon.svelte'
  import { tooltip } from '../../../ui/tooltip.ts'
  import { submenuAim } from '../../../ui/aim.ts'
  import { registerCommands } from '../commands/registry.ts'
  import { timeMap } from '../../../shared/timemap.ts'
  import { formatTime } from '../helpers.ts'
  import { outputSize } from '../../../engine/scene.ts'
  import { fitEncoder } from '../../../engine/export/index.ts'
  import { estimateBytes, formatBytes, LIMITS, LOOPS, mp4Plan, QUALITIES, RATES, SIZES, tooLong, type ExportOptions, type Quality } from '../../../engine/export/options.ts'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  type Key = 'format' | 'size' | 'fps' | 'quality' | 'codec' | 'loop' | 'maxMB'
  type Choice = { value: string | number; label: string; hint?: string; disabled?: boolean }

  const uid = $props.id()
  let o = $state<ExportOptions>(saved())
  let last = $state(savedLast())
  let starting = false // one click, one export
  let jobs = $state<JobInfo[]>([])
  let error = $state('')
  let hevc = $state(true)
  let fit = $state<{ width: number; height: number } | null>(null)
  let sub = $state<Key | ''>('') // the setting whose submenu is open
  const aim = submenuAim(() => sub, (k) => (sub = k as Key | ''))
  let menu: HTMLElement

  const duration = $derived(doc.project ? timeMap(doc.project.clips).duration : 0)
  const base = $derived(doc.project ? outputSize(doc.project, o.size) : null)
  // What the MP4 will be under its size limit; null when it cannot fit.
  const plan = $derived(o.format === 'mp4' && fit ? mp4Plan(duration, o.maxMB * 1e6, fit, o) : undefined)
  const size = $derived(o.format === 'gif' ? base : (plan ?? fit))
  const shrunk = $derived(o.format === 'mp4' && base && fit && fit.width < base.width)
  const estimate = $derived(size && duration ? estimateBytes(duration, size.width, size.height, o) : 0)
  /** Why the file comes out smaller than asked for, or cannot be made. */
  const note = $derived(
    plan === null ? tooLong(o.maxMB)
    : plan && fit && (plan.width < fit.width || plan.fps < o.fps) ? `Exports at ${plan.width} × ${plan.height}${plan.fps < o.fps ? `, ${plan.fps} fps` : ''} to stay under ${o.maxMB} MB.`
    : shrunk && base && fit ? `H.264 tops out at 4096 pixels, so this exports at ${fit.width} × ${fit.height}. HEVC keeps ${base.width} × ${base.height}.`
    : o.format === 'gif' && duration > 60 ? 'GIFs over a minute get large and slow. MP4 is usually the better choice.'
    : '',
  )

  const p = (n: number) => (n === 2160 ? '4K' : `${n}p`)
  const QL: Record<Quality, string> = { studio: 'Studio', social: 'Social', web: 'Web', small: 'Small' }
  const QHINT: Record<Quality, string> = { studio: 'Largest files, crisp text in fast motion', social: 'Sharp, sized for social uploads', web: 'Small files for sites and docs', small: 'Smallest files, softer motion' }
  const NAMES: Record<Key, string> = { format: 'Format', size: 'Resolution', fps: 'Frame rate', quality: 'Quality', codec: 'Codec', loop: 'Loop', maxMB: 'Size limit' }
  const choices = $derived<Record<Key, Choice[]>>({
    format: [{ value: 'mp4', label: 'MP4' }, { value: 'gif', label: 'GIF' }],
    size: SIZES[o.format].map((v) => ({ value: v, label: p(v) })),
    fps: RATES[o.format].map((v) => ({ value: v, label: `${v} fps` })),
    quality: QUALITIES.map((v) => ({ value: v, label: QL[v], hint: QHINT[v] })),
    codec: [
      { value: 'h264', label: 'H.264', hint: 'Plays everywhere' },
      { value: 'hevc', label: 'HEVC', hint: hevc ? 'A third smaller; older players need H.264' : 'This Mac cannot encode HEVC', disabled: !hevc },
    ],
    loop: LOOPS.map((v) => ({ value: v, label: v === 0 ? 'Forever' : v === 1 ? 'Once' : `${v}×` })),
    maxMB: LIMITS.map((v) => ({ value: v, label: v ? `${v} MB` : 'None', hint: v ? 'Scaled down if needed' : 'Follows length and motion' })),
  })
  /** The settings that apply to the format, in reading order. */
  const keys = $derived<Key[]>(o.format === 'mp4' ? ['format', 'size', 'fps', 'quality', 'codec', 'maxMB'] : ['format', 'size', 'fps', 'loop', 'maxMB'])
  const shown = (k: Key) => choices[k].find((c) => c.value === o[k])?.label ?? ''

  // The button's ring: this project's export on its way.
  const mine = $derived(jobs.findLast((j) => j.bundle === doc.path && j.dest !== 'temp' && (j.state === 'queued' || j.state === 'running')))
  const ring = $derived(mine ? Math.floor(mine.progress * 100) : null)
  const folder = $derived(last?.dir ? last.dir.split('/').pop() || last.dir : '')
  /** What one click does, for its tooltip. */
  const again = $derived(!last ? 'Export' : `${last.dest === 'file' ? 'Save' : 'Copy'} ${p(o.size)} ${o.format.toUpperCase()} to ${last.dest === 'file' ? folder : 'the Clipboard'}`)

  $effect(() => {
    localStorage.setItem(KEY, JSON.stringify(o))
  })

  $effect(() => {
    if (open !== menu.matches(':popover-open')) menu.togglePopover(open)
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

  $effect(() =>
    registerCommands([
      { id: 'project.export', group: 'Project', title: 'Export', hint: last ? again : undefined, keys: ['⌘E'], run: exportAgain, enabled: () => !!doc.project },
      { id: 'project.exportOptions', group: 'Project', title: 'Export Options…', keys: ['⇧⌘E'], run: () => (open = true), enabled: () => !!doc.project },
    ]),
  )

  function set(k: Key, v: string | number) {
    o = cleanOptions({ ...o, [k]: typeof o[k] === 'number' ? Number(v) : v })
  }

  /** Repeat the last export; the first one opens the menu. */
  function exportAgain() {
    if (!last) open = true
    else void start(last.dest, last.dest === 'file' ? last.dir : undefined)
  }

  /** Queue an export (or a batch); `dir` saves a file there without asking. The menu closes on the
   *  choice, as menus do, and opens again to show a failure. */
  async function start(dest: 'file' | 'clipboard' | 'batch', dir?: string) {
    if (!doc.project || starting) return
    starting = true
    error = ''
    open = false
    try {
      if (dest === 'batch') return void (await invoke('export:batch', $state.snapshot(o)))
      const out: JobInfo[] | null = await invoke('export:enqueue', [{ bundle: doc.path, project: $state.snapshot(doc.project), options: $state.snapshot(o), dest, dir }])
      if (!out) return // the save panel was canceled
      last = dest === 'file' ? { dest, dir: out[0].path.slice(0, out[0].path.lastIndexOf('/')) || '/' } : { dest, dir: last?.dir }
      localStorage.setItem(LAST, JSON.stringify(last))
    } catch (e) {
      error = clean(e)
      open = true
    } finally {
      starting = false
    }
  }

  /** Like a macOS menu: moving onto a setting opens its submenu, anything else in the menu closes it, and
   *  rows crossed on the way into the open submenu wait (ui/aim.ts). Movement only: a resting pointer
   *  leaves the keyboard in charge. */
  const hover = (e: PointerEvent) =>
    aim.move(e, ((e.target as Element).closest('[data-key]') as HTMLElement | null)?.dataset.key ?? '', menu.querySelector('.submenu'))

  /** Open a submenu from a click or the keyboard and move into it, on its checked item. */
  async function enterSub(k: Key, row: HTMLElement) {
    aim.stop()
    sub = k
    await tick()
    row.parentElement?.querySelector<HTMLElement>('.submenu [aria-checked="true"]')?.focus()
  }

  /** Close the open submenu and hand focus back to its row. */
  function leaveSub(inside: HTMLElement) {
    aim.stop()
    sub = ''
    inside.closest('.has-sub')?.querySelector<HTMLElement>(':scope > .mi')?.focus()
  }

  /** ↑ ↓ move between a menu's own items; a submenu keeps its keys to itself. */
  function nav(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(':scope > .mi, :scope > .has-sub > .mi')].filter((b) => !b.matches(':disabled'))
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
</script>

<div class="split">
  <button class="btn primary go" disabled={!doc.project} aria-label={ring !== null ? `Exporting, ${ring}%` : undefined} onclick={exportAgain} {@attach tooltip(again, '⌘E')}>
    {#if ring !== null}
      <svg class="ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <circle cx="8" cy="8" r="6" class="fill" pathLength="100" stroke-dasharray="{ring} 100" />
      </svg>
    {:else}
      <Icon name="export" size={16} />
    {/if}
    Export
  </button>
  <button
    class="btn primary more"
    disabled={!doc.project}
    aria-label="Export Options"
    aria-haspopup="menu"
    aria-expanded={open}
    popovertarget="{uid}-menu"
    style:anchor-name="--{uid}-export"
    {@attach tooltip('Export Options', '⇧⌘E')}
  >
    <Icon name="chevron" size={14} />
  </button>
</div>

<div
  bind:this={menu}
  id="{uid}-menu"
  popover="auto"
  class="menu drop"
  role="menu"
  aria-label="Export"
  tabindex="-1"
  style:position-anchor="--{uid}-export"
  ontoggle={(e) => {
    open = e.newState === 'open'
    aim.stop()
    sub = ''
    if (open) menu.querySelector<HTMLElement>('.mi')?.focus({ focusVisible: false } as FocusOptions)
  }}
  onpointermove={hover}
  onkeydown={nav}
>
  {#if mine}
    <button class="mi" role="menuitem" onclick={() => ((open = false), invoke('export:cancel', mine.id))}>
      <span class="tick"></span>Cancel Export<span class="val">{ring}%</span>
    </button>
    <hr />
  {/if}
  {#if last?.dir}
    {@const dir = last.dir}
    {@const repeats = last.dest === 'file'}
    <button class="mi" role="menuitem" aria-keyshortcuts={repeats ? 'Meta+E' : undefined} onclick={() => start('file', dir)}>
      <span class="tick">{#if repeats}<Icon name="check" size={14} />{/if}</span><span class="label" title={dir}>Save to {folder}</span>{#if repeats}<kbd>⌘E</kbd>{/if}
    </button>
  {/if}
  <button class="mi" role="menuitem" aria-keyshortcuts={last?.dest === 'clipboard' ? 'Meta+E' : undefined} onclick={() => start('clipboard')}>
    <span class="tick">{#if last?.dest === 'clipboard'}<Icon name="check" size={14} />{/if}</span>Copy to Clipboard{#if last?.dest === 'clipboard'}<kbd>⌘E</kbd>{/if}
  </button>
  <button class="mi" role="menuitem" onclick={() => start('file')}><span class="tick"></span>Save As…</button>
  <hr />
  {#each keys as k (k)}
    <div class="has-sub" data-key={k}>
      <button
        class="mi"
        class:on={sub === k}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={sub === k}
        onclick={(e) => enterSub(k, e.currentTarget)}
        onkeydown={(e) => ['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key) && (e.preventDefault(), enterSub(k, e.currentTarget))}
      >
        <span class="tick caret"><Icon name="chevron" size={12} /></span>{NAMES[k]}<span class="val">{shown(k)}</span>
      </button>
      {#if sub === k}
        <div
          class="submenu"
          role="menu"
          tabindex="-1"
          aria-label={NAMES[k]}
          onkeydown={(e) => {
            if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              e.stopPropagation()
              leaveSub(e.currentTarget)
            } else nav(e)
          }}
        >
          {#each choices[k] as c (c.value)}
            <button class="mi" role="menuitemradio" aria-checked={c.value === o[k]} disabled={c.disabled} onclick={(e) => (set(k, c.value), leaveSub(e.currentTarget))}>
              <span class="tick">{#if c.value === o[k]}<Icon name="check" size={14} />{/if}</span>{c.label}{#if c.hint}<small>{c.hint}</small>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
  <hr />
  <p class="facts">
    {#if size}{size.width} × {size.height} · {formatTime(duration, 0)} · {o.format === 'gif' && !o.maxMB ? '≈' : 'up to'} {formatBytes(estimate)}{:else}No project open{/if}
  </p>
  {#if note}<p class="note" class:danger={plan === null}>{note}</p>{/if}
  {#if error}<p class="note danger" role="alert">{error}</p>{/if}
  <button class="mi" role="menuitem" title="Export several projects with these settings, unattended" onclick={() => start('batch')}><span class="tick"></span>Batch Export…</button>
</div>

<style>
  .split {
    display: flex;
    margin-left: 4px;
  }
  .split .btn {
    height: 28px;
  }
  .go {
    padding: 0 11px 0 10px;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }
  .more {
    width: 22px;
    padding: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    box-shadow: inset 1px 0 0 rgb(0 0 0 / 0.14); /* the seam between the halves */
  }
  .ring {
    transform: rotate(-90deg);
    fill: none;
    stroke-width: 2;
    stroke: rgb(0 0 0 / 0.18);
  }
  .ring .fill {
    stroke: currentColor;
    stroke-linecap: round;
    transition: stroke-dasharray 0.2s;
  }

  /* The platform's menu: an elevated card that grows out of the Export button (.drop in theme.css). Visible
     overflow, so submenus can hang out of it. */
  .menu {
    inset: auto;
    width: 264px;
    margin: 6px 0 0;
    padding: 5px;
    border: 0;
    border-radius: 10px;
    box-sizing: border-box;
    overflow: visible;
    background: var(--surface-elevated);
    box-shadow: var(--shadow-pop);
    color: var(--fg-default);
    position-area: bottom span-left;
    position-try-fallbacks: flip-block;
  }
  .menu:popover-open {
    display: grid;
  }
  .mi {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 24px;
    padding: 0 8px 0 2px;
    border: 0;
    border-radius: 5px;
    background: none;
    text-align: left;
    font-size: 13px;
    font-weight: 400;
    color: var(--fg-default);
    white-space: nowrap;
  }
  /* [data-aiming]: on its way into the open submenu, the pointer lights up no row it crosses */
  .menu:not([data-aiming]) .mi:hover:not(:disabled),
  .mi:focus-visible,
  .mi.on {
    background: var(--surface-hover);
    outline: none;
  }
  .mi:disabled {
    color: var(--fg-faint);
  }
  .tick {
    display: grid;
    place-items: center;
    flex: none;
    width: 20px;
  }
  .caret {
    color: var(--fg-faint);
  }
  .caret :global(.icon) {
    transform: rotate(90deg); /* points left, where the submenu opens */
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  kbd,
  .val {
    margin-left: auto;
    padding-left: 12px;
    font: inherit;
    font-size: 12.5px;
    color: var(--fg-faint);
  }
  .val {
    color: var(--fg-secondary);
    font-variant-numeric: tabular-nums;
  }
  small {
    margin-left: auto;
    padding-left: 16px;
    font-size: 11.5px;
    color: var(--fg-faint);
  }
  hr {
    width: calc(100% - 20px);
    height: 0.5px;
    margin: 5px 10px;
    border: 0;
    background: var(--border-default);
  }
  .has-sub {
    position: relative;
    display: grid;
  }
  .submenu {
    position: absolute;
    top: -5px;
    right: calc(100% + 3px);
    z-index: 1;
    display: grid;
    width: max-content; /* an absolute box beside its row would shrink to the row's width */
    min-width: 140px;
    padding: 5px;
    border-radius: 10px;
    background: var(--surface-elevated);
    box-shadow: var(--shadow-pop);
  }
  .submenu .mi {
    padding-right: 14px;
  }
  .facts,
  .note {
    margin: 2px 10px 6px 22px;
    font-size: 11.5px;
    color: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }
  .note {
    margin-top: -2px;
    line-height: 1.35;
  }
  .note.danger {
    color: var(--error-content);
  }
</style>
