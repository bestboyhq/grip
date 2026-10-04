// Owner: audio/media. Frame-accurate decoding of source videos (mediabunny + WebCodecs, hardware
// decode). Frames stay on the GPU as VideoFrame handles; JS never touches pixel bytes.
// Sequential access (playback, export) must be fast: keep a decoder running ahead instead of
// seeking per frame. Random access (scrubbing) must be correct.

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

export async function openVideo(_url: string): Promise<FrameSource> {
  throw new Error('openVideo: not implemented')
}
