// `media://local/<encodeURIComponent(absolute path)>` serves local files to renderers with HTTP
// Range support, so decoders can seek inside multi-GB sources without loading them.
// Renderers (pages and workers, whose origin differs from media:) fetch with CORS.
// PUT writes derived data into a bundle's cache/ folder (waveforms, loudness); nothing else is writable.
import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { dirname, extname, normalize } from 'node:path'
import { followFile } from './projects.ts'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
])

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.caf': 'audio/x-caf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.jsonl': 'application/x-ndjson',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
}

/** A file inside `<something>.studio/cache/`, after normalization (no `..` escapes). */
const isCacheFile = (path: string) => path === normalize(path) && /\.studio\/cache\/[^/]+$/.test(path)

export function registerMediaProtocol() {
  protocol.handle('media', async (req) => {
    const path = followFile(decodeURIComponent(new URL(req.url).pathname.slice(1)))
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (req.method === 'PUT') {
      if (!isCacheFile(path)) return new Response('only bundle cache files are writable', { status: 403, headers: CORS })
      try {
        await mkdir(dirname(path), { recursive: true })
        const tmp = `${path}.${process.pid}.tmp`
        await writeFile(tmp, new Uint8Array(await req.arrayBuffer()))
        await rename(tmp, path) // atomic: a crash never leaves a torn cache file
        return new Response(null, { status: 204, headers: CORS })
      } catch (e) {
        return new Response(String(e), { status: 500, headers: CORS })
      }
    }
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return new Response('not found', { status: 404, headers: CORS })
    }
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const body = (start: number, end: number) => (req.method === 'HEAD' ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream))
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
    if (!m) {
      return new Response(size ? body(0, size - 1) : null, {
        headers: { ...CORS, 'Content-Length': String(size), 'Content-Type': type, 'Accept-Ranges': 'bytes' },
      })
    }
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...CORS, 'Content-Range': `bytes */${size}` } })
    return new Response(body(start, end), {
      status: 206,
      headers: {
        ...CORS,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
      },
    })
  })
}
