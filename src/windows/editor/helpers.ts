// Pure helpers for the editor window: playhead restore, preview hit-testing, time display.
import type { CameraPosition, Clip } from '../../shared/project.ts'
import type { Scene } from '../../engine/scene.ts'
import { timeMap, toOutput } from '../../shared/timemap.ts'

/** Output time to reopen at for a saved source playhead; if that moment was cut, the nearest kept moment. */
export function resumeAt(clips: Clip[], src: number): number {
  const m = timeMap(clips)
  const out = toOutput(m, src)
  if (out !== null) return out
  let best = 0
  let dist = Infinity
  m.clips.forEach((c, i) => {
    const s = Math.min(Math.max(src, c.start), c.end)
    if (Math.abs(s - src) < dist) {
      dist = Math.abs(s - src)
      best = m.outStarts[i] + (s - c.start) / c.speed
    }
  })
  return best
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Normalized screen point (0..1, clamped) under output pixel (x, y) of a possibly zoomed frame. */
export function screenPoint(scene: Scene, x: number, y: number): { x: number; y: number } | null {
  const r = scene.screen?.rect
  if (!r) return null
  const { center, scale } = scene.view
  const ux = (x - scene.width / 2) / scale + center.x
  const uy = (y - scene.height / 2) / scale + center.y
  return { x: clamp01((ux - r.x) / r.w), y: clamp01((uy - r.y) / r.h) }
}

/** Output pixel where normalized screen point (nx, ny) lands in the (possibly zoomed) frame. */
export function outputPoint(scene: Scene, nx: number, ny: number): { x: number; y: number } | null {
  const r = scene.screen?.rect
  if (!r) return null
  const { center, scale } = scene.view
  return { x: (r.x + nx * r.w - center.x) * scale + scene.width / 2, y: (r.y + ny * r.h - center.y) * scale + scene.height / 2 }
}

/** The corner of a w x h frame whose quadrant holds (x, y). */
export function cornerAt(x: number, y: number, w: number, h: number): CameraPosition {
  return `${y < h / 2 ? 'top' : 'bottom'}-${x < w / 2 ? 'left' : 'right'}`
}

/** The one time display: 0:05.58, 12:03.10, 1:02:03.45, or 0:05 / 0:05.5 with fewer `digits`.
 *  Floored like a timecode, so every place shows the same digits for the same moment; `hours` keeps
 *  the hour field under an hour too (ruler labels of a long project line up). */
export function formatTime(t: number, digits = 2, hours = false): string {
  const k = 10 ** digits
  const n = Math.floor(Math.max(0, t) * k + 1e-6) // the epsilon absorbs float noise (11.37 * 100 = 1136.99...)
  const s = Math.floor(n / k)
  const ss = String(s % 60).padStart(2, '0') + (digits ? '.' + String(n % k).padStart(digits, '0') : '')
  const m = Math.floor(s / 60)
  return hours || m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const CODES: Record<string, string> = {
  ENOENT: 'It was moved, renamed, or deleted.',
  EACCES: 'Studio does not have permission to open it.',
  EPERM: 'Studio does not have permission to open it.',
  ENOSPC: 'The disk is full.',
  EROFS: 'The disk is read-only.',
}

/** A one-line, plain-language reason for an error. IPC errors arrive as "Error invoking remote method 'x':
 *  Error: <reason>", and Node file errors as "ENOENT: no such file or directory, open '<path>'". */
export function reason(e: unknown): string {
  const msg = String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
  return CODES[/^(E[A-Z]+):/.exec(msg)?.[1] ?? ''] ?? msg
}
