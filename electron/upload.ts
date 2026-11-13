// Client side of the Bestboy platform's link API (bestboy.dev). Pure Node (fetch + fs): the main process runs it
// (electron/share.ts, electron/account.ts), and electron/upload.test.ts drives it against a fake.
//
//   POST   /api/items {kind, title, private, size, name, duration?, width?, height?, terms?} -> item; counts one upload
//   GET    /api/items/:id                       -> item: {id, state, offset, part, link, key, views, comments, …}
//   PUT    /api/items/:id/data?offset=n <bytes> exactly min(part, size - n) bytes -> {offset}
//   POST   /api/items/:id/finalize              -> item, state "ready"
//   PUT    /api/items/:id/poster <jpeg>         PUT /api/items/:id/gif <gif>, before finalize
//   POST   /api/items/:id/takes {the fields POST /api/items takes} -> item as its next take, uploading at offset 0:
//          a new video behind a ready video's link, which plays it from finalize on; GET, data, poster, gif, and
//          finalize then work on that take
//   PATCH  /api/items/:id {private}             DELETE /api/items/:id
//
// Every mutating call names a Content-Type (the server refuses one without, as it would a cross-site form).
// Errors are JSON {error, ...extra}. 409 {offset}: resume from there. 401: signed out. 402 {limit, resetsAt}: the
// team's uploads for the month are used. 402 {limit} alone: the link holds no more takes. 408 (a part arrived
// short), 425, 429, and 5xx pass; other 4xx are final.
//
// An upload survives anything transient (network loss, server restart, app restart): every attempt asks the
// server for its offset and continues from there. A part cut off midway is dropped whole by the server and sent
// again. Only answers that retrying cannot fix end it.
import { createReadStream, openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { Readable, Transform } from 'node:stream'

/** What the server says about an item (as its team sees it). */
export interface RemoteItem {
  id: string
  kind: 'video' | 'project'
  title: string
  private: boolean
  state: 'uploading' | 'ready' | 'expired'
  size: number
  offset: number
  part: number
  link: string
  key: string
  views: number
  comments: number
  duration?: number
  take?: number // the take's number, from 1
  expiresAt: string | null
}

export interface Upload {
  file: string // the bytes to send
  kind: 'video' | 'project'
  title: string
  private: boolean
  size: number // recorded when the share started: the file must not change underneath a resumed upload
  mtimeMs: number
  meta?: { duration: number; width: number; height: number } // a video's, for the link page's layout
  chapters?: Array<{ t: number; title: string }> // moments the link page lists, in seconds of the video
  terms?: string // the Terms date the Share button showed beside it: creating the item accepts them
  takeOf?: string // a ready video's id: this upload is its next take, behind its link and with its privacy. When the
  //                 link holds no more takes, it goes out as a new link as private, and remote.id differs.
  gif?: string // a GIF of the video, for places that show images but play no video (a pull request)
  remote?: RemoteItem // set once the server created the item; the link works from then on
  posterSent?: boolean
  gifSent?: boolean
}

export interface Hooks {
  signal?: AbortSignal
  /** Bytes the server holds (or is receiving), and what the upload is doing. */
  progress(sent: number, state: 'uploading' | 'processing' | 'waiting', note?: string): void
  /** The item exists with the right privacy: persist `job.remote` (resume needs it) and hand out the link.
   *  Called once per upload() call, so also after an app restart. */
  created(): void | Promise<void>
  poster?: () => Promise<Buffer | null>
}

/** A failure that retrying will not fix (signed out, over the limit, bad request, gone, file changed). */
export class ShareError extends Error {
  status?: number
  opensAt?: string // 402: when uploads open again (ISO)
  limit?: number // 402 at a take: the takes a link holds
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/** 402 at item creation: why the share was refused, and the day (UTC) uploads open again. */
export function usedUp(resetsAt: unknown): ShareError {
  const at = new Date(typeof resetsAt === 'string' ? resetsAt : NaN)
  const valid = !isNaN(at.getTime())
  const when = valid ? `on ${at.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}` : 'next month'
  const e = new ShareError(`This month’s uploads are used. Your links keep playing, and uploads open again ${when}.`, 402)
  if (valid) e.opensAt = at.toISOString()
  return e
}

export class RemoteError extends Error {
  status: number
  data: any
  constructor(status: number, data: any) {
    super(data?.error ?? `The share server answered ${status}.`)
    this.status = status
    this.data = data
  }
}

/** Sent with every call (electron/account.ts sets it): Node's own `node` reads as a script, whose calls the platform
 *  leaves out of its counts. */
export const client = { userAgent: '' }

/** One API call. JSON in and out; a Readable is sent as bytes, a Buffer as a JPEG, a Blob as its type. */
export async function api(server: string, token: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const headers: Record<string, string> = client.userAgent ? { 'user-agent': client.userAgent } : {}
  if (token) headers.authorization = `Bearer ${token}`
  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal }
  if (body instanceof Readable) {
    init.body = Readable.toWeb(body) as ReadableStream
    init.duplex = 'half'
    headers['content-type'] = 'application/octet-stream'
  } else if (Buffer.isBuffer(body)) {
    init.body = new Uint8Array(body)
    headers['content-type'] = 'image/jpeg'
  } else if (body instanceof Blob) {
    init.body = body
    headers['content-type'] = body.type
  } else if (body !== undefined) init.body = JSON.stringify(body)
  if (method !== 'GET') headers['content-type'] ??= 'application/json'
  const r = await fetch(server.replace(/\/+$/, '') + path, init)
  const data = r.status === 204 ? null : await r.json().catch(() => null)
  if (r.ok) return data
  if (r.status === 401) throw new ShareError('Sign in to share links.', 401)
  if (r.status === 402 && data?.limit && !data.resetsAt) throw Object.assign(new ShareError(data.error ?? 'This link holds no more takes.', 402), { limit: data.limit })
  if (r.status === 402) throw usedUp(data?.resetsAt)
  if (r.status < 500 && ![408, 409, 425, 429].includes(r.status)) throw new ShareError(new RemoteError(r.status, data).message, r.status)
  throw new RemoteError(r.status, data)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true })
  })

/** Upload `job` to `server` until it is ready; returns the final item. Mutates job.remote, job.private (a take's is
 *  its link's), job.posterSent, and job.gifSent. */
export async function upload(server: string, token: string, job: Upload, hooks: Hooks): Promise<RemoteItem> {
  const { signal } = hooks
  const call = (method: string, path: string, body?: unknown) => api(server, token, method, path, body, signal)
  let delay = 1000
  let sent = 0
  let announced = false
  const report = (n: number, state: 'uploading' | 'processing' | 'waiting', note?: string) => hooks.progress((sent = n), state, note)

  async function attempt(): Promise<RemoteItem> {
    const s = await stat(job.file).catch(() => null)
    if (!s) throw new ShareError('The file to share is gone. Share it again.')
    if (s.size !== job.size || s.mtimeMs !== job.mtimeMs) throw new ShareError('The file changed during the upload. Share it again.')
    const fields = () => ({ kind: job.kind, title: job.title, private: job.private, size: job.size, name: basename(job.file), terms: job.terms, chapters: job.chapters, ...job.meta })
    if (!job.remote && job.takeOf) {
      // A take keeps its link's privacy. A link that holds no more takes sends this one out as a new link, as private.
      const take: RemoteItem | null = await call('POST', `/api/items/${job.takeOf}/takes`, fields()).catch((e) => {
        if (e instanceof ShareError && e.limit) return null
        // No offset to resume from: the link expired (retrying would never end), or its first take still uploads.
        throw e instanceof RemoteError && e.status === 409 ? new ShareError(e.message, 409) : e
      })
      job.private = (take ?? (await call('GET', `/api/items/${job.takeOf}`))).private
      job.remote = take ?? undefined
    }
    job.remote ??= await call('POST', '/api/items', fields())
    const id = job.remote!.id
    // Privacy changed while the item was being created (or offline): the server must agree before the link goes out.
    if (job.remote!.private !== job.private) job.remote = await call('PATCH', `/api/items/${id}`, { private: job.private })
    if (!announced) {
      announced = true
      await hooks.created()
    }
    if (hooks.poster && !job.posterSent) {
      const jpg = await hooks.poster()
      // A rejected poster only costs the link preview image.
      if (jpg) await call('PUT', `/api/items/${id}/poster`, jpg).catch((e) => { if (!(e instanceof ShareError)) throw e })
      job.posterSent = true
    }
    let item: RemoteItem = await call('GET', `/api/items/${id}`)
    // A take reads as another once it was dropped (a newer take started, or it waited a week): its bytes are unwanted.
    if (job.takeOf && item.take !== job.remote!.take) throw new ShareError('This take was dropped before its upload finished. Share it again.')
    let offset = item.offset
    while (item.state === 'uploading' && offset < job.size) {
      report(offset, 'uploading')
      const body = createReadStream(job.file, { start: offset, end: Math.min(offset + item.part, job.size) - 1 }).pipe(
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            report(sent + chunk.length, 'uploading')
            cb(null, chunk)
          },
        }),
      )
      try {
        offset = (await call('PUT', `/api/items/${id}/data?offset=${offset}`, body)).offset
        delay = 1000 // moving again: the next hiccup starts the backoff over
      } catch (e) {
        body.destroy()
        if (!(e instanceof RemoteError && e.status === 409 && typeof e.data?.offset === 'number')) throw e
        offset = e.data.offset
      }
    }
    report(job.size, 'processing')
    if (job.gif && !job.gifSent) {
      // After the video, which matters more. A rejected GIF (over the limit, or a platform without GIFs) or one
      // deleted since only costs the image, as a poster does.
      const gif = await openAsBlob(job.gif, { type: 'image/gif' }).catch(() => null)
      if (gif) await call('PUT', `/api/items/${id}/gif`, gif).catch((e) => { if (!(e instanceof ShareError)) throw e })
      job.gifSent = true
    }
    item = await call('POST', `/api/items/${id}/finalize`)
    job.remote = item
    return item
  }

  for (;;) {
    try {
      return await attempt()
    } catch (e) {
      if (e instanceof ShareError || signal?.aborted) throw e
      const reason = e instanceof RemoteError ? e.message : `Can’t reach ${new URL(server).host}.`
      report(Math.min(sent, job.size), 'waiting', `${reason} Retrying in ${Math.round(delay / 1000)} s.`)
      await sleep(delay, signal)
      delay = Math.min(delay * 2, 30_000)
    }
  }
}
