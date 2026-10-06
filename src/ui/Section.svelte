<!-- A titled group of controls in a settings panel, separated from the next by a hairline. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  let { title, children, aside }: { title?: string; children: Snippet; aside?: Snippet } = $props()
  const id = $props.id()
</script>

<section aria-labelledby={title ? id : undefined}>
  {#if title}
    <header><h3 {id}>{title}</h3>{@render aside?.()}</header>
  {/if}
  {@render children()}
</section>

<style>
  section { display: flex; flex-direction: column; gap: 2px; padding: 14px 0; }
  :global(section) + section { box-shadow: var(--hairline-t); }
  header { display: flex; align-items: center; justify-content: space-between; min-height: 20px; margin-bottom: 6px; }
  h3 { margin: 0; font-size: 12px; font-weight: 600; color: var(--text); letter-spacing: 0.01em; }
</style>
