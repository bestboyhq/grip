// Export settings, the job shape shared by the main-process queue and the export window, and the
// pure math behind them (frame counts, bitrates, size estimates, file names). No DOM, no Node:
// electron/export.ts imports this too.

import type { Project } from '../../shared/project.ts'

export type Format = 'mp4' | 'gif'
export type Codec = 'h264' | 'hevc'
export type Quality = 'studio' | 'social' | 'web' | 'small'
// temp: an MP4 in Grip's temp folder for another feature to take (the Share button uploads it).
export type Destination = 'file' | 'clipboard' | 'share' | 'temp'
export const DESTINATIONS: Destination[] = ['file', 'clipboard', 'share', 'temp']

export interface ExportOptions {
  format: Format
  /** Short side in px: 1080 exports a 16:9 project at 1920x1080 and a 9:16 one at 1080x1920. */
  size: number
  fps: number
  codec: Codec // mp4
  quality: Quality // mp4
  loop: number // gif: 0 = forever, n = play n times
  maxMB: number // size limit in MB (10^6 bytes), 0 = none
}

export const SIZES: Record<Format, number[]> = { mp4: [720, 1080, 1440, 2160], gif: [480, 720, 1080] }
export const RATES: Record<Format, number[]> = { mp4: [30, 60], gif: [10, 15, 24, 30] }
export const QUALITIES: Quality[] = ['studio', 'social', 'web', 'small']
export const LOOPS = [0, 1, 2, 3]
export const LIMITS = [0, 5, 10, 15, 20]

export const defaultOptions = (): ExportOptions => ({ format: 'mp4', size: 1080, fps: 60, codec: 'h264', quality: 'social', loop: 0, maxMB: 0 })

/** Options from an untrusted source (localStorage, IPC) snapped to valid values. */
export function cleanOptions(o: Partial<ExportOptions> | null | undefined): ExportOptions {
  const d = defaultOptions()
  const pick = <T>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)
  const format = pick(o?.format, ['mp4', 'gif'] as Format[], d.format)
  return {
    format,
    size: pick(o?.size, SIZES[format], format === 'gif' ? 720 : d.size),
    fps: pick(o?.fps, RATES[format], format === 'gif' ? 15 : d.fps),
    codec: pick(o?.codec, ['h264', 'hevc'] as Codec[], d.codec),
    quality: pick(o?.quality, QUALITIES, d.quality),
    loop: pick(o?.loop, LOOPS, d.loop),
    maxMB: pick(o?.maxMB, LIMITS, d.maxMB),
  }
}

/** The options a job runs with. A share link (and the Share button's temp export) is always an H.264
 *  MP4 without a size limit, whatever the dialog shows: the link page is a video page, H.264 plays in
 *  every browser, and our server takes any size. */
export function jobOptions(dest: Destination, o: Partial<ExportOptions> | null | undefined): ExportOptions {
  return cleanOptions(dest === 'share' || dest === 'temp' ? { ...o, format: 'mp4', codec: 'h264', maxMB: 0 } : o)
}

export interface ExportRequest {
  bundle: string // absolute path of the .grip bundle
  project?: Project // snapshot to export; read from the bundle when absent
  options: ExportOptions
  dest: Destination
  path?: string // absolute output path for 'file'; asked with a save dialog when absent
}

export type JobState = 'queued' | 'running' | 'uploading' | 'done' | 'failed' | 'canceled'

export interface JobInfo {
  id: string
  name: string // project name
  bundle: string
  options: ExportOptions
  dest: Destination
  path: string // final output file
  state: JobState
  progress: number // 0..1; 1 only once the file is complete on disk
  phase: string // human-readable step, e.g. "Rendering", "Finalizing"
  error?: string
  url?: string // share link
  bytes?: number // final file size
  startedAt?: number // ms epoch
  finishedAt?: number
}

/** What the export window receives: the job plus the project snapshot to render. */
export interface JobSpec extends JobInfo {
  project: Project
}

export interface ExportIO {
  /** Write bytes at a file position; resolves once written (backpressure). */
  write(position: number, data: Uint8Array): Promise<void>
  /** 0..0.99 while encoding. The file is only complete (1) once the caller has closed it. */
  progress(p: number, phase: string): void
}

/** No step of a healthy export takes this long: one frame, one audio chunk, finalizing. */
export const STALL_MS = 10_000

export class Stall extends Error {
  readonly what: string
  constructor(what: string) {
    super(`The ${what} stopped responding.`)
    this.what = what
  }
}

/** `p`, or a Stall error once it has taken STALL_MS. */
export function watch<T>(p: Promise<T>, what: string, ms = STALL_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stall = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Stall(what)), ms)))
  return Promise.race([p, stall]).finally(() => clearTimeout(timer))
}

/** Progress for an export that may run more than one pass (a GIF refit, a software retry): each
 *  pass fills the rest of the bar from where the last one stopped, so it never moves backwards. */
export function passes(io: ExportIO): () => ExportIO {
  let shown = 0
  return () => {
    const from = shown
    return { ...io, progress: (p, phase) => io.progress((shown = from + ((0.99 - from) * p) / 0.99), phase) }
  }
}

export const SAMPLE_RATE = 48_000
export const AUDIO_BITRATE = 160_000

/** Every output frame, static or not, gets encoded: frame i shows output time i / fps. */
export const frameCount = (duration: number, fps: number) => Math.max(1, Math.round(duration * fps))

/** GIF size target: the factor that scales a GIF's sides from `bytes` (made or projected) to just under
 *  `limit`. GIF bytes grow slower than the pixel count, about as pixels^0.75, so the side scales by
 *  (limit / bytes)^(2/3), not by its square root. */
// ponytail: 0.75 measured on the fixture from 360p to 1080p (0.70-0.82); fit it per GIF from the probe and
// the first pass if targets keep landing far under.
export const gifRefit = (limit: number, bytes: number) => (limit / bytes) ** (2 / 3) * 0.97

/** GIF frame delay in centiseconds. Rounding the cumulative time keeps the total exact at any fps. */
export const gifDelay = (i: number, fps: number) => Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)

// Bits per pixel per frame at 30 fps. Screen content is mostly static, so the encoder lands well
// under these averages; they bound text sharpness during fast motion (scrolls, zoom transitions).
const BPP: Record<Quality, number> = { studio: 0.2, social: 0.1, web: 0.05, small: 0.025 }

export function videoBitrate(width: number, height: number, o: Pick<ExportOptions, 'fps' | 'quality' | 'codec'>): number {
  return Math.round(BPP[o.quality] * width * height * 30 * (o.fps / 30) ** 0.6 * (o.codec === 'hevc' ? 0.65 : 1))
}

/** File size in bytes: an upper bound for MP4 (the encoder's average bitrate is a ceiling; mostly
 *  static screen content lands at 5-20% of it), a typical size for GIF. */
// ponytail: GIF constants measured on the synthetic fixture with a camera bubble (3.0 MB for 24 s at
// 720p15, 4.4 MB at 642p30); GIF size swings with content, which is why the size limit exists.
export function estimateBytes(duration: number, width: number, height: number, o: ExportOptions): number {
  const est =
    o.format === 'gif'
      ? width * height * (0.5 + 0.0085 * frameCount(duration, o.fps)) // one full frame, then the changed regions of each frame
      : ((videoBitrate(width, height, o) + AUDIO_BITRATE) * duration) / 8
  return o.maxMB ? Math.min(est, o.maxMB * 1e6) : est
}

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export const tooLong = (mb: number) => `This video is too long to fit under ${mb} MB. Trim it, or export without a size limit.`

/** How an MP4 of `duration` output seconds fits under `limit` bytes (0 = no limit), from the encoder's
 *  size `base`. Gives up as little as it must, in order: none (the selected quality fits), a capped
 *  bitrate, 30 fps, then a smaller picture (down to 360p) with 96 kbps audio, plenty for a voice. Below
 *  half the Small quality's bits per pixel, text in motion turns to mush, and fewer, sharper pixels read
 *  better. Null when even 360p cannot fit. */
export function mp4Plan(duration: number, limit: number, base: { width: number; height: number }, o: Pick<ExportOptions, 'fps' | 'quality' | 'codec'>): { width: number; height: number; fps: number; bitrate: number; audio: number } | null {
  // Video bits per second: the limit minus the sample tables mediabunny reserves up front (about 35 bytes
  // a packet, for every frame and 2 AAC packets per 1024 samples, as mp4Pass declares them) and the
  // audio, with 10% left for the encoder overshooting its average.
  const budget = (fps: number, audio: number) => (limit ? ((limit - 64e3 - 35 * (fps + SAMPLE_RATE / 512) * duration) * 8 * 0.9) / duration - audio : Infinity)
  const floor = (k: number, fps: number) => videoBitrate(base.width * k, base.height * k, { ...o, fps, quality: 'small' }) / 2
  const at = (k: number, fps: number, audio: number) => ({
    width: even(base.width * k),
    height: even(base.height * k),
    fps,
    bitrate: Math.round(Math.min(videoBitrate(base.width * k, base.height * k, { ...o, fps }), budget(fps, audio))),
    audio,
  })
  for (const fps of [o.fps, Math.min(o.fps, 30)]) if (budget(fps, AUDIO_BITRATE) >= floor(1, fps)) return at(1, fps, AUDIO_BITRATE)
  const fps = Math.min(o.fps, 30)
  const b = budget(fps, 96_000)
  const min = Math.min(1, 360 / Math.min(base.width, base.height))
  if (!(b >= floor(min, fps))) return null
  return at(Math.min(1, Math.max(min, Math.sqrt(b / floor(1, fps)))), fps, 96_000)
}

export function formatBytes(n: number): string {
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`
  if (n < 1e9) return `${n < 1e7 ? (n / 1e6).toFixed(1) : Math.round(n / 1e6)} MB`
  return `${(n / 1e9).toFixed(1)} GB`
}

/** A project name as a macOS file name: keeps #, emoji, accents, and spaces; drops what the
 *  filesystem rejects or hides ("/", ":", control characters, a leading dot). */
export function safeFileName(name: string): string {
  const s = name
    .replace(/[/:\p{Cc}]/gu, '-')
    .replace(/^[.\s]+/, '')
    .trim()
  // APFS allows 255 UTF-8 bytes; leave room for " 12.mp4" and the ".partial" temp name.
  let out = ''
  let bytes = 0
  for (const ch of s) {
    bytes += new TextEncoder().encode(ch).length
    if (bytes > 220) break
    out += ch
  }
  return out.trim() || 'Untitled'
}

/** "<base>.<ext>", or "<base> 2.<ext>", "<base> 3.<ext>"... when `taken(name)` says it exists. */
export function uniqueName(base: string, ext: string, taken: (name: string) => boolean): string {
  for (let i = 1; ; i++) {
    const name = `${base}${i > 1 ? ` ${i}` : ''}.${ext}`
    if (!taken(name)) return name
  }
}
