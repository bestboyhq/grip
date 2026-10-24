// Owner: export. The export queue and the "export:*" IPC channels.
// Each job runs in its own hidden window (#/export?job=<id>), so a crash there cannot take down the
// editor and editing stays responsive. Jobs run one at a time, unattended: the menu bar icon turns
// into a progress ring (electron/shell/tray.ts), and a notification says when the queue drains. The window streams the file here through export:write: positioned writes into
// a hidden ".<name>.partial" beside the destination, renamed into place only once complete.
//
// Editor:
//   export:enqueue(ExportRequest[]) -> JobInfo[] | null   asks for every destination not given; null = canceled
//   export:batch(ExportOptions) -> JobInfo[] | null       pick projects, then a folder, then export them all
//   export:list() -> JobInfo[]       export:cancel(id)    export:reveal(id)    export:clear()
//   event export:update(JobInfo) on every change
// Export window (only the job's own window may call these):
//   export:job(id) -> JobSpec    export:write(id, position, bytes)    export:progress(id, p, phase)
//   export:done(id, size)        export:fail(id, message)
// Share links: once the file is complete, main hands it to share:upload (electron/share.ts) and the
// queue moves on; the job is done when the link exists.
import { app, BrowserWindow, ClipboardItem, clipboard, dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { open, mkdir, readdir, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hidden, openWindow } from './windows.ts'
import { projectsDir, readProject } from './projects.ts'
import { accountToken, signIn } from './account.ts'
import { shareFile } from './share.ts'
import { ShareError } from './upload.ts'
import type { Project } from '../src/shared/project.ts'
import { DESTINATIONS, jobOptions, safeFileName, uniqueName, type ExportOptions, type ExportRequest, type JobInfo, type JobSpec, type JobState } from '../src/engine/export/options.ts'

interface Job extends JobInfo {
  project?: Project // dropped once the job ends
  win?: BrowserWindow
  fh?: FileHandle
  tmp?: string // partial file, deleted unless renamed into place
  writes: Promise<unknown>
  owner?: BrowserWindow // a quiet job's asking window: it shows the outcome, so no notification while it is open
}

const jobs = new Map<string, Job>()
let running: Job | undefined
let batch = { done: 0, failed: 0, last: undefined as Job | undefined }
let lastDir = ''
const tmpRoot = () => join(app.getPath('temp'), 'Grip Exports')
const active = (j: Job) => j.state === 'queued' || j.state === 'running' || j.state === 'uploading'
/** Exports still running or queued (the quit prompt asks before dropping them). Uploads are not
 *  counted: they carry on after a restart (electron/share.ts). */
export const activeExports = () => [...jobs.values()].filter((j) => j.state === 'queued' || j.state === 'running').length
/** Called with every job change: the menu bar icon follows the queue. */
export const exportListeners: Array<(j: JobInfo) => void> = []

/** The export in progress for the menu bar: its name, 0..1 (0 while it starts or waits), and how many
 *  wait behind it. null when nothing is queued or running. */
export function exportStatus(): { name: string; progress: number; waiting: number } | null {
  const list = [...jobs.values()].filter((j) => j.state === 'queued' || j.state === 'running')
  if (!list.length) return null
  const j = running?.state === 'running' ? running : list[0]
  return { name: j.name, progress: j.state === 'running' ? j.progress : 0, waiting: list.length - 1 }
}

/** The menu bar menu's rows while exports run: which one, how far, and Cancel. */
export function exportMenuItems(): MenuItemConstructorOptions[] {
  const s = exportStatus()
  if (!s) return []
  return [
    { label: `Exporting “${s.name}” · ${Math.floor(s.progress * 100)}%`, enabled: false },
    ...(s.waiting ? [{ label: `${s.waiting} more waiting`, enabled: false }] : []),
    {
      label: s.waiting ? 'Cancel All Exports' : 'Cancel Export',
      click: () => {
        for (const j of jobs.values()) if (j.state === 'queued' || j.state === 'running') void finish(j, 'canceled')
      },
    },
    { type: 'separator' },
  ]
}

function info(j: Job): JobInfo {
  const { id, name, bundle, options, dest, path, state, progress, phase, error, url, bytes, startedAt, finishedAt } = j
  return { id, name, bundle, options, dest, path, state, progress, phase, error, url, bytes, startedAt, finishedAt }
}

function broadcast(j: Job) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== j.win) w.webContents.send('export:update', info(j))
  for (const f of exportListeners) f(info(j))
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
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return `Grip cannot write to “${dirname(path)}”. Choose another folder.`
  if (code === 'ENOENT') return `The folder “${dirname(path)}” no longer exists.`
  return err instanceof Error ? err.message : String(err)
}

/** Close the job's window (stopping its work at once) and let the next job start. */
function release(j: Job) {
  const win = j.win
  j.win = undefined // before destroy: the window's 'closed' handler then knows it was us
  if (win && !win.isDestroyed()) win.destroy()
  if (running === j) running = undefined
  void pump()
}

async function finish(j: Job, state: JobState, error?: string) {
  if (!active(j)) return
  Object.assign(j, { state, error, finishedAt: Date.now(), project: undefined }, state === 'done' && { progress: 1, phase: 'Done' })
  release(j)
  await j.writes.catch(() => {})
  await j.fh?.close().catch(() => {})
  j.fh = undefined
  if (j.tmp) await rm(j.tmp, { force: true }).catch(() => {})
  j.tmp = undefined
  // The Share button's own exports (temp) report through the Share button, and a quiet job through
  // its window while that is open, not a notification.
  if (j.dest !== 'temp' && !(j.owner && !j.owner.isDestroyed() && j.owner.isVisible())) {
    if (state === 'done') batch.done++
    if (state === 'failed') batch.failed++
    if (state !== 'canceled') batch.last = j
  }
  broadcast(j)
  if (!running) notifyIfIdle()
}

async function pump() {
  if (running) return
  const j = [...jobs.values()].find((x) => x.state === 'queued')
  if (!j) return
  running = j
  try {
    await mkdir(dirname(j.path), { recursive: true })
    j.tmp = join(dirname(j.path), `.${basename(j.path)}.partial`)
    await writeFile(partialLog(), j.tmp).catch(() => {}) // before the partial exists; a finished export leaves a harmless stale line
    j.fh = await open(j.tmp, 'w')
  } catch (err) {
    return finish(j, 'failed', fsMessage(err, j.path))
  }
  Object.assign(j, { state: 'running', phase: 'Starting', startedAt: Date.now() })
  const win = (j.win = openWindow(`export?job=${encodeURIComponent(j.id)}`, { show: false, width: 480, height: 320, webPreferences: { backgroundThrottling: false } }))
  win.webContents.on('render-process-gone', (_e, d) => j.win === win && void finish(j, 'failed', `The export stopped unexpectedly (${d.reason}).`))
  win.on('closed', () => j.win === win && void finish(j, 'failed', 'The export window closed.'))
  broadcast(j)
}

let note: Notification | undefined // held: a collected notification no longer hears its click

/** Exports run unattended, so they end with a notification once nothing is left to do, Grip in
 *  front or not. A click shows the file, or opens the link. */
function notifyIfIdle() {
  if ([...jobs.values()].some(active)) return
  const { done, failed, last } = batch
  batch = { done: 0, failed: 0, last: undefined }
  if (hidden || done + failed === 0 || !Notification.isSupported()) return
  const j = last!
  const file = basename(j.path)
  const body =
    done + failed > 1 ? (failed ? `${done} finished, ${failed} failed.` : `${done} exports are ready.`)
    : failed ? `“${j.name}”: ${j.error}`
    : j.url ? `The link to “${j.name}” is ready.`
    : j.dest === 'clipboard' ? `“${file}” is on the clipboard, ready to paste.`
    : `Saved “${file}” in ${basename(dirname(j.path))}.`
  note = new Notification({ title: failed ? 'Export finished with errors' : 'Export finished', body })
  note.on('click', () => {
    if (j.url) void shell.openExternal(j.url)
    else if (existsSync(j.path)) shell.showItemInFolder(j.path)
  })
  // Not allowed (the user said no, or an unsigned dev build): the menu bar's full ring still says done.
  note.on('failed', (_e, err) => console.warn('[export] notification not shown:', err))
  note.show()
}

/** `name.ext` in `dir`, numbered past files already there, ones this export picks (`taken`), and
 *  ones an export still on its way will write. */
function freePath(dir: string, name: string, ext: string, taken = new Set<string>()): string {
  const busy = (p: string) => taken.has(p) || existsSync(p) || [...jobs.values()].some((j) => active(j) && j.path === p)
  const path = join(dir, uniqueName(safeFileName(name), ext, (f) => busy(join(dir, f))))
  taken.add(path)
  return path
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
    for (const it of items) it.path = freePath(dir, it.name, it.ext, taken)
  }
  if (items.length) lastDir = dirname(items[items.length - 1].path!)
  return true
}

async function enqueue(parent: BrowserWindow | null, reqs: ExportRequest[]): Promise<JobInfo[] | null> {
  if (!Array.isArray(reqs) || !reqs.length) throw new Error('Nothing to export.')
  const items = await Promise.all(
    reqs.map(async (r) => {
      if (typeof r?.bundle !== 'string' || !isAbsolute(r.bundle)) throw new Error('Export needs the absolute path of a project.')
      if (r.path !== undefined && (typeof r.path !== 'string' || !isAbsolute(r.path))) throw new Error('Export paths must be absolute.')
      if (r.dir !== undefined && (typeof r.dir !== 'string' || !isAbsolute(r.dir))) throw new Error('Export folders must be absolute.')
      const project = r.project ?? (await readProject(r.bundle))
      const dest = DESTINATIONS.includes(r.dest) ? r.dest : 'file'
      const options = jobOptions(dest, r.options)
      return { project, options, dest, bundle: r.bundle, name: project.name || basename(r.bundle, '.grip'), ext: options.format, path: r.path, dir: r.dir, quiet: r.quiet === true }
    }),
  )
  const taken = new Set<string>()
  for (const it of items) if (it.dest === 'file' && !it.path && it.dir && existsSync(it.dir)) it.path = freePath((lastDir = it.dir), it.name, it.ext, taken)
  if (!(await chooseFiles(parent, items.filter((it) => it.dest === 'file' && !it.path)))) return null
  // Links need an account: sign in (in the browser) before an export that would only fail at upload.
  if (items.some((it) => it.dest === 'share') && !accountToken() && !(await signIn())) return null
  const out = items.map((it) => {
    const id = crypto.randomUUID()
    // Clipboard, share, and temp exports land in a per-job temp folder, so the file keeps the project's name.
    const path = it.path ?? join(tmpRoot(), id, `${safeFileName(it.name)}.${it.ext}`)
    const j: Job = { id, name: it.name, bundle: it.bundle, options: it.options, dest: it.dest, path, project: it.project, state: 'queued', progress: 0, phase: 'Waiting', writes: Promise.resolve(), owner: (it.quiet && parent) || undefined }
    jobs.set(id, j)
    broadcast(j)
    return info(j)
  })
  void pump()
  return out
}

/** The partial file of the running export, so the next launch deletes it if Grip dies mid-export
 *  (will-quit never runs on a crash, kill, or power loss) instead of leaving a hidden file beside the
 *  user's videos. One line: exports run one at a time. */
const partialLog = () => join(app.getPath('userData'), 'export-partial.txt')

/** Temp exports older than a day go, except files a share upload still reads (uploads survive restarts). */
async function sweepTemp() {
  const stale = await readFile(partialLog(), 'utf8').catch(() => '')
  if (isAbsolute(stale) && /\/\.[^/]+\.partial$/.test(stale)) await rm(stale, { force: true }).catch(() => {})
  const root = tmpRoot()
  // ponytail: reads the sharing domain's state file; a share:busy(path) contract if more callers need it.
  const uploading: string[] = await readFile(join(app.getPath('userData'), 'share.json'), 'utf8').then(
    (s) => (JSON.parse(s).jobs ?? []).filter((x: { state: string }) => !['done', 'failed', 'canceled'].includes(x.state)).map((x: { path: string }) => x.path),
    () => [],
  )
  for (const d of await readdir(root).catch(() => [])) {
    const p = join(root, d)
    if (uploading.some((u) => u.startsWith(p + '/'))) continue
    const s = await stat(p).catch(() => null)
    if (s && Date.now() - s.mtimeMs > 864e5) await rm(p, { recursive: true, force: true }).catch(() => {})
  }
}

export function registerExport() {
  void sweepTemp()
  app.on('will-quit', () => {
    for (const j of jobs.values()) if (j.tmp) rmSync(j.tmp, { force: true })
  })

  ipcMain.handle('export:enqueue', (e, reqs: ExportRequest[]) => enqueue(BrowserWindow.fromWebContents(e.sender), reqs))

  ipcMain.handle('export:batch', async (e, options: ExportOptions) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    // Bundles are packages in the built app and plain folders in development: allow both.
    const opts = {
      title: 'Batch Export',
      message: 'Choose the projects to export',
      buttonLabel: 'Choose',
      defaultPath: projectsDir(),
      properties: ['openFile', 'openDirectory', 'multiSelections'] as Array<'openFile' | 'openDirectory' | 'multiSelections'>,
      filters: [{ name: 'Grip Projects', extensions: ['grip'] }],
    }
    const res = await (parent ? dialog.showOpenDialog(parent, opts) : dialog.showOpenDialog(opts))
    if (res.canceled) return null
    const bundles = res.filePaths.filter((p) => /\.grip\/?$/i.test(p))
    if (!bundles.length) throw new Error('Choose one or more Grip projects.')
    return enqueue(parent, bundles.map((bundle) => ({ bundle, options, dest: 'file' as const })))
  })

  ipcMain.handle('export:list', () => [...jobs.values()].map(info))

  ipcMain.handle('export:cancel', (_e, id: string) => {
    const j = jobs.get(id)
    // An upload belongs to the Share button once the file is complete; it can be deleted there.
    if (j && j.state !== 'uploading') return finish(j, 'canceled')
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
    } catch (err) {
      await finish(j, 'failed', fsMessage(err, j.path))
      throw err
    }
    if (j.dest !== 'share') return finish(j, 'done')
    // The file is complete: free the queue while share.ts uploads it (in the background, across restarts).
    Object.assign(j, { state: 'uploading', phase: 'Uploading', progress: 1 })
    release(j)
    broadcast(j)
    shareFile(j.path, { title: j.name, project: j.bundle }).then(
      (url: unknown) => {
        if (typeof url === 'string' && /^https?:\/\//.test(url)) return finish(Object.assign(j, { url }), 'done')
        return url === null ? finish(j, 'canceled') : finish(j, 'failed', 'The upload finished without a link.')
      },
      // Refused at the monthly limit: the reason stands on its own, it is no failure to retry.
      (err: unknown) => finish(j, 'failed', err instanceof ShareError && err.status === 402 ? err.message : `The video was saved, but the upload failed: ${String((err as Error)?.message ?? err)}`),
    )
  })

  ipcMain.handle('export:fail', (e, id: string, message: string) => {
    const j = own(e, id)
    return finish(j, 'failed', String(message || 'The export failed.').slice(0, 500))
  })
}
