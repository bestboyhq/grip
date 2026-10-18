<!-- Export lab: the title bar's Export button with its menu open, at the right edge like in the
     editor, for a project given as #/dev?lab=Export&project=<absolute .grip path>. -->
<script lang="ts">
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke } from '../../../lib/ipc.ts'
  import ExportButton from '../../editor/export/ExportButton.svelte'

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

<div class="bar">
  <span>{error || (path ? (doc.project?.name ?? '') : 'Add &project=<bundle path> to the URL.')}</span>
  <ExportButton bind:open />
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    padding: 0 12px 0 84px;
    background: var(--surface-root);
  }
  :global(body) {
    background: var(--surface-root);
  }
</style>
