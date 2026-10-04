<!-- Owner: export. Hidden export window, #/export?job=<id>: runs one job from electron/export.ts.
     A crash here fails that job and nothing else; main deletes the partial file. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '../../lib/ipc.ts'
  import { exportProject } from '../../engine/export/index.ts'
  import type { JobSpec } from '../../engine/export/options.ts'

  let { params }: { params: URLSearchParams } = $props()
  let status = $state('Starting')

  onMount(async () => {
    const id = params.get('job') ?? ''
    try {
      const job: JobSpec = await invoke('export:job', id)
      let sent = 0
      const size = await exportProject(job, {
        write: (position, data) =>
          // Send exactly the bytes in view: structured clone would copy a view's whole buffer.
          invoke('export:write', id, position, data.byteOffset || data.byteLength !== data.buffer.byteLength ? data.slice() : data),
        progress: (p, phase) => {
          status = `${phase} ${Math.floor(p * 100)}%`
          const now = performance.now()
          if (now - sent < 200 && p < 0.99) return
          sent = now
          void invoke('export:progress', id, p, phase).catch(() => {})
        },
      })
      status = 'Saving'
      await invoke('export:done', id, size)
    } catch (e) {
      console.error(e)
      status = 'Failed'
      await invoke('export:fail', id, e instanceof Error ? e.message : String(e)).catch(() => {})
    }
  })
</script>

<main>{status}</main>

<style>
  main {
    height: 100vh;
    padding: 16px;
    background: var(--bg);
    font-variant-numeric: tabular-nums;
  }
</style>
