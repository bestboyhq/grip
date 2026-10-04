// Owner: audio/media. Frame-accurate decoding of source videos (mediabunny + WebCodecs, hardware
// decode). Frames stay on the GPU as VideoFrame handles; JS never touches pixel bytes.
// Sequential access (playback, export) is fast: one decoder keeps running ahead (mediabunny queues
// decoded frames) and frameAt walks forward through it. Random access (scrubbing, cuts) restarts the
// decoder at the keyframe before t; stepping backward keeps the frames decoded on the way, so a
// backward scrub decodes from the keyframe once per several frames, not at every frame. A second
// decoder starts early where playback jumps next (the clip after a cut, see prefetch), so playing
// across a cut never waits for a keyframe decode. Either way the answer is exact: the frame whose
// timestamp <= t < the next frame's, which is what variable frame rate (ScreenCaptureKit) needs.

import { ALL_FORMATS, EncodedPacketSink, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny'

export interface FrameSource {
  readonly width: number
  readonly height: number
  readonly duration: number
  /** The frame on screen at source time t (seconds). Caller closes it. Null past the end. */
  frameAt(t: number): Promise<VideoFrame | null>
  /** Start decoding at source time t in the background (where the next clip starts after a cut),
   *  without disturbing the decoder that shows source time `now`. */
  prefetch(t: number, now: number): void
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

/** One decoder walking forward through the file, with the decoded frames around where it is. */
interface Lane {
  frames: VideoSample[] // consecutive decoded frames in presentation order; [behind] is the last one shown
  behind: number // frames kept before the one shown: while stepping backward (see restart), else none
  it: AsyncGenerator<VideoSample, void, unknown> | null
  ended: boolean // the decoder delivered the last frame
  target: number // the time it was last asked for (NaN: none)
  work: Promise<unknown> // its jobs, one at a time
  used: number // when it last served a frame
}
const lane = (): Lane => ({ frames: [], behind: 0, it: null, ended: false, target: NaN, work: Promise.resolve(), used: 0 })

class VideoFile implements FrameSource {
  readonly width: number
  readonly height: number
  readonly duration: number
  private name: string
  private input: Input
  private sink: VideoSampleSink
  private packets: EncodedPacketSink
  private first: number
  // Two decoders: one follows playback while the other decodes ahead where the next clip starts.
  private lanes = [lane(), lane()]
  private active: Lane | null = null // the lane serving frameAt
  private uses = 0
  private last = -Infinity // the previous request
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
    // One request at a time: callers wanting only the latest request skip stale ones.
    const run = this.queue.then(() => this.locate(t))
    this.queue = run.catch(() => {})
    return run
  }

  /** Start decoding at source time t on the decoder not showing `now`, so a jump there shows at once. */
  prefetch(t: number, now: number) {
    if (this.closed || !(t <= this.duration + EPS)) return
    t = Math.max(t, this.first)
    if (this.lanes.some((l) => this.near(l, t))) return
    const l = this.lanes.find((l) => !this.near(l, now)) ?? this.spare()
    if (l === this.active) this.active = null // it leaves the playhead for where playback goes next
    l.target = t
    l.work = l.work.then(() => this.show(l, t, 0)).then((f) => f?.close(), () => {})
  }

  private locate(t: number): Promise<VideoFrame | null> {
    if (this.closed || !(t <= this.duration + EPS)) return Promise.resolve(null)
    t = Math.max(t, this.first)
    const behind = t < this.last ? Math.min(BEHIND, Math.floor(BEHIND_BYTES / (1.5 * this.width * this.height))) : 0
    this.last = t
    const l = this.lanes.find((l) => this.near(l, t)) ?? this.spare()
    const old = this.active
    if (old && old !== l) {
      // Playback moved on from the other lane (a cut, a jump): free its decoder and frames.
      old.target = NaN
      old.work = old.work.then(() => this.reset(old))
    }
    this.active = l
    l.used = ++this.uses
    l.target = t
    const run = l.work.then(() => this.show(l, t, behind))
    l.work = run.catch(() => {})
    return run
  }

  /** Can lane l show t without seeking: t is in its decoded window, or a short walk past where it is going? */
  private near(l: Lane, t: number) {
    const f = l.frames
    return (f.length > 0 && t >= f[0].timestamp - EPS && t <= f[f.length - 1].timestamp + EPS) || (t >= l.target - EPS && t - l.target < REACH)
  }

  /** The lane used longest ago: the one to restart or decode ahead with. */
  private spare() {
    return this.lanes[0].used <= this.lanes[1].used ? this.lanes[0] : this.lanes[1]
  }

  private async show(l: Lane, t: number, behind: number): Promise<VideoFrame | null> {
    if (this.closed) return null
    l.behind = behind
    let i = this.find(l, t)
    if (i < 0) {
      try {
        if (!(await this.reachable(l, t))) await this.restart(l, t)
        while (!l.ended && l.frames[l.frames.length - 1].timestamp <= t + EPS) await this.pull(l, t)
      } catch (e) {
        await this.reset(l)
        throw new Error(`Could not decode ${this.name} at ${t.toFixed(3)} s: ${e instanceof Error ? e.message : e}`)
      }
      i = this.find(l, t)
      if (i < 0) return null
    }
    return l.frames[i].toVideoFrame()
  }

  /** Index of the frame shown at t, if the window proves it (the next frame is known, or none follows). */
  private find(l: Lane, t: number): number {
    const f = l.frames
    if (!f.length || f[0].timestamp > t + EPS) return -1
    let i = 0
    while (i + 1 < f.length && f[i + 1].timestamp <= t + EPS) i++
    return i + 1 < f.length || l.ended ? i : -1
  }

  /** Is walking forward from the current window cheaper than seeking to the keyframe before t? */
  private async reachable(l: Lane, t: number) {
    const last = l.frames[l.frames.length - 1]
    if (!l.it || !last || t < l.frames[0].timestamp) return false
    if (t - last.timestamp < REACH) return true
    const key = await this.packets.getKeyPacket(t, { metadataOnly: true })
    return !key || key.timestamp <= last.timestamp
  }

  private async restart(l: Lane, t: number) {
    await this.reset(l)
    // Stepping backward (scrubbing back): decode from the keyframe instead, which costs the same, and
    // keep the frames before t (see pull), so the next steps back show without decoding.
    const key = l.behind ? await this.packets.getKeyPacket(t, { metadataOnly: true }) : null
    l.it = this.sink.samples(key?.timestamp ?? t) // starts with the frame shown at that time
    await this.pull(l, t)
  }

  private async pull(l: Lane, t: number) {
    const r = await l.it!.next()
    if (r.done) {
      l.ended = true
      return
    }
    l.frames.push(r.value)
    // Keep the frame shown at t, `behind` frames before it, and what follows; close everything older.
    while (l.frames.length > 2 + l.behind && l.frames[1 + l.behind].timestamp <= t + EPS) l.frames.shift()!.close()
  }

  private async reset(l: Lane) {
    for (const f of l.frames) f.close()
    l.frames = []
    l.ended = false
    const it = l.it
    l.it = null
    await it?.return()
  }

  close() {
    this.closed = true
    const done = this.lanes.map((l) => (l.work = l.work.then(() => this.reset(l))))
    this.queue = Promise.all([this.queue, ...done]).finally(() => this.input.dispose())
  }
}
