<!-- Anchored popover on the native popover API: top layer, light dismiss, Escape, and focus return
     to the trigger come from the platform; CSS anchor positioning places it and flips it on overflow.
     Spread `props` from the trigger snippet onto a <button>. -->
<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    trigger,
    children,
    label,
    align = 'end',
    open = $bindable(false),
  }: {
    trigger: Snippet<[Record<string, unknown>]>
    children: Snippet<[close: () => void]>
    label: string
    align?: 'start' | 'end'
    open?: boolean
  } = $props()

  const id = $props.id()
  const anchor = `--pop-${id}`
  let el = $state<HTMLElement>()
  const close = () => el?.hidePopover()
</script>

{@render trigger({ popovertarget: `pop-${id}`, style: `anchor-name: ${anchor}`, 'aria-haspopup': 'dialog', 'aria-expanded': open })}
<div
  bind:this={el}
  id="pop-{id}"
  popover="auto"
  role="dialog"
  aria-label={label}
  class="popover {align}"
  style:position-anchor={anchor}
  ontoggle={(e) => {
    open = e.newState === 'open'
    if (open) el?.querySelector<HTMLElement>('input, button, select, [tabindex]')?.focus({ focusVisible: false } as FocusOptions)
  }}
>
  {@render children(close)}
</div>

<style>
  .popover {
    inset: auto; margin: 6px 0 0; padding: 6px; min-width: 220px; max-height: 70vh; overflow: auto;
    border: 0; border-radius: var(--radius-lg); background: var(--surface-50); color: var(--text);
    box-shadow: var(--shadow-pop);
    position-try-fallbacks: flip-block;
    opacity: 0; transform: translateY(-4px) scale(0.98); transform-origin: top right;
    transition: opacity 140ms var(--ease-out), transform 140ms var(--ease-out), display 140ms allow-discrete, overlay 140ms allow-discrete;
  }
  .popover.end { position-area: bottom span-left; }
  .popover.start { position-area: bottom span-right; transform-origin: top left; }
  .popover:popover-open { opacity: 1; transform: none; }
  @starting-style { .popover:popover-open { opacity: 0; transform: translateY(-4px) scale(0.98); } }
</style>
