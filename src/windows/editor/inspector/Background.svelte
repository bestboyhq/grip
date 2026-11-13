<!-- Background (wallpaper, gradient, color, custom image, blur), the screen's shape, and the device frame. -->
<script lang="ts" module>
  import { WALLPAPERS, wallpaper, type Wallpaper } from '../../../engine/backgrounds/index.ts'
  import { invoke } from '../../../lib/ipc.ts'

  // Collection pills: the user's installed macOS wallpapers first, then ours in WALLPAPERS order.
  const MACOS = 'macOS'
  const COLLECTIONS = [...new Set(WALLPAPERS.map((w) => w.collection))]
  const COLS = 7
  const ROWS = 4 // the wallpaper tray's height, whatever the collection; most fit, larger ones scroll
  const FRAME = 80 // padding a picked background brings when none would show
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
  import { pickFile } from '../files.ts'
  import { reason } from '../helpers.ts'
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
  let converting = $state('') // the image being copied into the project
  let failed = $state(0) // remounts the tiles after a failed pick, so the checked radio matches the background again

  // The Custom tab (electron/wallpapers.ts): images the user added, for every project. Listed each time
  // the inspector shows, so a window sees what another one added.
  type CustomImage = { name: string; file: string; thumb: string }
  let customs = $state<CustomImage[]>([])
  invoke('wallpapers:custom').then((c: CustomImage[]) => (customs = c), (e) => console.warn('Custom backgrounds:', e))
  /** The project's own image when it is in neither the library nor the macOS collection: shown first, to keep. */
  const own = $derived(bg.kind === 'image' && !mac && !customs.some((c) => c.file === bg.file) ? bg.file : undefined)

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

  /** Copies an image into the project (main process) and makes it the background. */
  async function pickImage(id: string, ...args: [channel: string, ...unknown[]]) {
    error = ''
    converting = id
    try {
      setBg({ kind: 'image', file: await invoke(...args) })
    } catch (e) {
      error = reason(e)
      failed++
    } finally {
      converting = ''
    }
  }
  const pickMac = (m: MacWallpaper) => pickImage(m.file, 'wallpapers:importMacos', doc.path, m.name)
  const pickCustom = (c: CustomImage) => pickImage(c.file, 'wallpapers:importCustom', doc.path, c.file)

  /** Adds an image to the library and picks it: the one the user chose in the open panel, or the project's own. */
  async function addCustom(path: string | null) {
    if (!path) return
    error = ''
    try {
      const c: CustomImage = await invoke('wallpapers:addCustom', path)
      customs = [c, ...customs.filter((x) => x.file !== c.file)]
      await pickCustom(c)
      reveal(customTray)
    } catch (e) {
      error = reason(e)
    }
  }
  async function removeCustom(c: CustomImage) {
    error = ''
    try {
      await invoke('wallpapers:removeCustom', c.file)
      customs = customs.filter((x) => x !== c)
    } catch (e) {
      error = reason(e)
    }
  }

  // Trays scroll when they hold more tiles than they show: the chosen tile scrolls into view, the panel stays.
  let wallTray = $state<HTMLElement>()
  let customTray = $state<HTMLElement>()
  function reveal(tray: HTMLElement | undefined) {
    tick().then(() => {
      if (!tray) return
      tray.scrollTop = 0
      tray.querySelector(':checked')?.scrollIntoView({ block: 'nearest', container: 'nearest' } as ScrollIntoViewOptions)
    })
  }
  $effect(() => {
    void collection
    reveal(wallTray)
  })

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
  // The chosen pill stays clear of the fades: in view the moment the row shows, and again when the
  // macOS pill arrives in front and pushes it right. Switching collections glides to it.
  let shown: [HTMLElement | undefined, string] | undefined
  $effect(() => {
    void pills
    const glide = shown?.[0] === pillRow && shown?.[1] !== collection
    pillRow?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest', behavior: glide ? 'smooth' : 'instant' } as ScrollIntoViewOptions)
    shown = [pillRow, collection]
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

  // A background picked while the screen fills the output edge to edge would not show: frame it.
  const setBg = (b: Background, merge?: string) => edit((p) => {
    p.style.background = b
    if (p.style.padding === 0 && p.style.aspect === 'auto') p.style.padding = FRAME
  }, merge)
  const set = <K extends keyof Style>(k: K) => (v: Style[K], merge?: string) => edit((p) => { p.style[k] = v }, merge)

  const stops = $derived(bg.kind === 'gradient' ? bg.stops : (GRADIENTS[0].stops))
  const angle = $derived(bg.kind === 'gradient' ? bg.angle : 135)
  const color = $derived(bg.kind === 'color' ? bg.color : '#1c1c1e')

  function randomWallpaper() {
    const others = tiles.filter((t) => !t.on)
    others[Math.floor(Math.random() * others.length)]?.pick()
  }
</script>

<Section>
  <Segmented
    ariaLabel="Background"
    value={kind}
    onchange={(v) => ((kind = v), (error = ''))}
    options={[
      { value: 'wallpaper', label: 'Wallpaper' },
      { value: 'gradient', label: 'Gradient' },
      { value: 'color', label: 'Color' },
      { value: 'image', label: 'Custom' },
    ]}
  />
  <!-- Every tab's pane shares one cell, so the area is as tall as the tallest pane and the controls below stay put. -->
  <div class="kind">
    <div class="pane" class:shown={kind === 'wallpaper'} inert={kind !== 'wallpaper'}>
      <div class="pills" class:fade-start={fade.start} class:fade-end={fade.end} role="tablist" aria-label="Wallpaper collections" bind:this={pillRow} onscroll={edges}>
        {#each pills as c, i (c)}
          <button role="tab" id="{uid}-tab-{i}" aria-selected={c === collection} aria-controls="{uid}-panel" tabindex={c === collection ? 0 : -1} onclick={() => (collection = c)} onkeydown={pillKeys}>{c}</button>
        {/each}
      </div>
      <div class="stack" role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{pills.indexOf(collection)}">
        <button class="btn wide" onclick={randomWallpaper}><Icon name="shuffle" size={15} />Pick random wallpaper</button>
        <div class="well">
          <div class="tray" style:--cols={COLS} style:--rows={ROWS} bind:this={wallTray}>
            {#key failed}
              <div class="grid" role="radiogroup" aria-label="{collection} wallpapers" bind:clientWidth={gridWidth}>
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
              </div>
            {/key}
          </div>
        </div>
      </div>
    </div>
    <div class="pane" class:shown={kind === 'gradient'} inert={kind !== 'gradient'}>
      <div class="well fill">
        <div class="tray" style:--cols={COLS}>
          <div class="grid" role="radiogroup" aria-label="Gradient presets">
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
        </div>
      </div>
      <ColorPicker label="From" value={stops[0]} onchange={(c, m) => setBg({ kind: 'gradient', stops: [c, ...stops.slice(1)], angle }, m)} />
      <ColorPicker label="To" value={stops.at(-1)!} onchange={(c, m) => setBg({ kind: 'gradient', stops: [...stops.slice(0, -1), c], angle }, m)} />
      <Slider label="Angle" value={angle} min={0} max={360} step={1} initial={135} format={(v) => `${Math.round(v)}°`} onchange={(a, m) => setBg({ kind: 'gradient', stops: [...stops], angle: a }, m)} />
    </div>
    <div class="pane" class:shown={kind === 'color'} inert={kind !== 'color'}>
      <div class="well fill">
        <div class="tray" style:--cols={COLS}>
          <div class="grid" role="radiogroup" aria-label="Colors">
            {#each COLORS as c (c)}
              <input
                class="tile"
                type="radio"
                name="{uid}-color"
                checked={bg.kind === 'color' && bg.color.toLowerCase() === c}
                aria-label={c}
                style:background={c}
                onchange={() => setBg({ kind: 'color', color: c })}
                {@attach tooltip(c)}
              />
            {/each}
          </div>
        </div>
      </div>
      <ColorPicker label="Color" value={color} active={bg.kind === 'color'} onchange={(c, m) => setBg({ kind: 'color', color: c }, m)} />
    </div>
    <div class="pane" class:shown={kind === 'image'} inert={kind !== 'image'}>
      <div class="well fill">
        <div class="tray" style:--cols={COLS} bind:this={customTray}>
          {#key failed}
            <div class="grid" role="radiogroup" aria-label="Custom backgrounds">
              <button class="add" aria-label="Add image…" onclick={() => pickFile('image/png,image/jpeg,image/webp').then(addCustom)} {@attach tooltip('Add image…')}>
                <Icon name="plus" size={15} />
              </button>
              {#if own}
                <div class="cell">
                  <input class="tile" type="radio" name="{uid}-custom" checked aria-label="This project's image" style:background={cover(fileUrl(`${doc.path}/${own}`))} {@attach tooltip("This project's image")} />
                  <button class="badge" aria-label="Keep in Custom for every project" onclick={() => addCustom(`${doc.path}/${own}`)} {@attach tooltip('Keep for every project')}>
                    <Icon name="plus" size={10} />
                  </button>
                </div>
              {/if}
              {#each customs as c (c.file)}
                {@const on = bg.kind === 'image' && bg.file === c.file}
                <div class="cell">
                  <input
                    class="tile"
                    type="radio"
                    name="{uid}-custom"
                    checked={on}
                    aria-label={c.name}
                    aria-busy={converting === c.file}
                    style:background={cover(c.thumb)}
                    onchange={() => pickCustom(c)}
                    {@attach tooltip(c.name)}
                  />
                  <button class="badge" tabindex={on ? 0 : -1} aria-label="Remove {c.name} from Custom" onclick={() => removeCustom(c)} {@attach tooltip('Remove from Custom')}>
                    <Icon name="close" size={10} />
                  </button>
                </div>
              {/each}
            </div>
          {/key}
        </div>
      </div>
      <p class="note">Images you add stay here for every project.</p>
    </div>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <Slider label="Blur" value={st.backgroundBlur} initial={init.backgroundBlur} format={(v) => `${Math.round(v * 100)}%`} onchange={set('backgroundBlur')} />
</Section>

<Section title="Shape">
  <Slider label="Padding" value={st.padding} min={0} max={300} step={1} initial={init.padding} onchange={set('padding')} />
  <!-- A device frame brings its own screen corners. -->
  <Slider label="Roundness" value={st.radius} min={0} max={80} step={1} initial={init.radius} disabled={st.device !== 'none'} onchange={set('radius')} />
  <Slider label="Inset" value={st.inset ?? 0} min={0} max={120} step={1} initial={0} onchange={set('inset')} />
  <!-- The band the inset puts around the recording: the recording's own edge, stretched, or a color. -->
  <ColorPicker
    label="Inset color"
    value={st.insetColor ?? '#000000'}
    active={!!st.insetColor}
    disabled={!st.inset}
    swatches={COLORS.slice(0, 5)}
    auto={{ label: 'Recording edge', on: !st.insetColor, pick: () => edit((p) => { delete p.style.insetColor }) }}
    onchange={set('insetColor')}
  />
  <Slider label="Inset opacity" value={st.insetOpacity ?? 1} initial={1} disabled={!st.inset} format={(v) => `${Math.round(v * 100)}%`} onchange={set('insetOpacity')} />
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
  .kind { display: grid; padding: 10px 0 6px; }
  .pane { grid-area: 1 / 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .pane:not(.shown) { visibility: hidden; }
  .stack { display: flex; flex-direction: column; gap: 8px; }
  /* Tiles sit in a well; corners stay concentric (well radius - padding = tile radius). */
  .well { container-type: inline-size; padding: var(--gutter); border-radius: var(--radius-xl); background: var(--control-track); box-shadow: var(--hairline); }
  .grid { display: grid; grid-template-columns: repeat(var(--cols, 6), 1fr); gap: var(--gutter); }
  /* A tray keeps its height as its tiles change and scrolls the rest, an edge fading where more hide.
     It reaches into the well's padding by the selection ring, which overhangs the tile. The wallpaper
     tray is --rows tiles tall and sets the panes' height; the others take what their pane leaves (size
     containment keeps their tiles from growing it), so each tab's tiles sit where the last tab's did. */
  .tray {
    --ring: 4px;
    margin: calc(-1 * var(--ring)); padding: var(--ring); scroll-padding: var(--ring); overflow-y: auto; scrollbar-width: none;
    height: calc((100cqi - (var(--cols) - 1) * var(--gutter)) / var(--cols) * var(--rows) + (var(--rows) - 1) * var(--gutter) + 2 * var(--ring));
    mask-image: linear-gradient(transparent, #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), transparent);
    animation: tray-edges linear both;
    animation-timeline: scroll(self);
  }
  @property --fade-top { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @property --fade-bottom { syntax: '<length>'; inherits: false; initial-value: 0px; }
  @keyframes tray-edges {
    from { --fade-top: 0px; --fade-bottom: 24px; }
    10%, 90% { --fade-top: 24px; --fade-bottom: 24px; }
    to { --fade-top: 24px; --fade-bottom: 0px; }
  }
  .fill { flex: 1 1 0; contain: size; display: flex; flex-direction: column; }
  .fill .tray { flex: 1 1 0; height: auto; }
  .cell { position: relative; display: grid; }
  .add {
    aspect-ratio: 1; margin: 0; padding: 0; border: 0; border-radius: var(--radius); display: grid; place-items: center;
    background: var(--surface-150); box-shadow: var(--hairline); color: var(--fg-secondary);
  }
  .add:hover { background: var(--surface-hover); color: var(--fg-default); }
  /* Remove (or keep) shows on the tile under the pointer, and on the chosen one for the keyboard. */
  .badge {
    position: absolute; top: calc(-1 * var(--ring)); right: calc(-1 * var(--ring)); width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;
    display: grid; place-items: center; background: var(--surface-150); color: var(--fg-default);
    box-shadow: var(--hairline), 0 1px 2px rgb(0 0 0 / 0.4); visibility: hidden;
  }
  .cell:hover .badge, .badge:focus-visible { visibility: visible; }
  .badge:hover { background: var(--surface-hover); }
  .note { margin: 0; padding: 2px 0; font-size: 11.5px; line-height: 1.35; color: var(--fg-faint); }
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
    background: none; color: var(--fg-secondary); font-size: 12px; font-weight: 500;
  }
  .pills button:hover { background: var(--surface-hover); color: var(--fg-default); }
  .pills button[aria-selected='true'] { background: var(--surface-150); color: var(--fg-default); box-shadow: 0 1px 2px rgb(0 0 0 / 0.3), var(--hairline); }
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
  .tile:checked { --selected: 0 0 0 2px var(--control-track), 0 0 0 4px var(--brand); }
  .tile:focus-visible { outline: none; --focused: inset 0 0 0 2px var(--fg-default), inset 0 0 0 3.5px rgb(0 0 0 / 0.5); }
  .wide { width: 100%; }
  .error { margin: 0; padding: 4px 0; font-size: 12px; line-height: 1.45; color: var(--fg-faint); }
  .error { color: var(--error-content); }
</style>
