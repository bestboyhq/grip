// `media://local/<encodeURIComponent(absolute path)>` serves local files to renderers with HTTP
// Range support, so decoders can seek inside multi-GB sources without loading them.
import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { extname } from 'node:path'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
])

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.caf': 'audio/x-caf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.jsonl': 'application/x-ndjson',
}

export function registerMediaProtocol() {
  protocol.handle('media', async (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname.slice(1))
    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
    if (!m) {
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
        headers: { 'Content-Length': String(size), 'Content-Type': type, 'Accept-Ranges': 'bytes' },
      })
    }
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
      },
    })
  })
}
