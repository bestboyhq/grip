<!-- Camera bubble while picking and recording: live preview of the chosen camera, mirrored like a
     mirror, circular, draggable. Out of the recording (the camera is its own track). -->
<script lang="ts">
  import Icon from '../recorder/Icon.svelte'
  import { inputs, shell } from '../recorder/shell.svelte.ts'

  let { params }: { params: URLSearchParams } = $props()

  let error = $state('')

  /** Attachment: streams the chosen camera into the video; reruns when the choice changes. */
  function preview(video: HTMLVideoElement) {
    const id = shell.settings?.camera
    if (!id) return
    let stream: MediaStream | null = null
    let gone = false
    open(id).then(
      (s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop())
        stream = s
        error = ''
        video.srcObject = s
      },
      (e: DOMException) => (error = e?.name === 'NotAllowedError' ? 'Allow camera access in System Settings' : 'Camera unavailable'),
    )
    return () => {
      gone = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }

  /** Capture devices are named alike in AVFoundation and Chromium, but their ids differ. */
  async function open(id: string) {
    const name = (await inputs()).cameras.find((c) => c.id === id)?.name
    const match = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && d.label === name)
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: match ? { exact: match.deviceId } : undefined, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    })
  }
</script>

<main class="bubble">
  <video {@attach preview} autoplay muted playsinline class:hidden={!!error}></video>
  {#if error}
    <div class="off">
      <Icon name="camera-off" size={28} />
      <span>{error}</span>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    background: transparent;
  }
  .bubble {
    position: fixed;
    inset: 16px;
    overflow: hidden;
    border-radius: 50%;
    background: #1c1c1e;
    box-shadow:
      0 0 0 1.5px rgb(255 255 255 / 0.2),
      0 8px 22px rgb(0 0 0 / 0.38);
    -webkit-app-region: drag;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }
  .hidden {
    display: none;
  }
  .off {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 0 30px;
    text-align: center;
    font-size: 12px;
    line-height: 1.3;
    color: rgb(255 255 255 / 0.62);
  }
</style>
