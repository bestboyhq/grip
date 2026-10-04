// Owner: sharing. Share links through our server (server/). Uploads run here, in the background, and survive network
// loss and app restarts (state in userData/share.json). The link exists, and is copied, as soon as the server knows
// the item: long before the bytes are up, the link page shows the upload's progress.
//
//   share:upload(path, {title?, private?, project?}) -> link, or null when canceled before the link existed.
//                                         path: an exported video, or a .studio bundle (sent as an archive).
//                                         project: the bundle a video share belongs to (the Share button finds it).
//   share:jobs() -> Job[]                 share:progress (event to every window) -> Job, on every change
//   share:status(jobId) -> Job            refresh views, comments, and privacy from the server
//   share:update(jobId, {private}) -> Job
//   share:cancel(jobId)                   stop the upload and delete the link
//   share:copy(text)                      share:open(jobId): the link in the browser, as the owner (own views not counted)
//   share:config(patch?) -> {url}         the share server, http://localhost:7433 unless STUDIO_SHARE_URL says otherwise
//   share:import(url) -> bundle path      open a shared project link in the editor; studio://open?url=<link> does the same
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny'
import { api, upload, type Upload } from '../server/client.ts'
import { projectsDir } from './projects.ts'
import { openWindow } from './windows.ts'

const exec = promisify(execFile)

export interface Job extends Upload {
  id: string
  server: string // the share server this job talks to
  path: string // what the user shared: a video file or a .studio bundle
  project?: string // the bundle this share belongs to
  state: 'preparing' | 'uploading' | 'waiting' | 'processing' | 'done' | 'failed' | 'canceled'
  sent: number // bytes up
  note?: string // why it waits or failed, in plain language
  link?: string
  createdAt: number
}

const state = { url: process.env.STUDIO_SHARE_URL ?? 'http://localhost:7433', owner: '', jobs: [] as Job[] }
let stateFile = ''
const running = new Map<string, AbortController>()
const waiters = new Map<string, { resolve(link: string | null): void; reject(e: Error): void }>()
const startedNow = new Set<string>() // jobs the user started in this run: their link goes to the clipboard
const lastEmit = new Map<string, number>()

let saving = Promise.resolve()
function persist() {
  saving = saving
    .then(async () => {
      await writeFile(stateFile + '.tmp', JSON.stringify(state))
      await rename(stateFile + '.tmp', stateFile)
    })
    .catch((e) => console.error('share: could not save state', e))
}

function emit(job: Job, throttle = false) {
  const now = Date.now()
  if (throttle && now - (lastEmit.get(job.id) ?? 0) < 100) return
  lastEmit.set(job.id, now)
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('share:progress', job)
}

const plain = (e: unknown) =>
  (e as NodeJS.ErrnoException)?.code === 'ENOSPC' ? 'Your disk is full. Free some space and share again.'
  : e instanceof Error ? e.message
  : String(e)

function find(id: string): Job {
  const job = state.jobs.find((j) => j.id === id)
  if (!job) throw new Error('That share is gone.')
  return job
}

/** Upload a video or .studio bundle in the background; resolves to the link (also used by export). */
export async function shareFile(path: string, o: { title?: string; private?: boolean; project?: string } = {}): Promise<string | null> {
  const s = await stat(path).catch(() => null)
  if (!s) throw new Error('The file to share is gone.')
  const kind = s.isDirectory() ? 'project' : 'video'
  const job: Job = {
    id: randomUUID(),
    server: state.url,
    path,
    project: o.project ?? (kind === 'project' ? path : undefined),
    kind,
    title: o.title?.trim() || basename(path).replace(/\.[^.]+$/, ''),
    private: o.private === true,
    file: path,
    size: s.size,
    mtimeMs: s.mtimeMs,
    state: 'preparing',
    sent: 0,
    createdAt: Date.now(),
  }
  state.jobs = [...state.jobs.slice(-199), job]
  startedNow.add(job.id)
  persist()
  emit(job)
  const link = new Promise<string | null>((resolve, reject) => waiters.set(job.id, { resolve, reject }))
  drive(job)
  return link
}

async function drive(job: Job) {
  if (running.has(job.id)) return
  const ac = new AbortController()
  running.set(job.id, ac)
  try {
    if (job.kind === 'project' && !job.remote) {
      // Pack (again, after a restart) until the server knows the item; from then on the bytes must not change.
      job.state = 'preparing'
      emit(job)
      const dir = join(app.getPath('userData'), 'share')
      await mkdir(dir, { recursive: true })
      job.file = join(dir, `${job.id}.tar`)
      await exec('tar', ['-cf', job.file, '--exclude', '.DS_Store', '-C', dirname(job.path), basename(job.path)], { signal: ac.signal }).catch((e) => {
        throw (e as NodeJS.ErrnoException).code === 'ENOSPC' || ac.signal.aborted ? e : new Error(`Could not pack the project: ${String(e.stderr || e.message).trim().split('\n')[0]}`)
      })
      const s = await stat(job.file)
      job.size = s.size
      job.mtimeMs = s.mtimeMs
      persist()
    }
    const item = await upload(job.server, state.owner, job, {
      signal: ac.signal,
      progress(sent, st, note) {
        const changed = st !== job.state || note !== job.note
        job.sent = sent
        job.state = st
        job.note = note
        if (changed) persist()
        emit(job, !changed)
      },
      created() {
        job.link = job.remote!.link
        persist()
        emit(job)
        if (startedNow.delete(job.id)) clipboard.writeText(job.link)
        waiters.get(job.id)?.resolve(job.link)
        waiters.delete(job.id)
      },
      poster: job.kind === 'video' ? () => poster(job.path) : undefined,
    })
    Object.assign(job, { state: 'done', link: item.link, private: item.private, sent: job.size, note: undefined })
    if (job.kind === 'project') await rm(job.file, { force: true })
  } catch (e) {
    if (ac.signal.aborted) return
    job.state = 'failed'
    job.note = plain(e)
    waiters.get(job.id)?.reject(new Error(job.note))
    waiters.delete(job.id)
  } finally {
    running.delete(job.id)
    if (job.state !== 'canceled') {
      persist()
      emit(job)
    }
  }
}

/** Poster frame for the link page and link previews, from Quick Look. Quick Look can answer
 *  with the generic file icon while it has no thumbnail yet, so the image must have the video's shape.
 *  Optional: null when there is no good frame. */
async function poster(path: string): Promise<Buffer | null> {
  const input = new Input({ source: new FilePathSource(path), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const aspect = (await track.getDisplayWidth()) / (await track.getDisplayHeight())
    for (let i = 0; i < 4; i++) {
      // 960 px (2x of a 480 box) at q70 is ~40 kB: big enough for link previews, small enough not to slow 4G playback.
      const jpg = (await nativeImage.createThumbnailFromPath(path, { width: 480, height: 480 })).toJPEG(70)
      const { width, height } = nativeImage.createFromBuffer(jpg).getSize() // getSize() on the thumbnail reports the box
      if (width && Math.abs(width / height / aspect - 1) < 0.03) return jpg
      await new Promise((r) => setTimeout(r, 500))
    }
    return null
  } catch {
    return null
  } finally {
    input.dispose()
  }
}

/** Download a shared project (its link page, its archive URL, or studio://open?url=<either>) into the projects
 *  folder under a free name, and open it in the editor. */
export async function importProject(link: string, ask: boolean): Promise<string | null> {
  const raw = link.startsWith('studio:') ? (new URL(link).searchParams.get('url') ?? '') : link
  const u = URL.canParse(raw) ? new URL(raw) : null
  if (!u || !/^https?:$/.test(u.protocol)) throw new Error('That is not a project link.')
  if (/^\/v\/[\w-]{22}$/.test(u.pathname)) u.pathname += '/project.tar'
  if (ask) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      message: 'Open the shared project?',
      detail: `Studio downloads it from ${u.host} into your projects folder.`,
      buttons: ['Open', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response !== 0) return null
  }
  const root = projectsDir()
  const tmp = join(root, `.import-${randomUUID()}`) // same volume as the destination: the final move is a rename
  await mkdir(tmp, { recursive: true })
  try {
    const r = await fetch(u).catch(() => null)
    if (!r) throw new Error(`Can’t reach ${u.host}. Check your connection and try again.`)
    if (!r.ok || !r.body) {
      throw new Error(r.status === 403 ? 'This project link is private. Ask for the full link.' : r.status === 404 ? 'This project link no longer exists.' : `The download failed (${r.status}).`)
    }
    const tar = join(tmp, 'project.tar')
    await pipeline(Readable.fromWeb(r.body as any), createWriteStream(tar))
    // Accept one .studio bundle of plain files and folders: no links, nothing outside it.
    const list = async (flag: string) => (await exec('tar', [flag, tar], { maxBuffer: 256 * 2 ** 20 })).stdout.split('\n').filter(Boolean)
    const names = await list('-tf').catch(() => [])
    const kinds = (await list('-tvf').catch(() => [])).map((l) => l[0])
    const top = names[0]?.split('/')[0] ?? ''
    const ok = top.endsWith('.studio') && names.every((n) => n.split('/')[0] === top && !n.split('/').includes('..')) && kinds.every((k) => k === '-' || k === 'd')
    if (!ok) throw new Error('That link is not a Studio project.')
    await exec('tar', ['-xf', tar, '-C', tmp])
    await readFile(join(tmp, top, 'project.json'), 'utf8').then(JSON.parse).catch(() => {
      throw new Error('That project is damaged: its project.json is missing or unreadable.')
    })
    const name = top.slice(0, -'.studio'.length).normalize('NFC') // tar may hand back decomposed accents
    for (let i = 1; ; i++) {
      const dest = join(root, `${name}${i > 1 ? ` ${i}` : ''}.studio`)
      try {
        await rename(join(tmp, top), dest) // fails on a taken name (an empty folder is the only thing it replaces)
      } catch (e) {
        if (['ENOTEMPTY', 'EEXIST', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) continue
        throw e
      }
      openWindow(`editor?project=${encodeURIComponent(dest)}`)
      return dest
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

/** studio://open?url=<project link>, routed here by the app shell (electron/main.ts) once the app is ready. */
export function openSharedLink(url: string) {
  importProject(url, true).catch((e) => dialog.showErrorBox('Could not open the shared project', plain(e)))
}

export function registerShare() {
  stateFile = join(app.getPath('userData'), 'share.json')
  try {
    Object.assign(state, JSON.parse(readFileSync(stateFile, 'utf8')))
  } catch {
    // first run, or a damaged file: start clean (the server keeps everything already shared)
  }
  if (process.env.STUDIO_SHARE_URL) state.url = process.env.STUDIO_SHARE_URL
  if (!state.owner) {
    state.owner = randomBytes(32).toString('base64url')
    persist()
  }
  for (const job of state.jobs) if (!['done', 'failed', 'canceled'].includes(job.state)) drive(job)

  ipcMain.handle('share:upload', (_e, path: string, o?: { title?: string; private?: boolean; project?: string }) => shareFile(path, o))
  ipcMain.handle('share:jobs', () => state.jobs)
  ipcMain.handle('share:status', async (_e, id: string) => {
    const job = find(id)
    if (!job.remote) return job
    try {
      const item = await api(job.server, state.owner, 'GET', `/api/items/${job.remote.id}`)
      Object.assign(job, { remote: item, private: item.private, link: item.link })
      persist()
      emit(job)
    } catch {
      // offline: the last known numbers stay
    }
    return job
  })
  ipcMain.handle('share:update', async (_e, id: string, patch: { private?: boolean }) => {
    const job = find(id)
    if (typeof patch.private !== 'boolean') return job
    if (job.remote) {
      const item = await api(job.server, state.owner, 'PATCH', `/api/items/${job.remote.id}`, { private: patch.private })
      Object.assign(job, { remote: item, private: item.private, link: item.link })
    } else job.private = patch.private // applied when the upload creates the item
    persist()
    emit(job)
    return job
  })
  ipcMain.handle('share:cancel', async (_e, id: string) => {
    const job = find(id)
    // A finished link must really be gone before it leaves the list; an unfinished one is swept by the server anyway.
    if (job.remote && job.state === 'done') await api(job.server, state.owner, 'DELETE', `/api/items/${job.remote.id}`)
    else if (job.remote) api(job.server, state.owner, 'DELETE', `/api/items/${job.remote.id}`).catch(() => {})
    running.get(job.id)?.abort()
    job.state = 'canceled'
    state.jobs = state.jobs.filter((j) => j !== job)
    waiters.get(job.id)?.resolve(null)
    waiters.delete(job.id)
    if (job.kind === 'project') await rm(join(app.getPath('userData'), 'share', `${job.id}.tar`), { force: true })
    persist()
    emit(job)
  })
  ipcMain.handle('share:copy', (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle('share:open', (_e, id: string) => {
    const job = find(id)
    if (job.link) return shell.openExternal(`${job.link}#owner=${state.owner}`)
  })
  ipcMain.handle('share:config', (_e, patch?: { url?: string }) => {
    if (patch?.url !== undefined) {
      const u = URL.canParse(patch.url) ? new URL(patch.url) : null
      if (!u || !/^https?:$/.test(u.protocol)) throw new Error('The share server URL must start with http:// or https://.')
      state.url = u.origin + u.pathname.replace(/\/+$/, '')
      persist()
    }
    return { url: state.url }
  })
  ipcMain.handle('share:import', (_e, url: string) => importProject(url, false))

}
