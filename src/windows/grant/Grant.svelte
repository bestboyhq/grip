<!-- The drag-to-allow panel under System Settings (#/grant, electron/shell/grant.ts):
     the whole card drags Grip into the privacy list it is missing from. -->
<script lang="ts">
  import { invoke } from '../../lib/ipc.ts'
  import Icon from '../../ui/Icon.svelte'
  import appIcon from '../../../build/icon.png'

  let {}: { params: URLSearchParams } = $props() // its route has none

  /** Dragging anywhere on the card drops Grip.app; people grab the card, not the icon. The drag image is
   *  the icon at 64 pt, drawn now (the drag must start in this event). */
  function drag(e: DragEvent & { currentTarget: HTMLElement }) {
    e.preventDefault()
    const c = document.createElement('canvas')
    c.width = c.height = 128
    c.getContext('2d')!.drawImage(e.currentTarget.querySelector('img')!, 0, 0, 128, 128)
    invoke('grant:drag', c.toDataURL('image/png'))
  }
</script>

<main class="card hud" draggable="true" ondragstart={drag}>
  <img src={appIcon} alt="Grip" width="44" height="44" />
  <div class="text">
    <div class="title">Drag Grip into the list above</div>
    <div class="hint">Already in the list? Turn it on there.</div>
  </div>
  <button class="icon-btn" aria-label="Close" onclick={() => invoke('grant:close')}><Icon name="close" size={16} /></button>
</main>

<style>
  :global(body) {
    background: transparent;
  }
  .card {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 100vh;
    padding: 0 12px 0 14px;
    background: var(--surface-50);
    border-radius: var(--radius-lg);
    box-shadow: var(--hairline);
    cursor: grab;
  }
  .card:active {
    cursor: grabbing;
  }
  img {
    flex: none;
    filter: drop-shadow(0 3px 6px rgb(0 0 0 / 0.35));
    transition: transform 150ms var(--ease-out);
  }
  .card:hover img {
    transform: scale(1.06);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
  }
  .hint {
    margin-top: 1px;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
