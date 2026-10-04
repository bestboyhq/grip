<!-- Owner: export. Export dialog (format, resolution, fps, destination: file, clipboard, share link)
     and the batch queue. Mounted by Editor.svelte as <ExportDialog bind:open />. -->
<script lang="ts">
  let { open = $bindable(false) }: { open?: boolean } = $props()
</script>
