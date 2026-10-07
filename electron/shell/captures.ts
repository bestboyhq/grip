// Recent Captures: the last screenshots and recordings, newest first, in <userData>/captures.json.
// The menu bar menu and the toolbar's gear menu list them; each reopens its result card.
// A screenshot that went to the clipboard lives in <userData>/Screenshots ($TMPDIR gets purged)
// while the list points at it. One on the Desktop is the user's: never deleted.
import electron from 'electron'
import type { NativeImage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Project } from '../../src/shared/project.ts'

export interface Capture {
  kind: 'shot' | 'recording'
  path: string // the PNG, or the .grip bundle
  at: number // ms since epoch
}

export const KEEP = 5

/** `list` with `c` on top: once per path, KEEP at most. */
export const remember = (list: Capture[], c: Capture): Capture[] => [c, ...list.filter((x) => x.path !== c.path)].slice(0, KEEP)

/** Files in `dir` (Grip's screenshots) on `before` but not on `after`: they go. Files elsewhere are the user's. */
export const dropped = (before: Capture[], after: Capture[], dir: string): string[] =>
  before.filter((c) => dirname(c.path) === dir && !after.some((a) => a.path === c.path)).map((c) => c.path)

const file = () => join(electron.app.getPath('userData'), 'captures.json')
export const shotsDir = () => join(electron.app.getPath('userData'), 'Screenshots')

/** The list as saved. */
function read(): Capture[] {
  let list: unknown
  try {
    list = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {}
  if (!Array.isArray(list)) return []
  return list.filter((c) => (c?.kind === 'shot' || c?.kind === 'recording') && typeof c.path === 'string' && typeof c.at === 'number')
}

/** The list, minus captures whose file is gone (deleted, trashed, renamed in Finder). */
export const captures = () => read().filter((c) => existsSync(c.path))

/** Never throws: a full disk costs the history, not the capture. */
function save(before: Capture[], after: Capture[]) {
  try {
    const tmp = file() + '.tmp'
    mkdirSync(dirname(tmp), { recursive: true })
    writeFileSync(tmp, JSON.stringify(after))
    renameSync(tmp, file()) // atomic: a crash leaves the old list or the new one
    for (const f of dropped(before, after, shotsDir())) rmSync(f, { force: true })
  } catch (e) {
    console.warn('[captures] not saved:', (e as Error).message)
  }
}

export function addCapture(c: Capture) {
  const list = captures()
  save(list, remember(list, c))
}

/** A capture moved: a project renamed, a screenshot saved to the Desktop. */
export function moveCapture(from: string, to: string) {
  const list = read() // a renamed project is gone from `from` already
  if (list.some((c) => c.path === from)) save(list, list.map((c) => (c.path === from ? { ...c, path: to } : c)))
}

// ---- Menu rows ----

const thumbs = new Map<string, NativeImage>() // by path: a capture's pictures never change

/** A 32×20 pt thumbnail (16:10, cropped to fill so every label lines up), drawn at 2×. */
function thumbnail(img: NativeImage): NativeImage {
  const { width: w, height: h } = img.getSize()
  if (!w || !h) return img
  const cw = Math.min(w, Math.round((h * 16) / 10))
  const ch = Math.min(h, Math.round((w * 10) / 16))
  const small = img.crop({ x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), width: cw, height: ch }).resize({ width: 64, height: 40, quality: 'best' })
  return electron.nativeImage.createFromBuffer(small.toPNG(), { scaleFactor: 2 })
}

/** "00:24", "1:02:03", as the result card shows a duration. */
function clock(t: number): string {
  const s = Math.floor(t)
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
}

/** "10:27" today, "Oct 6, 10:27" before. */
function when(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

/** One row per capture: "Screenshot, 10:27", "Recording (00:24), 10:27" (a renamed one by its name), and a thumbnail. */
export async function captureRows(): Promise<Array<{ path: string; label: string; icon: NativeImage }>> {
  return Promise.all(
    captures().map(async (c) => {
      if (c.kind === 'shot') {
        if (!thumbs.has(c.path)) thumbs.set(c.path, thumbnail(electron.nativeImage.createFromPath(c.path)))
        return { path: c.path, label: `Screenshot, ${when(c.at)}`, icon: thumbs.get(c.path)! }
      }
      const sources = await readFile(join(c.path, 'project.json'), 'utf8').then((s) => (JSON.parse(s) as Project).sources, () => null)
      const name = basename(c.path, '.grip')
      const label = `${/^Recording \d{4}-\d\d-\d\d at /.test(name) ? 'Recording' : name}${sources?.duration ? ` (${clock(sources.duration)})` : ''}, ${when(c.at)}`
      // Quick Look's frame of the video, asked for at the video's own aspect (it stretches to the size asked).
      const v = sources?.screen ?? sources?.camera
      if (!thumbs.has(c.path) && v?.width && v.height) {
        const frame = await electron.nativeImage.createThumbnailFromPath(join(c.path, v.file), { width: 160, height: Math.round((160 * v.height) / v.width) }).catch(() => null)
        if (frame) thumbs.set(c.path, thumbnail(frame))
      }
      return { path: c.path, label, icon: thumbs.get(c.path) ?? electron.nativeImage.createEmpty() }
    }),
  )
}
