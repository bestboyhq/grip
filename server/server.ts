// Share link server: resumable uploads, fast-start MP4s, link pages with comments and view counts.
// Plain node:http run directly by Node (type stripping): `npm run server`.
// Env: PORT (7433), STUDIO_SHARE_DATA (data folder, default .context/share), STUDIO_SHARE_URL (public base URL for
// links and Open Graph tags, default http://<Host header>), STUDIO_SHARE_UPLOAD_KEY (when set, creating an upload
// needs the X-Upload-Key header; set it before exposing the server beyond localhost).
//
// Storage: <data>/items/<id>/ meta.json, data.part (while uploading), video.mp4 | project.tar, poster.jpg, comments.jsonl
// The owner is whoever holds the owner token: `Authorization: Bearer <token>` (the app) or the studio_owner cookie
// (the owner's browser). Private items also open with ?k=<key>.
//
//   POST   /api/items {kind, title, private, size, name}  create; the reply holds the link, which works right away
//   GET    /api/items/:id                                 state and upload offset (owner: also link, key, views)
//   PUT    /api/items/:id/data?offset=n  <bytes>          append at n; 409 {offset} when n is not the current offset
//   POST   /api/items/:id/finalize                        check the bytes; MP4s are remuxed so the moov box comes first
//   PUT    /api/items/:id/poster  <jpeg>                  owner: poster frame for the page and link previews
//   PATCH  /api/items/:id {title?, private?}              owner
//   DELETE /api/items/:id                                 owner
//   GET    /api/items/:id/comments, POST {name, text, t}, DELETE /api/items/:id/comments/:cid (owner)
//   POST   /api/items/:id/views                           a play started; the owner's plays are not counted
//   POST   /api/owner {token}                             sets the owner cookie (the app opens /v/<id>#owner=<token>)
//   GET    /v/:id  /v/:id/video.mp4  /v/:id/poster.jpg  /v/:id/project.tar   page and files (Range requests)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import {
  ALL_FORMATS, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, FilePathSource, FilePathTarget,
  Input, Mp4OutputFormat, Output, type EncodedPacket,
} from 'mediabunny'
import { itemPage, messagePage } from './page.ts'

export interface Item {
  id: string
  kind: 'video' | 'project'
  title: string
  name: string // original file name, for downloads
  size: number // bytes declared at create
  private: boolean
  key: string // opens the item while private
  owner: string // sha256 of the owner token, hex
  state: 'uploading' | 'processing' | 'ready'
  createdAt: string
  views: number // play starts, the owner's excluded
  duration?: number // seconds
  width?: number
  height?: number
  poster?: boolean
}

export interface Comment {
  id: string
  t: number // video seconds
  name: string
  text: string
  at: string // ISO
  owner?: boolean
}

export interface Options {
  port?: number // 0 = any free port
  dir: string
  publicUrl?: string
  uploadKey?: string
}

const MAX_SIZE = 256 * 2 ** 30
const ID = '[\\w-]{22}'
const TOKEN = /^[\w-]{32,128}$/
const STALE_MS = 7 * 86400e3 // unfinished uploads are removed after a week
const PLAYABLE = ['avc', 'hevc', 'vp9', 'av1'] // codecs every current browser can play in MP4
const COOKIE = 'studio_owner'

class HttpError extends Error {
  status: number
  extra?: object
  constructor(status: number, message: string, extra?: object) {
    super(message)
    this.status = status
    this.extra = extra
  }
}
function need(ok: unknown, status: number, message: string): asserts ok {
  if (!ok) throw new HttpError(status, message)
}

const newId = () => randomBytes(16).toString('base64url') // 128 bits: unguessable
const sha = (s: string) => createHash('sha256').update(s).digest()
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b))
/** Trimmed single-line text without control characters, at most `max` code points (emoji stay whole). */
const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? [...v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()].slice(0, max).join('') : ''

export async function startServer(opts: Options): Promise<{ url: string; close(): Promise<void> }> {
  const root = join(opts.dir, 'items')
  await mkdir(root, { recursive: true })
  const dirOf = (id: string) => join(root, id)
  const writing = new Map<string, { req: IncomingMessage; done: Promise<void> }>() // in-flight chunk per item
  const processing = new Map<string, Promise<Item>>()
  const queues = new Map<string, Promise<unknown>>()

  async function load(id: string): Promise<Item> {
    try {
      return JSON.parse(await readFile(join(dirOf(id), 'meta.json'), 'utf8'))
    } catch {
      throw new HttpError(404, 'This link does not exist or was deleted.')
    }
  }
  async function save(item: Item) {
    const tmp = join(dirOf(item.id), `meta.${randomBytes(4).toString('hex')}.tmp`)
    await writeFile(tmp, JSON.stringify(item))
    await rename(tmp, join(dirOf(item.id), 'meta.json'))
  }
  /** Read-modify-write of one item's meta, serialized per item so concurrent requests never lose an update. */
  function update(id: string, fn: (it: Item) => void | Promise<void>): Promise<Item> {
    const run = (queues.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const it = await load(id)
        await fn(it)
        await save(it)
        return it
      })
    queues.set(id, run)
    const done = () => queues.get(id) === run && queues.delete(id)
    run.then(done, done)
    return run
  }
  const partSize = (id: string) => stat(join(dirOf(id), 'data.part')).then((s) => s.size, () => 0)

  function ownerToken(req: IncomingMessage): string | null {
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
    const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`).exec(req.headers.cookie ?? '')?.[1]
    const t = bearer ?? cookie
    return t && TOKEN.test(t) ? t : null
  }
  function isOwner(req: IncomingMessage, item: Item) {
    const t = ownerToken(req)
    return !!t && timingSafeEqual(sha(t), Buffer.from(item.owner, 'hex'))
  }
  /** The key from ?k= when it is this item's key, else null (never reflect arbitrary input). */
  function keyOf(url: URL, item: Item) {
    const k = url.searchParams.get('k')
    return k && same(k, item.key) ? k : null
  }
  function canView(req: IncomingMessage, url: URL, item: Item) {
    return !item.private || !!keyOf(url, item) || isOwner(req, item)
  }
  function ownerCookie(res: ServerResponse, token: string) {
    const secure = opts.publicUrl?.startsWith('https:') ? '; Secure' : ''
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Lax${secure}`)
  }
  function base(req: IncomingMessage) {
    if (opts.publicUrl) return opts.publicUrl.replace(/\/+$/, '')
    const host = req.headers.host ?? ''
    return `http://${/^[\w.-]+(:\d+)?$/.test(host) ? host : 'localhost'}`
  }
  const link = (req: IncomingMessage, item: Item) => `${base(req)}/v/${item.id}${item.private ? `?k=${item.key}` : ''}`

  async function comments(item: Item): Promise<Comment[]> {
    const raw = await readFile(join(dirOf(item.id), 'comments.jsonl'), 'utf8').catch(() => '')
    const out = new Map<string, Comment>()
    for (const line of raw.split('\n')) {
      try {
        const c = JSON.parse(line)
        if (c.deleted) out.delete(c.deleted)
        else out.set(c.id, c)
      } catch {
        // empty or torn last line
      }
    }
    return [...out.values()].sort((a, b) => a.t - b.t || a.at.localeCompare(b.at))
  }

  async function itemJson(req: IncomingMessage, item: Item) {
    const owner = isOwner(req, item)
    const { key, owner: _, views, ...pub } = item
    return {
      ...pub,
      offset: item.state === 'uploading' ? await partSize(item.id) : item.size,
      ...(owner ? { owned: true, key, views, link: link(req, item), comments: (await comments(item)).length } : {}),
    }
  }

  async function create(req: IncomingMessage, res: ServerResponse) {
    if (opts.uploadKey) need(same(String(req.headers['x-upload-key'] ?? ''), opts.uploadKey), 401, 'This share server needs an upload key.')
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
    need(token && TOKEN.test(token), 401, 'Missing owner token.')
    const b = await readJson(req)
    need(b.kind === 'video' || b.kind === 'project', 400, 'kind must be "video" or "project".')
    need(Number.isSafeInteger(b.size) && b.size > 0, 400, 'size must be a positive byte count.')
    need(b.size <= MAX_SIZE, 413, 'The file is too large to share.')
    const { bavail, bsize } = await statfs(root)
    // Videos may be remuxed into a second copy before the upload is dropped.
    need(bavail * bsize > b.size * (b.kind === 'video' ? 2 : 1) + 2 ** 30, 507, 'The share server is out of disk space.')
    const item: Item = {
      id: newId(),
      kind: b.kind,
      title: clean(b.title, 200) || 'Untitled',
      name: clean(b.name, 255).replace(/[/\\]/g, '_') || (b.kind === 'video' ? 'video.mp4' : 'project.tar'),
      size: b.size,
      private: b.private === true,
      key: newId(),
      owner: sha(token).toString('hex'),
      state: 'uploading',
      createdAt: new Date().toISOString(),
      views: 0,
    }
    await mkdir(dirOf(item.id))
    await writeFile(join(dirOf(item.id), 'data.part'), '')
    await save(item)
    ownerCookie(res, token)
    send(req, res, 201, await itemJson(req, item))
  }

  /** Append one chunk. A dropped connection keeps what arrived; the client asks for the offset and resumes. */
  async function putData(req: IncomingMessage, res: ServerResponse, url: URL, item: Item) {
    need(item.state === 'uploading', 409, 'This upload is already complete.')
    const offset = Number(url.searchParams.get('offset'))
    need(Number.isSafeInteger(offset) && offset >= 0, 400, 'offset must be a byte position.')
    // A retry can arrive before the server noticed the previous connection died: that chunk yields to this one.
    const prev = writing.get(item.id)
    let release = () => {}
    const mine = { req, done: new Promise<void>((r) => (release = r)) }
    writing.set(item.id, mine)
    try {
      if (prev) {
        prev.req.destroy()
        await prev.done
      }
      const part = join(dirOf(item.id), 'data.part')
      const current = (await stat(part)).size
      if (offset !== current) throw new HttpError(409, 'Resume from the current offset.', { offset: current })
      let left = item.size - current
      const limit = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          if (chunk.length > left) return cb(new HttpError(413, 'The chunk runs past the declared size.'))
          left -= chunk.length
          cb(null, chunk)
        },
      })
      try {
        await pipeline(req, limit, createWriteStream(part, { flags: 'r+', start: current, flush: true }))
      } catch (e) {
        if (e instanceof HttpError) throw e
        // The client went away mid-chunk: the bytes that landed stay, the next offset query reports them.
      }
      if (!res.destroyed) send(req, res, 200, { offset: (await stat(part)).size })
    } finally {
      release()
      if (writing.get(item.id) === mine) writing.delete(item.id)
    }
  }

  async function finalize(req: IncomingMessage, res: ServerResponse, item: Item) {
    req.setTimeout(0) // remuxing hours of video keeps the socket silent for a while
    if (item.state !== 'ready') {
      let job = processing.get(item.id)
      if (!job) {
        const offset = await partSize(item.id)
        if (offset !== item.size) throw new HttpError(409, 'The upload is not complete yet.', { offset })
        job = ingest(item)
        processing.set(item.id, job)
        job.then(() => processing.delete(item.id), () => processing.delete(item.id))
      }
      item = await job
    }
    send(req, res, 200, await itemJson(req, item))
  }

  async function ingest(item: Item): Promise<Item> {
    const d = dirOf(item.id)
    const part = join(d, 'data.part')
    await update(item.id, (it) => void (it.state = 'processing'))
    if (item.kind === 'project') {
      const head = Buffer.alloc(512)
      const fh = await open(part)
      await fh.read(head, 0, 512, 0).finally(() => fh.close())
      if (head.toString('latin1', 257, 262) !== 'ustar') {
        await rm(d, { recursive: true, force: true })
        throw new HttpError(422, 'That file is not a project archive.')
      }
      await rename(part, join(d, 'project.tar'))
      return update(item.id, (it) => void (it.state = 'ready'))
    }
    const tmp = join(d, 'video.tmp.mp4')
    let info: VideoInfo
    try {
      info = await fastStart(part, tmp)
    } catch (e) {
      await rm(tmp, { force: true })
      // Disk or I/O trouble is worth another finalize; anything else means the bytes are no playable video.
      if ((e as NodeJS.ErrnoException).code) throw e
      await rm(d, { recursive: true, force: true })
      throw new HttpError(422, e instanceof Error ? e.message : 'That file is not a playable video.')
    }
    await rename(info.remuxed ? tmp : part, join(d, 'video.mp4'))
    const done = await update(item.id, (it) => {
      it.state = 'ready'
      it.duration = info.duration
      it.width = info.width
      it.height = info.height
    })
    await rm(part, { force: true })
    return done
  }

  async function addComment(req: IncomingMessage, res: ServerResponse, item: Item) {
    need(item.kind === 'video' && item.state === 'ready', 409, 'Comments open once the video is ready.')
    const b = await readJson(req)
    const name = clean(b.name, 60)
    const text = typeof b.text === 'string' ? [...b.text.replace(/\r\n?/g, '\n').trim()].slice(0, 2000).join('') : ''
    need(name, 400, 'Add your name.')
    need(text, 400, 'Write a comment first.')
    need(typeof b.t === 'number' && b.t >= 0 && b.t <= (item.duration ?? 0) + 1, 400, 'The comment time is outside the video.')
    const c: Comment = { id: randomBytes(6).toString('base64url'), t: Math.round(b.t * 100) / 100, name, text, at: new Date().toISOString() }
    if (isOwner(req, item)) c.owner = true
    await appendFile(join(dirOf(item.id), 'comments.jsonl'), JSON.stringify(c) + '\n')
    send(req, res, 201, c)
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://local')
    const path = url.pathname
    const M = req.method ?? 'GET'
    let m: RegExpExecArray | null
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer') // keys in URLs never leak to other sites
    res.setHeader('X-Robots-Tag', 'noindex')

    if (path === '/api/items' && M === 'POST') return create(req, res)
    if (path === '/api/owner' && M === 'POST') {
      const { token } = await readJson(req)
      need(typeof token === 'string' && TOKEN.test(token), 400, 'Invalid owner token.')
      ownerCookie(res, token)
      return send(req, res, 204)
    }
    if ((m = new RegExp(`^/api/items/(${ID})(?:/(data|finalize|poster|comments|views))?(?:/([\\w-]+))?$`).exec(path))) {
      const item = await load(m[1])
      const route = `${M} ${m[2] ?? ''}${m[3] ? '/:cid' : ''}`
      const owner = isOwner(req, item)
      const ownerOnly = () => need(owner, 403, 'Only the owner can do that.')
      switch (route) {
        case 'GET ':
          need(canView(req, url, item), 403, 'This link is private.')
          return send(req, res, 200, await itemJson(req, item))
        case 'PATCH ': {
          ownerOnly()
          const b = await readJson(req)
          const next = await update(item.id, (it) => {
            if (typeof b.private === 'boolean') it.private = b.private
            if (b.title !== undefined) it.title = clean(b.title, 200) || it.title
          })
          return send(req, res, 200, await itemJson(req, next))
        }
        case 'DELETE ':
          ownerOnly()
          writing.get(item.id)?.req.destroy()
          await rm(dirOf(item.id), { recursive: true, force: true })
          return send(req, res, 204)
        case 'PUT data':
          ownerOnly()
          return putData(req, res, url, item)
        case 'POST finalize':
          ownerOnly()
          return finalize(req, res, item)
        case 'PUT poster': {
          ownerOnly()
          need(item.kind === 'video', 400, 'Only videos have posters.')
          const jpg = await readBody(req, 4 * 2 ** 20)
          need(jpg[0] === 0xff && jpg[1] === 0xd8 && jpg[2] === 0xff, 400, 'The poster must be a JPEG.')
          const tmp = join(dirOf(item.id), 'poster.tmp')
          await writeFile(tmp, jpg)
          await rename(tmp, join(dirOf(item.id), 'poster.jpg'))
          await update(item.id, (it) => void (it.poster = true))
          return send(req, res, 204)
        }
        case 'GET comments':
          need(canView(req, url, item), 403, 'This link is private.')
          return send(req, res, 200, await comments(item))
        case 'POST comments':
          need(canView(req, url, item), 403, 'This link is private.')
          return addComment(req, res, item)
        case 'DELETE comments/:cid':
          ownerOnly()
          await appendFile(join(dirOf(item.id), 'comments.jsonl'), JSON.stringify({ deleted: m[3] }) + '\n')
          return send(req, res, 204)
        case 'POST views':
          need(canView(req, url, item), 403, 'This link is private.')
          if (!owner && item.state === 'ready') await update(item.id, (it) => void it.views++)
          return send(req, res, 204)
      }
      throw new HttpError(405, 'Method not allowed.')
    }
    if ((m = new RegExp(`^/v/(${ID})(?:/(video\\.mp4|poster\\.jpg|project\\.tar))?$`).exec(path)) && (M === 'GET' || M === 'HEAD')) {
      const item = await load(m[1])
      need(canView(req, url, item), 403, 'This link is private.')
      const file = m[2]
      if (!file) {
        const nonce = randomBytes(12).toString('base64')
        const owner = isOwner(req, item)
        const html = itemPage({
          item,
          base: base(req),
          key: keyOf(url, item),
          owner,
          views: owner ? item.views : null,
          offset: item.state === 'uploading' ? await partSize(item.id) : item.size,
          comments: item.kind === 'video' && item.state === 'ready' ? await comments(item) : [],
          nonce,
        })
        return sendHtml(req, res, 200, html, nonce)
      }
      need(item.state === 'ready', 404, 'Not uploaded yet.')
      need((file === 'project.tar') === (item.kind === 'project'), 404, 'Not found.')
      if (file === 'poster.jpg') need(item.poster, 404, 'No poster.')
      const type = file === 'video.mp4' ? 'video/mp4' : file === 'poster.jpg' ? 'image/jpeg' : 'application/x-tar'
      const extra: Record<string, string> = { 'Cache-Control': 'private, max-age=3600' }
      if (file === 'project.tar') {
        const ascii = item.name.replace(/[^\x20-\x7e]|["\\]/g, '_')
        extra['Content-Disposition'] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(item.name)}`
      }
      return serveFile(req, res, join(dirOf(item.id), file), type, extra)
    }
    throw new HttpError(404, 'Not found.')
  }

  /** Remove uploads that never finished (and folders a crash left without meta) once they are a week old. */
  async function sweep() {
    for (const id of await readdir(root).catch(() => [])) {
      const d = dirOf(id)
      const meta = await readFile(join(d, 'meta.json'), 'utf8').then(JSON.parse, () => null)
      const born = meta ? Date.parse(meta.createdAt) : (await stat(d).catch(() => null))?.mtimeMs ?? Date.now()
      if (meta?.state !== 'ready' && Date.now() - born > STALE_MS && !writing.has(id)) await rm(d, { recursive: true, force: true })
    }
  }
  await sweep()
  const sweeper = setInterval(() => sweep().catch((e) => console.error('sweep:', e)), 6 * 3600e3)
  sweeper.unref()

  const server = createServer((req, res) =>
    handle(req, res).catch((e: unknown) => {
      const err = e instanceof HttpError ? e : new HttpError(500, 'Something went wrong on the share server.')
      if (!(e instanceof HttpError)) console.error(req.method, req.url, e)
      if (res.headersSent || res.destroyed) return res.destroy()
      // A request body we did not read (rejected early) must not be parsed as the next request.
      if (!req.complete) res.setHeader('Connection', 'close')
      if (new URL(req.url ?? '/', 'http://local').pathname.startsWith('/v/')) {
        const nonce = randomBytes(12).toString('base64')
        const title = err.status === 403 ? 'This link is private' : err.status === 404 ? 'Link not found' : 'Something went wrong'
        const text = err.status === 403 ? 'Ask the person who shared it for the full link.' : err.message
        sendHtml(req, res, err.status, messagePage(title, text, nonce), nonce)
      } else send(req, res, err.status, { error: err.message, ...err.extra })
    }),
  )
  server.requestTimeout = 0 // chunks stream for as long as they need on slow uplinks
  server.setTimeout(60_000) // ...but a socket that goes silent for a minute is dropped
  await new Promise<void>((r) => server.listen(opts.port ?? 0, r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : opts.port
  return {
    url: `http://localhost:${port}`,
    close: () =>
      new Promise((r) => {
        clearInterval(sweeper)
        server.close(() => r())
        server.closeAllConnections()
      }),
  }
}

// ---- HTTP helpers ----

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let n = 0
  for await (const c of req as AsyncIterable<Buffer>) {
    n += c.length
    if (n > limit) throw new HttpError(413, 'The request is too large.')
    parts.push(c)
  }
  return Buffer.concat(parts)
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  // JSON only: a cross-site form cannot send it without a CORS preflight, which this server never grants.
  need(req.headers['content-type']?.startsWith('application/json'), 415, 'Send JSON.')
  try {
    const v = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8'))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch (e) {
    if (e instanceof HttpError) throw e
  }
  throw new HttpError(400, 'Invalid JSON.')
}

function send(req: IncomingMessage, res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) return res.writeHead(status).end()
  const json = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': json.length, 'Cache-Control': 'no-store' })
  res.end(req.method === 'HEAD' ? undefined : json)
}

function sendHtml(req: IncomingMessage, res: ServerResponse, status: number, html: string, nonce: string) {
  let body = Buffer.from(html)
  const headers: Record<string, string | number> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    Vary: 'Accept-Encoding',
  }
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    body = gzipSync(body)
    headers['Content-Encoding'] = 'gzip'
  }
  headers['Content-Length'] = body.length
  res.writeHead(status, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}

/** Static file with single-range Range support (what <video> and download resumption use). */
async function serveFile(req: IncomingMessage, res: ServerResponse, path: string, type: string, extra: Record<string, string>) {
  const size = (await stat(path).catch(() => null))?.size
  need(size !== undefined, 404, 'Not found.')
  const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', ...extra }
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (!m || (!m[1] && !m[2])) {
    res.writeHead(200, { ...head, 'Content-Length': size })
    if (req.method === 'HEAD') return res.end()
    return pipeline(createReadStream(path), res).catch(() => {})
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  if (start >= size || start > end) return res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
  if (req.method === 'HEAD') return res.end()
  return pipeline(createReadStream(path, { start, end }), res).catch(() => {})
}

// ---- Fast start ----

export interface VideoInfo {
  duration: number
  width: number
  height: number
  remuxed: boolean
}

/** Top-level ISO BMFF box types in file order. */
export async function topBoxes(path: string): Promise<string[]> {
  const fh = await open(path)
  try {
    const size = (await fh.stat()).size
    const b = Buffer.alloc(16)
    const types: string[] = []
    for (let pos = 0; pos + 8 <= size && types.length < 1000; ) {
      await fh.read(b, 0, 16, pos)
      let len = b.readUInt32BE(0)
      if (len === 1) len = Number(b.readBigUInt64BE(8))
      else if (len === 0) len = size - pos
      if (len < 8) break
      types.push(b.toString('latin1', 4, 8))
      pos += len
    }
    return types
  } finally {
    await fh.close()
  }
}

/** Check that `src` is a browser-playable MP4/MOV. Unless its moov box already precedes the media (and it is not
 *  fragmented), remux it into `out` with the moov box first, so playback starts after the first few kilobytes.
 *  Memory stays flat: packets stream through, and the moov space is reserved up front from the packet counts. */
export async function fastStart(src: string, out: string): Promise<VideoInfo> {
  const input = new Input({ source: new FilePathSource(src), formats: ALL_FORMATS })
  try {
    if (!(await input.canRead())) throw new Error('That file is not a video.')
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error('That file has no video track.')
    const codec = await video.getCodec()
    if (!codec || !PLAYABLE.includes(codec)) throw new Error(`Browsers cannot play ${codec ?? 'this'} video. Export as H.264 or HEVC.`)
    const info = {
      duration: Math.round((await input.computeDuration()) * 1000) / 1000,
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      remuxed: false,
    }
    const boxes = await topBoxes(src)
    const moov = boxes.indexOf('moov')
    const mdat = boxes.indexOf('mdat')
    if (moov >= 0 && (mdat < 0 || moov < mdat) && !boxes.includes('moof')) return info

    const audio = await input.getPrimaryAudioTrack()
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target: new FilePathTarget(out) })
    const tracks: Array<{ add(p: EncodedPacket): Promise<void>; close(): void; it: AsyncGenerator<EncodedPacket> }> = []
    for (const t of audio ? [video, audio] : [video]) {
      const maximumPacketCount = (await t.computePacketStats()).packetCount
      const it = new EncodedPacketSink(t).packets()
      if (t.isVideoTrack()) {
        const source = new EncodedVideoPacketSource((await t.getCodec())!)
        const meta = { decoderConfig: (await t.getDecoderConfig()) ?? undefined }
        output.addVideoTrack(source, { maximumPacketCount, rotation: await t.getRotation() })
        tracks.push({ add: (p) => source.add(p, meta), close: () => source.close(), it })
      } else if (t.isAudioTrack()) {
        const c = await t.getCodec()
        if (!c) continue
        const source = new EncodedAudioPacketSource(c)
        const meta = { decoderConfig: (await t.getDecoderConfig()) ?? undefined }
        output.addAudioTrack(source, { maximumPacketCount, languageCode: await t.getLanguageCode() })
        tracks.push({ add: (p) => source.add(p, meta), close: () => source.close(), it })
      }
    }
    await output.start()
    // Merge tracks by timestamp so audio and video interleave: a browser then reads one stream front to back.
    const heads: Array<EncodedPacket | null> = await Promise.all(tracks.map(async (t) => (await t.it.next()).value ?? null))
    const maxTs = tracks.map(() => -Infinity)
    for (;;) {
      let i = -1
      heads.forEach((p, j) => p && (i < 0 || p.timestamp < heads[i]!.timestamp) && (i = j))
      if (i < 0) break
      let p = heads[i]!
      // The muxer rejects a key packet earlier than the previous GOP's latest timestamp; keep it in that GOP.
      if (p.type === 'key' && p.timestamp < maxTs[i]) p = p.clone({ type: 'delta' })
      maxTs[i] = Math.max(maxTs[i], p.timestamp)
      await tracks[i].add(p)
      heads[i] = (await tracks[i].it.next()).value ?? null
    }
    for (const t of tracks) t.close()
    await output.finalize()
    return { ...info, remuxed: true }
  } finally {
    input.dispose()
  }
}

if (import.meta.main) {
  const dir = resolve(process.env.STUDIO_SHARE_DATA ?? join(import.meta.dirname, '../.context/share'))
  const s = await startServer({
    port: Number(process.env.PORT ?? 7433),
    dir,
    publicUrl: process.env.STUDIO_SHARE_URL,
    uploadKey: process.env.STUDIO_SHARE_UPLOAD_KEY,
  })
  console.log(`Share server: ${process.env.STUDIO_SHARE_URL ?? s.url} (data in ${dir})`)
}
