<!-- Track mix: the selected voiceover, microphone, system audio, and background music. Per-clip volume
     lives on the timeline. -->
<script lang="ts" module>
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke, listen } from '../../../lib/ipc.ts'
  import { reason } from '../helpers.ts'

  // "Enhance voice" plays the voice track the voice pass makes after recording (electron/audio.ts).
  // When it is missing (a project from before it, Enhance turned on for an import, a pass cut short
  // or failed), the editor asks for it (the main process dedupes a run in progress). State is per
  // window, so it survives switching inspector tabs.
  const voice = $state({ progress: null as number | null, failed: '' })
  let tried = ''
  listen('audio:progress', (e: { bundle: string; progress: number }) => e.bundle === doc.path && (voice.progress = e.progress))
  listen('audio:analyzed', (e: { bundle: string; error?: string }) => {
    if (e.bundle !== doc.path) return
    voice.progress = null
    voice.failed = e.error ?? ''
  })

  /** Start the voice pass if an enhanced mic has no voice track. Once per project unless `retry`. */
  export function ensureVoice(retry = false) {
    const p = doc.project
    if (!p?.sources.mic || !p.audio.mic.enhance || p.sources.mic.voice || (tried === doc.path && !retry)) return
    tried = doc.path
    voice.failed = ''
    voice.progress ??= 0
    invoke('audio:analyze', doc.path).catch((e) => {
      voice.progress = null
      voice.failed = reason(e)
    })
  }
</script>

<script lang="ts">
  import { edit, selection } from '../../../lib/doc.svelte.ts'
  import type { Voiceover } from '../../../shared/project.ts'
  import * as A from '../timeline/actions.svelte.ts'
  import Section from '../../../ui/Section.svelte'
  import Slider from '../../../ui/Slider.svelte'
  import Toggle from '../../../ui/Toggle.svelte'
  import Icon from '../../../ui/Icon.svelte'
  import { tooltip } from '../../../ui/tooltip.ts'
  import { importFile } from '../files.ts'

  const project = $derived(doc.project!)
  const a = $derived(project.audio)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  // The voiceovers selected on the timeline: the first one's settings show, and changes go to all of them.
  const vos = $derived(project.voiceovers.filter((v) => selection.ids.includes(v.id)))
  const vo = $derived(vos[0])
  function setVo(patch: Partial<Voiceover>, merge?: string) {
    const ids = new Set(vos.map((v) => v.id))
    edit((p) => p.voiceovers.forEach((v) => ids.has(v.id) && Object.assign(v, patch)), merge)
  }
  function deleteVo() {
    const ids = new Set(vos.map((v) => v.id))
    edit((p) => {
      p.voiceovers = p.voiceovers.filter((v) => !ids.has(v.id))
    })
    selection.ids = selection.ids.filter((id) => !ids.has(id))
  }
  let error = $state('')
  // The voice track plays as soon as it exists; a newer pass replacing it reports progress too.
  const enhanceHint = $derived(
    !a.mic.enhance || (project.sources.mic?.voice && voice.progress === null) ? 'Removes background noise, softens harsh S sounds, and evens out your level.'
    : voice.failed ? `Voice enhancement failed: ${voice.failed}`
    : `Enhancing your voice… ${Math.round((voice.progress ?? 0) * 100)}%`,
  )

  async function addMusic() {
    error = ''
    try {
      const file = await importFile('audio', '.m4a,.mp3,.aac,.wav,audio/mp4,audio/mpeg,audio/aac,audio/wav')
      if (file) edit((p) => { p.audio.music = { file, volume: p.audio.music?.volume ?? 0.25 } })
    } catch (e) {
      error = String((e as Error).message)
    }
  }
</script>

{#if vo}
  <Section title="Voiceover">
    {#snippet aside()}
      <button class="icon-btn mute" aria-pressed={!!vo.muted} onclick={A.toggleVoiceovers} {@attach tooltip(vo.muted ? 'Unmute voiceover' : 'Mute voiceover')}>
        <Icon name={vo.muted ? 'muted' : 'sound'} size={16} />
      </button>
    {/snippet}
    <Slider label="Volume" value={vo.volume} min={0} max={2} step={0.01} initial={1} disabled={vo.muted} format={pct} onchange={(v, m) => setVo({ volume: v }, m)} />
    {#if project.sources.mic}
      <Toggle label="Mute the recording’s mic under it" checked={vo.duck} disabled={vo.muted} onchange={(v) => setVo({ duck: v })} />
    {/if}
    <Toggle label="Enhance voice" checked={vo.enhance} disabled={vo.muted} onchange={(v) => setVo({ enhance: v })} />
    <div class="vo-buttons">
      <button class="btn" disabled={vos.length > 1} onclick={A.recordAgain}><Icon name="mic" size={15} />Record again</button>
      <button class="btn" onclick={deleteVo}><Icon name="trash" size={15} />Delete</button>
    </div>
  </Section>
{/if}

{#if project.sources.mic}
  <Section title="Microphone">
    {#snippet aside()}
      <button class="icon-btn mute" aria-pressed={a.mic.muted} onclick={() => edit((p) => (p.audio.mic.muted = !p.audio.mic.muted))} {@attach tooltip(a.mic.muted ? 'Unmute microphone' : 'Mute microphone')}>
        <Icon name={a.mic.muted ? 'muted' : 'sound'} size={16} />
      </button>
    {/snippet}
    <Slider label="Volume" value={a.mic.volume} min={0} max={2} step={0.01} initial={1} disabled={a.mic.muted} format={pct} onchange={(v, m) => edit((p) => (p.audio.mic.volume = v), m)} />
    <Toggle label="Enhance voice" hint={enhanceHint} checked={a.mic.enhance} disabled={a.mic.muted} onchange={(v) => (edit((p) => (p.audio.mic.enhance = v)), v && ensureVoice(true))} />
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
  .mute[aria-pressed='true'] { color: var(--error-content); }
  .file { display: flex; align-items: center; gap: 8px; min-height: 30px; color: var(--fg-secondary); }
  .file span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-default); font-size: 12.5px; }
  .small { width: 24px; height: 24px; }
  .wide { width: 100%; }
  .vo-buttons { display: flex; gap: 6px; margin-top: 8px; }
  .vo-buttons .btn { flex: 1; min-width: 0; }
  .hint { margin: 6px 0 0; font-size: 11.5px; color: var(--fg-faint); }
  .error { margin: 6px 0 0; font-size: 12px; color: var(--error-content); }
</style>
