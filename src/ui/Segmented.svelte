<!-- Segmented control on native radio inputs: arrow keys move the choice, VoiceOver reads a radio group.
     `stacked` puts the label above the control, for option lists too wide for the label column; stacked
     options with icons become tiles (icon over label). `iconOnly` keeps names as tooltips and labels. -->
<script lang="ts" generics="T extends string | number">
  import type { Attachment } from 'svelte/attachments'
  import Icon, { type IconName } from './Icon.svelte'
  import { tooltip } from './tooltip.ts'

  let {
    label,
    ariaLabel,
    options,
    value,
    stacked = false,
    iconOnly = false,
    disabled = false,
    onchange,
  }: {
    label?: string
    ariaLabel?: string // names the group when there is no visible label
    options: Array<{ value: T; label: string; icon?: IconName; disabled?: boolean; title?: string }>
    value: T
    stacked?: boolean
    iconOnly?: boolean
    disabled?: boolean
    onchange: (v: T) => void
  } = $props()
  const name = $props.id()

  // The chosen option's box. One thumb glides to it, as the platform's segmented control does, instead of each
  // option lighting up in place. It appears in place the first time and slides only on later choices.
  let thumb = $state<{ x: number; y: number; w: number; h: number; glide: boolean }>()
  let owner: HTMLElement | undefined
  const place: Attachment<HTMLElement> = (el) => {
    owner = el
    const set = () => (thumb = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, glide: !!thumb?.w })
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => {
      ro.disconnect()
      queueMicrotask(() => owner === el && ((owner = undefined), (thumb = undefined))) // after the next choice attaches
    }
  }
</script>

<div class="row" class:stacked class:disabled>
  {#if label}<span class="label" id="{name}-label">{label}</span>{/if}
  <div class="seg" role="radiogroup" aria-labelledby={label ? `${name}-label` : undefined} aria-label={label ? undefined : ariaLabel}>
    {#if thumb}<span class="thumb" class:glide={thumb.glide} style:translate="{thumb.x}px {thumb.y}px" style:width="{thumb.w}px" style:height="{thumb.h}px"></span>{/if}
    {#each options as o (o.value)}
      <label class:on={o.value === value} class:off={o.disabled} title={o.title} {@attach iconOnly && tooltip(o.label)} {@attach o.value === value ? place : undefined}>
        <input type="radio" {name} disabled={disabled || o.disabled} checked={o.value === value} aria-label={iconOnly ? o.label : undefined} onchange={() => onchange(o.value)} />
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
  .label { flex: none; width: var(--label-w, 92px); color: var(--fg-secondary); font-size: 12px; }
  /* A well sunk into the panel; the chosen option rises out of it. */
  .seg { position: relative; isolation: isolate; flex: 1; min-width: 0; display: flex; gap: 2px; padding: 2px; border-radius: var(--radius); background: var(--control-track); box-shadow: var(--hairline); }
  .thumb {
    position: absolute; top: 0; left: 0; z-index: -1; border-radius: var(--radius-sm); background: var(--control-raised);
    box-shadow: inset 0 0 0 0.5px var(--border-default), 0 1px 2px rgb(0 0 0 / 0.3);
  }
  .thumb.glide { transition: translate 250ms var(--ease-glide), width 250ms var(--ease-glide), height 250ms var(--ease-glide); }
  label {
    flex: 1 1 0; min-width: max-content; display: flex; align-items: center; justify-content: center; gap: 5px;
    height: 24px; padding: 0 6px; border-radius: var(--radius-sm); color: var(--fg-muted); font-size: 12px; font-weight: 500;
  }
  label span { white-space: nowrap; }
  .stacked label:has(:global(.icon)) { flex-direction: column; gap: 3px; height: 48px; }
  label:hover:not(.off) { color: var(--fg-secondary); }
  label.off { opacity: 0.35; }
  label.on { color: var(--fg-default); }
  label:has(input:focus-visible) { outline: 2px solid var(--brand); outline-offset: -1px; }
  input { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; pointer-events: none; }
</style>
