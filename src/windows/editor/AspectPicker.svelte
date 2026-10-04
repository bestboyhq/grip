<!-- Output aspect ratio, in the preview toolbar like a camera's frame setting: presets plus a custom W:H. -->
<script lang="ts">
  import { doc, edit } from '../../lib/doc.svelte.ts'
  import { outputSize } from '../../engine/scene.ts'
  import type { Aspect } from '../../shared/project.ts'
  import Icon from '../../ui/Icon.svelte'

  const aspect = $derived(doc.project!.style.aspect)
  const custom = $derived(typeof aspect === 'object' ? aspect : null)
  const options: Array<[string, string]> = [
    ['auto', 'Auto'],
    ['16:9', 'Wide 16:9'],
    ['9:16', 'Vertical 9:16'],
    ['4:5', 'Portrait 4:5'],
    ['1:1', 'Square 1:1'],
    ['custom', 'Custom'],
  ]

  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

  function choose(v: string) {
    let next: Aspect
    if (v === 'custom') {
      const { width, height } = outputSize(doc.project!, 1080)
      const g = gcd(width, height)
      next = { w: width / g, h: height / g }
    } else next = v as Aspect
    edit((p) => (p.style.aspect = next))
  }

  // Ratios past 5:1 either way make outputs no encoder or platform accepts.
  function setTerm(key: 'w' | 'h', raw: string) {
    const v = Number(raw)
    if (!custom || !(v > 0)) return
    const other = key === 'w' ? custom.h : custom.w
    const clamped = Math.min(Math.max(v, other / 5), other * 5)
    edit((p) => (p.style.aspect = { ...custom, [key]: Math.round(clamped * 100) / 100 }))
  }
</script>

<div class="aspect">
  <label class="pick">
    <Icon name="aspect" size={16} />
    <select aria-label="Aspect ratio" value={custom ? 'custom' : (aspect as string)} onchange={(e) => choose(e.currentTarget.value)}>
      {#each options as [value, label] (value)}<option {value}>{label}</option>{/each}
    </select>
    <Icon name="chevron" size={14} />
  </label>
  {#if custom}
    <input type="number" min="0.1" step="any" value={custom.w} aria-label="Aspect width" onchange={(e) => { setTerm('w', e.currentTarget.value); e.currentTarget.value = String(custom?.w ?? '') }} />
    <span aria-hidden="true">:</span>
    <input type="number" min="0.1" step="any" value={custom.h} aria-label="Aspect height" onchange={(e) => { setTerm('h', e.currentTarget.value); e.currentTarget.value = String(custom?.h ?? '') }} />
  {/if}
</div>

<style>
  .aspect { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
  .pick { position: relative; display: flex; align-items: center; height: 28px; border-radius: 6px; color: var(--text); }
  .pick:hover { background: rgb(255 255 255 / 0.06); }
  .pick:has(select:focus-visible) { outline: 2px solid var(--focus-ring); }
  .pick > :global(.icon:first-child) { position: absolute; left: 8px; color: var(--text-dim); pointer-events: none; }
  .pick > :global(.icon:last-child) { position: absolute; right: 6px; color: var(--text-dim); pointer-events: none; }
  select { field-sizing: content; height: 100%; padding: 0 26px 0 30px; border: 0; background: none; appearance: none; font-size: 12.5px; font-weight: 500; }
  select:focus-visible { outline: none; }
  input { width: 52px; height: 26px; padding: 0 6px; border: 0; border-radius: 6px; background: var(--bg-raised); font-size: 12.5px; text-align: center; font-variant-numeric: tabular-nums; }
  input::-webkit-inner-spin-button { display: none; }
</style>
