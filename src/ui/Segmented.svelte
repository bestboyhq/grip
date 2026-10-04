<!-- Segmented control on native radio inputs: arrow keys move the choice, VoiceOver reads a radio group.
     `stacked` puts the label above the control, for option lists too wide for the label column; stacked
     options with icons become tiles (icon over label). `iconOnly` keeps names as tooltips and labels. -->
<script lang="ts" generics="T extends string | number">
  import Icon, { type IconName } from './Icon.svelte'
  import { tooltip } from './tooltip.ts'

  let {
    label,
    options,
    value,
    stacked = false,
    iconOnly = false,
    disabled = false,
    onchange,
  }: {
    label?: string
    options: Array<{ value: T; label: string; icon?: IconName }>
    value: T
    stacked?: boolean
    iconOnly?: boolean
    disabled?: boolean
    onchange: (v: T) => void
  } = $props()
  const name = $props.id()
</script>

<div class="row" class:stacked class:disabled>
  {#if label}<span class="label" id="{name}-label">{label}</span>{/if}
  <div class="seg" role="radiogroup" aria-labelledby={label ? `${name}-label` : undefined}>
    {#each options as o (o.value)}
      <label class:on={o.value === value} {@attach iconOnly && tooltip(o.label)}>
        <input type="radio" {name} {disabled} checked={o.value === value} aria-label={iconOnly ? o.label : undefined} onchange={() => onchange(o.value)} />
        {#if o.icon}<Icon name={o.icon} size={stacked ? 18 : 15} />{/if}
        {#if !iconOnly}<span>{o.label}</span>{/if}
      </label>
    {/each}
  </div>
</div>

<style>
  .row { display: flex; align-items: center; gap: 6px; min-height: 30px; }
  .row.stacked { flex-direction: column; align-items: stretch; gap: 6px; padding-top: 2px; }
  .row.disabled { opacity: 0.4; pointer-events: none; }
  .label { flex: none; width: var(--label-w, 92px); color: var(--text-dim); font-size: 12px; }
  .seg { flex: 1; min-width: 0; display: flex; gap: 2px; padding: 2px; border-radius: 7px; background: var(--bg-raised); }
  label {
    flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px;
    height: 24px; padding: 0 3px; border-radius: 5px; color: var(--text-dim); font-size: 12px; font-weight: 500;
    transition: background-color 120ms, color 120ms;
  }
  label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stacked label:has(:global(.icon)) { flex-direction: column; gap: 3px; height: 48px; }
  label:hover { color: var(--text); }
  label.on { background: var(--bg-active); color: var(--text); box-shadow: 0 1px 2px rgb(0 0 0 / 0.3), inset 0 0.5px 0 rgb(255 255 255 / 0.08); }
  label:has(input:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: -1px; }
  input { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; pointer-events: none; }
</style>
