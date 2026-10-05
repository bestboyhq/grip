<!-- The inspector: a vertical tab rail and one settings panel. Selecting a zoom on the timeline opens
     the Zoom tab. Arrow keys move between tabs (ARIA tabs pattern). -->
<script lang="ts">
  import { untrack } from 'svelte'
  import { doc, edit, selection } from '../../lib/doc.svelte.ts'
  import { defaultStyle } from '../../shared/project.ts'
  import Icon, { type IconName } from '../../ui/Icon.svelte'
  import Section from '../../ui/Section.svelte'
  import Slider from '../../ui/Slider.svelte'
  import Toggle from '../../ui/Toggle.svelte'
  import { tooltip } from '../../ui/tooltip.ts'
  import Background from './inspector/Background.svelte'
  import Cursor from './inspector/Cursor.svelte'
  import Camera, { ensureCameraAnalysis } from './inspector/Camera.svelte'
  import Zoom from './inspector/Zoom.svelte'
  import Captions from './inspector/Captions.svelte'
  import Audio from './inspector/Audio.svelte'
  import TranscriptPanel from './transcript/TranscriptPanel.svelte'

  const tabs = [
    { id: 'background', label: 'Background', icon: 'frame' },
    { id: 'cursor', label: 'Cursor', icon: 'cursor' },
    { id: 'camera', label: 'Camera', icon: 'camera' },
    { id: 'zoom', label: 'Zoom', icon: 'zoom' },
    { id: 'captions', label: 'Captions', icon: 'captions' },
    { id: 'transcript', label: 'Transcript', icon: 'transcript' },
    { id: 'audio', label: 'Audio', icon: 'audio' },
    { id: 'keystrokes', label: 'Keystrokes', icon: 'command' },
    { id: 'motion', label: 'Motion', icon: 'motion' },
  ] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>
  type Tab = (typeof tabs)[number]['id']

  const saved = localStorage.getItem('editor.tab')
  let tab = $state<Tab>(tabs.some((t) => t.id === saved) ? (saved as Tab) : 'background')
  $effect(() => localStorage.setItem('editor.tab', tab))

  // A newly selected zoom brings up its settings.
  $effect(() => {
    selection.ids.join()
    untrack(() => {
      if (doc.project?.zooms.some((z) => selection.ids.includes(z.id))) tab = 'zoom'
    })
  })

  // Owed camera analysis (an effect on, its matte or face track missing) runs whatever tab is open.
  $effect(() => ensureCameraAnalysis())

  const rail = $state<HTMLButtonElement[]>([])
  function onkeydown(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === tab)
    const to: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }
    if (!(e.key in to)) return
    e.preventDefault()
    const j = (to[e.key] + tabs.length) % tabs.length
    tab = tabs[j].id
    rail[j]?.focus()
  }

  const st = $derived(doc.project!.style)
  const init = defaultStyle()
  const current = $derived(tabs.find((t) => t.id === tab)!)
</script>

<aside class="inspector">
  <div class="rail" role="tablist" aria-orientation="vertical" aria-label="Settings" tabindex="-1" {onkeydown}>
    {#each tabs as t, i (t.id)}
      <button
        bind:this={rail[i]}
        role="tab"
        id="tab-{t.id}"
        aria-selected={tab === t.id}
        aria-controls="panel"
        tabindex={tab === t.id ? 0 : -1}
        class:on={tab === t.id}
        onclick={() => (tab = t.id)}
        {@attach tooltip(t.label, undefined, 'left')}
      >
        <Icon name={t.icon} size={20} />
      </button>
    {/each}
  </div>

  <div class="panel" id="panel" role="tabpanel" aria-labelledby="tab-{tab}">
    <!-- The transcript brings its own title bar (with subtitle export) and scrolls its text itself. -->
    {#if tab !== 'transcript'}<h2>{current.label}</h2>{/if}
    {#key tab}<div class="content" class:bare={tab === 'transcript'}>
      {#if tab === 'background'}
        <Background />
      {:else if tab === 'cursor'}
        <Cursor />
      {:else if tab === 'camera'}
        <Camera />
      {:else if tab === 'zoom'}
        <Zoom />
      {:else if tab === 'captions'}
        <Captions />
      {:else if tab === 'transcript'}
        <TranscriptPanel />
      {:else if tab === 'audio'}
        <Audio />
      {:else if tab === 'keystrokes'}
        <Section>
          <Toggle label="Show keystrokes" hint="Shortcuts and keys you press appear as keycaps. Password fields are never shown." checked={st.keystrokes.visible} onchange={(v) => edit((p) => (p.style.keystrokes.visible = v))} />
          <Slider label="Size" value={st.keystrokes.size} min={0.5} max={2} step={0.05} initial={init.keystrokes.size} disabled={!st.keystrokes.visible} format={(v) => `${Math.round(v * 100)}%`} onchange={(v, m) => edit((p) => (p.style.keystrokes.size = v), m)} />
        </Section>
      {:else}
        <Section>
          <Toggle label="Motion blur" hint="Blurs fast cursor and zoom moves along their real path, like a film camera." checked={st.motionBlur} onchange={(v) => edit((p) => (p.style.motionBlur = v))} />
        </Section>
      {/if}
    </div>{/key}
  </div>
</aside>

<style>
  .inspector { flex: none; display: flex; padding: 0 10px 10px 0; }
  /* In a short window the tabs scroll instead of squashing. */
  .rail { flex: none; display: flex; flex-direction: column; align-items: center; gap: 4px; width: 52px; padding: 6px 0; overflow-y: auto; scrollbar-width: none; }
  .rail button {
    flex: none;
    display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 9px;
    background: none; color: var(--text-faint); transition: background-color 120ms, color 120ms;
  }
  @media (max-height: 700px) {
    .rail { gap: 2px; }
    .rail button { height: 32px; }
  }
  .rail button:hover { color: var(--text); background: rgb(255 255 255 / 0.06); }
  .rail button.on { color: var(--accent-text); background: var(--accent-soft); }
  .panel {
    width: 328px; display: flex; flex-direction: column; min-height: 0; border-radius: var(--radius-lg);
    background: var(--bg-panel); box-shadow: inset 0 0 0 1px var(--border);
  }
  h2 { flex: none; margin: 0; padding: 14px 16px 4px; font-size: 13px; font-weight: 600; }
  /* Content fades out under the title instead of being cut by a hard edge when scrolled. */
  /* The scrollbar gutter is always reserved (and counted in the right padding), so controls keep
     their place whether or not a tab overflows. */
  .content {
    flex: 1; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 0 6px 8px 16px; --label-w: 88px;
    mask-image: linear-gradient(transparent, #000 10px);
  }
  .content.bare { display: flex; flex-direction: column; overflow: hidden; padding: 0 16px; mask-image: none; }
</style>
