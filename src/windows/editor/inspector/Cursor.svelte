<!-- The cursor is redrawn from the event stream, so every setting here is a free, reversible edit. -->
<script lang="ts">
  import { doc, edit } from '../../../lib/doc.svelte.ts'
  import { defaultStyle, type Style } from '../../../shared/project.ts'
  import Section from '../../../ui/Section.svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import Toggle from '../../../ui/Toggle.svelte'

  type C = Style['cursor']
  const c = $derived(doc.project!.style.cursor)
  const hasEvents = $derived(!!doc.project!.sources.events)
  const init = defaultStyle().cursor
  const set = <K extends keyof C>(k: K) => (v: C[K], merge?: string) => edit((p) => { p.style.cursor[k] = v }, merge)
  const off = $derived(!c.visible || !hasEvents)
</script>

{#if !hasEvents}
  <p class="note">This video was imported without cursor data, so its cursor is part of the picture and can’t be restyled.</p>
{/if}

<Section>
  <Toggle label="Show cursor" checked={c.visible} disabled={!hasEvents} onchange={set('visible')} />
  <Slider label="Size" value={c.size} min={0.5} max={4} step={0.05} initial={init.size} disabled={off} format={(v) => `${v.toFixed(1)}×`} onchange={set('size')} />
  <Segmented
    label="Style"
    value={c.set ?? 'system'}
    disabled={off}
    onchange={set('set')}
    options={[
      { value: 'system', label: 'System' },
      { value: 'builtin', label: 'Crisp' },
      { value: 'touch', label: 'Touch' },
    ]}
  />
</Section>

<Section title="Movement">
  <Toggle label="Hide when idle" hint="Fades the cursor out while it rests." checked={c.hideIdle} disabled={off} onchange={set('hideIdle')} />
  <Toggle label="Loop position" hint="Returns to where it started by the last frame, for looping videos." checked={c.loop} disabled={off} onchange={set('loop')} />
</Section>

<Section title="Clicks">
  <Segmented
    stacked
    ariaLabel="Click effect"
    value={c.click}
    disabled={!hasEvents}
    onchange={set('click')}
    options={[
      { value: 'none', label: 'None' },
      { value: 'ripple', label: 'Ripple' },
      { value: 'circle', label: 'Circle' },
      { value: 'shockwave', label: 'Shockwave' },
    ]}
  />
  <!-- Click effects and sounds play with the cursor hidden too, so they stay switchable. -->
  <Toggle label="Click sound" checked={c.clickSound} disabled={!hasEvents} onchange={set('clickSound')} />
</Section>

<style>
  .note { margin: 14px 0 0; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-25); box-shadow: var(--hairline); color: var(--text-dim); font-size: 12px; line-height: 1.45; }
</style>
