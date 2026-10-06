<!-- Background (wallpaper, gradient, color, image, blur), the screen's shape, and the device frame. -->
<script lang="ts" module>
  import { WALLPAPERS, wallpaper, type Wallpaper } from '../../../engine/backgrounds/index.ts'
  import { invoke } from '../../../lib/ipc.ts'

  // Collection pills: the user's installed macOS wallpapers first, then ours in WALLPAPERS order.
  const MACOS = 'macOS'
  const COLLECTIONS = [...new Set(WALLPAPERS.map((w) => w.collection))]
  const COLS = 7
  const GAP = 8 // --gutter

  // The macOS collection (electron/wallpapers.ts): installed system wallpapers with their previews.
  // Asked for once per window, as soon as the inspector loads, so it is there when the tab opens.
  type MacWallpaper = { name: string; file: string; thumb: string }
  let macList: Promise<MacWallpaper[]> | undefined
  const macWallpapers = () =>
    (macList ??= invoke('wallpapers:macos').catch((e) => {
      macList = undefined
      console.warn('macOS wallpapers:', e)
      return []
    }))
  macWallpapers()

  const gradient = (stops: string[], angle = 135) => `linear-gradient(${angle}deg, ${stops.join(', ')})`
  // Until the rendered thumbnails arrive: the wallpaper's palette as a plain gradient.
  const sketch = (w: Wallpaper) => (w.colors.length > 1 ? gradient(w.colors) : w.colors[0])

  // Our gradient presets. Picking one copies its stops into the project, so editing it later never
  // changes other projects.
  export const GRADIENTS: Array<{ name: string; stops: string[]; angle: number }> = [
    { name: 'Nightfall', stops: ['#1e1b4b', '#6d28d9', '#db2777'], angle: 135 },
    { name: 'Ember', stops: ['#3a1c71', '#d76d77', '#ffaf7b'], angle: 135 },
    { name: 'Lagoon', stops: ['#0b3d91', '#1cb5e0'], angle: 135 },
    { name: 'Peach', stops: ['#ff9a8b', '#ff6a88', '#ff99ac'], angle: 135 },
    { name: 'Lilac', stops: ['#a18cd1', '#fbc2eb'], angle: 160 },
    { name: 'Meadow', stops: ['#0ba360', '#3cba92'], angle: 135 },
    { name: 'Citrus', stops: ['#f83600', '#f9d423'], angle: 135 },
    { name: 'Glacier', stops: ['#89f7fe', '#66a6ff'], angle: 135 },
    { name: 'Deep sea', stops: ['#0f2027', '#203a43', '#2c5364'], angle: 160 },
    { name: 'Pine', stops: ['#134e5e', '#71b280'], angle: 135 },
    { name: 'Graphite', stops: ['#232526', '#4a4d50'], angle: 160 },
    { name: 'Candy', stops: ['#fc5c7d', '#6a82fb'], angle: 135 },
  ]
  export const COLORS = ['#000000', '#1c1c1e', '#3a3a3c', '#f2f2f7', '#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f']
</script>

<script lang="ts">
  import { tick } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { doc, edit } from '../../../lib/doc.svelte.ts'
  import { defaultStyle, type Background, type Style } from '../../../shared/project.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import Section from '../../../ui/Section.svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import ColorPicker from '../../../ui/ColorPicker.svelte'
  import Icon from '../../../ui/Icon.svelte'
  import { tooltip } from '../../../ui/tooltip.ts'
  import { importFile } from '../files.ts'
  import { wallpaperThumbnail } from '../../../engine/backgrounds/thumbnails.ts'

  const uid = $props.id()
  const st = $derived(doc.project!.style)
  const bg = $derived(st.background)
  const init = defaultStyle()
  let macs = $state<MacWallpaper[]>([])
  macWallpapers().then((m) => (macs = m))
  /** The macOS wallpaper the image background was converted from, if it was. */
  const mac = $derived(bg.kind === 'image' ? macs.find((m) => m.file === bg.file) : undefined)
  // The tab and the collection follow the background (undo, presets) but can be switched to browse.
  let kind = $derived<Background['kind']>(mac ? 'wallpaper' : bg.kind)
  const pills = $derived(macs.length ? [MACOS, ...COLLECTIONS] : COLLECTIONS)
  let collection = $derived(mac ? MACOS : bg.kind === 'wallpaper' ? wallpaper(bg.id).collection : COLLECTIONS[0])
  let error = $state('')
  let missing = $state('') // the image file that failed to load
  let converting = $state('') // the macOS wallpaper being copied into the project
  let failed = $state(0) // remounts the tiles after a failed pick, so the checked radio matches the background again

  // Compositor thumbnails of the shown collection only, at the tile's device pixel size.
  const thumbs = new SvelteMap<string, string>()
  let gridWidth = $state(0)
  const px = $derived(Math.ceil(((gridWidth - GAP * (COLS - 1)) / COLS) * devicePixelRatio))
  $effect(() => {
    if (px <= 0) return
    for (const w of WALLPAPERS) {
      if (w.collection === collection) wallpaperThumbnail(w.id, px, px).then((url) => thumbs.set(w.id, url), () => {})
    }
  })

  type Tile = { id: string; name: string; look: string; on: boolean; pick: () => void }
  const cover = (url: string) => `center / cover url("${url}")`
  const tiles: Tile[] = $derived(
    collection === MACOS
      ? macs.map((m) => ({ id: m.file, name: m.name, look: cover(m.thumb), on: mac === m, pick: () => pickMac(m) }))
      : WALLPAPERS.filter((w) => w.collection === collection).map((w) => ({
          id: w.id,
          name: w.name,
          look: thumbs.has(w.id) ? cover(thumbs.get(w.id)!) : sketch(w),
          on: bg.kind === 'wallpaper' && bg.id === w.id,
          pick: () => setBg({ kind: 'wallpaper', id: w.id }),
        })),
  )

  async function pickMac(m: MacWallpaper) {
    error = ''
    converting = m.file
    try {
      const file: string = await invoke('wallpapers:importMacos', doc.path, m.name)
      setBg({ kind: 'image', file })
    } catch (e) {
      error = String((e as Error).message)
      failed++
    } finally {
      converting = ''
    }
  }

  // Collection pills scroll sideways; an edge fades where more pills hide.
  let pillRow = $state<HTMLElement>()
  let fade = $state({ start: false, end: false })
  function edges() {
    const el = pillRow
    if (el) fade = { start: el.scrollLeft > 1, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 }
  }
  $effect(() => {
    void pills
    edges()
  })
  $effect(() => {
    void collection
    pillRow?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  })
  // Tabs pattern: one tab stop, arrow keys and Home/End move between collections and show them.
  function pillKeys(e: KeyboardEvent) {
    const i = pills.indexOf(collection)
    const j = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: pills.length - 1 } as Record<string, number>)[e.key]
    if (j === undefined) return
    e.preventDefault()
    collection = pills[(j + pills.length) % pills.length]
    tick().then(() => pillRow?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
  }

  const setBg = (b: Background, merge?: string) => edit((p) => { p.style.background = b }, merge)
  const set = <K extends keyof Style>(k: K) => (v: Style[K], merge?: string) => edit((p) => { p.style[k] = v }, merge)

  const stops = $derived(bg.kind === 'gradient' ? bg.stops : (GRADIENTS[0].stops))
  const angle = $derived(bg.kind === 'gradient' ? bg.angle : 135)
  const color = $derived(bg.kind === 'color' ? bg.color : '#1c1c1e')

  async function pickImage() {
    error = ''
    try {
      const file = await importFile('image', 'image/png,image/jpeg,image/webp')
      if (file) setBg({ kind: 'image', file })
    } catch (e) {
      error = String((e as Error).message)
    }
  }

  function randomWallpaper() {
    const others = tiles.filter((t) => !t.on)
    others[Math.floor(Math.random() * others.length)]?.pick()
  }
</script>

<Section>
  <Segmented
    value={kind}
    onchange={(v) => (kind = v)}
    options={[
      { value: 'wallpaper', label: 'Wallpaper' },
      { value: 'gradient', label: 'Gradient' },
      { value: 'color', label: 'Color' },
      { value: 'image', label: 'Image' },
    ]}
  />
  <div class="kind">
    {#if kind === 'wallpaper'}
      <div class="pills" class:fade-start={fade.start} class:fade-end={fade.end} role="tablist" aria-label="Wallpaper collections" bind:this={pillRow} onscroll={edges}>
        {#each pills as c, i (c)}
          <button role="tab" id="{uid}-tab-{i}" aria-selected={c === collection} aria-controls="{uid}-panel" tabindex={c === collection ? 0 : -1} onclick={() => (collection = c)} onkeydown={pillKeys}>{c}</button>
        {/each}
      </div>
      <div class="stack" role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{pills.indexOf(collection)}">
        <button class="btn wide" onclick={randomWallpaper}><Icon name="shuffle" size={15} />Pick random wallpaper</button>
        {#key failed}
          <div class="well"><div class="grid" style:--cols={COLS} role="radiogroup" aria-label="{collection} wallpapers" bind:clientWidth={gridWidth}>
            {#each tiles as t (t.id)}
              <input
                class="tile"
                type="radio"
                name="{uid}-wallpaper"
                checked={t.on}
                aria-label={t.name}
                aria-busy={converting === t.id}
                style:background={t.look}
                onchange={t.pick}
                {@attach tooltip(t.name)}
              />
            {/each}
          </div></div>
        {/key}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </div>
    {:else if kind === 'gradient'}
      <div class="well grid" role="radiogroup" aria-label="Gradient presets">
        {#each GRADIENTS as g (g.name)}
          <input
            class="tile"
            type="radio"
            name="{uid}-gradient"
            checked={bg.kind === 'gradient' && bg.stops.join() === g.stops.join()}
            aria-label={g.name}
            style:background={gradient(g.stops, g.angle)}
            onchange={() => setBg({ kind: 'gradient', stops: [...g.stops], angle: g.angle })}
            {@attach tooltip(g.name)}
          />
        {/each}
      </div>
      <ColorPicker label="From" value={stops[0]} onchange={(c, m) => setBg({ kind: 'gradient', stops: [c, ...stops.slice(1)], angle }, m)} />
      <ColorPicker label="To" value={stops.at(-1)!} onchange={(c, m) => setBg({ kind: 'gradient', stops: [...stops.slice(0, -1), c], angle }, m)} />
      <Slider label="Angle" value={angle} min={0} max={360} step={1} initial={135} format={(v) => `${Math.round(v)}°`} onchange={(a, m) => setBg({ kind: 'gradient', stops: [...stops], angle: a }, m)} />
    {:else if kind === 'color'}
      <ColorPicker label="Color" value={color} active={bg.kind === 'color'} swatches={COLORS} onchange={(c, m) => setBg({ kind: 'color', color: c }, m)} />
    {:else}
      {#if bg.kind === 'image'}
        {#key bg.file}
          {#if missing !== bg.file}
            <img class="preview" src={fileUrl(`${doc.path}/${bg.file}`)} alt="Current background" onerror={() => (missing = bg.kind === 'image' ? bg.file : '')} />
          {:else}
            <p class="preview missing" role="alert">The background image is missing from this project, so the default wallpaper shows. Choose another image.</p>
          {/if}
        {/key}
      {/if}
      <button class="btn wide" onclick={pickImage}><Icon name="upload" size={15} />{bg.kind === 'image' ? 'Replace image…' : 'Choose image…'}</button>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {/if}
  </div>
  <Slider label="Blur" value={st.backgroundBlur} initial={init.backgroundBlur} format={(v) => `${Math.round(v * 100)}%`} onchange={set('backgroundBlur')} />
</Section>

<Section title="Shape">
  <Slider label="Padding" value={st.padding} min={0} max={300} step={1} initial={init.padding} onchange={set('padding')} />
  <!-- A device frame brings its own screen corners. -->
  <Slider label="Roundness" value={st.radius} min={0} max={80} step={1} initial={init.radius} disabled={st.device !== 'none'} onchange={set('radius')} />
  <Slider label="Inset" value={st.inset ?? 0} min={0} max={120} step={1} initial={0} onchange={set('inset')} />
  <Slider label="Shadow" value={st.shadow} initial={init.shadow} format={(v) => `${Math.round(v * 100)}%`} onchange={set('shadow')} />
</Section>

<Section title="Device frame">
  <Segmented
    stacked
    value={st.device}
    onchange={set('device')}
    options={[
      { value: 'none', label: 'None', icon: 'none' },
      { value: 'macbook', label: 'MacBook', icon: 'laptop' },
      { value: 'iphone', label: 'iPhone', icon: 'phone' },
      { value: 'ipad', label: 'iPad', icon: 'tablet' },
    ]}
  />
</Section>

<style>
  .kind { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 6px; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  /* Tiles sit in a well; corners stay concentric (well radius - padding = tile radius). */
  .well { padding: var(--gutter); border-radius: var(--radius-xl); background: var(--surface-25); box-shadow: var(--hairline); }
  .grid { display: grid; grid-template-columns: repeat(var(--cols, 6), 1fr); gap: var(--gutter); }
  /* Collections: a row of pills that scrolls sideways without a scrollbar; an edge fades where more
     pills hide. The vertical padding keeps focus rings and shadows from being clipped; the scroll padding
     keeps the chosen pill clear of the fades when it scrolls into view. */
  .pills {
    --start: 0px; --end: 0px;
    display: flex; gap: 4px; margin: -2px 0; padding: 2px 0; overflow-x: auto; scrollbar-width: none; scroll-padding-inline: 40px;
    mask-image: linear-gradient(to right, transparent, #000 var(--start), #000 calc(100% - var(--end)), transparent);
  }
  .pills.fade-start { --start: 40px; }
  .pills.fade-end { --end: 40px; }
  .pills button {
    flex: none; height: 24px; padding: 0 10px; border: 0; border-radius: var(--radius-sm);
    background: none; color: var(--text-dim); font-size: 12px; font-weight: 500;
    transition: background-color 120ms, color 120ms;
  }
  .pills button:hover { background: var(--surface-50-hover); color: var(--text); }
  .pills button[aria-selected='true'] { background: var(--surface-150); color: var(--text); box-shadow: 0 1px 2px rgb(0 0 0 / 0.3), var(--hairline); }
  .pills button:focus-visible { outline-offset: -2px; }
  /* Native radios: the group is one tab stop and arrow keys move the choice. Selection rings the tile;
     keyboard focus rings its inside (light over dark, visible on any wallpaper), so the two never merge. */
  .tile {
    --selected: 0 0 transparent; --focused: 0 0 transparent;
    appearance: none; aspect-ratio: 1; margin: 0; border-radius: var(--radius);
    box-shadow: var(--focused), var(--hairline), var(--selected);
    transition: transform 140ms var(--ease-out), box-shadow 140ms;
  }
  .tile:hover { transform: scale(1.06); }
  .tile[aria-busy='true'] { animation: converting 700ms ease-in-out infinite alternate; }
  @keyframes converting { to { opacity: 0.5; } }
  .tile:checked { --selected: 0 0 0 2px var(--surface-25), 0 0 0 4px var(--accent); }
  .tile:focus-visible { outline: none; --focused: inset 0 0 0 2px var(--text), inset 0 0 0 3.5px rgb(0 0 0 / 0.5); }
  .wide { width: 100%; }
  .preview { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: var(--radius); box-shadow: var(--hairline); background: var(--surface-25); }
  .missing { display: grid; place-items: center; margin: 0; padding: 16px; font-size: 12px; line-height: 1.45; text-align: center; color: var(--text-dim); }
  .error { margin: 0; padding: 4px 0; font-size: 12px; line-height: 1.45; color: var(--text-faint); }
  .error { color: var(--danger); }
</style>
