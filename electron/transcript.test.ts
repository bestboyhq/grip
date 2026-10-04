import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// transcript.ts runs in Electron's main process: stand in for the modules that need Electron.
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`
register(
  stub(`export async function resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: ${JSON.stringify(stub('export const app = {}, BrowserWindow = {}, dialog = {}, ipcMain = {}'))}, shortCircuit: true }
    if (specifier === './native.ts') return { url: ${JSON.stringify(stub('export const native = {}'))}, shortCircuit: true }
    return next(specifier, context)
  }`),
)
const { download } = await import('./transcript.ts')

test('model download resumes where it stopped and checks its checksum', async () => {
  const body = randomBytes(400_000)
  const ranges: string[] = []
  const server = createServer((req, res) => {
    ranges.push(req.headers.range ?? '')
    const from = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0)
    res.writeHead(from ? 206 : 200, { 'Content-Length': body.length - from })
    let at = from
    const drip = () => (at >= body.length ? res.end() : res.write(body.subarray(at, (at += 50_000)), () => setTimeout(drip, 2)))
    drip()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/model`
  const dir = mkdtempSync(join(tmpdir(), 'studio-model-'))
  const path = join(dir, 'model #1 ✨.onnx')
  const file = { name: 'model', size: body.length, sha256: createHash('sha256').update(body).digest('hex') }
  try {
    // Interrupted after 250 kB: what reached the disk stays.
    const ac = new AbortController()
    await assert.rejects(download(url, file, path, ac.signal, (n) => n >= 250_000 && ac.abort()))
    const part = statSync(path + '.part').size
    assert.ok(part > 0 && part < body.length, `${part} bytes kept`)
    // Resumed: asks only for the rest, and the file takes its name once complete.
    await download(url, file, path, new AbortController().signal, () => {})
    assert.equal(ranges.at(-1), `bytes=${part}-`)
    assert.ok(readFileSync(path).equals(body))
    assert.ok(!existsSync(path + '.part'))
    // Damaged on the way: rejected and deleted, so the next try starts clean.
    const bad = join(dir, 'bad.onnx')
    await assert.rejects(download(url, { ...file, sha256: '0'.repeat(64) }, bad, new AbortController().signal, () => {}), /damaged/)
    assert.ok(!existsSync(bad) && !existsSync(bad + '.part'))
  } finally {
    server.closeAllConnections()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
