<!-- How things move: the zoom camera, the cursor, and motion blur. Each is one tuned preset per option,
     not raw spring or smoothing constants. -->
<script lang="ts">
  import { doc, edit } from '../../../lib/doc.svelte.ts'
  import { defaultStyle, type Style } from '../../../shared/project.ts'
  import Section from '../../../ui/Section.svelte'
  import Segmented from '../../../ui/Segmented.svelte'
  import Slider from '../../../ui/Slider.svelte'

  const st = $derived(doc.project!.style)
  const hasEvents = $derived(!!doc.project!.sources.events)
  const init = defaultStyle()

  const screenHints: Record<Style['screenAnimation'], string> = {
    focused: 'Settles quickly, so the content is easy to follow and read.',
    smooth: 'Glides slowly in and out, for a more cinematic feel.',
  }
  const cursorHints: Record<Style['cursor']['animation'], string> = {
    smooth: 'Glides along a soft path, still hitting every click exactly.',
    medium: 'Removes the shake, keeps quick moves quick.',
    rapid: 'Only removes hand tremor.',
    none: 'Moves exactly as recorded.',
  }
</script>

<Section title="Screen">
  <Segmented
    ariaLabel="Screen animation"
    value={st.screenAnimation}
    onchange={(v) => edit((p) => (p.style.screenAnimation = v))}
    options={[
      { value: 'focused', label: 'Focused' },
      { value: 'smooth', label: 'Smooth' },
    ]}
  />
  <p class="hint">{screenHints[st.screenAnimation]}</p>
</Section>

<Section title="Cursor">
  <Segmented
    ariaLabel="Cursor animation"
    value={st.cursor.animation}
    disabled={!hasEvents}
    onchange={(v) => edit((p) => (p.style.cursor.animation = v))}
    options={[
      { value: 'smooth', label: 'Smooth' },
      { value: 'medium', label: 'Medium' },
      { value: 'rapid', label: 'Rapid' },
      { value: 'none', label: 'None' },
    ]}
  />
  <p class="hint">{hasEvents ? cursorHints[st.cursor.animation] : 'This video was imported without cursor data.'}</p>
</Section>

<Section title="Motion blur">
  <Slider
    label="Amount"
    value={st.motionBlur}
    initial={init.motionBlur}
    format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
    onchange={(v, m) => edit((p) => (p.style.motionBlur = v), m)}
  />
  <p class="hint">Blurs fast cursor and zoom moves along their real path, like a film camera.</p>
</Section>

<style>
  .hint { margin: 4px 0 0; color: var(--text-faint); font-size: 11.5px; line-height: 1.4; }
</style>
