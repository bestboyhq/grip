// Pure helpers for the editor window: playhead restore, preview hit-testing, time display.
import type { CameraPosition, Clip, Project, Rect } from '../../shared/project.ts'
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

/** Normalized screen point under output pixel (x, y) of a possibly zoomed frame, clamped to the
 *  shown part of the screen (all of it, or the crop). */
export function screenPoint(scene: Scene, x: number, y: number): { x: number; y: number } | null {
  if (!scene.screen) return null
  const { rect: r, visible: v } = scene.screen
  const { center, scale } = scene.view
  const ux = Math.min(Math.max((x - scene.width / 2) / scale + center.x, v.x), v.x + v.w)
  const uy = Math.min(Math.max((y - scene.height / 2) / scale + center.y, v.y), v.y + v.h)
  return { x: (ux - r.x) / r.w, y: (uy - r.y) / r.h }
}

/** Output pixel where normalized screen point (nx, ny) lands in the (possibly zoomed) frame. */
export function outputPoint(scene: Scene, nx: number, ny: number): { x: number; y: number } | null {
  const r = scene.screen?.rect
  if (!r) return null
  const { center, scale } = scene.view
  return { x: (r.x + nx * r.w - center.x) * scale + scene.width / 2, y: (r.y + ny * r.h - center.y) * scale + scene.height / 2 }
}

/** A crop handle: an edge or corner by compass point, or the whole crop. */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

/** Crop `r0` (recording px) with `handle` dragged by (dx, dy): moved, or resized from the opposite
 *  edge or corner (from the center with `center`), keeping w/h = `ratio` when it is set, at least
 *  `min` px a side, inside the W x H recording. Whole px. */
export function dragCrop(r0: Rect, handle: CropHandle, dx: number, dy: number, o: { W: number; H: number; ratio: number; center: boolean; min: number }): Rect {
  const { W, H, ratio, center } = o
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))
  const whole = (r: Rect) => {
    const w = clamp(Math.round(r.w), 1, W), h = clamp(Math.round(r.h), 1, H)
    return { x: clamp(Math.round(r.x), 0, W - w), y: clamp(Math.round(r.y), 0, H - h), w, h }
  }
  if (handle === 'move') return whole({ ...r0, x: r0.x + dx, y: r0.y + dy })
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0
  // The anchor stays put: the opposite edge, or the center along an axis that resizes both ways.
  const ax = sx && !center ? (sx > 0 ? r0.x : r0.x + r0.w) : r0.x + r0.w / 2
  const ay = sy && !center ? (sy > 0 ? r0.y : r0.y + r0.h) : r0.y + r0.h / 2
  const k = center ? 2 : 1
  let w = sx ? r0.w + k * sx * dx : r0.w
  let h = sy ? r0.h + k * sy * dy : r0.h
  if (ratio > 0) {
    // A corner follows the axis the pointer moved further along; an edge drives the other side.
    if (sx && (!sy || Math.abs(w - r0.w) >= Math.abs(h - r0.h) * ratio)) h = w / ratio
    else w = h * ratio
  }
  const room = (a: number, s: number, size: number) => (s && !center ? (s > 0 ? size - a : a) : 2 * Math.min(a, size - a))
  const maxW = ratio > 0 || sx ? room(ax, sx, W) : W
  const maxH = ratio > 0 || sy ? room(ay, sy, H) : H
  const min = Math.min(o.min, W, H)
  if (ratio > 0) {
    w = clamp(w, Math.max(min, min * ratio), Math.min(maxW, maxH * ratio))
    h = w / ratio
  } else {
    w = clamp(w, Math.min(min, maxW), maxW)
    h = clamp(h, Math.min(min, maxH), maxH)
  }
  const pos = (a: number, s: number, size: number, from: number, fixed: boolean) => (fixed ? from : s && !center ? (s > 0 ? a : a - size) : a - size / 2)
  return whole({ x: pos(ax, sx, w, r0.x, !sx && !(ratio > 0)), y: pos(ay, sy, h, r0.y, !sy && !(ratio > 0)), w, h })
}

/** Background removal or face follow is on, but the camera analysis they need (matte and face track)
 *  is missing: it was interrupted by quitting, it failed, or the project predates it. */
export function owesCameraAnalysis(p: Project | null): boolean {
  const cam = p?.sources.camera
  return !!cam && !(cam.matte && cam.faces) && (p!.style.camera.removeBackground || p!.style.camera.followFace)
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
  EACCES: 'Grip does not have permission to open it.',
  EPERM: 'Grip does not have permission to open it.',
  ENOSPC: 'The disk is full.',
  EROFS: 'The disk is read-only.',
}

/** A one-line, plain-language reason for an error. IPC errors arrive as "Error invoking remote method 'x':
 *  Error: <reason>", and Node file errors as "ENOENT: no such file or directory, open '<path>'". */
export function reason(e: unknown): string {
  const msg = String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
  return CODES[/^(E[A-Z]+):/.exec(msg)?.[1] ?? ''] ?? msg
}
