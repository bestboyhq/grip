<!-- Labelled native <select>: opens the real macOS menu, with typeahead and keyboard support built in.
     An icon in the box stands in for the label, which then only names the control for screen readers. -->
<script lang="ts" generics="T extends string">
  import Icon, { type IconName } from './Icon.svelte'

  let {
    label,
    icon,
    options,
    value,
    disabled = false,
    onchange,
  }: {
    label?: string
    icon?: IconName
    options: Array<{ value: T; label: string }>
    value: T
    disabled?: boolean
    onchange: (v: T) => void
  } = $props()
  const id = $props.id()
</script>

<div class="row" class:disabled>
  {#if label && !icon}<label for={id}>{label}</label>{/if}
  <div class="box">
    {#if icon}<Icon name={icon} size={16} />{/if}
    <!-- Controlled: after the change the menu shows `value` again, so a choice the parent turns down
         (or an action item like "Load…") never sticks in the menu. -->
    <select
      {id}
      {value}
      {disabled}
      class:iconic={!!icon}
      aria-label={label && !icon ? undefined : (label ?? 'Choose')}
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
  label { flex: none; width: var(--label-w, 92px); color: var(--fg-secondary); font-size: 12px; }
  .box { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
  .box :global(.icon) { position: absolute; color: var(--fg-secondary); pointer-events: none; }
  .box :global(.icon:first-child) { left: 8px; }
  .box :global(.icon:last-child) { right: 7px; }
  select {
    width: 100%; height: var(--control-h); padding: 0 26px 0 9px; border: 0; border-radius: var(--radius-sm); appearance: none;
    background: var(--surface-100); box-shadow: var(--hairline); font-size: 12.5px; text-overflow: ellipsis;
  }
  select.iconic { padding-left: 30px; }
  select:hover { background: var(--surface-hover); }
</style>
