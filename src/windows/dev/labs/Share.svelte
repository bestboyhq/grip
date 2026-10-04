<!-- Lab: the editor top bar's Share button against a real project and share server.
     #/dev?lab=Share&project=<bundle path>&video=<exported mp4 path> -->
<script lang="ts">
  import ShareButton from '../../editor/share/ShareButton.svelte'
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke } from '../../../lib/ipc.ts'

  let { params }: { params: URLSearchParams } = $props()
  const video = $derived(params.get('video'))

  $effect(() => {
    const path = params.get('project')
    if (path) invoke('projects:open', path).then(({ project }) => Object.assign(doc, { path, project }))
  })
</script>

<div class="bar">
  <span class="title">{doc.project?.name ?? 'No project'}</span>
  <ShareButton exportVideo={video ? async () => video : undefined} />
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
    padding: 0 12px 0 84px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-weight: 600;
  }
  :global(body) {
    background: #141416;
  }
</style>
