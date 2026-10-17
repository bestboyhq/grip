<!-- Auto zoom defaults, and the zooms selected on the timeline (edits apply to every selected zoom). -->
<script lang="ts">
  import { doc, edit, pickLook, selection, zoomLook } from '../../../lib/doc.svelte.ts'
  import { screenCrop, type Zoom } from '../../../shared/project.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import { LOUPE_SIZE, setAutoZoom } from '../../../engine/zoom/index.ts'
  import Section from '../../../ui/Section.svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import Toggle from '../../../ui/Toggle.svelte'

  const project = $derived(doc.project!)
  const auto = $derived(project.style.autoZoom)
  const selected = $derived(project.zooms.filter((z) => selection.ids.includes(z.id)))
  const z = $derived(selected[0])
  const screen = $derived(project.sources.screen)
  const crop = $derived(screenCrop(project)) // the picker shows the part of the screen the video does

  const setAuto = (enabled: boolean) => edit((p) => setAutoZoom(p, doc.events, { ...p.style.autoZoom, enabled }, zoomLook()))
  const setAutoLevel = (level: number, merge?: string) => edit((p) => setAutoZoom(p, doc.events, { ...p.style.autoZoom, level }), merge)

  /** Apply a change to every selected zoom. */
  function each(fn: (x: Zoom) => void, merge?: string) {
    const ids = selected.map((x) => x.id)
    edit((p) => p.zooms.filter((x) => ids.includes(x.id)).forEach(fn), merge)
  }
  /** A change to the look (type, size, Liquid): new zooms take it too. */
  function eachLook(fn: (x: Zoom) => void, merge?: string) {
    each(fn, merge)
    pickLook(z)
  }

  // Target picker: a frame of the screen from the middle of the zoom, with the target dot on top.
  const showMiddle = (v: HTMLVideoElement) => {
    if (z) v.currentTime = (z.start + z.end) / 2
  }
  let gesture = 0
  function aimAt(e: PointerEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const x = crop.x + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * crop.w
    const y = crop.y + Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * crop.h
    each((s) => { s.target = { kind: 'point', x, y } }, `target:${gesture}`)
  }
  function nudge(e: KeyboardEvent) {
    if (z?.target.kind !== 'point') return
    const d = e.shiftKey ? 0.1 : 0.02
    const dx = e.key === 'ArrowLeft' ? -d * crop.w : e.key === 'ArrowRight' ? d * crop.w : 0
    const dy = e.key === 'ArrowUp' ? -d * crop.h : e.key === 'ArrowDown' ? d * crop.h : 0
    if (!dx && !dy) return
    e.preventDefault()
    const { x, y } = z.target
    const c = (v: number, lo: number, size: number) => Math.min(lo + size, Math.max(lo, v))
    each((s) => { s.target = { kind: 'point', x: c(x + dx, crop.x, crop.w), y: c(y + dy, crop.y, crop.h) } })
  }
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const css = (v: number) => `${v * 100}%`
</script>

{#if z}
  <Section title={selected.length > 1 ? `${selected.length} zooms selected` : z.auto ? 'Selected zoom (automatic)' : 'Selected zoom'}>
    <Toggle label="Enabled" checked={z.enabled} onchange={(v) => each((s) => (s.enabled = v))} />
    <Slider label="Level" value={z.level} min={1.1} max={6} step={0.05} initial={auto.level} format={(v) => `${v.toFixed(1)}×`} onchange={(v, m) => each((s) => (s.level = v), m)} />
    <Segmented
      label="Type"
      value={z.mode ?? 'zoom'}
      onchange={(v) => eachLook((s) => (s.mode = v))}
      options={[
        { value: 'zoom', label: 'Zoom' },
        { value: 'loupe', label: 'Loupe' },
      ]}
    />
    {#if z.mode === 'loupe'}
      <Slider label="Size" value={z.size ?? LOUPE_SIZE.initial} min={LOUPE_SIZE.min} max={LOUPE_SIZE.max} step={10} initial={LOUPE_SIZE.initial} onchange={(v, m) => eachLook((s) => { if (s.mode === 'loupe') s.size = v }, m)} />
      <Toggle label="Liquid" hint="The glass stretches as it moves." checked={!z.rigid} onchange={(v) => eachLook((s) => { if (s.mode === 'loupe') s.rigid = !v })} />
    {/if}
    <Toggle label="Instant" hint="Cuts in and out instead of animating." checked={!!z.instant} onchange={(v) => each((s) => (s.instant = v))} />
  </Section>

  <Section title="Target">
    <Segmented
      value={z.target.kind}
      onchange={(v) => each((s) => { s.target = v === 'cursor' ? { kind: 'cursor' } : { kind: 'point', x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 } })}
      options={[
        { value: 'cursor', label: 'Follow cursor', icon: 'cursor' },
        { value: 'point', label: 'Fixed point', icon: 'target' },
      ]}
    />
    {#if z.target.kind === 'point' && screen}
      <div
        class="picker"
        style:aspect-ratio="{screen.width * crop.w} / {screen.height * crop.h}"
        role="slider"
        tabindex="0"
        aria-label="Zoom target"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(((z.target.x - crop.x) / crop.w) * 100)}
        aria-valuetext="{pct((z.target.x - crop.x) / crop.w)} across, {pct((z.target.y - crop.y) / crop.h)} down"
        onpointerdown={(e) => {
          gesture++
          e.currentTarget.setPointerCapture(e.pointerId)
          aimAt(e, e.currentTarget)
        }}
        onpointermove={(e) => e.buttons === 1 && aimAt(e, e.currentTarget)}
        onkeydown={nudge}
      >
        <video {@attach showMiddle} src={fileUrl(`${doc.path}/${screen.file}`)} style:object-view-box="inset({css(crop.y)} {css(1 - crop.x - crop.w)} {css(1 - crop.y - crop.h)} {css(crop.x)})" muted playsinline preload="auto" aria-hidden="true"></video>
        <span class="dot" style:left={css((z.target.x - crop.x) / crop.w)} style:top={css((z.target.y - crop.y) / crop.h)}></span>
      </div>
      <p class="hint">Drag the dot, or click anywhere on the preview.</p>
    {/if}
  </Section>
{:else}
  <p class="hint empty">Select a zoom on the timeline to set its level, target, and animation.</p>
{/if}

<Section title="Auto zoom">
  <Toggle label="Zoom on clicks and typing" hint="Automatic zooms are ordinary timeline items you can edit or turn off one by one. Settings turns it off for new recordings." checked={auto.enabled} onchange={setAuto} />
  <Slider label="Default level" value={auto.level} min={1.25} max={4} step={0.05} initial={2} disabled={!auto.enabled} format={(v) => `${v.toFixed(1)}×`} onchange={setAutoLevel} />
</Section>

<style>
  .picker { position: relative; margin-top: 8px; border-radius: var(--radius); overflow: hidden; background: #000; box-shadow: var(--hairline); cursor: crosshair; touch-action: none; }
  .picker:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  video { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .dot {
    position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; pointer-events: none;
    border: 2px solid #fff; background: var(--accent); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35), 0 2px 6px rgb(0 0 0 / 0.5); /* like the preview marker: reads on light and dark video */
  }
  .hint { margin: 6px 0 0; font-size: 11.5px; color: var(--text-faint); }
  .hint.empty { margin: 0; padding: 14px 0; box-shadow: var(--hairline-b); font-size: 12px; line-height: 1.45; }
</style>
