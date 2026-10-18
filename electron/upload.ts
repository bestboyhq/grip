// Client side of the Bestboy platform's link API (bestboy.dev). Pure Node (fetch + fs): the main process runs it
// (electron/share.ts, electron/account.ts), and electron/upload.test.ts drives it against a fake.
//
//   POST   /api/items {kind, title, private, size, name, duration?, width?, height?} -> item; counts one upload
//   GET    /api/items/:id                       -> item: {id, state, offset, part, link, key, views, comments, …}
//   PUT    /api/items/:id/data?offset=n <bytes> exactly min(part, size - n) bytes -> {offset}
//   POST   /api/items/:id/finalize              -> item, state "ready"
//   PUT    /api/items/:id/poster <jpeg>         PATCH /api/items/:id {private}   DELETE /api/items/:id
//
// Every mutating call names a Content-Type (the server refuses one without, as it would a cross-site form).
// Errors are JSON {error, ...extra}. 409 {offset}: resume from there. 401: signed out. 402: the team's uploads
// for the month are used up. 408 (a part arrived short), 425, 429, and 5xx pass; other 4xx are final.
//
// An upload survives anything transient (network loss, server restart, app restart): every attempt asks the
// server for its offset and continues from there. A part cut off midway is dropped whole by the server and sent
// again. Only answers that retrying cannot fix end it.
import { createReadStream } from 'node:fs'
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
  remote?: RemoteItem // set once the server created the item; the link works from then on
  posterSent?: boolean
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
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
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

/** One API call. JSON in and out; a Readable is sent as bytes, a Buffer as a JPEG. */
export async function api(server: string, token: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  const init: RequestInit & { duplex?: 'half' } = { method, headers, signal }
  if (body instanceof Readable) {
    init.body = Readable.toWeb(body) as ReadableStream
    init.duplex = 'half'
    headers['content-type'] = 'application/octet-stream'
  } else if (Buffer.isBuffer(body)) {
    init.body = new Uint8Array(body)
    headers['content-type'] = 'image/jpeg'
  } else if (body !== undefined) init.body = JSON.stringify(body)
  if (method !== 'GET') headers['content-type'] ??= 'application/json'
  const r = await fetch(server.replace(/\/+$/, '') + path, init)
  const data = r.status === 204 ? null : await r.json().catch(() => null)
  if (r.ok) return data
  if (r.status === 401) throw new ShareError('Sign in to share links.', 401)
  if (r.status < 500 && ![408, 409, 425, 429].includes(r.status)) throw new ShareError(new RemoteError(r.status, data).message, r.status)
  throw new RemoteError(r.status, data)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true })
  })

/** Upload `job` to `server` until it is ready; returns the final item. Mutates job.remote / job.posterSent. */
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
    job.remote ??= await call('POST', '/api/items', { kind: job.kind, title: job.title, private: job.private, size: job.size, name: basename(job.file), ...job.meta })
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
