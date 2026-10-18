<!-- Lab: export dialog variants to choose from (#/dev?lab=ExportVariants). Live mocks on the real UI
     kit and export math, one shared set of options (change it in any variant and all follow), for a
     25 s 2296 × 1440 project. Nothing exports and nothing calls IPC, so it also runs in a plain browser. -->
<script lang="ts">
  import { tick } from 'svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Popover from '../../../ui/Popover.svelte'
  import Icon from '../../../ui/Icon.svelte'
  import { cleanOptions, defaultOptions, estimateBytes, formatBytes, LIMITS, LOOPS, QUALITIES, RATES, SIZES, type ExportOptions, type Quality } from '../../../engine/export/options.ts'

  type Opt<T> = { value: T; label: string }
  type Key = 'format' | 'size' | 'fps' | 'quality' | 'codec' | 'loop' | 'maxMB'

  const SECONDS = 25
  const folder = 'Desktop'
  const QL: Record<Quality, string> = { studio: 'Studio', social: 'Social', web: 'Web', small: 'Small' }
  const QHINT: Record<Quality, string> = { studio: 'Largest files, crisp text in fast motion', social: 'Sharp, sized for social uploads', web: 'Small files for sites and docs', small: 'Smallest files, softer motion' }
  const PRESETS: Array<{ id: string; title: string; note: string; o: Partial<ExportOptions> }> = [
    { id: 'studio', title: 'Studio', note: 'Archive, editing', o: { format: 'mp4', size: 2160, fps: 60, quality: 'studio', codec: 'hevc', maxMB: 0 } },
    { id: 'social', title: 'Social', note: 'X, LinkedIn, YouTube', o: { format: 'mp4', size: 1440, fps: 60, quality: 'social', codec: 'h264', maxMB: 0 } },
    { id: 'small', title: 'Small', note: 'Slack, Mail, chat', o: { format: 'mp4', size: 1080, fps: 30, quality: 'web', codec: 'h264', maxMB: 20 } },
    { id: 'gif', title: 'GIF', note: 'READMEs, issues', o: { format: 'gif', size: 720, fps: 15, loop: 0, maxMB: 10 } },
  ]

  let o = $state<ExportOptions>({ ...defaultOptions(), size: 1440 })
  let toast = $state('')
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let sub = $state<Key | ''>('') // variant 6: the setting whose submenu is open
  let subTimer: ReturnType<typeof setTimeout> | undefined
  let lastDest = $state<'file' | 'clipboard'>('file') // variant 6: what ⌘E repeats

  const p = (n: number) => (n === 2160 ? '4K' : `${n}p`)
  const loopLabel = (v: number) => (v === 0 ? 'Forever' : v === 1 ? 'Once' : `${v}×`)
  const limitLabel = (v: number) => (v ? `${v} MB` : 'None')
  const dims = (x: ExportOptions) => ({ width: Math.round((x.size * 2296) / 1440 / 2) * 2, height: x.size })
  /** The size line's estimate: an MP4's ceiling, a GIF's typical size, both capped by the limit. */
  function sizeOf(x: ExportOptions) {
    const { width, height } = dims(x)
    const bytes = estimateBytes(SECONDS, width, height, x)
    return `${x.format === 'gif' && !x.maxMB ? '≈' : 'up to'} ${formatBytes(x.maxMB ? Math.min(bytes, x.maxMB * 1e6) : bytes)}`
  }
  const set = (patch: Partial<ExportOptions>) => (o = cleanOptions({ ...o, ...patch }))
  const pick = (k: Key, v: string | number) => set({ [k]: typeof o[k] === 'number' ? Number(v) : v })
  const asPreset = (x: Partial<ExportOptions>) => cleanOptions({ ...o, ...x })
  const matches = (x: Partial<ExportOptions>) => (Object.keys(x) as Key[]).every((k) => x[k] === o[k])

  const choices = $derived<Record<Key, Opt<string | number>[]>>({
    format: [{ value: 'mp4', label: 'MP4' }, { value: 'gif', label: 'GIF' }],
    size: SIZES[o.format].map((v) => ({ value: v, label: p(v) })),
    fps: RATES[o.format].map((v) => ({ value: v, label: `${v} fps` })),
    quality: QUALITIES.map((v) => ({ value: v, label: QL[v] })),
    codec: [{ value: 'h264', label: 'H.264' }, { value: 'hevc', label: 'HEVC' }],
    loop: LOOPS.map((v) => ({ value: v, label: loopLabel(v) })),
    maxMB: LIMITS.map((v) => ({ value: v, label: limitLabel(v) })),
  })
  const NAMES: Record<Key, string> = { format: 'Format', size: 'Resolution', fps: 'Frame rate', quality: 'Quality', codec: 'Codec', loop: 'Loop', maxMB: 'Size limit' }
  /** The settings that apply to the format, in reading order. */
  const keys = $derived<Key[]>(o.format === 'mp4' ? ['format', 'size', 'fps', 'quality', 'codec', 'maxMB'] : ['format', 'size', 'fps', 'loop', 'maxMB'])
  const shown = (k: Key) => choices[k].find((c) => c.value === o[k])?.label ?? ''
  const summary = $derived([shown('format'), shown('size'), shown('fps'), o.format === 'mp4' ? QL[o.quality] : `Loops ${loopLabel(o.loop).toLowerCase()}`])
  const facts = $derived(`${dims(o).width} × ${dims(o).height} · 0:${SECONDS} · ${sizeOf(o)}`)

  /** Variant 6, like a macOS menu: hovering a setting opens its submenu at once, and once one is open
   *  another row takes over only after a beat, so the pointer can cross rows on its way into it. */
  function hoverRow(k: Key | '') {
    clearTimeout(subTimer)
    if (!sub) sub = k
    else if (sub !== k) subTimer = setTimeout(() => (sub = k), 180)
  }

  /** Open a submenu from the keyboard and move into it, on its checked item. */
  async function enterSub(k: Key, row: HTMLElement) {
    clearTimeout(subTimer)
    sub = k
    await tick()
    row.parentElement?.querySelector<HTMLElement>('.submenu [aria-checked="true"]')?.focus()
  }

  /** Close the open submenu and hand focus back to its row. */
  function leaveSub(inside: HTMLElement) {
    sub = ''
    inside.closest('.has-sub')?.querySelector<HTMLElement>(':scope > .mi')?.focus()
  }

  /** Up and down arrows move between a menu's own items; a submenu keeps its keys to itself. */
  function nav(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(':scope > .mi, :scope > .has-sub > .mi')]
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  function flash(n: number, what: string) {
    toast = `Variant ${n}: ${what}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = ''), 1800)
  }
</script>

{#snippet head(title = 'Export', batch = true)}
  <header>
    <h2>{title}</h2>
    {#if batch}<button class="link">Batch Export…</button>{/if}
    <button class="x" aria-label="Close"><Icon name="close" size={12} /></button>
  </header>
{/snippet}

{#snippet seg(k: Key, stacked = false)}
  <Segmented label={NAMES[k]} {stacked} value={o[k]} onchange={(v) => pick(k, v)} options={choices[k].map((c) => (k === 'quality' ? { ...c, title: QHINT[c.value as Quality] } : c))} />
{/snippet}

{#snippet actions(n: number)}
  <footer>
    <button class="btn" onclick={() => flash(n, 'Copy to Clipboard')}>Copy to Clipboard</button>
    <button class="btn primary end" onclick={() => flash(n, `Save to File… (then ⌘E saves to that folder)`)}>Save to File…</button>
  </footer>
{/snippet}

{#snippet chip(k: Key)}
  <Popover label={NAMES[k]} align="start">
    {#snippet trigger(props)}
      <button class="chip" {...props} aria-label="{NAMES[k]}: {shown(k)}">{k === 'maxMB' && !o.maxMB ? 'No size limit' : k === 'maxMB' ? `Under ${o.maxMB} MB` : shown(k)}<Icon name="chevron" size={12} /></button>
    {/snippet}
    {#snippet children(close)}
      <div class="menu" role="menu" aria-label={NAMES[k]}>
        <p class="menu-title">{NAMES[k]}</p>
        {#each choices[k] as c (c.value)}
          <button class="mi" role="menuitemradio" aria-checked={c.value === o[k]} onclick={() => (pick(k, c.value), close())}>
            <span class="tick">{#if c.value === o[k]}<Icon name="check" size={14} />{/if}</span>{c.label}
            {#if k === 'quality'}<small>{QHINT[c.value as Quality]}</small>{/if}
          </button>
        {/each}
      </div>
    {/snippet}
  </Popover>
{/snippet}

{#snippet inline(k: Key)}
  <span class="inline">
    <select aria-label={NAMES[k]} value={String(o[k])} onchange={(e) => pick(k, e.currentTarget.value)}>
      {#each choices[k] as c (c.value)}<option value={String(c.value)}>{k === 'maxMB' ? (c.value ? `under ${c.value} MB` : 'no size limit') : k === 'quality' ? c.label.toLowerCase() : k === 'loop' ? loopLabel(Number(c.value)).toLowerCase() : c.label}</option>{/each}
    </select>
    <Icon name="chevron" size={11} />
  </span>
{/snippet}

<main>
  <div class="intro">
    <h1>Export dialog variants</h1>
    <p>⌘E repeats the last export in one click; these are the dialog behind ▾ (⇧⌘E). The settings are shared: change them in any variant and every variant follows. Nothing exports.</p>
  </div>

  <div class="board">
    <!-- 1 -->
    <section class="card">
      <h3><b>1</b>Fold the knobs</h3>
      <p class="why">One line says what you get. The rows stay folded until you want them; codec and size limit sit one level deeper. Cost: a click to change anything.</p>
      <div class="stage">
        <div class="sheet">
          {@render head()}
          <details class="fold">
            <summary>
              <span class="line">{summary.join(' · ')}</span>
              <span class="edit">Edit<Icon name="chevron" size={12} /></span>
            </summary>
            <div class="rows">
              {@render seg('format')}
              {@render seg('size')}
              {@render seg('fps')}
              {@render seg(o.format === 'mp4' ? 'quality' : 'loop')}
              <details class="more">
                <summary>More<Icon name="chevron" size={12} /></summary>
                <div class="rows">
                  {#if o.format === 'mp4'}{@render seg('codec')}{/if}
                  {@render seg('maxMB')}
                </div>
              </details>
            </div>
          </details>
          <p class="facts">{facts}</p>
          {@render actions(1)}
        </div>
      </div>
    </section>

    <!-- 2 -->
    <section class="card">
      <h3><b>2</b>Chips</h3>
      <p class="why">The summary is the control: each word opens its own short menu. Nothing hidden, nothing folded, one line tall. Cost: options are a click away instead of visible side by side.</p>
      <div class="stage">
        <div class="sheet">
          {@render head()}
          <div class="chips">
            {#each keys as k (k)}{@render chip(k)}{/each}
          </div>
          <p class="facts">{facts}</p>
          {@render actions(2)}
        </div>
      </div>
    </section>

    <!-- 3 -->
    <section class="card">
      <h3><b>3</b>Presets first</h3>
      <p class="why">Pick an intent, not six numbers: four tuned presets with their sizes, and the rows behind Custom. Cost: the presets need tuning, and Custom becomes a second mode.</p>
      <div class="stage">
        <div class="sheet">
          {@render head()}
          <div class="presets" role="radiogroup" aria-label="Preset">
            {#each PRESETS as preset (preset.id)}
              {@const x = asPreset(preset.o)}
              <button class="preset" role="radio" aria-checked={matches(preset.o)} onclick={() => set(preset.o)}>
                <b>{preset.title}</b>
                <span>{x.format === 'gif' ? 'GIF' : 'MP4'} · {p(x.size)} · {x.fps} fps</span>
                <span>{sizeOf(x)}</span>
                <small>{preset.note}</small>
              </button>
            {/each}
          </div>
          <details class="more custom" open={!PRESETS.some((x) => matches(x.o))}>
            <summary>Custom<Icon name="chevron" size={12} /></summary>
            <div class="rows">
              {#each keys as k (k)}{@render seg(k)}{/each}
            </div>
          </details>
          <p class="facts">{facts}</p>
          {@render actions(3)}
        </div>
      </div>
    </section>

    <!-- 4 -->
    <section class="card">
      <h3><b>4</b>Calm rows</h3>
      <p class="why">Every control stays, grouped into what you see and what you get, labels above, hints moved to tooltips. Cost: still six decisions on screen.</p>
      <div class="stage">
        <div class="sheet">
          {@render head()}
          <p class="group">Video</p>
          <div class="rows stacked">
            <div class="pair">
              {@render seg('format', true)}
              {@render seg('fps', true)}
            </div>
            {@render seg('size', true)}
          </div>
          <p class="group">File</p>
          <div class="rows stacked">
            {@render seg(o.format === 'mp4' ? 'quality' : 'loop', true)}
            {#if o.format === 'mp4'}{@render seg('codec', true)}{/if}
            {@render seg('maxMB', true)}
          </div>
          <p class="facts">{facts}</p>
          {@render actions(4)}
        </div>
      </div>
    </section>

    <!-- 5 -->
    <section class="card">
      <h3><b>5</b>Destination first</h3>
      <p class="why">Where it goes is the big choice and each tile acts at once; settings shrink to a line you rarely touch. Cost: two big targets for two actions takes room.</p>
      <div class="stage">
        <div class="sheet">
          {@render head()}
          <div class="tiles">
            <button class="tile" onclick={() => flash(5, 'Copy to Clipboard')}>
              <Icon name="copy" size={22} />
              <b>Copy to Clipboard</b>
              <small>Paste anywhere</small>
            </button>
            <button class="tile" onclick={() => flash(5, `Save to ${folder}`)}>
              <Icon name="folder" size={22} />
              <b>Save to {folder}</b>
              <small>Change folder…</small>
            </button>
          </div>
          <details class="fold">
            <summary>
              <span class="line dim">{summary.join(' · ')} · {sizeOf(o)}</span>
              <span class="edit">Edit<Icon name="chevron" size={12} /></span>
            </summary>
            <div class="rows">
              {#each keys as k (k)}{@render seg(k)}{/each}
            </div>
          </details>
        </div>
      </div>
    </section>

    <!-- 6 -->
    <section class="card">
      <h3><b>6</b>Menu, not a dialog</h3>
      <p class="why">The ▾ opens a native-feeling menu under the button: destinations on top, settings below, each opening its submenu on hover. No modal at all. Cost: no room for notes like "H.264 tops out at 4096 px".</p>
      <div class="stage start">
        <div class="titlebar-mock">
          <div class="split">
            <button class="btn primary go"><Icon name="export" size={16} />Export</button>
            <button class="btn primary more-btn" aria-label="Export Settings"><Icon name="chevron" size={14} /></button>
          </div>
        </div>
        <div class="nsmenu" role="menu" aria-label="Export" tabindex="-1" onkeydown={nav}>
          <button class="mi" role="menuitemradio" aria-checked={lastDest === 'file'} onpointerenter={() => hoverRow('')} onclick={() => ((lastDest = 'file'), flash(6, `Save to ${folder}`))}>
            <span class="tick">{#if lastDest === 'file'}<Icon name="check" size={14} />{/if}</span>Save to {folder}{#if lastDest === 'file'}<kbd>⌘E</kbd>{/if}
          </button>
          <button class="mi" role="menuitemradio" aria-checked={lastDest === 'clipboard'} onpointerenter={() => hoverRow('')} onclick={() => ((lastDest = 'clipboard'), flash(6, 'Copy to Clipboard'))}>
            <span class="tick">{#if lastDest === 'clipboard'}<Icon name="check" size={14} />{/if}</span>Copy to Clipboard{#if lastDest === 'clipboard'}<kbd>⌘E</kbd>{/if}
          </button>
          <button class="mi" role="menuitem" onpointerenter={() => hoverRow('')} onclick={() => flash(6, 'Save As…')}><span class="tick"></span>Save As…</button>
          <hr />
          {#each keys as k (k)}
            <div class="has-sub">
              <button
                class="mi"
                class:on={sub === k}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={sub === k}
                onpointerenter={() => hoverRow(k)}
                onclick={(e) => enterSub(k, e.currentTarget)}
                onkeydown={(e) => ['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key) && (e.preventDefault(), enterSub(k, e.currentTarget))}
              >
                <span class="tick"></span>{NAMES[k]}<span class="val">{k === 'maxMB' ? limitLabel(o.maxMB) : shown(k)}</span><span class="caret"><Icon name="chevron" size={12} /></span>
              </button>
              {#if sub === k}
                <!-- Opens to the left: the Export button sits at the window's right edge. -->
                <div
                  class="nsmenu submenu"
                  role="menu"
                  tabindex="-1"
                  aria-label={NAMES[k]}
                  onpointerenter={() => clearTimeout(subTimer)}
                  onkeydown={(e) => {
                    if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault()
                      e.stopPropagation()
                      leaveSub(e.currentTarget)
                    } else nav(e)
                  }}
                >
                  {#each choices[k] as c (c.value)}
                    <button class="mi" role="menuitemradio" aria-checked={c.value === o[k]} onclick={(e) => (pick(k, c.value), leaveSub(e.currentTarget))}>
                      <span class="tick">{#if c.value === o[k]}<Icon name="check" size={14} />{/if}</span>{c.label}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
          <hr />
          <p class="mfacts">{facts}</p>
          <button class="mi" role="menuitem" onpointerenter={() => hoverRow('')} onclick={() => flash(6, 'Batch Export…')}><span class="tick"></span>Batch Export…</button>
        </div>
      </div>
    </section>

    <!-- 7 -->
    <section class="card">
      <h3><b>7</b>Inspector panel</h3>
      <p class="why">Export settings live in the editor's right panel like any other property, always visible, never in the way; the button there or ⌘E just exports. Cost: one more inspector tab.</p>
      <div class="stage">
        <aside class="inspector">
          <h4>Export</h4>
          {@render seg('format', true)}
          {@render seg('size', true)}
          {@render seg('fps', true)}
          {@render seg(o.format === 'mp4' ? 'quality' : 'loop', true)}
          {#if o.format === 'mp4'}{@render seg('codec', true)}{/if}
          {@render seg('maxMB', true)}
          <p class="facts small">{facts}</p>
          <div class="stack">
            <button class="btn primary" onclick={() => flash(7, `Save to ${folder}`)}><Icon name="export" size={15} />Save to {folder}</button>
            <button class="btn" onclick={() => flash(7, 'Copy to Clipboard')}>Copy to Clipboard</button>
          </div>
        </aside>
      </div>
    </section>

    <!-- 8 -->
    <section class="card">
      <h3><b>8</b>Sentence</h3>
      <p class="why">The settings read as one sentence of native pop-up menus, so the whole export is understood in one pass. Cost: harder to scan for a single value, and wording depends on the format.</p>
      <div class="stage">
        <div class="sheet">
          {@render head()}
          <p class="sentence">
            {#if o.format === 'mp4'}
              Export an {@render inline('format')} at {@render inline('size')} and {@render inline('fps')}, {@render inline('quality')} quality, {@render inline('codec')}, {@render inline('maxMB')}.
            {:else}
              Export a {@render inline('format')} at {@render inline('size')} and {@render inline('fps')}, looping {@render inline('loop')}, {@render inline('maxMB')}.
            {/if}
          </p>
          <p class="facts">{facts}</p>
          {@render actions(8)}
        </div>
      </div>
    </section>
  </div>

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</main>

<style>
  :global(html[data-window='dev'] body) { overflow: auto; }
  main { min-height: 100vh; padding: 40px 40px 80px; box-sizing: border-box; background: var(--surface-root); }
  .intro { max-width: 760px; margin: 0 auto 28px; text-align: center; }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  .intro p { margin: 0; color: var(--text-dim); line-height: 1.5; }

  .board { display: grid; grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); gap: 28px; max-width: 1640px; margin: 0 auto; }
  .card { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .card h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; font-weight: 600; }
  .card h3 b { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--surface-150); font-size: 11px; font-weight: 600; }
  .why { margin: 0 0 4px 28px; color: var(--text-dim); font-size: 12.5px; line-height: 1.45; }
  .stage {
    flex: 1; display: grid; place-items: center; min-height: 500px; padding: 32px 24px; border-radius: var(--radius-xl);
    background: radial-gradient(120% 90% at 50% 0%, #1d1d22, #0c0c0e 70%); box-shadow: var(--hairline);
  }
  .stage.start { place-items: start end; align-content: start; gap: 0; padding-right: 48px; }

  .sheet { width: 400px; padding: 16px 20px 20px; border-radius: var(--radius-lg); background: var(--surface-50); box-shadow: var(--shadow-modal); box-sizing: border-box; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  h2 { margin: 0 auto 0 0; font-size: 15px; font-weight: 600; }
  .link { padding: 0; border: 0; background: none; color: var(--text-dim); font-size: 12px; font-weight: 500; }
  .link:hover { color: var(--text); }
  .x { display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: var(--surface-100); color: var(--text-dim); }
  .x:hover { color: var(--text); background: var(--surface-100-hover); }

  .rows { --label-w: 92px; display: grid; gap: 6px; }
  .rows.stacked { gap: 10px; }
  .facts { margin: 14px 0 0; padding-top: 10px; box-shadow: var(--hairline-t); color: var(--text-dim); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .facts.small { margin-top: 4px; font-size: 12px; }
  .dim { color: var(--text-dim); }
  footer { display: flex; gap: 8px; margin-top: 16px; }
  footer .btn { height: 30px; padding: 0 12px; }
  .btn:not(.primary) { box-shadow: var(--hairline); }
  .end { margin-left: auto; }

  /* 1, 3, 5: native disclosure */
  details > summary { list-style: none; cursor: default; }
  details > summary::-webkit-details-marker { display: none; }
  .fold > summary { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 10px; border-radius: var(--radius); background: var(--surface-25); box-shadow: var(--hairline); }
  .fold > summary:hover { background: var(--surface-25-hover); }
  .fold[open] > summary { margin-bottom: 10px; }
  .line { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .line.dim { font-weight: 400; }
  .edit, .more > summary, .custom > summary { display: inline-flex; align-items: center; gap: 3px; color: var(--text-dim); font-size: 12px; }
  .fold > summary:hover .edit, .more > summary:hover { color: var(--text); }
  :is(.fold, .more)[open] > summary :global(.icon) { transform: rotate(180deg); }
  .more > summary { margin: 2px 0 0 calc(var(--label-w) + 6px); padding: 3px 0; }
  .more[open] > summary { margin-bottom: 6px; }
  .custom > summary { margin: 12px 0 0; }
  .custom[open] > summary { margin-bottom: 8px; }

  /* 2 */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px 0 11px; border: 0; border-radius: 14px;
    background: var(--surface-100); box-shadow: var(--hairline); font-size: 12.5px; font-weight: 500;
  }
  .chip :global(.icon) { color: var(--text-dim); }
  .chip:hover { background: var(--surface-100-hover); }
  .menu { display: grid; min-width: 180px; }
  .menu-title { margin: 2px 8px 4px; color: var(--text-faint); font-size: 11px; font-weight: 600; }
  .menu .mi small { display: block; margin-left: auto; padding-left: 16px; color: var(--text-faint); font-size: 11.5px; }

  /* 3 */
  .presets { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .preset {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 9px 10px 10px; border: 0; border-radius: var(--radius);
    background: var(--surface-25); box-shadow: var(--hairline); text-align: left; font-size: 11.5px; color: var(--text-dim); font-variant-numeric: tabular-nums;
  }
  .preset b { margin-bottom: 2px; color: var(--text); font-size: 13px; font-weight: 600; }
  .preset span { white-space: nowrap; }
  .preset small { margin-top: 6px; color: var(--text-faint); font-size: 11px; line-height: 1.3; }
  .preset:hover { background: var(--surface-25-hover); }
  .preset[aria-checked='true'] { background: var(--surface-150); box-shadow: inset 0 0 0 1px var(--edge-strong); }

  /* 4 */
  .group { margin: 4px 0 8px; color: var(--text-faint); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .group + .rows + .group { margin-top: 18px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  /* 5 */
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
  .tile {
    display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 14px 14px 13px; border: 0; border-radius: var(--radius-lg);
    background: var(--surface-100); box-shadow: var(--hairline); text-align: left;
  }
  .tile :global(.icon) { margin-bottom: 8px; color: var(--text-dim); }
  .tile b { font-size: 13px; font-weight: 600; }
  .tile small { color: var(--text-faint); font-size: 11.5px; }
  .tile:hover { background: var(--surface-100-hover); }
  .tile:hover :global(.icon) { color: var(--text); }

  /* 6 */
  .titlebar-mock { display: flex; justify-content: flex-end; width: 300px; padding: 6px 0; }
  .split { display: flex; }
  .split .btn { height: 28px; }
  .go { padding: 0 11px 0 10px; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
  .more-btn { width: 22px; padding: 0; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; box-shadow: inset 1px 0 0 rgb(0 0 0 / 0.14) !important; }
  .nsmenu {
    display: grid; width: 260px; margin-top: 6px; padding: 5px; border-radius: 10px; box-sizing: border-box;
    background: rgb(36 36 40 / 0.92); backdrop-filter: blur(24px) saturate(1.6); box-shadow: var(--shadow-pop);
  }
  .mi {
    display: flex; align-items: center; height: 24px; padding: 0 8px 0 2px; border: 0; border-radius: 5px; background: none; text-align: left;
    font-size: 13px; color: var(--text);
  }
  .mi:hover, .mi:focus-visible, .mi.on { background: #2f6bd8; color: #fff; outline: none; }
  .mi:is(:hover, :focus-visible, .on) :is(kbd, .val, .caret) { color: rgb(255 255 255 / 0.8); }
  .tick { display: grid; place-items: center; flex: none; width: 20px; }
  .mi kbd, .mi .val { margin-left: auto; color: var(--text-faint); font: inherit; font-size: 12.5px; }
  .mi .val { color: var(--text-dim); }
  .caret { display: grid; margin-left: 4px; color: var(--text-faint); transform: rotate(-90deg); }
  .has-sub { position: relative; display: grid; }
  .submenu { position: absolute; top: -5px; right: calc(100% + 3px); z-index: 1; width: max-content; min-width: 140px; margin: 0; }
  .submenu .mi { padding-right: 14px; }
  .nsmenu hr { width: calc(100% - 20px); height: 0.5px; margin: 5px 10px; border: 0; background: var(--edge-strong); }
  .mfacts { margin: 2px 10px 6px 22px; color: var(--text-faint); font-size: 11.5px; font-variant-numeric: tabular-nums; }

  /* 7 */
  .inspector {
    display: grid; gap: 12px; width: 268px; padding: 14px 14px 16px; border-radius: var(--radius-lg); box-sizing: border-box;
    background: var(--surface-50); box-shadow: var(--hairline);
  }
  .inspector h4 { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
  .stack { display: grid; gap: 6px; }
  .stack .btn { height: 30px; }

  /* 8 */
  .sentence { margin: 2px 0 0; font-size: 15px; line-height: 2.1; color: var(--text-dim); }
  .inline { position: relative; display: inline-flex; align-items: center; vertical-align: baseline; }
  .inline select {
    height: 26px; padding: 0 20px 0 8px; border: 0; border-radius: var(--radius-sm); appearance: none;
    background: var(--surface-100); box-shadow: var(--hairline); color: var(--text); font: inherit; font-size: 14px; font-weight: 500;
  }
  .inline select:hover { background: var(--surface-100-hover); }
  .inline :global(.icon) { position: absolute; right: 6px; color: var(--text-dim); pointer-events: none; }

  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 8px 14px; border-radius: 18px;
    background: var(--surface-150); box-shadow: var(--shadow-pop); font-size: 12.5px;
  }
</style>
