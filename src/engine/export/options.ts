// Export settings, the job shape shared by the main-process queue and the export window, and the
// pure math behind them (frame counts, bitrates, size estimates, file names). No DOM, no Node:
// electron/export.ts imports this too.

import type { Project } from '../../shared/project.ts'

export type Format = 'mp4' | 'gif'
export type Codec = 'h264' | 'hevc'
export type Quality = 'studio' | 'social' | 'web' | 'small'
export type Destination = 'file' | 'clipboard' | 'share'

export interface ExportOptions {
  format: Format
  /** Short side in px: 1080 exports a 16:9 project at 1920x1080 and a 9:16 one at 1080x1920. */
  size: number
  fps: number
  codec: Codec // mp4
  quality: Quality // mp4
  loop: number // gif: 0 = forever, n = play n times
  maxMB: number // gif: size target in MB (10^6 bytes), 0 = none
}

export const SIZES: Record<Format, number[]> = { mp4: [720, 1080, 1440, 2160], gif: [480, 720, 1080] }
export const RATES: Record<Format, number[]> = { mp4: [30, 60], gif: [10, 15, 24, 30] }
export const QUALITIES: Quality[] = ['studio', 'social', 'web', 'small']
export const LOOPS = [0, 1, 2, 3]
export const LIMITS = [0, 5, 10, 15]

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

export interface ExportRequest {
  bundle: string // absolute path of the .studio bundle
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

export const SAMPLE_RATE = 48_000
export const AUDIO_BITRATE = 160_000

/** Every output frame, static or not, gets encoded: frame i shows output time i / fps. */
export const frameCount = (duration: number, fps: number) => Math.max(1, Math.round(duration * fps))

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
// ponytail: GIF constants measured on the synthetic fixture (1.3-1.6 MB for 24 s at 720p15); GIF size
// swings with content, which is why the size limit exists.
export function estimateBytes(duration: number, width: number, height: number, o: ExportOptions): number {
  if (o.format === 'gif') {
    // One full frame, then small changed regions per frame.
    const est = width * height * (0.5 + 0.0035 * frameCount(duration, o.fps))
    return o.maxMB ? Math.min(est, o.maxMB * 1e6) : est
  }
  return ((videoBitrate(width, height, o) + AUDIO_BITRATE) * duration) / 8
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
