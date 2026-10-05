<!-- Export lab: the export dialog over an editor-like backdrop, for a project given as
     #/dev?lab=Export&project=<absolute .grip path>. -->
<script lang="ts">
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke } from '../../../lib/ipc.ts'
  import ExportDialog from '../../editor/export/ExportDialog.svelte'

  let { params }: { params: URLSearchParams } = $props()
  let open = $state(false)
  let error = $state('')

  const path = $derived(params.get('project'))
  $effect(() => {
    const p = path
    if (!p) return
    invoke('projects:open', p).then(
      ({ project }) => {
        doc.project = project
        doc.path = p
        open = true
      },
      (e) => (error = String(e)),
    )
  })
</script>

<main>
  <button onclick={() => (open = true)}>Export…</button>
  {#if error}<p>{error}</p>{:else if !path}<p>Add &project=&lt;bundle path&gt; to the URL.</p>{/if}
</main>
<ExportDialog bind:open />

<style>
  main {
    height: 100vh;
    padding: 16px;
    background: var(--bg);
  }
</style>
