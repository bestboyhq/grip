// Owner: audio/media. Frame-accurate decoding of source videos (mediabunny + WebCodecs, hardware
// decode). Frames stay on the GPU as VideoFrame handles; JS never touches pixel bytes.
// Sequential access (playback, export) is fast: one decoder keeps running ahead (mediabunny queues
// decoded frames) and frameAt walks forward through it. Random access (scrubbing, cuts) restarts the
// decoder at the keyframe before t; stepping backward keeps the frames decoded on the way, so a
// backward scrub decodes from the keyframe once per several frames, not at every frame. Either way
// the answer is exact: the frame whose timestamp <= t < the next frame's, which is what variable
// frame rate (ScreenCaptureKit) needs.

import { ALL_FORMATS, EncodedPacketSink, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny'

export interface FrameSource {
  readonly width: number
  readonly height: number
  readonly duration: number
  /** The frame on screen at source time t (seconds). Caller closes it. Null past the end. */
  frameAt(t: number): Promise<VideoFrame | null>
  close(): void
}

/** URL for a local file, served by the main process `media:` protocol with Range support. */
export function fileUrl(absPath: string): string {
  return 'media://local/' + encodeURIComponent(absPath)
}

/** Short name of a media: URL for messages, e.g. "sources/mic.m4a". */
export const fileLabel = (url: string) => decodeURIComponent(url.replace(/^media:\/\/local\//, '')).split('/').slice(-2).join('/')

export async function openVideo(url: string): Promise<FrameSource> {
  const name = fileLabel(url)
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error(`${name} has no video track`)
    if (!(await track.canDecode())) throw new Error(`${name} uses ${(await track.getCodec()) ?? 'an unknown'} video, which this Mac cannot decode`)
    // ponytail: frames come out unrotated; a rotated import (portrait iPhone .mov) needs the compositor to apply track rotation.
    const [width, height, first, duration] = await Promise.all([
      track.getSquarePixelWidth(),
      track.getSquarePixelHeight(),
      track.getFirstTimestamp(),
      track.computeDuration(), // end of the last frame; container metadata can disagree on VFR files
    ])
    return new VideoFile(name, input, new VideoSampleSink(track), new EncodedPacketSink(track), width, height, first, duration)
  } catch (e) {
    input.dispose()
    throw e instanceof Error && e.message.startsWith(name) ? e : new Error(`Could not open ${name}: ${e instanceof Error ? e.message : e}`)
  }
}

const EPS = 1e-6
const REACH = 1 // seconds: decoding forward this far is never slower than a seek
const BEHIND = 30 // frames kept for scrubbing backward, at most...
const BEHIND_BYTES = 128e6 // ...and at most this much decoded video (9 frames of 4K)

class VideoFile implements FrameSource {
  readonly width: number
  readonly height: number
  readonly duration: number
  private name: string
  private input: Input
  private sink: VideoSampleSink
  private packets: EncodedPacketSink
  private first: number
  private frames: VideoSample[] = [] // consecutive decoded frames in presentation order; [behind] is the last one shown
  private behind = 0 // frames kept before the one shown: while stepping backward (see restart), else none
  private last = -Infinity // the previous request
  private it: AsyncGenerator<VideoSample, void, unknown> | null = null
  private ended = false // the decoder delivered the last frame
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(name: string, input: Input, sink: VideoSampleSink, packets: EncodedPacketSink, width: number, height: number, first: number, duration: number) {
    this.name = name
    this.input = input
    this.sink = sink
    this.packets = packets
    this.width = width
    this.height = height
    this.first = first
    this.duration = duration
  }

  frameAt(t: number): Promise<VideoFrame | null> {
    // One decoder, one request at a time: callers wanting only the latest request skip stale ones.
    const run = this.queue.then(() => this.locate(t))
    this.queue = run.catch(() => {})
    return run
  }

  private async locate(t: number): Promise<VideoFrame | null> {
    if (this.closed || !(t <= this.duration + EPS)) return null
    t = Math.max(t, this.first)
    this.behind = t < this.last ? Math.min(BEHIND, Math.floor(BEHIND_BYTES / (1.5 * this.width * this.height))) : 0
    this.last = t
    let i = this.find(t)
    if (i < 0) {
      try {
        if (!(await this.reachable(t))) await this.restart(t)
        while (!this.ended && this.frames[this.frames.length - 1].timestamp <= t + EPS) await this.pull(t)
      } catch (e) {
        await this.reset()
        throw new Error(`Could not decode ${this.name} at ${t.toFixed(3)} s: ${e instanceof Error ? e.message : e}`)
      }
      i = this.find(t)
      if (i < 0) return null
    }
    return this.frames[i].toVideoFrame()
  }

  /** Index of the frame shown at t, if the window proves it (the next frame is known, or none follows). */
  private find(t: number): number {
    const f = this.frames
    if (!f.length || f[0].timestamp > t + EPS) return -1
    let i = 0
    while (i + 1 < f.length && f[i + 1].timestamp <= t + EPS) i++
    return i + 1 < f.length || this.ended ? i : -1
  }

  /** Is walking forward from the current window cheaper than seeking to the keyframe before t? */
  private async reachable(t: number) {
    const last = this.frames[this.frames.length - 1]
    if (!this.it || !last || t < this.frames[0].timestamp) return false
    if (t - last.timestamp < REACH) return true
    const key = await this.packets.getKeyPacket(t, { metadataOnly: true })
    return !key || key.timestamp <= last.timestamp
  }

  private async restart(t: number) {
    await this.reset()
    // Stepping backward (scrubbing back): decode from the keyframe instead, which costs the same, and
    // keep the frames before t (see pull), so the next steps back show without decoding.
    const key = this.behind ? await this.packets.getKeyPacket(t, { metadataOnly: true }) : null
    this.it = this.sink.samples(key?.timestamp ?? t) // starts with the frame shown at that time
    await this.pull(t)
  }

  private async pull(t: number) {
    const r = await this.it!.next()
    if (r.done) {
      this.ended = true
      return
    }
    this.frames.push(r.value)
    // Keep the frame shown at t, `behind` frames before it, and what follows; close everything older.
    while (this.frames.length > 2 + this.behind && this.frames[1 + this.behind].timestamp <= t + EPS) this.frames.shift()!.close()
  }

  private async reset() {
    for (const f of this.frames) f.close()
    this.frames = []
    this.ended = false
    const it = this.it
    this.it = null
    await it?.return()
  }

  close() {
    this.closed = true
    this.queue = this.queue.then(() => this.reset()).finally(() => this.input.dispose())
  }
}
