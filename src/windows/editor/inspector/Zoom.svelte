<!-- Auto zoom defaults, and the zooms selected on the timeline (edits apply to every selected zoom). -->
<script lang="ts">
  import { doc, edit, selection } from '../../../lib/doc.svelte.ts'
  import type { Zoom } from '../../../shared/project.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import { generateAutoZooms } from '../../../engine/zoom/index.ts'
  import Section from '../../../ui/Section.svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import Toggle from '../../../ui/Toggle.svelte'

  const project = $derived(doc.project!)
  const auto = $derived(project.style.autoZoom)
  const selected = $derived(project.zooms.filter((z) => selection.ids.includes(z.id)))
  const z = $derived(selected[0])
  const screen = $derived(project.sources.screen)

  // Turning auto zoom on re-enables the automatic zooms, or makes them when there are none yet.
  function setAuto(enabled: boolean) {
    edit((p) => {
      p.style.autoZoom.enabled = enabled
      const autos = p.zooms.filter((x) => x.auto)
      if (enabled && !autos.length) p.zooms.push(...generateAutoZooms(doc.events, p.sources, p.style.autoZoom))
      for (const x of autos) x.enabled = enabled
    })
  }

  function setAutoLevel(level: number, merge?: string) {
    edit((p) => {
      p.style.autoZoom.level = level
      for (const x of p.zooms) if (x.auto) x.level = level
    }, merge)
  }

  /** Apply a change to every selected zoom. */
  function each(fn: (x: Zoom) => void, merge?: string) {
    const ids = selected.map((x) => x.id)
    edit((p) => p.zooms.filter((x) => ids.includes(x.id)).forEach(fn), merge)
  }

  // Target picker: a frame of the screen from the middle of the zoom, with the target dot on top.
  const showMiddle = (v: HTMLVideoElement) => {
    if (z) v.currentTime = (z.start + z.end) / 2
  }
  let gesture = 0
  function aimAt(e: PointerEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    each((s) => { s.target = { kind: 'point', x, y } }, `target:${gesture}`)
  }
  function nudge(e: KeyboardEvent) {
    if (z?.target.kind !== 'point') return
    const d = e.shiftKey ? 0.1 : 0.02
    const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
    const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
    if (!dx && !dy) return
    e.preventDefault()
    const { x, y } = z.target
    const c = (v: number) => Math.min(1, Math.max(0, v))
    each((s) => { s.target = { kind: 'point', x: c(x + dx), y: c(y + dy) } })
  }
  const pct = (v: number) => `${Math.round(v * 100)}%`
</script>

{#if z}
  <Section title={selected.length > 1 ? `${selected.length} zooms selected` : z.auto ? 'Selected zoom (automatic)' : 'Selected zoom'}>
    <Toggle label="Enabled" checked={z.enabled} onchange={(v) => each((s) => (s.enabled = v))} />
    <Slider label="Level" value={z.level} min={1.1} max={4} step={0.05} initial={auto.level} format={(v) => `${v.toFixed(1)}×`} onchange={(v, m) => each((s) => (s.level = v), m)} />
    <Segmented
      label="Type"
      value={z.mode ?? 'zoom'}
      onchange={(v) => each((s) => (s.mode = v))}
      options={[
        { value: 'zoom', label: 'Zoom' },
        { value: 'loupe', label: 'Loupe' },
      ]}
    />
    <Toggle label="Instant" hint="Cuts in and out instead of animating." checked={!!z.instant} onchange={(v) => each((s) => (s.instant = v))} />
  </Section>

  <Section title="Target">
    <Segmented
      value={z.target.kind}
      onchange={(v) => each((s) => { s.target = v === 'cursor' ? { kind: 'cursor' } : { kind: 'point', x: 0.5, y: 0.5 } })}
      options={[
        { value: 'cursor', label: 'Follow cursor', icon: 'cursor' },
        { value: 'point', label: 'Fixed point', icon: 'target' },
      ]}
    />
    {#if z.target.kind === 'point' && screen}
      <div
        class="picker"
        style:aspect-ratio="{screen.width} / {screen.height}"
        role="slider"
        tabindex="0"
        aria-label="Zoom target"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(z.target.x * 100)}
        aria-valuetext="{pct(z.target.x)} across, {pct(z.target.y)} down"
        onpointerdown={(e) => {
          gesture++
          e.currentTarget.setPointerCapture(e.pointerId)
          aimAt(e, e.currentTarget)
        }}
        onpointermove={(e) => e.buttons === 1 && aimAt(e, e.currentTarget)}
        onkeydown={nudge}
      >
        <video {@attach showMiddle} src={fileUrl(`${doc.path}/${screen.file}`)} muted playsinline preload="auto" aria-hidden="true"></video>
        <span class="dot" style:left={pct(z.target.x)} style:top={pct(z.target.y)}></span>
      </div>
      <p class="hint">Drag the dot, or click anywhere on the preview.</p>
    {/if}
  </Section>
{:else}
  <p class="hint empty">Select a zoom on the timeline to set its level, target, and animation.</p>
{/if}

<Section title="Auto zoom">
  <Toggle label="Zoom on clicks and typing" hint="Automatic zooms are ordinary timeline items you can edit or turn off one by one." checked={auto.enabled} onchange={setAuto} />
  <Slider label="Default level" value={auto.level} min={1.25} max={4} step={0.05} initial={2} disabled={!auto.enabled} format={(v) => `${v.toFixed(1)}×`} onchange={setAutoLevel} />
</Section>

<style>
  .picker { position: relative; margin-top: 8px; border-radius: 8px; overflow: hidden; background: #000; box-shadow: inset 0 0 0 1px var(--border); cursor: crosshair; touch-action: none; }
  .picker:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  video { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .dot {
    position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; pointer-events: none;
    border: 2px solid #fff; background: var(--accent); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35), 0 0 0 6px rgb(116 102 255 / 0.25);
  }
  .hint { margin: 6px 0 0; font-size: 11.5px; color: var(--text-faint); }
  .hint.empty { margin: 0; padding: 14px 0; border-bottom: 1px solid var(--border); font-size: 12px; line-height: 1.45; }
</style>
