<!-- Lab: recording UI at window size on a light desktop, under a reference image for comparison.
     #/dev?lab=RecorderShell[&ref=<absolute path of a 2x png whose bar starts at 17.5, 21 pt>]
     --bar-bg stands in for the window's HUD vibrancy, which only exists in the real windows. -->
<script lang="ts">
  import Recorder from '../../recorder/Recorder.svelte'
  import Widget from '../../widget/Widget.svelte'
  import { fileUrl } from '../../../engine/media/index.ts'

  let { params }: { params: URLSearchParams } = $props()
  const ref = $derived(params.get('ref'))
</script>

<div class="page">
  {#if ref}<img src={fileUrl(ref)} alt="Reference" width="924" />{/if}
  <div class="row">
    <div class="window" style:width="882px" style:height="64px"><Recorder params={new URLSearchParams('preview')} /></div>
  </div>
  <div class="row">
    <div class="window" style:width="280px" style:height="48px"><Widget params={new URLSearchParams()} /></div>
  </div>
</div>

<style>
  .page {
    position: fixed;
    inset: 0;
    overflow: auto;
    background: #fff;
  }
  img {
    display: block;
  }
  .row {
    padding: 21px 17.5px;
  }
  .window {
    position: relative;
    transform: translateZ(0); /* contain the windows' position: fixed */
    --bar-bg: #515150;
    border-radius: 12px;
    box-shadow:
      0 0 0 0.5px rgb(0 0 0 / 0.6),
      0 10px 30px rgb(0 0 0 / 0.22);
  }
</style>
