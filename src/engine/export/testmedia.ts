// TEST ONLY. A minimal sequential FrameSource on mediabunny, so export can be verified end to end
// while openVideo (media domain) is still a stub. The shipped path calls openVideo; this one is
// used only when the dev server runs with VITE_EXPORT_TEST_MEDIA=1. Delete once openVideo lands.
import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny'
import type { FrameSource } from '../media/index.ts'

export async function openTestVideo(url: string): Promise<FrameSource> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error('no video track')
  const sink = new VideoSampleSink(track)
  const duration = await track.computeDuration()
  let it: AsyncGenerator<VideoSample, void> | null = null
  let cur: VideoSample | null = null
  let next: VideoSample | null = null
  let last = -Infinity
  const pull = async () => (await it!.next()).value ?? null
  return {
    width: track.displayWidth,
    height: track.displayHeight,
    duration,
    async frameAt(t) {
      // Restart decoding on a backward seek or a jump of more than 2 s (a cut); otherwise walk forward.
      if (!it || t < last || t > last + 2) {
        cur?.close()
        next?.close()
        await it?.return()
        it = sink.samples(Math.max(0, t))
        cur = await pull()
        next = await pull()
      }
      last = t
      while (next && next.timestamp <= t + 1e-6) {
        cur?.close()
        cur = next
        next = await pull()
      }
      return cur && t <= duration ? cur.toVideoFrame() : null
    },
    close() {
      cur?.close()
      next?.close()
      void it?.return()
      input.dispose()
    },
  }
}
