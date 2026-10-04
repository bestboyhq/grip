<!-- Background (wallpaper, gradient, color, image, blur), the screen's shape, and the device frame. -->
<script lang="ts" module>
  // The compositor owns the wallpapers (src/engine/backgrounds: WALLPAPERS, plus wallpaperThumbnails()
  // rendered by the real compositor, so tiles show exactly what export draws). A glob import tolerates
  // the module being absent: the Wallpaper tab then says so and the other kinds still work.
  type Wallpaper = { id: string; name: string; points?: Array<[number, number, number, string]> }
  type Backgrounds = { WALLPAPERS?: Wallpaper[]; wallpaperThumbnails?: (w?: number, h?: number) => Promise<Map<string, string>> }
  const engine = Object.values(import.meta.glob<Backgrounds>('../../../engine/backgrounds/index.ts', { eager: true }))[0]
  const wallpapers = engine?.WALLPAPERS ?? []
  let rendered: Promise<Map<string, string>> | undefined
  const thumbnails = () => (rendered ??= engine?.wallpaperThumbnails?.(160, 100) ?? Promise.resolve(new Map()))

  const gradient = (stops: string[], angle = 135) => `linear-gradient(${angle}deg, ${stops.join(', ')})`
  // Until the rendered thumbnails arrive: the wallpaper's color points as soft radial gradients.
  const sketch = (w: Wallpaper) =>
    w.points?.length
      ? [...w.points.map(([x, y, r, c]) => `radial-gradient(circle ${Math.round(r * 90)}px at ${x * 100}% ${y * 100}%, ${c}, transparent)`), w.points[0][3]].join(', ')
      : 'var(--bg-raised)'

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

  const st = $derived(doc.project!.style)
  const bg = $derived(st.background)
  const init = defaultStyle()
  // The tab follows the background (undo, presets) but can be switched to browse other kinds.
  let kind = $derived<Background['kind']>(bg.kind)
  let error = $state('')
  let missing = $state('') // the image file that failed to load
  let thumbs = $state<Map<string, string>>()
  thumbnails().then((m) => (thumbs = m), () => {})

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
    const others = wallpapers.filter((w) => !(bg.kind === 'wallpaper' && bg.id === w.id))
    const w = others[Math.floor(Math.random() * others.length)]
    if (w) setBg({ kind: 'wallpaper', id: w.id })
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
      {#if wallpapers.length}
        <button class="btn wide" onclick={randomWallpaper}><Icon name="shuffle" size={15} />Pick random wallpaper</button>
        <div class="grid" role="radiogroup" aria-label="Wallpaper">
          {#each wallpapers as w (w.id)}
            {@const on = bg.kind === 'wallpaper' && bg.id === w.id}
            <button class="tile" class:on role="radio" aria-checked={on} aria-label={w.name} style:background={thumbs?.has(w.id) ? `center / cover url("${thumbs.get(w.id)}")` : sketch(w)} onclick={() => setBg({ kind: 'wallpaper', id: w.id })} {@attach tooltip(w.name)}></button>
          {/each}
        </div>
      {:else}
        <p class="empty">No wallpapers are installed in this build. Gradients, colors, and images work as usual.</p>
      {/if}
    {:else if kind === 'gradient'}
      <div class="grid" role="radiogroup" aria-label="Gradient presets">
        {#each GRADIENTS as g (g.name)}
          {@const on = bg.kind === 'gradient' && bg.stops.join() === g.stops.join()}
          <button class="tile" class:on role="radio" aria-checked={on} aria-label={g.name} style:background={gradient(g.stops, g.angle)} onclick={() => setBg({ kind: 'gradient', stops: [...g.stops], angle: g.angle })} {@attach tooltip(g.name)}></button>
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
  .grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 7px; }
  .tile { aspect-ratio: 1; padding: 0; border: 0; border-radius: 7px; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1); transition: transform 140ms var(--ease-out), box-shadow 140ms; }
  .tile:hover { transform: scale(1.06); }
  .tile.on { box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 0 0 2px var(--bg-panel), 0 0 0 4px var(--accent); }
  .wide { width: 100%; }
  .preview { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--border); background: var(--bg-raised); }
  .missing { display: grid; place-items: center; margin: 0; padding: 16px; font-size: 12px; line-height: 1.45; text-align: center; color: var(--text-dim); }
  .empty, .error { margin: 0; padding: 4px 0; font-size: 12px; line-height: 1.45; color: var(--text-faint); }
  .error { color: var(--danger); }
</style>
