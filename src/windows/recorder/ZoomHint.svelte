<!-- Auto zoom, under a countdown: where the user is looking just before recording. Colored while on, so
     a glance reads it; Z flips the setting itself, for this recording and the ones after. -->
<script lang="ts">
  import { blur, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import UiIcon from '../../ui/Icon.svelte'
  import { setSettings, shell } from './shell.svelte.ts'

  const on = $derived(!!shell.settings?.autoZoom)

  function key(e: KeyboardEvent) {
    // The typed Latin letter, else the key's place (QWERTY), like the area's tool keys.
    const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase()
    if (k !== 'z' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    setSettings({ autoZoom: !on })
  }
</script>

<svelte:window onkeydown={key} />

<div class="hint" class:on role="status" in:fly|global={{ y: 6, duration: 320, delay: 120, easing: cubicOut }}>
  {#key on}
    <span class="state" in:blur={{ amount: 2, duration: 200 }}><UiIcon name={on ? 'zoom' : 'zoom-off'} size={16} />{on ? 'Auto zoom' : 'No auto zoom'}</span>
  {/key}
  <span class="key"><kbd>Z</kbd>{on ? 'to turn off' : 'to turn on'}</span>
</div>

<style>
  .hint {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 12px 0 10px;
    border-radius: 17px;
    background: var(--surface-veil);
    box-shadow: var(--hairline);
    color: var(--fg-secondary);
    font: 13px var(--font);
    white-space: nowrap;
  }
  .hint.on {
    background: color-mix(in srgb, var(--brand) 16%, var(--surface-veil));
    box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--brand) 50%, transparent);
  }
  .state {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
  }
  .on .state {
    color: var(--brand-text);
  }
  .key {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 10px;
    box-shadow: var(--hairline-l);
  }
  kbd {
    display: grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--surface-100);
    color: var(--fg-default);
    font: 600 11.5px var(--font);
  }
</style>
