<!-- Labelled native <select>: opens the real macOS menu, with typeahead and keyboard support built in. -->
<script lang="ts" generics="T extends string">
  import Icon from './Icon.svelte'

  let {
    label,
    options,
    value,
    disabled = false,
    onchange,
  }: {
    label?: string
    options: Array<{ value: T; label: string }>
    value: T
    disabled?: boolean
    onchange: (v: T) => void
  } = $props()
  const id = $props.id()
</script>

<div class="row" class:disabled>
  {#if label}<label for={id}>{label}</label>{/if}
  <div class="box">
    <!-- Controlled: after the change the menu shows `value` again, so a choice the parent turns down
         (or an action item like "Load…") never sticks in the menu. -->
    <select
      {id}
      {value}
      {disabled}
      aria-label={label ? undefined : 'Choose'}
      onchange={(e) => {
        onchange(e.currentTarget.value as T)
        e.currentTarget.value = value
      }}
    >
      {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
    </select>
    <Icon name="chevron" size={14} />
  </div>
</div>

<style>
  .row { display: flex; align-items: center; gap: 6px; min-height: 30px; }
  .row.disabled { opacity: 0.4; }
  label { flex: none; width: var(--label-w, 92px); color: var(--text-dim); font-size: 12px; }
  .box { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
  .box :global(.icon) { position: absolute; right: 7px; color: var(--text-dim); pointer-events: none; }
  select {
    width: 100%; height: var(--control-h); padding: 0 26px 0 9px; border: 0; border-radius: var(--radius-sm); appearance: none;
    background: var(--surface-100); box-shadow: var(--hairline); font-size: 12.5px; text-overflow: ellipsis;
  }
  select:hover { background: var(--surface-100-hover); }
</style>
