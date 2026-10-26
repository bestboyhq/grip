// The real upload client against a small in-process fake of the platform's item API (electron/upload.ts lists it).
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShareError, upload, usedUp, type Upload } from './upload.ts'

const PART = 64 * 1024
const TOKEN = 't'.repeat(43)

/** What the server holds, and the misfortunes to stage on the next part uploads. */
const fake = { parts: [] as Buffer[], size: 0, ready: false, limitReached: false, lostAnswer: false, cutPart: false }

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)))
  })

const server = createServer(async (req, res) => {
  const send = (status: number, data?: object) => res.writeHead(status, { 'content-type': 'application/json' }).end(data && JSON.stringify(data))
  const offset = () => Math.min(fake.parts.length * PART, fake.size)
  const item = () => ({ id: 'x7Kq2mP9aB3c', state: fake.ready ? 'ready' : 'uploading', private: false, size: fake.size, offset: offset(), part: PART, link: 'http://fake/v/x7Kq2mP9aB3c' })
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Sign in first.' })
  if (req.method !== 'GET' && !req.headers['content-type']) return send(403, { error: 'No content type.' })
  const url = new URL(req.url!, 'http://fake')
  if (req.method === 'POST' && url.pathname === '/api/items') {
    const b = JSON.parse((await body(req)).toString())
    if (fake.limitReached) return send(402, { error: 'Your team used its 25 uploads for this month.', limit: 25, resetsAt: '2026-11-01T00:00:00.000Z' })
    Object.assign(fake, { parts: [], size: b.size, ready: false })
    return send(201, item())
  }
  if (req.method === 'GET') return send(200, item())
  if (url.pathname.endsWith('/poster')) return send(204)
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
  const j = job('Demo #1 ✨ café.mp4', 3 * PART + 1234)
  Object.assign(fake, { lostAnswer: true, cutPart: true })
  const states: string[] = []
  const item = await upload(URL_, TOKEN, j, { progress: (_n, s) => states.push(s), created() {} })
  assert.equal(item.state, 'ready')
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
