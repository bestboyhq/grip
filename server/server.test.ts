// End to end: the real upload client against the real server, on a synthetic MP4 whose moov box comes last.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, FilePathTarget, Mp4OutputFormat, Output } from 'mediabunny'
import { startServer as start, topBoxes, type Options } from './server.ts'
import { api, ShareError, upload, type Upload } from './client.ts'

const dir = mkdtempSync(join(tmpdir(), 'studio-share-'))
const servers: Array<{ close(): Promise<void> }> = []
const startServer = async (o: Options) => {
  const s = await start(o)
  servers.push(s)
  return s
}
after(() => Promise.all(servers.map((s) => s.close())))
const OWNER = 'o'.repeat(43)
const STRANGER = 's'.repeat(43)

/** 4 s of 1280x720 H.264 + AAC packet stream (payloads are filler: the server never decodes). */
async function slowStartMp4(path: string) {
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new FilePathTarget(path) })
  const video = new EncodedVideoPacketSource('avc')
  const audio = new EncodedAudioPacketSource('aac')
  out.addVideoTrack(video)
  out.addAudioTrack(audio)
  await out.start()
  const vMeta = { decoderConfig: { codec: 'avc1.64001f', codedWidth: 1280, codedHeight: 720, description: Buffer.from('0164001fffe1000a2764001fac56805005b901000428ee3cb0fdf8f800', 'hex') } }
  const aMeta = { decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: 1, sampleRate: 48000, description: Buffer.from('1188', 'hex') } }
  const fill = (n: number, seed: number) => Buffer.alloc(n, seed)
  for (let i = 0; i < 120; i++) {
    await video.add(new EncodedPacket(fill(20_000, i), i % 30 ? 'delta' : 'key', i / 30, 1 / 30), vMeta)
    for (let a = Math.ceil(((i / 30) * 48000) / 1024); (a * 1024) / 48000 < (i + 1) / 30; a++)
      await audio.add(new EncodedPacket(fill(300, a), 'key', (a * 1024) / 48000, 1024 / 48000), aMeta)
  }
  await out.finalize()
}

const job = (file: string, extra: Partial<Upload> = {}): Upload => {
  const s = statSync(file)
  return { file, kind: 'video', title: 'Demo #1 ✨ café', private: false, size: s.size, mtimeMs: s.mtimeMs, ...extra }
}
const quiet = { progress() {}, created() {} }
const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, redirect: 'manual' })

test('resumable upload survives a dropped connection and a server restart; MP4 becomes fast start', async () => {
  const file = join(dir, 'export.mp4')
  await slowStartMp4(file)
  const before = await topBoxes(file)
  assert.ok(before.indexOf('moov') > before.indexOf('mdat'), 'fixture has moov last')

  let server = await startServer({ port: 0, dir: join(dir, 'data') })
  const port = new URL(server.url).port
  const j = job(file)
  j.remote = await api(server.url, OWNER, 'POST', '/api/items', { kind: 'video', title: j.title, private: false, size: j.size, name: 'export.mp4' })
  assert.match(j.remote!.link, /\/v\/[\w-]{22}$/)

  // Send 300 kB of the first chunk, then cut the connection mid-body.
  const bytes = readFileSync(file)
  await new Promise<void>((resolve) => {
    const req = request(`${server.url}/api/items/${j.remote!.id}/data?offset=0`, { method: 'PUT', headers: { authorization: `Bearer ${OWNER}` } })
    req.on('error', () => resolve())
    req.write(bytes.subarray(0, 300_000), () => setTimeout(() => (req.destroy(), resolve()), 100))
  })
  await new Promise((r) => setTimeout(r, 100))
  const partial = (await api(server.url, OWNER, 'GET', `/api/items/${j.remote!.id}`)).offset
  assert.ok(partial > 0 && partial <= 300_000, `kept what arrived (${partial})`)

  // A wrong offset is refused with the right one.
  await assert.rejects(api(server.url, OWNER, 'PUT', `/api/items/${j.remote!.id}/data?offset=5`, Buffer.from('x')), (e: any) => e.status === 409 && e.data.offset === partial)

  // Server goes down; the client waits and resumes once it is back on the same port.
  await server.close()
  const states: string[] = []
  const done = upload(`http://localhost:${port}`, OWNER, j, { progress: (_n, s) => states.push(s), created() {} })
  await new Promise((r) => setTimeout(r, 300))
  server = await startServer({ port: Number(port), dir: join(dir, 'data') })
  const item = await done
  assert.ok(states.includes('waiting'), 'reported waiting while the server was down')
  assert.equal(item.state, 'ready')
  assert.ok(Math.abs(item.duration! - 4) < 0.05, `duration ${item.duration}`)

  const stored = join(dir, 'data/items', item.id, 'video.mp4')
  const after = await topBoxes(stored)
  assert.ok(after.indexOf('moov') < after.indexOf('mdat'), `moov first: ${after}`)

  const r = await get(`${server.url}/v/${item.id}/video.mp4`, { range: 'bytes=0-99' })
  assert.equal(r.status, 206)
  assert.equal(r.headers.get('content-range'), `bytes 0-99/${statSync(stored).size}`)
  assert.equal((await r.arrayBuffer()).byteLength, 100)
  const page = await (await get(`${server.url}/v/${item.id}`)).text()
  assert.match(page, /<meta property="og:title" content="Demo #1 ✨ café">/)
  assert.match(page, /<video id="video" src="http:\/\/localhost:\d+\/v\/[\w-]{22}\/video\.mp4"/)
  await server.close()
})

test('private links, comments, and owner-free view counts', async () => {
  const server = await startServer({ port: 0, dir: join(dir, 'data2') })
  const file = join(dir, 'export2.mp4')
  await slowStartMp4(file)
  const item = await upload(server.url, OWNER, job(file, { private: true }), quiet)
  const v = `${server.url}/v/${item.id}`
  assert.equal(item.link, `${v}?k=${item.key}`)

  for (const url of [v, `${v}?k=nope`, `${v}/video.mp4`, `${v}?k=${'x'.repeat(22)}`]) assert.equal((await get(url)).status, 403, url)
  const blocked = await (await get(v)).text()
  assert.doesNotMatch(blocked, /café/, 'a private page leaks no title')
  assert.equal((await get(`${v}?k=${item.key}`)).status, 200)
  assert.equal((await get(`${v}/video.mp4?k=${item.key}`, { range: 'bytes=0-9' })).status, 206)
  assert.equal((await get(v, { cookie: `studio_owner=${OWNER}` })).status, 200, 'owner opens without the key')
  assert.equal((await get(v, { cookie: `studio_owner=${STRANGER}` })).status, 403)
  await assert.rejects(api(server.url, STRANGER, 'PATCH', `/api/items/${item.id}`, { private: false }), ShareError)

  // Comments round-trip, hostile text stays text.
  const q = `?k=${item.key}`
  const post = (body: object) => fetch(`${server.url}/api/items/${item.id}/comments${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post({ name: 'Ann', text: 'hi', t: 99 })).status, 400, 'time outside the video')
  const c = await (await post({ name: '<b>Zoë</b> 🎬', text: 'Nice cut </script><script>alert(1)</script>', t: 1.234 })).json()
  assert.equal(c.t, 1.23)
  await post({ name: 'Ann', text: 'first', t: 0.5 })
  const list = await (await fetch(`${server.url}/api/items/${item.id}/comments${q}`)).json()
  assert.deepEqual(list.map((x: any) => x.text), ['first', 'Nice cut </script><script>alert(1)</script>'])
  const html = await (await get(`${v}${q}`)).text()
  assert.ok(html.includes('\\u003c/script>\\u003cscript>alert(1)'), 'inlined comments are escaped')
  assert.ok(!html.includes('<script>alert(1)'))
  assert.equal((await fetch(`${server.url}/api/items/${item.id}/comments/${c.id}${q}`, { method: 'DELETE' })).status, 403)
  await api(server.url, OWNER, 'DELETE', `/api/items/${item.id}/comments/${c.id}`)
  assert.equal((await (await fetch(`${server.url}/api/items/${item.id}/comments${q}`)).json()).length, 1)

  // Views: the owner's plays do not count.
  const view = (headers: Record<string, string> = {}) => fetch(`${server.url}/api/items/${item.id}/views${q}`, { method: 'POST', headers })
  await view({ cookie: `studio_owner=${OWNER}` })
  await view()
  await view()
  const owned = await api(server.url, OWNER, 'GET', `/api/items/${item.id}`)
  assert.equal(owned.views, 2)
  assert.equal(owned.comments, 1)
  const pub = await (await fetch(`${server.url}/api/items/${item.id}${q}`)).json()
  assert.equal(pub.views, undefined, 'viewers do not see the key or counts')
  assert.equal(pub.key, undefined)

  // Making it public opens the bare link; the old key link keeps working.
  const open = await api(server.url, OWNER, 'PATCH', `/api/items/${item.id}`, { private: false })
  assert.equal(open.link, v)
  assert.equal((await get(v)).status, 200)

  // Privacy switched on while the item was being created reaches the server before the link goes out.
  const late = job(file, { private: true })
  late.remote = await api(server.url, OWNER, 'POST', '/api/items', { kind: 'video', title: 't', private: false, size: late.size, name: 'x.mp4' })
  let linkAtCreated = ''
  const done = await upload(server.url, OWNER, late, { progress() {}, created: () => void (linkAtCreated = late.remote!.link) })
  assert.equal(done.private, true)
  assert.match(linkAtCreated, /\?k=[\w-]{22}$/)
  await server.close()
})

test('project archives download with their hostile name; junk is refused', async () => {
  const server = await startServer({ port: 0, dir: join(dir, 'data3') })
  const bundle = join(dir, 'Demo #1 ✨ café.grip')
  mkdirSync(join(bundle, 'sources'), { recursive: true })
  writeFileSync(join(bundle, 'project.json'), '{}')
  const tar = join(dir, 'Demo #1 ✨ café.grip.tar')
  execFileSync('tar', ['-cf', tar, '-C', dir, 'Demo #1 ✨ café.grip'])
  const item = await upload(server.url, OWNER, job(tar, { kind: 'project' }), quiet)
  const r = await get(`${server.url}/v/${item.id}/project.tar`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-disposition'), `attachment; filename="Demo #1 _ caf_.grip.tar"; filename*=UTF-8''${encodeURIComponent('Demo #1 ✨ café.grip.tar')}`)
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), readFileSync(tar))
  assert.match(await (await get(`${server.url}/v/${item.id}`)).text(), /href="grip:\/\/open\?url=http%3A%2F%2Flocalhost/)

  const junk = join(dir, 'junk.mp4')
  writeFileSync(junk, Buffer.alloc(4096, 7))
  await assert.rejects(upload(server.url, OWNER, job(junk), quiet), (e: Error) => e instanceof ShareError && /not a video/.test(e.message))
  await server.close()
})
