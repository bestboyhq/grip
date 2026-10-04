<!-- Track mix: microphone, system audio, and background music. Per-clip volume lives on the timeline. -->
<script lang="ts">
  import { doc, edit } from '../../../lib/doc.svelte.ts'
  import Section from '../../../ui/Section.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import Toggle from '../../../ui/Toggle.svelte'
  import Icon from '../../../ui/Icon.svelte'
  import { tooltip } from '../../../ui/tooltip.ts'
  import { importFile } from '../files.ts'

  const project = $derived(doc.project!)
  const a = $derived(project.audio)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  let error = $state('')

  async function addMusic() {
    error = ''
    try {
      const file = await importFile('audio', '.m4a,.mp3,.aac,.wav,audio/mp4,audio/mpeg,audio/aac,audio/wav')
      if (file) edit((p) => (p.audio.music = { file, volume: p.audio.music?.volume ?? 0.25 }))
    } catch (e) {
      error = String((e as Error).message)
    }
  }
</script>

{#if project.sources.mic}
  <Section title="Microphone">
    {#snippet aside()}
      <button class="icon-btn mute" aria-pressed={a.mic.muted} onclick={() => edit((p) => (p.audio.mic.muted = !p.audio.mic.muted))} {@attach tooltip(a.mic.muted ? 'Unmute microphone' : 'Mute microphone')}>
        <Icon name={a.mic.muted ? 'muted' : 'sound'} size={16} />
      </button>
    {/snippet}
    <Slider label="Volume" value={a.mic.volume} min={0} max={2} step={0.01} initial={1} disabled={a.mic.muted} format={pct} onchange={(v, m) => edit((p) => (p.audio.mic.volume = v), m)} />
    <Toggle label="Enhance voice" hint="Reduces noise, evens out loudness, and never clips." checked={a.mic.enhance} disabled={a.mic.muted} onchange={(v) => edit((p) => (p.audio.mic.enhance = v))} />
  </Section>
{/if}

{#if project.sources.system}
  <Section title="System audio">
    {#snippet aside()}
      <button class="icon-btn mute" aria-pressed={a.system.muted} onclick={() => edit((p) => (p.audio.system.muted = !p.audio.system.muted))} {@attach tooltip(a.system.muted ? 'Unmute system audio' : 'Mute system audio')}>
        <Icon name={a.system.muted ? 'muted' : 'sound'} size={16} />
      </button>
    {/snippet}
    <Slider label="Volume" value={a.system.volume} min={0} max={2} step={0.01} initial={1} disabled={a.system.muted} format={pct} onchange={(v, m) => edit((p) => (p.audio.system.volume = v), m)} />
  </Section>
{/if}

<Section title="Music">
  {#if a.music}
    {@const music = a.music}
    <div class="file">
      <Icon name="music" size={16} />
      <span title={music.file}>{music.file.split('/').pop()}</span>
      <button class="icon-btn small" onclick={addMusic} {@attach tooltip('Replace music')}><Icon name="upload" size={14} /></button>
      <button class="icon-btn small" onclick={() => edit((p) => delete p.audio.music)} {@attach tooltip('Remove music')}><Icon name="trash" size={14} /></button>
    </div>
    <Slider label="Volume" value={music.volume} min={0} max={1} step={0.01} initial={0.25} format={pct} onchange={(v, m) => edit((p) => p.audio.music && (p.audio.music.volume = v), m)} />
  {:else}
    <button class="btn wide" onclick={addMusic}><Icon name="plus" size={15} />Add background music…</button>
    <p class="hint">Plays under the whole video, in sync with the timeline.</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</Section>

<style>
  .mute { width: 24px; height: 24px; }
  .mute[aria-pressed='true'] { color: var(--danger); }
  .file { display: flex; align-items: center; gap: 8px; min-height: 30px; color: var(--text-dim); }
  .file span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 12.5px; }
  .small { width: 24px; height: 24px; }
  .wide { width: 100%; }
  .hint { margin: 6px 0 0; font-size: 11.5px; color: var(--text-faint); }
  .error { margin: 6px 0 0; font-size: 12px; color: var(--danger); }
</style>
