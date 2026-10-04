<!-- Owner: export. Hidden export window, #/export?job=<id>: runs one job from electron/export.ts.
     A crash here fails that job and nothing else; main deletes the partial file. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '../../lib/ipc.ts'
  import { openVideo, type FrameSource } from '../../engine/media/index.ts'
  import { exportProject } from '../../engine/export/index.ts'
  import type { JobSpec } from '../../engine/export/options.ts'

  let { params }: { params: URLSearchParams } = $props()
  let status = $state('Starting')

  // TEMP (until the media domain's openVideo lands): `VITE_EXPORT_TEST_MEDIA=1 npm run dev` decodes
  // with a minimal test-only source so export can be verified end to end. Dead code in builds.
  async function opener(): Promise<(url: string) => Promise<FrameSource>> {
    if (import.meta.env.DEV && import.meta.env.VITE_EXPORT_TEST_MEDIA) return (await import('../../engine/export/testmedia.ts')).openTestVideo
    return openVideo
  }

  async function upload(path: string, name: string): Promise<string> {
    try {
      const res = await invoke('share:upload', path, { name })
      const url = typeof res === 'string' ? res : res?.url
      if (!url) throw new Error('The upload finished without a link.')
      return url
    } catch (e) {
      if (/No handler registered/.test(String(e))) throw new Error('Share links are not available yet. The file was saved.')
      throw e
    }
  }

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
        open: await opener(),
      })
      status = 'Saving'
      const res = await invoke('export:done', id, size)
      if (res?.upload) {
        status = 'Uploading'
        await invoke('export:shared', id, await upload(res.upload, job.name))
      }
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
