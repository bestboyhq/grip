// Owner: export. The export queue and the "export:*" IPC channels.
// Each job runs in its own hidden window (#/export?job=<id>), so a crash there cannot take down the
// editor and editing stays responsive. Jobs run one at a time, unattended, with a notification when
// the queue drains. The window streams the file here through export:write: positioned writes into
// a hidden ".<name>.partial" beside the destination, renamed into place only once complete.
//
// Editor and project list:
//   export:enqueue(ExportRequest[]) -> JobInfo[] | null   asks for every destination first; null = canceled
//   export:list() -> JobInfo[]       export:cancel(id)    export:reveal(id)    export:clear()
//   event export:update(JobInfo) on every change
// Export window (only the job's own window may call these):
//   export:job(id) -> JobSpec    export:write(id, position, bytes)    export:progress(id, p, phase)
//   export:done(id, size) -> { upload?: path }    export:shared(id, url)    export:fail(id, message)
import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent } from 'electron'
import { open, mkdir, readdir, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openWindow } from './windows.ts'
import { readProject } from './projects.ts'
import type { Project } from '../src/shared/project.ts'
import { cleanOptions, safeFileName, uniqueName, type ExportRequest, type JobInfo, type JobSpec, type JobState } from '../src/engine/export/options.ts'

interface Job extends JobInfo {
  project?: Project // dropped once the job ends
  win?: BrowserWindow
  fh?: FileHandle
  tmp?: string // partial file, deleted unless renamed into place
  writes: Promise<unknown>
}

const jobs = new Map<string, Job>()
let running: Job | undefined
let batch = { done: 0, failed: 0, last: undefined as Job | undefined }
let lastDir = ''
const tmpRoot = () => join(app.getPath('temp'), 'Studio Exports')
const active = (j: Job) => j.state === 'queued' || j.state === 'running' || j.state === 'uploading'

/** Exports queued or in progress, for the quit prompt. */
export const activeExports = () => [...jobs.values()].filter(active).length

function info(j: Job): JobInfo {
  const { id, name, bundle, options, dest, path, state, progress, phase, error, url, bytes, startedAt, finishedAt } = j
  return { id, name, bundle, options, dest, path, state, progress, phase, error, url, bytes, startedAt, finishedAt }
}

function broadcast(j: Job) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== j.win) w.webContents.send('export:update', info(j))
}

/** The job whose own export window sent this message. */
function own(e: IpcMainInvokeEvent, id: string): Job {
  const j = jobs.get(id)
  if (!j || !j.win || j.win.isDestroyed() || j.win.webContents !== e.sender) throw new Error('Not an active export.')
  return j
}

function fsMessage(err: unknown, path: string): string {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return 'The disk is full. Free up some space and export again.'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return `Studio cannot write to “${dirname(path)}”. Choose another folder.`
  if (code === 'ENOENT') return `The folder “${dirname(path)}” no longer exists.`
  return err instanceof Error ? err.message : String(err)
}

async function finish(j: Job, state: JobState, error?: string) {
  if (!active(j)) return
  Object.assign(j, { state, error, finishedAt: Date.now(), project: undefined }, state === 'done' && { progress: 1, phase: 'Done' })
  const win = j.win
  j.win = undefined
  if (win && !win.isDestroyed()) win.destroy()
  await j.writes.catch(() => {})
  await j.fh?.close().catch(() => {})
  j.fh = undefined
  if (j.tmp) await rm(j.tmp, { force: true }).catch(() => {})
  j.tmp = undefined
  if (state === 'done') batch.done++
  if (state === 'failed') batch.failed++
  if (state !== 'canceled') batch.last = j
  if (running === j) running = undefined
  broadcast(j)
  void pump()
}

async function pump() {
  if (running) return
  const j = [...jobs.values()].find((x) => x.state === 'queued')
  if (!j) return notify()
  running = j
  try {
    await mkdir(dirname(j.path), { recursive: true })
    j.tmp = join(dirname(j.path), `.${basename(j.path)}.partial`)
    j.fh = await open(j.tmp, 'w')
  } catch (err) {
    return finish(j, 'failed', fsMessage(err, j.path))
  }
  Object.assign(j, { state: 'running', phase: 'Starting', startedAt: Date.now() })
  const win = (j.win = openWindow(`export?job=${encodeURIComponent(j.id)}`, { show: false, width: 480, height: 320, webPreferences: { backgroundThrottling: false } }))
  win.webContents.on('render-process-gone', (_e, d) => void finish(j, 'failed', `The export stopped unexpectedly (${d.reason}).`))
  win.on('closed', () => void finish(j, 'failed', 'The export window closed.'))
  broadcast(j)
}

/** Unattended exports end with a notification; a single export with Studio in front does not. */
function notify() {
  const { done, failed, last } = batch
  batch = { done: 0, failed: 0, last: undefined }
  if (done + failed === 0 || (done + failed === 1 && BrowserWindow.getFocusedWindow()) || !Notification.isSupported()) return
  const j = last!
  const body =
    done + failed > 1 ? (failed ? `${done} finished, ${failed} failed.` : `${done} exports are ready.`)
    : failed ? `“${j.name}”: ${j.error}`
    : j.url ? `The link to “${j.name}” is ready.`
    : `“${basename(j.path)}” is ready.`
  const n = new Notification({ title: failed ? 'Export finished with errors' : 'Export finished', body })
  n.on('click', () => {
    if (j.url) void shell.openExternal(j.url)
    else if (existsSync(j.path)) shell.showItemInFolder(j.path)
  })
  n.show()
}

/** Resolve every destination up front (one save dialog, or one folder for many files), so the
 *  queue then runs without asking anything. Returns false when the user cancels. */
async function chooseFiles(parent: BrowserWindow | null, items: Array<{ name: string; ext: string; path?: string }>): Promise<boolean> {
  const desktop = app.getPath('desktop')
  if (items.length === 1) {
    const it = items[0]
    const opts = { defaultPath: join(lastDir || desktop, `${safeFileName(it.name)}.${it.ext}`), filters: [{ name: it.ext.toUpperCase(), extensions: [it.ext] }] }
    const res = await (parent ? dialog.showSaveDialog(parent, opts) : dialog.showSaveDialog(opts))
    if (res.canceled || !res.filePath) return false
    it.path = res.filePath
  } else if (items.length > 1) {
    const opts = { defaultPath: lastDir || desktop, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, buttonLabel: 'Export Here', message: `Choose a folder for ${items.length} exports` }
    const res = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts))
    if (res.canceled || !res.filePaths[0]) return false
    const dir = res.filePaths[0]
    const taken = new Set<string>()
    for (const it of items) {
      const name = uniqueName(safeFileName(it.name), it.ext, (f) => taken.has(f) || existsSync(join(dir, f)))
      taken.add(name)
      it.path = join(dir, name)
    }
  }
  if (items.length) lastDir = dirname(items[items.length - 1].path!)
  return true
}

/** Clipboard and share exports land in a per-job temp folder, so the file keeps the project's name. */
async function sweepTemp() {
  const root = tmpRoot()
  for (const d of await readdir(root).catch(() => [])) {
    const p = join(root, d)
    const s = await stat(p).catch(() => null)
    if (s && Date.now() - s.mtimeMs > 864e5) await rm(p, { recursive: true, force: true }).catch(() => {})
  }
}

export function registerExport() {
  void sweepTemp()
  app.on('will-quit', () => {
    for (const j of jobs.values()) if (j.tmp) rmSync(j.tmp, { force: true })
  })

  ipcMain.handle('export:enqueue', async (e, reqs: ExportRequest[]) => {
    if (!Array.isArray(reqs)) throw new Error('export:enqueue expects a list of requests.')
    const items = await Promise.all(
      reqs.map(async (r) => {
        if (typeof r?.bundle !== 'string' || !isAbsolute(r.bundle)) throw new Error('Export needs the absolute path of a project.')
        if (r.path !== undefined && (typeof r.path !== 'string' || !isAbsolute(r.path))) throw new Error('Export paths must be absolute.')
        const project = r.project ?? (await readProject(r.bundle))
        const options = cleanOptions(r.options)
        const dest = (['file', 'clipboard', 'share'] as const).includes(r.dest) ? r.dest : 'file'
        return { project, options, dest, bundle: r.bundle, name: project.name || basename(r.bundle, '.studio'), ext: options.format, path: r.path }
      }),
    )
    if (!(await chooseFiles(BrowserWindow.fromWebContents(e.sender), items.filter((it) => it.dest === 'file' && !it.path)))) return null
    const out = items.map((it) => {
      const id = crypto.randomUUID()
      const path = it.path ?? join(tmpRoot(), id, `${safeFileName(it.name)}.${it.ext}`)
      const j: Job = { id, name: it.name, bundle: it.bundle, options: it.options, dest: it.dest, path, project: it.project, state: 'queued', progress: 0, phase: 'Waiting', writes: Promise.resolve() }
      jobs.set(id, j)
      broadcast(j)
      return info(j)
    })
    void pump()
    return out
  })

  ipcMain.handle('export:list', () => [...jobs.values()].map(info))

  ipcMain.handle('export:cancel', (_e, id: string) => {
    const j = jobs.get(id)
    if (j) return finish(j, 'canceled')
  })

  ipcMain.handle('export:reveal', (_e, id: string) => {
    const j = jobs.get(id)
    if (j && existsSync(j.path)) shell.showItemInFolder(j.path)
  })

  ipcMain.handle('export:clear', () => {
    for (const [id, j] of jobs) if (!active(j)) jobs.delete(id)
  })

  ipcMain.handle('export:job', (e, id: string): JobSpec => {
    const j = own(e, id)
    return { ...info(j), project: j.project! }
  })

  ipcMain.handle('export:write', (e, id: string, position: number, data: Uint8Array) => {
    const j = own(e, id)
    const fh = j.fh
    if (!fh || !Number.isSafeInteger(position) || position < 0 || !(data instanceof Uint8Array)) throw new Error('Invalid export write.')
    const write = j.writes.then(() => fh.write(data, 0, data.byteLength, position))
    j.writes = write
    return write.then(
      () => undefined,
      (err) => {
        void finish(j, 'failed', fsMessage(err, j.path))
        throw err
      },
    )
  })

  ipcMain.handle('export:progress', (e, id: string, p: number, phase: string) => {
    const j = own(e, id)
    // Never backwards within a phase (a new GIF pass restarts its own). 1 is reserved for "complete
    // on disk" (export:done), so the bar never sits at 100% early.
    const fresh = typeof phase === 'string' && phase !== j.phase
    if (fresh) j.phase = phase.slice(0, 80)
    j.progress = Math.min(Math.max(Number(p) || 0, fresh ? 0 : j.progress), 0.99)
    broadcast(j)
  })

  ipcMain.handle('export:done', async (e, id: string, size?: number) => {
    const j = own(e, id)
    try {
      await j.writes
      const fh = j.fh!
      if (Number.isSafeInteger(size) && size! >= 0) await fh.truncate(size)
      await fh.datasync()
      await fh.close()
      j.fh = undefined
      await rename(j.tmp!, j.path)
      j.tmp = undefined
      j.bytes = (await stat(j.path)).size
      if (j.dest === 'clipboard') {
        // A file reference, like Finder's Copy: pasting into Finder, Slack, or Mail attaches the file.
        await clipboard.write([new ClipboardItem({ 'electron application/osclipboard;format="public.file-url"': new Blob([pathToFileURL(j.path).href]) })])
      }
      if (j.dest === 'share') {
        Object.assign(j, { state: 'uploading', phase: 'Uploading', progress: 1 })
        broadcast(j)
        return { upload: j.path }
      }
    } catch (err) {
      await finish(j, 'failed', fsMessage(err, j.path))
      throw err
    }
    await finish(j, 'done')
    return {}
  })

  ipcMain.handle('export:shared', (e, id: string, url: string) => {
    const j = own(e, id)
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return finish(j, 'failed', 'The upload finished without a link.')
    j.url = url
    return finish(j, 'done')
  })

  ipcMain.handle('export:fail', (e, id: string, message: string) => {
    const j = own(e, id)
    return finish(j, 'failed', String(message || 'The export failed.').slice(0, 500))
  })
}
