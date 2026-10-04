<!-- Labelled switch: a native checkbox with role="switch", so Space toggles it and VoiceOver reads on/off. -->
<script lang="ts">
  let {
    label,
    hint,
    checked,
    disabled = false,
    onchange,
  }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onchange: (v: boolean) => void } = $props()
  const id = $props.id()
</script>

<div class="row" class:disabled>
  <label for={id}>
    {label}
    {#if hint}<small id="{id}-hint">{hint}</small>{/if}
  </label>
  <input {id} type="checkbox" role="switch" {checked} {disabled} aria-describedby={hint ? `${id}-hint` : undefined} onchange={(e) => onchange(e.currentTarget.checked)} />
</div>

<style>
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; padding: 2px 0; }
  .row:has(small) { padding: 5px 0; }
  .row.disabled { opacity: 0.4; }
  label { display: flex; flex-direction: column; gap: 1px; font-size: 12.5px; color: var(--text); }
  small { font-size: 11.5px; line-height: 1.35; color: var(--text-faint); }
  input {
    flex: none; position: relative; width: 28px; height: 16px; margin: 0; border-radius: 8px; appearance: none;
    background: var(--bg-active); box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.06); transition: background-color 160ms;
  }
  input::before {
    content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%;
    background: #f5f5f7; box-shadow: 0 1px 2px rgb(0 0 0 / 0.35); transition: transform 180ms var(--ease-out);
  }
  input:checked { background: var(--accent-strong); }
  input:checked::before { transform: translateX(12px); }
</style>
