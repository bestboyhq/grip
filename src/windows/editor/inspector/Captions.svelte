<!-- Caption style. The words come from the transcript (Transcript tab); fixes to them live there too. -->
<script lang="ts">
  import { doc, edit } from '../../../lib/doc.svelte.ts'
  import { defaultStyle, type Style } from '../../../shared/project.ts'
  import Section from '../../../ui/Section.svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Select from '../../../ui/Select.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import Toggle from '../../../ui/Toggle.svelte'
  import ColorPicker from '../../../ui/ColorPicker.svelte'
  import { job, transcribe } from '../transcript/TranscriptPanel.svelte'

  type C = Style['captions']
  const c = $derived(doc.project!.style.captions)
  const init = defaultStyle().captions
  const set = <K extends keyof C>(k: K) => (v: C[K], merge?: string) => edit((p) => { p.style.captions[k] = v }, merge)
  const off = $derived(!c.visible)

  /** Asking for captions here means wanting to see them. */
  function generate() {
    if (!c.visible) set('visible')(true)
    transcribe()
  }

  // Fonts every Mac has, so a project renders the same on any machine and in export.
  const fonts = [
    { value: 'system-ui', label: 'System' },
    { value: 'Avenir Next', label: 'Avenir Next' },
    { value: 'Helvetica Neue', label: 'Helvetica Neue' },
    { value: 'Futura', label: 'Futura' },
    { value: 'Arial Rounded MT Bold', label: 'Rounded' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Menlo', label: 'Menlo' },
  ]
  const known = $derived(fonts.some((f) => f.value === c.font) ? fonts : [...fonts, { value: c.font, label: c.font }])
</script>

<Section>
  <Toggle label="Show captions" checked={c.visible} onchange={set('visible')} />
  {#if !doc.transcript}
    {@const s = doc.project!.sources}
    {#if job.bundle === doc.path && job.phase && job.phase !== 'error'}
      <p class="note">
        {job.phase === 'download' ? 'Downloading the speech model' : 'Transcribing'}{job.progress ? ` · ${Math.round(job.progress * 100)}%.` : '…'}
        Captions appear when it is done.
      </p>
    {:else if s.mic || s.system || s.imported}
      <p class="note">Captions come from the transcript, made on this Mac. Fix their words in the Transcript tab.</p>
      {#if job.bundle === doc.path && job.phase === 'error'}<p class="note error" role="alert">{job.error}</p>{/if}
      <button class="btn" onclick={generate}>Transcribe</button>
    {:else}
      <p class="note">This recording has no voice to caption.</p>
    {/if}
  {:else if !doc.transcript.words.length}
    <p class="note">Grip heard no words in this recording, so there is nothing to caption.</p>
  {/if}
</Section>

<Section title="Text">
  <Select label="Font" value={c.font} options={known} disabled={off} onchange={set('font')} />
  <Slider label="Size" value={c.size} min={20} max={120} step={1} initial={init.size} disabled={off} onchange={set('size')} />
  <ColorPicker label="Color" value={c.color} disabled={off} swatches={['#ffffff', '#ffd60a', '#64d2ff', '#30d158', '#ff9f0a', '#000000']} onchange={(v, m) => set('color')(v, m)} />
</Section>

<Section title="Layout">
  <Segmented label="Position" value={c.position} disabled={off} onchange={set('position')} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }]} />
  <Segmented label="Show" value={c.mode} disabled={off} onchange={set('mode')} options={[{ value: 'line', label: 'Line' }, { value: 'word', label: 'Word' }]} />
  <Segmented label="Animation" value={c.animation} disabled={off} onchange={set('animation')} options={[{ value: 'appear', label: 'Appear' }, { value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }]} />
</Section>

<style>
  .note { margin: 4px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--text-faint); }
  .error { color: var(--danger); }
  .btn { align-self: flex-start; margin-top: 8px; }
</style>
