<!-- Segmented control on native radio inputs: arrow keys, focus, and screen readers work as-is. -->
<script lang="ts" generics="T extends string | number">
  let {
    label,
    value = $bindable(),
    options,
    wide = false,
  }: { label: string; value: T; options: Array<{ value: T; text: string; disabled?: boolean; title?: string }>; wide?: boolean } = $props()
  const name = $props.id()
</script>

<div class="seg" class:wide role="radiogroup" aria-label={label}>
  {#each options as opt (opt.value)}
    <label class:on={opt.value === value} class:off={opt.disabled} title={opt.title}>
      <input type="radio" {name} value={opt.value} checked={opt.value === value} disabled={opt.disabled} onchange={() => (value = opt.value)} />
      {opt.text}
    </label>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 7px;
    background: var(--bg-raised);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .seg.wide label {
    height: 28px;
    font-size: 13px;
  }
  label {
    position: relative;
    flex: 1;
    display: grid;
    place-items: center;
    min-width: 52px;
    height: 24px;
    padding: 0 8px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
    white-space: nowrap;
    cursor: default;
    transition:
      background-color 120ms ease-out,
      color 120ms ease-out;
  }
  label:hover:not(.on, .off) {
    color: var(--text);
  }
  label.on {
    color: var(--text);
    background: #48484e;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.35),
      inset 0 0.5px 0 rgb(255 255 255 / 0.12);
  }
  label.off {
    opacity: 0.35;
  }
  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    pointer-events: none;
  }
</style>
