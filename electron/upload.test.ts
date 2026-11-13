// The real upload client against a small in-process fake of the platform's item API (electron/upload.ts lists it).
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { client, ShareError, upload, usedUp, type Upload } from './upload.ts'

const PART = 64 * 1024
const TOKEN = 't'.repeat(43)
client.userAgent = 'Grip/1.2.3 (Macintosh; Mac OS X 15.6.1)'

/** What the server holds, the calls it answered, and the misfortunes to stage on the next part uploads. */
const fake = {
  ...{ id: 'x7Kq2mP9aB3c', parts: [] as Buffer[], size: 0, ready: false, private: false, take: 1, gif: undefined as Buffer | undefined, calls: [] as string[] },
  ...{ limitReached: false, takesFull: false, gifStatus: 0, lostAnswer: false, cutPart: false, terms: undefined as unknown },
}

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)))
  })

const server = createServer(async (req, res) => {
  const send = (status: number, data?: object) => res.writeHead(status, { 'content-type': 'application/json' }).end(data && JSON.stringify(data))
  const offset = () => Math.min(fake.parts.length * PART, fake.size)
  const item = () => ({ id: fake.id, state: fake.ready ? 'ready' : 'uploading', private: fake.private, size: fake.size, offset: offset(), part: PART, take: fake.take, link: `http://fake/v/${fake.id}` })
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Sign in first.' })
  if (req.method !== 'GET' && !req.headers['content-type']) return send(403, { error: 'No content type.' })
  // Every call names Grip: the platform leaves a script's `node` out of its counts.
  if (req.headers['user-agent'] !== client.userAgent) return send(403, { error: 'Not Grip.' })
  const url = new URL(req.url!, 'http://fake')
  fake.calls.push(`${req.method} ${url.pathname}`)
  if (req.method === 'POST' && url.pathname === '/api/items') {
    const b = JSON.parse((await body(req)).toString())
    if (fake.limitReached) return send(402, { error: 'Your team used its 25 uploads for this month.', limit: 25, resetsAt: '2026-11-01T00:00:00.000Z' })
    Object.assign(fake, { id: Math.random().toString(36).slice(2, 14), parts: [], size: b.size, ready: false, private: b.private, take: 1, terms: b.terms })
    return send(201, item())
  }
  if (req.method === 'POST' && url.pathname === `/api/items/${fake.id}/takes`) {
    const b = JSON.parse((await body(req)).toString())
    if (fake.takesFull) return send(402, { error: 'This link holds 20 takes. Share the next one as a new link.', limit: 20 })
    Object.assign(fake, { parts: [], size: b.size, ready: false, take: fake.take + 1 })
    return send(201, item())
  }
  if (req.method === 'GET') return send(200, item())
  if (url.pathname.endsWith('/poster')) return send(204)
  if (url.pathname.endsWith('/gif')) {
    if (fake.gifStatus || req.headers['content-type'] !== 'image/gif') return send(fake.gifStatus || 400, { error: 'No GIF.' })
    fake.gif = await body(req)
    return send(204)
  }
  if (url.pathname.endsWith('/finalize')) return offset() < fake.size ? send(409, { offset: offset() }) : ((fake.ready = true), send(200, item()))
  if (req.method === 'PUT' && url.pathname.endsWith('/data')) {
    const at = Number(url.searchParams.get('offset'))
    if (at !== offset()) return send(409, { offset: offset() })
    if (fake.cutPart && at > 0) {
      // The connection drops partway: the server keeps nothing of this part.
      fake.cutPart = false
      req.once('data', () => req.socket.destroy())
      return
    }
    const bytes = await body(req)
    if (bytes.length !== Math.min(PART, fake.size - at)) return send(408, { error: 'Short part.', offset: at })
    fake.parts.push(bytes)
    // The part landed but its answer is lost; the retry learns the offset from a 409.
    if (fake.lostAnswer) return (fake.lostAnswer = false), send(409, { offset: offset() })
    return send(200, { offset: offset() })
  }
  send(404, { error: 'Not found.' })
})
await new Promise<void>((r) => server.listen(0, r))
after(() => server.close())
const URL_ = `http://localhost:${(server.address() as { port: number }).port}`

const dir = mkdtempSync(join(tmpdir(), 'grip-upload-'))
after(() => rmSync(dir, { recursive: true, force: true }))
function job(name: string, size: number): Upload {
  const file = join(dir, name)
  writeFileSync(file, Buffer.from(Array.from({ length: size }, (_, i) => (i * 7) % 251)))
  const s = statSync(file)
  return { file, kind: 'video', title: 'Demo #1 ✨ café', private: false, size, mtimeMs: s.mtimeMs, meta: { duration: 24, width: 1920, height: 1080 } }
}

test('parts resume after a lost answer and a dropped connection, and arrive whole and in order', async () => {
  const j = { ...job('Demo #1 ✨ café.mp4', 3 * PART + 1234), terms: '2026-11-02' }
  Object.assign(fake, { lostAnswer: true, cutPart: true })
  const states: string[] = []
  const item = await upload(URL_, TOKEN, j, { progress: (_n, s) => states.push(s), created() {} })
  assert.equal(item.state, 'ready')
  assert.equal(fake.terms, '2026-11-02', 'the Terms date the Share button showed is accepted with the item')
  assert.ok(states.includes('waiting'), 'reported waiting while the part was resent')
  assert.deepEqual(Buffer.concat(fake.parts), readFileSync(j.file))
})

test('the monthly limit and a signed-out token end the upload with the reason', async () => {
  fake.limitReached = true
  await assert.rejects(upload(URL_, TOKEN, job('over.mp4', 10), { progress() {}, created() {} }), (e: ShareError) => {
    // Why and when, in UTC, without a count; no retry.
    assert.equal(e.message, 'This month’s uploads are used. Your links keep playing, and uploads open again on November 1.')
    return e instanceof ShareError && e.status === 402 && e.opensAt === '2026-11-01T00:00:00.000Z'
  })
  assert.match(usedUp(undefined).message, /open again next month\.$/)
  fake.limitReached = false
  await assert.rejects(
    upload(URL_, 'nope', job('signed-out.mp4', 10), { progress() {}, created() {} }),
    (e: ShareError) => e instanceof ShareError && e.status === 401 && e.message === 'Sign in to share links.',
  )
})

test('a take resumes behind the same link, keeps its privacy, and sends its GIF before finalize', async () => {
  Object.assign(fake, { ready: true, private: true, take: 1, calls: [] })
  const link = fake.id
  const gif = join(dir, 'Demo #1 ✨ café.gif')
  writeFileSync(gif, 'GIF89a and the rest')
  const j: Upload = { ...job('take.mp4', 2 * PART + 7), takeOf: link, gif }
  // Grip quits once the take exists; it resumes from share.json, where remote is the take.
  const ac = new AbortController()
  await assert.rejects(upload(URL_, TOKEN, j, { signal: ac.signal, progress() {}, created: () => ac.abort() }))
  const item = await upload(URL_, TOKEN, j, { progress() {}, created() {} })
  assert.equal(item.id, link)
  assert.equal(item.take, 2)
  assert.equal(item.private, true, 'a take keeps its link’s privacy')
  assert.deepEqual(Buffer.concat(fake.parts), readFileSync(j.file))
  assert.deepEqual(fake.gif, readFileSync(gif))
  const calls = fake.calls.filter((c) => !c.startsWith('GET') && !c.endsWith('/data'))
  assert.deepEqual(calls, [`POST /api/items/${link}/takes`, `PUT /api/items/${link}/gif`, `POST /api/items/${link}/finalize`])
})

test('a link full of takes sends the video out as a new link, as private as that one', async () => {
  Object.assign(fake, { ready: true, private: true, takesFull: true })
  const full = fake.id
  const item = await upload(URL_, TOKEN, { ...job('full.mp4', 10), takeOf: full }, { progress() {}, created() {} })
  fake.takesFull = false
  assert.notEqual(item.id, full)
  assert.equal(item.take, 1)
  assert.equal(item.private, true)
})

test('a GIF the server refuses costs only the image', async () => {
  fake.gifStatus = 404 // a platform without GIFs
  const gif = join(dir, 'refused.gif')
  writeFileSync(gif, 'GIF89a')
  const item = await upload(URL_, TOKEN, { ...job('refused.mp4', 10), gif }, { progress() {}, created() {} })
  fake.gifStatus = 0
  assert.equal(item.state, 'ready')
  assert.ok(fake.calls.includes(`PUT /api/items/${item.id}/gif`), 'the GIF was offered')
})
