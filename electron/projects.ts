// Owner: projects. Bundle lifecycle and the "projects:*" IPC channels. A bundle is a folder
// `<name>.studio/` holding sources/ (immutable raw recordings), project.json (the edit document),
// project.json.bak (the previous save), thumbnail.png, and assets/ (preset images, LUTs).
//
//   projects:open(path) -> { project, path }  migrated + validated; path follows in-app renames;
//                                             an interrupted recording is rebuilt first
//   projects:save(path, project)              validated, atomic, keeps project.json.bak; `sources`
//                                             already on disk win (main-side domains own them)
//   projects:recovered() -> Recovered[]       interrupted recordings rebuilt at launch
//   projects:import(file?) -> path | null     .mp4/.mov into a new bundle (no file: open dialog)
//   projects:thumbnail(path, png)             thumbnail.png + Finder icon (editor sends PNG bytes)
//   projects:recent() -> RecentProject[]      most recent first
//   projects:rename(path, name) -> { path, name }   unique within the folder
//   projects:remove(path)                     moves the bundle to the Trash
//   projects:presets:*                        see ./presets.ts
// Event to all windows: projects:sources(path, sources) after a main-side updateProject().
//
// Other main-process domains import the helpers below; keep their signatures.
import electron from 'electron'
import { execFile } from 'node:child_process'
import { constants, existsSync } from 'node:fs'
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { createProject, type Project, type Sources } from '../src/shared/project.ts'
import { migrate, newerError, validateProject } from '../src/shared/migrate.ts'
import { registerPresets } from './presets.ts'

export interface Recovered {
  path: string
  name: string
  duration: number
}

export interface RecentProject {
  path: string
  name: string
  duration: number // source seconds
  modified: number // ms since epoch, last save
  thumbnail: string | null // absolute path to thumbnail.png
}

/** Folder where new recordings and imports land: ~/Movies/Studio, per worktree in dev (main.ts). */
export function projectsDir(): string {
  const { app } = electron
  return app.isPackaged ? join(app.getPath('videos'), 'Studio') : join(app.getPath('userData'), 'Projects')
}

/** Create `<dir>/<unique name>.studio/sources/` and return the bundle path. The name is sanitized
 *  for the file system; read it back with `basename(path, '.studio')`. */
export async function createBundle(name: string, dir = projectsDir()): Promise<string> {
  await mkdir(dir, { recursive: true })
  const [path] = await claim(dir, sanitizeName(name))
  await mkdir(join(path, 'sources'))
  return path
}

/** Atomic save that keeps the previous version as project.json.bak. */
export async function writeProject(bundle: string, project: Project): Promise<void> {
  validateProject(project)
  return locked(() => write(follow(bundle), project))
}

/** Read, migrate, and validate project.json, falling back to project.json.bak if it is damaged.
 *  The name follows the folder (renames in Finder), the playhead is clamped, and a missing
 *  background image or LUT falls back to the default. */
export async function readProject(bundle: string): Promise<Project> {
  bundle = follow(bundle)
  const file = join(bundle, 'project.json')
  let p: Project
  try {
    p = migrate(JSON.parse(await readFile(file, 'utf8')))
  } catch (e) {
    if ((e as { code?: string }).code === 'ENEWER') throw newerError(basename(bundle, '.studio')) // never fall back to an older version
    try {
      p = migrate(JSON.parse(await readFile(file + '.bak', 'utf8')))
      console.warn(`[projects] ${file} unreadable (${(e as Error).message}), opened the backup`)
    } catch {
      throw (e as { code?: string }).code === 'ENOENT' ? new Error(`“${basename(bundle, '.studio')}” has no project file.`) : e
    }
  }
  p.name = basename(bundle, '.studio')
  p.playhead = Math.min(Math.max(p.playhead, 0), p.sources.duration)
  const missing = (rel: string) => access(join(bundle, rel)).then(() => false, () => true)
  if (p.style.background.kind === 'image' && (await missing(p.style.background.file))) p.style.background = createProject('', p.sources).style.background
  if (p.style.camera.lut && (await missing(p.style.camera.lut))) delete p.style.camera.lut
  return p
}

/** The editor's save (projects:save): `sources` already on disk win over the editor's copy, so a
 *  main-side updateProject() (camera matte, transcript) is never undone by a stale autosave. */
export async function saveProject(bundle: string, project: Project): Promise<void> {
  validateProject(project)
  return locked(async () => {
    const b = follow(bundle)
    const disk = await readFile(join(b, 'project.json'), 'utf8').then((j) => migrate(JSON.parse(j)), () => null)
    await write(b, disk ? { ...project, sources: { ...project.sources, ...disk.sources } } : project)
  })
}

/** Read-modify-write for main-side domains (camera analysis, transcription) that patch a project
 *  while the editor may be saving it. Open editors get the new sources via `projects:sources`. */
export function updateProject(bundle: string, fn: (p: Project) => void): Promise<Project> {
  return locked(async () => {
    const b = follow(bundle)
    const p = await readProject(b)
    fn(p)
    await write(b, validateProject(p))
    for (const w of electron.BrowserWindow?.getAllWindows() ?? []) w.webContents.send('projects:sources', b, p.sources)
    return p
  })
}

/** Write `data` to `file` so a crash at any instant leaves either the old or the new content:
 *  temp file in the same folder, fsync (F_FULLFSYNC on macOS), rename, fsync the folder.
 *  Callers serialize writes to the same file (the temp name is fixed so crashes leave no litter). */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = file + '.tmp'
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, file)
  const dir = await open(dirname(file), 'r')
  await dir.sync().catch(() => {}) // some file systems refuse to sync a directory
  await dir.close()
}

/** A name safe for a folder: no path separators, control characters, or leading dots, NFC, and at
 *  most 200 UTF-8 bytes (APFS allows 255, leaving room for " 2.studio"). */
export function sanitizeName(name: string): string {
  const s = name.normalize('NFC').replace(/[/:]/g, '-').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^[.\s]+/, '')
  let out = ''
  for (const { segment } of new Intl.Segmenter().segment(s)) {
    if (Buffer.byteLength(out + segment) > 200) break
    out += segment
  }
  return out.trim() || 'Untitled'
}

/** Rename a bundle in place; a taken name gets " 2", " 3"... Returns the new path. The project's
 *  name is the folder's name (readProject), so project.json needs no rewrite. */
export function renameBundle(bundle: string, name: string): Promise<string> {
  return locked(async () => {
    const from = follow(bundle)
    const [to, made] = await claim(dirname(from), sanitizeName(name), from)
    if (to === from) return to
    try {
      await rename(from, to) // replaces the empty folder claim() made
    } catch (e) {
      if (made) await rmdir(to).catch(() => {})
      throw e
    }
    moved.delete(to)
    moved.set(from, to)
    return to
  })
}

/** Rebuild project.json for every bundle in `dir` that has sources but no project (a recording
 *  that was interrupted by a crash or power loss). */
export async function recoverBundles(dir = projectsDir()): Promise<Recovered[]> {
  const out: Recovered[] = []
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !e.name.endsWith('.studio')) continue
    const bundle = join(dir, e.name)
    if (await exists(join(bundle, 'project.json'))) continue
    try {
      const p = await rebuildProject(bundle)
      if (p) out.push({ path: bundle, name: p.name, duration: p.sources.duration })
    } catch (err) {
      console.error(`[projects] could not recover ${bundle}:`, err)
    }
  }
  return out
}

/** project.json from what is on disk: the backup if there is one, else probed sources. Null when
 *  there is nothing playable. */
export async function rebuildProject(bundle: string): Promise<Project | null> {
  const bak = await readFile(join(bundle, 'project.json.bak'), 'utf8').then((j) => migrate(JSON.parse(j)), () => null)
  if (bak) {
    await writeProject(bundle, bak)
    return bak
  }
  const files = await readdir(join(bundle, 'sources')).catch(() => [] as string[])
  const media = async (stem: string) => {
    const f = files.find((f) => /\.(mp4|mov|m4a|caf|wav)$/i.test(f) && f.slice(0, f.lastIndexOf('.')) === stem)
    const info = f && (await probe(join(bundle, 'sources', f)).catch(() => null))
    return info ? { file: `sources/${f}`, ...info } : null
  }
  const [screen, camera, mic, system] = await Promise.all(['screen', 'camera', 'mic', 'system'].map(media))
  const found = [screen, camera, mic, system].filter((m) => m !== null)
  if (!found.length) return null
  // ponytail: display scale of the primary display; a recording on a secondary display with another
  // scale gets the wrong one. Upgrade: recording writes project.json (or a sidecar) at start.
  const scale = electron.screen?.getPrimaryDisplay().scaleFactor ?? 2
  const video = (m: typeof screen, scale: number) => m?.video && { file: m.file, width: m.video.width, height: m.video.height, fps: m.video.fps, scale }
  const audio = (m: typeof mic) => m?.audio && { file: m.file, channels: m.audio.channels, sampleRate: m.audio.sampleRate }
  const sources: Sources = { duration: Math.max(...found.map((m) => m.duration)) }
  if (video(screen, scale)) sources.screen = video(screen, scale)!
  if (video(camera, 1)) sources.camera = video(camera, 1)!
  if (audio(mic)) sources.mic = audio(mic)!
  if (audio(system)) sources.system = audio(system)!
  if (files.includes('events.jsonl')) sources.events = 'sources/events.jsonl'
  if (files.includes('transcript.json')) sources.transcript = 'sources/transcript.json'
  const p = createProject(basename(bundle, '.studio'), sources)
  p.createdAt = (await stat(bundle)).birthtime.toISOString()
  await writeProject(bundle, p)
  return p
}

/** Import an .mp4 or .mov as a new project: the file is cloned in (instant on APFS), its video is
 *  the screen source and its audio track the mic. Returns the bundle path. */
export async function importVideo(file: string, dir = projectsDir()): Promise<string> {
  const ext = extname(file).toLowerCase()
  const label = `“${basename(file)}”`
  if (ext !== '.mp4' && ext !== '.mov') throw new Error(`Studio imports .mp4 and .mov videos, not ${label}.`)
  const info = await probe(file).catch((e) => {
    throw new Error(e.code === 'ENOENT' ? `${label} was not found.` : `Studio can't read ${label}. It may be damaged or in an unsupported format.`)
  })
  if (!info?.video) throw new Error(`${label} has no video track.`)
  if (!['avc', 'hevc', 'vp8', 'vp9', 'av1'].includes(info.video.codec ?? '')) {
    throw new Error(`${label} uses a video codec Studio can't play (${info.video.codec ?? 'unknown'}). Convert it to H.264 or HEVC first.`)
  }
  const bundle = await createBundle(basename(file, extname(file)), dir)
  try {
    const rel = `sources/screen${ext}`
    // Via a .part name, so a crash mid-copy never looks like a recording to recover.
    await copyFile(file, join(bundle, rel + '.part'), constants.COPYFILE_FICLONE)
    await rename(join(bundle, rel + '.part'), join(bundle, rel))
    const { width, height, fps } = info.video
    const p = createProject(basename(bundle, '.studio'), {
      duration: info.duration,
      screen: { file: rel, width, height, fps, scale: 1 },
      ...(info.audio && { mic: { file: rel, ...info.audio } }),
      imported: true,
    })
    p.audio.mic.enhance = false // already-mixed audio: do not run the voice chain on it
    await writeProject(bundle, p)
  } catch (e) {
    await rm(bundle, { recursive: true, force: true })
    throw (e as { code?: string }).code === 'ENOSPC' ? new Error(`Not enough free disk space to import ${label}.`) : e
  }
  return bundle
}

/** Save the editor's PNG as thumbnail.png and show it as the bundle's Finder icon. */
export async function saveThumbnail(bundle: string, png: Uint8Array): Promise<void> {
  if (!(png instanceof Uint8Array) || png.length > 32 << 20 || !PNG.every((b, i) => png[i] === b)) throw new Error('Thumbnail must be a PNG under 32 MB.')
  const file = await locked(async () => {
    const f = join(follow(bundle), 'thumbnail.png')
    await writeFileAtomic(f, png)
    return f
  })
  // Package bit: Finder shows the bundle as one document. Custom icon: its thumbnail, aspect-fit.
  // Quick Look (space bar) on a package shows that icon large. A playable Quick Look preview needs a
  // Quick Look extension inside a signed app.
  await new Promise<void>((done) =>
    execFile('osascript', ['-l', 'JavaScript', '-e', FINDER_ICON, dirname(file), file], (err) => {
      if (err) console.warn('[projects] Finder icon not set:', err.message)
      done()
    }),
  )
}

const FINDER_ICON = `ObjC.import('AppKit')
function run([dir, png]) {
  $.NSURL.fileURLWithPath(dir).setResourceValueForKeyError($.NSNumber.numberWithBool(true), $.NSURLIsPackageKey, null)
  const src = $.NSImage.alloc.initWithContentsOfFile(png)
  if (src.isNil()) return
  const S = 1024, k = Math.min(S / src.size.width, S / src.size.height), w = src.size.width * k, h = src.size.height * k
  const r = $.NSMakeRect((S - w) / 2, (S - h) / 2, w, h)
  const icon = $.NSImage.alloc.initWithSize($.NSMakeSize(S, S))
  icon.lockFocus
  const path = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(r, S / 48, S / 48)
  path.addClip
  src.drawInRectFromRectOperationFraction(r, $.NSZeroRect, $.NSCompositingOperationSourceOver, 1)
  $.NSColor.colorWithWhiteAlpha(0, 0.15).setStroke // hairline edge, so white frames do not melt into Finder
  path.lineWidth = 4
  path.stroke
  icon.unlockFocus
  $.NSWorkspace.sharedWorkspace.setIconForFileOptions(icon, dir, 0)
}`
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// ---- Recent projects: <userData>/recent.json, absolute bundle paths, most recent first. ----

const recentFile = () => join(electron.app.getPath('userData'), 'recent.json')

async function readRecent(file: string): Promise<string[]> {
  const list = await readFile(file, 'utf8').then(JSON.parse, () => [])
  return Array.isArray(list) ? list.filter((p) => typeof p === 'string') : []
}

export function updateRecent(fn: (list: string[]) => string[], file = recentFile()): Promise<void> {
  return locked(async () => {
    await mkdir(dirname(file), { recursive: true })
    await writeFileAtomic(file, JSON.stringify(fn(await readRecent(file)).slice(0, 30)))
  })
}

/** Recent projects that still exist. A missing one (unplugged drive) is skipped, not forgotten. */
export async function recentProjects(file = recentFile()): Promise<RecentProject[]> {
  const out: RecentProject[] = []
  for (const path of await readRecent(file)) {
    try {
      const json = join(path, 'project.json')
      const [p, s, thumb] = await Promise.all([readFile(json, 'utf8').then(JSON.parse), stat(json), exists(join(path, 'thumbnail.png'))])
      out.push({ path, name: basename(path, '.studio'), duration: p.sources.duration, modified: s.mtimeMs, thumbnail: thumb ? join(path, 'thumbnail.png') : null })
    } catch {}
  }
  return out
}

// ---- Internals ----

/** Atomic save of `project` that first copies the current project.json (if valid) to .bak.
 *  Callers hold the lock. */
async function write(bundle: string, project: Project) {
  const file = join(bundle, 'project.json')
  const old = await readFile(file, 'utf8').catch(() => null)
  try {
    if (old && parses(old)) await writeFileAtomic(file + '.bak', old)
    await writeFileAtomic(file, JSON.stringify(project, null, 2))
  } catch (e) {
    if ((e as { code?: string }).code !== 'ENOENT') throw e
    throw new Error(`“${basename(bundle, '.studio')}” was moved or deleted, so its edits can't be saved.`)
  }
}

let chain: Promise<unknown> = Promise.resolve()
/** Runs bundle writes one at a time, in call order. Never call locked() inside locked().
 *  ponytail: one global queue; per-bundle queues (keyed across renames) if many projects save at once. */
export function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  chain = run.catch(() => {})
  return run
}

/** Bundles renamed in this session: a save or open addressed to the old path follows the move. */
const moved = new Map<string, string>()
function follow(path: string): string {
  while (moved.has(path) && !existsSync(path)) path = moved.get(path)!
  return path
}

/** mkdir `<dir>/<base>.studio`, or `<base> 2.studio`, `<base> 3.studio`... when taken. mkdir is
 *  atomic, so concurrent callers never share a name. `self` (a rename) may keep its own name,
 *  including a case- or normalization-only change. */
async function claim(dir: string, base: string, self?: string): Promise<[path: string, made: boolean]> {
  for (let i = 1; ; i++) {
    const path = join(dir, `${i === 1 ? base : `${base} ${i}`}.studio`)
    if (path === self) return [path, false]
    try {
      await mkdir(path)
      return [path, true]
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e
      if (self && (await stat(path)).ino === (await stat(self)).ino) return [path, false]
    }
  }
}

type Probe = {
  duration: number
  video: { codec: string | null; width: number; height: number; fps: number } | null
  audio: { channels: number; sampleRate: number } | null
}
/** Duration and track info of a media file, read with mediabunny. Null when it has no tracks (for
 *  example an MP4 cut off before its index was written). */
async function probe(file: string): Promise<Probe | null> {
  await access(file)
  const { Input, ALL_FORMATS, FilePathSource } = await import('mediabunny')
  const input = new Input({ source: new FilePathSource(file), formats: ALL_FORMATS })
  try {
    const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()])
    if (!v && !a) return null
    const fps = v ? (await v.computeFrameRateMetrics()).bestGuessFrameRate : 0
    return {
      duration: await input.computeDuration(),
      video: v && { codec: v.codec, width: v.displayWidth, height: v.displayHeight, fps: fps > 0 ? Math.round(fps * 1000) / 1000 : 30 },
      audio: a && { channels: a.numberOfChannels, sampleRate: a.sampleRate },
    }
  } finally {
    input.dispose()
  }
}

const exists = (path: string) => access(path).then(() => true, () => false)
const parses = (json: string) => {
  try {
    JSON.parse(json)
    return true
  } catch {
    return false
  }
}

/** A bundle path from IPC: absolute, ends in .studio, following in-app renames. */
export function bundleArg(path: unknown): string {
  const p = typeof path === 'string' && isAbsolute(path) ? resolve(path) : ''
  if (!p.endsWith('.studio')) throw new Error(`Not a Studio project: ${String(path)}`)
  return follow(p)
}

export function registerProjects() {
  const { app, ipcMain, dialog, shell, BrowserWindow } = electron
  // Snapshot interrupted recordings now, before anything can start a new one.
  const recovered = recoverBundles().catch((e) => (console.error('[projects] recovery failed:', e), [] as Recovered[]))
  const opened = (path: string) => {
    app.addRecentDocument(path)
    return updateRecent((l) => [path, ...l.filter((p) => p !== path)])
  }

  ipcMain.handle('projects:open', async (_e, path: unknown) => {
    const bundle = bundleArg(path)
    const name = `“${basename(bundle, '.studio')}”`
    if (!(await exists(bundle))) throw new Error(`${name} was not found. It may have been moved or deleted.`)
    const project = (await exists(join(bundle, 'project.json'))) ? await readProject(bundle) : await rebuildProject(bundle)
    if (!project) throw new Error(`${name} has no project file and no recording to recover.`)
    await opened(bundle)
    return { project, path: bundle }
  })
  ipcMain.handle('projects:save', (_e, path: unknown, project: unknown) => saveProject(bundleArg(path), project as Project))
  ipcMain.handle('projects:recovered', () => recovered)
  ipcMain.handle('projects:import', async (e, file?: unknown) => {
    if (file === undefined) {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = { properties: ['openFile' as const], filters: [{ name: 'Videos', extensions: ['mp4', 'mov'] }] }
      const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
      if (r.canceled || !r.filePaths[0]) return null
      file = r.filePaths[0]
    }
    if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('Import needs an absolute file path.')
    return importVideo(file)
  })
  ipcMain.handle('projects:thumbnail', (_e, path: unknown, png: unknown) =>
    saveThumbnail(bundleArg(path), png instanceof ArrayBuffer ? new Uint8Array(png) : (png as Uint8Array)),
  )
  ipcMain.handle('projects:recent', () => recentProjects())
  ipcMain.handle('projects:rename', async (_e, path: unknown, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('A project needs a name.')
    const from = bundleArg(path)
    const to = await renameBundle(from, name)
    if (to !== from) await updateRecent((l) => l.map((p) => (p === from ? to : p)))
    return { path: to, name: basename(to, '.studio') }
  })
  ipcMain.handle('projects:remove', async (_e, path: unknown) => {
    const bundle = bundleArg(path)
    if (!(await stat(bundle).catch(() => null))?.isDirectory()) throw new Error(`“${basename(bundle, '.studio')}” was not found.`)
    await locked(() => shell.trashItem(bundle))
    await updateRecent((l) => l.filter((p) => p !== bundle))
  })
  registerPresets()
}
