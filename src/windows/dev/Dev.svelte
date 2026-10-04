<!-- Dev-only lab host: #/dev?lab=<Name> mounts src/windows/dev/labs/<Name>.svelte.
     Domains add labs there to exercise their piece in isolation (visual checks over CDP). -->
<script lang="ts">
  import type { Component } from 'svelte'
  let { params }: { params: URLSearchParams } = $props()
  const labs = import.meta.glob<{ default: Component<{ params: URLSearchParams }> }>('./labs/*.svelte')
  const load = $derived(labs[`./labs/${params.get('lab') ?? ''}.svelte`])
</script>

{#if load}
  {#await load() then { default: Lab }}
    <Lab {params} />
  {/await}
{:else}
  <ul>
    {#each Object.keys(labs) as path}
      {@const n = path.slice(7, -7)}
      <li><a href={`#/dev?lab=${n}`} onclick={() => setTimeout(() => location.reload())}>{n}</a></li>
    {/each}
  </ul>
{/if}
