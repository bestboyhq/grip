<!-- Picture-in-picture camera: look, position, and on-device effects. Layout changes over time live
     on the timeline; these settings apply to every layout. -->
<script lang="ts">
  import { doc, edit } from '../../../lib/doc.svelte.ts'
  import { defaultStyle, type CameraPosition, type Style } from '../../../shared/project.ts'
  import Section from '../../../ui/Section.svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import Toggle from '../../../ui/Toggle.svelte'
  import Icon from '../../../ui/Icon.svelte'
  import { tooltip } from '../../../ui/tooltip.ts'
  import { importFile } from '../files.ts'

  type C = Style['camera']
  const source = $derived(doc.project!.sources.camera)
  const c = $derived(doc.project!.style.camera)
  const init = defaultStyle().camera
  const set = <K extends keyof C>(k: K) => (v: C[K], merge?: string) => edit((p) => (p.style.camera[k] = v), merge)
  const off = $derived(c.visible === false)
  const corners: Array<[CameraPosition, string]> = [
    ['top-left', 'Top left'],
    ['top-right', 'Top right'],
    ['bottom-left', 'Bottom left'],
    ['bottom-right', 'Bottom right'],
  ]
  const name = $props.id()
  let error = $state('')

  function shape(v: C['shape']) {
    edit((p) => {
      p.style.camera.shape = v
      if (v === 'circle') p.style.camera.aspect = 1 // a circle is square by definition
    })
  }

  async function loadLut() {
    error = ''
    try {
      const file = await importFile('lut', '.cube')
      if (file) set('lut')(file)
    } catch (e) {
      error = String((e as Error).message)
    }
  }
</script>

{#if !source}
  <p class="note">This recording has no camera.</p>
{:else}
  <Section>
    <Toggle label="Show camera" checked={!off} onchange={(v) => set('visible')(v)} />
    <Slider label="Size" value={c.size} min={120} max={720} step={1} initial={init.size} disabled={off} onchange={set('size')} />
    <Segmented
      label="Shape"
      iconOnly
      value={c.shape}
      disabled={off}
      onchange={shape}
      options={[
        { value: 'circle', label: 'Circle', icon: 'circle' },
        { value: 'rounded', label: 'Rounded', icon: 'rounded' },
        { value: 'square', label: 'Square', icon: 'square' },
      ]}
    />
    {#if c.shape !== 'circle'}
      <Segmented
        label="Aspect"
        value={c.aspect}
        disabled={off}
        onchange={set('aspect')}
        options={[
          { value: 1, label: '1:1' },
          { value: 4 / 3, label: '4:3' },
          { value: 16 / 9, label: '16:9' },
          { value: 3 / 4, label: '3:4' },
        ]}
      />
    {/if}
    {#if c.shape === 'rounded'}
      <Slider label="Roundness" value={c.radius} min={0} max={Math.round(c.size / 2)} step={1} initial={init.radius} disabled={off} onchange={set('radius')} />
    {/if}
    <Slider label="Shadow" value={c.shadow} initial={init.shadow} disabled={off} format={(v) => `${Math.round(v * 100)}%`} onchange={set('shadow')} />
    <Toggle label="Mirror" checked={c.mirror} disabled={off} onchange={set('mirror')} />
  </Section>

  <Section title="Position">
    <div class="row" class:off>
      <span class="label" id="{name}-pos">Corner</span>
      <div class="corners" role="radiogroup" aria-labelledby="{name}-pos">
        {#each corners as [pos, label] (pos)}
          <label class="corner {pos}" class:on={c.position === pos} {@attach tooltip(label)}>
            <input type="radio" {name} checked={c.position === pos} disabled={off} aria-label={label} onchange={() => set('position')(pos)} />
          </label>
        {/each}
      </div>
      <span class="tip">or drag it in the preview</span>
    </div>
    <Slider label="Margin" value={c.inset} min={0} max={200} step={1} initial={init.inset} disabled={off} onchange={set('inset')} />
  </Section>

  <Section title="Effects">
    <Toggle
      label="Remove background"
      hint={source.matte ? undefined : 'Applies once the camera analysis finishes.'}
      checked={c.removeBackground}
      disabled={off}
      onchange={set('removeBackground')}
    />
    <Toggle
      label="Follow face"
      hint={source.faces ? 'Keeps your face centered in the frame.' : 'Applies once the camera analysis finishes.'}
      checked={c.followFace}
      disabled={off}
      onchange={set('followFace')}
    />
    <Toggle label="Hide when silent" hint="Shows the camera only while you speak." checked={c.hideWhenSilent} disabled={off || !doc.project!.sources.mic} onchange={set('hideWhenSilent')} />
    <div class="row lut" class:off>
      <span class="label">Color (LUT)</span>
      {#if c.lut}
        <span class="file" title={c.lut}>{c.lut.split('/').pop()}</span>
        <button class="icon-btn small" disabled={off} onclick={() => set('lut')(undefined)} {@attach tooltip('Remove LUT')}><Icon name="close" size={14} /></button>
      {:else}
        <button class="btn" disabled={off} onclick={loadLut}><Icon name="upload" size={14} />Load .cube…</button>
      {/if}
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </Section>
{/if}

<style>
  .note { margin: 14px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--bg-raised); color: var(--text-dim); font-size: 12px; }
  .row { display: flex; align-items: center; gap: 6px; min-height: 30px; }
  .row.off { opacity: 0.4; pointer-events: none; }
  .label { flex: none; width: var(--label-w, 92px); color: var(--text-dim); font-size: 12px; }
  .tip { color: var(--text-faint); font-size: 11.5px; }
  .corners { position: relative; flex: none; width: 64px; height: 40px; border-radius: 6px; background: var(--bg-raised); box-shadow: inset 0 0 0 1px var(--border); }
  .corner { position: absolute; width: 18px; height: 12px; border-radius: 3px; background: var(--bg-active); transition: background-color 120ms; }
  .corner:hover { background: #50505a; }
  .corner.on { background: var(--accent); }
  .corner:has(input:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .corner input { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; }
  .top-left { left: 4px; top: 4px; }
  .top-right { right: 4px; top: 4px; }
  .bottom-left { left: 4px; bottom: 4px; }
  .bottom-right { right: 4px; bottom: 4px; }
  .lut .file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .lut .btn { height: 24px; font-size: 12px; }
  .small { width: 22px; height: 22px; }
  .error { margin: 0; font-size: 12px; color: var(--danger); }
</style>
