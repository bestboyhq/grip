<!-- Wallpaper lab: renders built-in wallpapers through the real compositor for visual review.
     #/dev?lab=Wallpapers&collection=<name>  (all collections without it)
     Driven over CDP through window.lab:
       png(id, w, h)                 -> base64 PNG of one wallpaper at w x h
       sheet(collection, w, h, cols) -> base64 PNG contact sheet (every wallpaper of a collection, or all for '') -->
<script lang="ts">
  import { Renderer } from '../../../engine/gpu/renderer.ts'
  import { WALLPAPERS } from '../../../engine/backgrounds/index.ts'

  let { params }: { params: URLSearchParams } = $props()
  const collection = $derived(params.get('collection') ?? '')
  const shown = $derived(WALLPAPERS.filter((w) => !collection || w.collection === collection))
  let urls = $state(new Map<string, string>())
  let error = $state('')

  async function render(ids: string[], w: number, h: number): Promise<OffscreenCanvas[]> {
    const canvas = new OffscreenCanvas(w, h)
    const r = await Renderer.create(canvas, (rel) => rel)
    const out: OffscreenCanvas[] = []
    try {
      for (const id of ids) {
        await r.draw(Renderer.backgroundScene({ kind: 'wallpaper', id }, w, h), { screen: null, camera: null })
        const copy = new OffscreenCanvas(w, h)
        copy.getContext('2d')!.drawImage(canvas, 0, 0)
        out.push(copy)
      }
    } finally {
      r.destroy()
    }
    return out
  }

  const base64 = async (c: OffscreenCanvas) => {
    const bytes = new Uint8Array(await (await c.convertToBlob()).arrayBuffer())
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }

  const lab = {
    async png(id: string, w = 1920, h = 1080) {
      return base64((await render([id], w, h))[0])
    },
    async sheet(name = '', w = 320, h = 200, cols = 6) {
      const list = WALLPAPERS.filter((x) => !name || x.collection === name)
      const tiles = await render(list.map((x) => x.id), w, h)
      const gap = 8
      const rows = Math.ceil(tiles.length / cols)
      const sheet = new OffscreenCanvas(cols * (w + gap) + gap, rows * (h + gap) + gap)
      const ctx = sheet.getContext('2d')!
      ctx.fillStyle = '#16161a'
      ctx.fillRect(0, 0, sheet.width, sheet.height)
      tiles.forEach((t, i) => ctx.drawImage(t, gap + (i % cols) * (w + gap), gap + Math.floor(i / cols) * (h + gap)))
      return base64(sheet)
    },
  }
  ;(window as unknown as { lab: typeof lab }).lab = lab

  $effect(() => {
    const list = shown
    render(list.map((w) => w.id), 384, 240).then(
      async (tiles) => {
        const m = new Map<string, string>()
        for (let i = 0; i < tiles.length; i++) m.set(list[i].id, URL.createObjectURL(await tiles[i].convertToBlob()))
        urls = m
      },
      (e) => (error = String(e)),
    )
  })
</script>

<main>
  {#if error}<p class="error">{error}</p>{/if}
  <div class="grid">
    {#each shown as w (w.id)}
      <figure>
        {#if urls.has(w.id)}<img src={urls.get(w.id)} alt={w.name} />{/if}
        <figcaption>{w.collection} / {w.name} <span>{w.id}</span></figcaption>
      </figure>
    {/each}
  </div>
</main>

<style>
  main { padding: 16px; background: var(--surface-root); min-height: 100vh; color: var(--text); font: 12px var(--font); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  figure { margin: 0; }
  img { width: 100%; aspect-ratio: 16 / 10; border-radius: var(--radius); display: block; }
  figcaption span { color: var(--text-faint); }
  .error { color: var(--danger); }
</style>
