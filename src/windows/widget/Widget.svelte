<!-- Recording widget: timer, pen, pause/resume, restart, finish, delete. Floats over everything, drags
     anywhere, stays out of the recording. Restart and delete ask first: both throw the take away.
     The pen draws on the recorded display; what it draws is in the video and fades out after a moment. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '../../lib/ipc.ts'
  import Icon from '../recorder/Icon.svelte'
  import { formatTime, shell } from '../recorder/shell.svelte.ts'

  let { params }: { params: URLSearchParams } = $props()

  let now = $state(Date.now())
  let confirm = $state<'cancel' | 'restart' | null>(null)

  const paused = $derived(shell.status === 'paused')
  const saving = $derived(shell.status === 'stopping')
  const seconds = $derived(shell.elapsed + (shell.at ? Math.max(0, now - shell.at) / 1000 : 0))
  const run = (cmd: string) => invoke('shell:command', cmd)

  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 200)
    return () => clearInterval(tick)
  })

  function confirmed() {
    if (confirm) run(confirm)
    confirm = null
  }

  /** Right-click: hide the controls for this recording. The menu bar icon brings them back. */
  async function menu(e: MouseEvent) {
    const items = [{ id: 'hide', label: 'Hide Recording Controls' }]
    if ((await invoke('shell:popup', items, e.clientX, e.clientY)) === 'hide') window.close()
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (confirm = null)} oncontextmenu={menu} />

<main class="widget hud">
  {#if confirm}
    <span class="ask">{confirm === 'cancel' ? 'Delete recording?' : 'Start over?'}</span>
    <button class="text" onclick={() => (confirm = null)}>Keep</button>
    <button class="text danger" onclick={confirmed}>{confirm === 'cancel' ? 'Delete' : 'Restart'}</button>
  {:else}
    <span class="dot" class:paused class:saving aria-hidden="true"></span>
    <span class="time" role="timer" aria-label="Recording time">{saving ? 'Saving…' : formatTime(seconds)}</span>
    <span class="sep"></span>
    <button
      class:on={shell.drawing}
      aria-label="Draw on screen"
      aria-pressed={shell.drawing}
      title={shell.drawing ? 'Stop drawing (esc)' : 'Draw on screen (⌥⇧⌘D)'}
      disabled={saving || paused || shell.inkDisplay === null}
      onclick={() => invoke('shell:draw')}><Icon name="pen" size={18} stroke={1.7} /></button
    >
    <button aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume (⌥⇧⌘P)' : 'Pause (⌥⇧⌘P)'} disabled={saving} onclick={() => run('toggle-pause')}>
      <Icon name={paused ? 'play' : 'pause'} size={18} />
    </button>
    <button aria-label="Restart" title="Restart" disabled={saving} onclick={() => (confirm = 'restart')}><Icon name="restart" size={18} stroke={1.8} /></button>
    <button class="stop" aria-label="Finish recording" title="Finish (⌥⌘↩)" disabled={saving} onclick={() => run('stop')}><Icon name="stop" size={20} /></button>
    <button aria-label="Delete recording" title="Delete (⌥⇧⌘⌫)" disabled={saving} onclick={() => (confirm = 'cancel')}><Icon name="trash" size={18} stroke={1.7} /></button>
  {/if}
</main>

<style>
  .widget {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px 0 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-50);
    box-shadow: var(--hairline);
    color: var(--text);
    -webkit-app-region: drag;
  }
  .dot {
    width: 9px;
    height: 9px;
    margin-right: 9px;
    border-radius: 50%;
    background: var(--record);
    box-shadow: 0 0 0 3px rgb(255 69 58 / 0.22);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .dot.paused {
    background: var(--warning);
    box-shadow: 0 0 0 3px rgb(255 214 10 / 0.2);
    animation: none;
  }
  .dot.saving {
    background: var(--text-faint);
    box-shadow: none;
    animation: none;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 5px rgb(255 69 58 / 0.08);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
  .time {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.2px;
  }
  .sep {
    width: 0.5px;
    height: 24px;
    margin: 0 6.25px;
    background: var(--edge-strong);
  }
  button {
    -webkit-app-region: no-drag;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-dim);
  }
  button:hover:not(:disabled) {
    background: var(--surface-50-hover);
    color: var(--text);
  }
  button:active:not(:disabled) {
    background: var(--surface-50-selected);
  }
  button:disabled {
    opacity: 0.35;
  }
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  button.on,
  button.on:hover:not(:disabled) {
    background: var(--surface-50-selected);
    box-shadow: var(--hairline);
    color: var(--record);
  }
  .stop {
    color: var(--record);
  }
  .stop:hover:not(:disabled) {
    color: var(--record-hover);
  }
  .ask {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
  }
  .text {
    width: auto;
    height: 28px;
    padding: 0 12px;
    margin-left: 4px;
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    font-size: 13px;
    color: var(--text);
  }
  .text:hover:not(:disabled) {
    background: var(--surface-100-hover);
  }
  .danger {
    background: var(--danger);
    box-shadow: none;
    color: #fff;
  }
  .danger:hover:not(:disabled) {
    background: var(--danger-hover);
    color: #fff;
  }
</style>
