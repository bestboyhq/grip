<!-- Owner: agents. Hidden encoder of record_demo, #/demo?w=<px>&h=<px>&fps=<n>: the page's frames come from
     electron/demo.ts as VideoFrames and leave as the screen track of a recording, HEVC in an MP4, written
     through main as an export is. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { canEncodeVideo, Mp4OutputFormat, Output, Quality, StreamTarget, VideoSample, VideoSampleSource, type StreamTargetChunk } from 'mediabunny'
  import { invoke, on } from '../../lib/ipc.ts'

  let { params }: { params: URLSearchParams } = $props()

  onMount(async () => {
    try {
      const [width, height, fps] = ['w', 'h', 'fps'].map((k) => Number(params.get(k)))
      // The recorder's screen track: HEVC at 0.12 bits a pixel, H.264 on a Mac without it.
      const quality = new Quality({ bitrate: Math.round(width * height * fps * 0.12) })
      const codec = (await canEncodeVideo('hevc', { width, height, quality, hardwareAcceleration: 'prefer-hardware' })) ? 'hevc' : 'avc'
      const target = new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          // Send exactly the bytes in view: structured clone would copy a view's whole buffer.
          write: ({ data, position }) => invoke('demo:write', position, data.byteOffset || data.byteLength !== data.buffer.byteLength ? data.slice() : data),
        }),
        { chunked: true, chunkSize: 4 << 20 },
      )
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target })
      const video = new VideoSampleSource({
        codec,
        quality,
        keyFrameInterval: 2,
        hardwareAcceleration: 'prefer-hardware',
        // The page is sRGB; tagged as such, as the recorder and the export tag theirs.
        onEncodedPacket: (_, meta) => {
          if (meta?.decoderConfig?.colorSpace) meta.decoderConfig.colorSpace.transfer = 'iec61966-2-1'
        },
      })
      output.addVideoTrack(video)
      await output.start()
      // Each frame at the source time main took it; a page paints only when it changes, as a screen does.
      window.studio.onFrame(async (frame, t: number) => {
        const sample = new VideoSample(frame, { timestamp: t, duration: 1 / fps })
        try {
          await video.add(sample)
        } finally {
          sample.close()
        }
      })
      on('demo:finish', async () => {
        try {
          video.close()
          await output.finalize()
          await invoke('demo:done')
        } catch (e) {
          await invoke('demo:fail', e instanceof Error ? e.message : String(e))
        }
      })
      await invoke('demo:ready', codec)
    } catch (e) {
      console.error(e)
      await invoke('demo:fail', e instanceof Error ? e.message : String(e)).catch(() => {})
    }
  })
</script>
