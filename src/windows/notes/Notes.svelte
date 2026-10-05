<!-- Speaker notes (#/notes): what to say, under the menu bar near the camera, only for the user (the
     window stays out of the recording). Write them here, then Start: the prompter scrolls them at a
     steady pace. ⌥⌘. starts and stops it from any app; Space pauses, Esc goes back to editing. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { on } from '../../lib/ipc.ts'
  import Icon from '../recorder/Icon.svelte'
  import { setSettings, shell } from '../recorder/shell.svelte.ts'

  let { params }: { params: URLSearchParams } = $props()

  const LINE = 1.4 // line height, in text sizes
  let text = $state<string | null>(null) // local while typing; saved shortly after
  let prompting = $state(false)
  let playing = $state(false)
  let pos = $state(0) // points scrolled
  let view = $state<HTMLElement>()
  let content = $state<HTMLElement>()

  const prompter = $derived(shell.settings?.prompter ?? { speed: 20, size: 24 })
  const notes = $derived(text ?? shell.settings?.notes ?? '')

  let saving: ReturnType<typeof setTimeout> | undefined
  function edit(value: string) {
    text = value
    clearTimeout(saving)
    saving = setTimeout(() => setSettings({ notes: value }), 400)
  }
  const tune = (patch: Partial<typeof prompter>) => setSettings({ prompter: { ...prompter, ...patch } })

  function start() {
    if (!notes.trim()) return
    pos = 0
    prompting = playing = true
  }
  const stop = () => (prompting = playing = false)
  const toggle = () => (prompting ? stop() : start())

  // Scroll at `speed` lines a minute, smoothly at any speed (a transform, not whole-pixel scrolling).
  onMount(() => {
    let last = performance.now()
    let raf = requestAnimationFrame(function frame(now) {
      if (playing && view && content) {
        const end = Math.max(0, content.offsetHeight - view.clientHeight / 3)
        pos = Math.min(end, pos + ((prompter.speed * prompter.size * LINE) / 60) * ((now - last) / 1000))
        if (pos >= end) playing = false
      }
      last = now
      raf = requestAnimationFrame(frame)
    })
    const off = on('notes:prompter', toggle)
    return () => (cancelAnimationFrame(raf), off(), clearTimeout(saving))
  })

  function key(e: KeyboardEvent) {
    if (e.metaKey && e.altKey && e.code === 'Period') return (e.preventDefault(), toggle())
    if (!prompting) return
    if (e.key === ' ') (e.preventDefault(), (playing = !playing))
    else if (e.key === 'Escape') stop()
  }
</script>

<svelte:window onkeydown={key} />

<main class="notes" style:--size="{prompter.size}px">
  <header>
    {#if prompting}
      <button class="icon" aria-label="Back to editing" title="Back to editing (Esc)" onclick={stop}><Icon name="stop" size={16} /></button>
      <button class="icon" aria-label={playing ? 'Pause' : 'Play'} title="{playing ? 'Pause' : 'Play'} (Space)" onclick={() => (playing = !playing)}>
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <label class="tune">Speed<input type="range" min="5" max="60" step="1" value={prompter.speed} oninput={(e) => tune({ speed: +e.currentTarget.value })} /></label>
      <label class="tune">Size<input type="range" min="14" max="48" step="1" value={prompter.size} oninput={(e) => tune({ size: +e.currentTarget.value })} /></label>
    {:else}
      <span class="title">Speaker Notes</span>
      <button class="start" disabled={!notes.trim()} title="Start prompter (⌥⌘.)" onclick={start}><Icon name="play" size={13} />Start Prompter</button>
    {/if}
    <button class="icon" aria-label="Hide speaker notes" title="Hide speaker notes" onclick={() => setSettings({ speakerNotes: false })}><Icon name="close" size={16} stroke={2} /></button>
  </header>
  {#if prompting}
    <!-- Wheel or trackpad nudges the text; a click pauses or plays. -->
    <div class="view" bind:this={view} role="presentation" onclick={() => (playing = !playing)} onwheel={(e) => (pos = Math.max(0, pos + e.deltaY))}>
      <div class="text" bind:this={content} style:transform="translateY({-pos}px)">{notes}</div>
    </div>
  {:else}
    <textarea aria-label="Speaker notes" placeholder="What you want to say. Only you see this; it stays out of the recording." value={notes} oninput={(e) => edit(e.currentTarget.value)}
    ></textarea>
  {/if}
</main>

<style>
  .notes {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    overflow: hidden;
    /* Over the window's HUD vibrancy, like the toolbar. */
    background: rgb(28 28 30 / 0.72);
    box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.13);
    color: #f4f4f5;
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 6px 0 14px;
    border-bottom: 0.5px solid rgb(255 255 255 / 0.1);
    -webkit-app-region: drag;
  }
  header > :first-child.icon {
    margin-left: -8px;
  }
  .title {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    color: rgb(255 255 255 / 0.6);
  }
  button,
  input {
    -webkit-app-region: no-drag;
  }
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 0;
    padding: 0;
    background: none;
    color: rgb(255 255 255 / 0.8);
  }
  .icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }
  .icon:hover {
    background: rgb(255 255 255 / 0.1);
    color: #fff;
  }
  .start {
    gap: 6px;
    height: 26px;
    padding: 0 10px 0 8px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 12px;
    font-weight: 600;
  }
  .start:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .start:disabled {
    opacity: 0.4;
  }
  .tune {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
    font-size: 11.5px;
    color: rgb(255 255 255 / 0.6);
  }
  .tune input {
    appearance: none;
    width: 72px;
    height: 3px;
    margin: 0;
    border-radius: 1.5px;
    background: rgb(255 255 255 / 0.22);
  }
  .tune input::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
  }
  .tune:last-of-type {
    flex: 1;
  }
  textarea {
    flex: 1;
    min-height: 0;
    padding: 12px 16px;
    border: 0;
    resize: none;
    background: none;
    font-size: 15px;
    line-height: 1.5;
  }
  textarea::placeholder {
    color: rgb(255 255 255 / 0.35);
  }
  .view {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    /* Lines fade in at the bottom and out at the top. */
    mask-image: linear-gradient(transparent, #000 8%, #000 85%, transparent);
  }
  .text {
    padding: 16px 20px 0;
    font-size: var(--size);
    font-weight: 500;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    will-change: transform;
  }
</style>
