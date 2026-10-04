// `studio://` automation URLs (Raycast, Shortcuts, scripts):
//   studio://record[?mode=display|window|area|device]   open the recording picker
//   studio://stop                                         finish the recording in progress
//   studio://open?path=<absolute path to a .studio bundle>
//   studio://open?url=<shared project link>               download it and open it (electron/share.ts)
// Launch arguments: `[--open] <bundle.studio | video.mp4>`, `studio://` URLs, `--lab <Name>` (dev).
// Pure: no electron imports, so node:test can run it.
import { closeSync, constants, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type Mode = 'display' | 'window' | 'area' | 'device'
export type UrlAction = { kind: 'record'; mode?: Mode } | { kind: 'stop' } | { kind: 'open'; path: string } | { kind: 'import'; url: string }

const MODES = ['display', 'window', 'area', 'device']

export function parseStudioUrl(url: string): UrlAction | null {
  const m = /^studio:\/*([a-z]+)\/?(?:\?(.*))?$/is.exec(url.trim())
  if (!m) return null
  // Read the query by hand: URLSearchParams turns a raw "+" into a space, and a raw "#" would end
  // the query in `new URL`. Both are legal in file names ("C++ #1.studio").
  const query = new Map<string, string>()
  for (const pair of (m[2] ?? '').split('&')) {
    const i = pair.indexOf('=')
    if (i > 0) query.set(pair.slice(0, i), decode(pair.slice(i + 1)))
  }
  const action = m[1].toLowerCase()
  if (action === 'record') {
    const mode = query.get('mode')
    return mode && MODES.includes(mode) ? { kind: 'record', mode: mode as Mode } : { kind: 'record' }
  }
  if (action === 'stop') return { kind: 'stop' }
  if (action === 'open') {
    const url = query.get('url')
    if (url) return /^https?:\/\//i.test(url) ? { kind: 'import', url } : null
    const path = query.get('path')?.replace(/\/+$/, '')
    return path && path.startsWith('/') && path.endsWith('.studio') ? { kind: 'open', path } : null
  }
  return null
}

/** What a launch asks for. Files are absolute, relative ones resolved against `cwd` (the launching
 *  shell's directory). A second instance's argv has Chromium's order: switches first, then the app
 *  path ("." in dev), then the rest; lab names start with a letter. */
export function parseLaunch(argv: string[], cwd: string): { lab?: string; urls: string[]; files: string[] } {
  const args = argv.slice(1)
  const lab = args.indexOf('--lab')
  if (lab >= 0) return { lab: args.slice(lab + 1).find((a) => /^[a-z]/i.test(a)) ?? '', urls: [], files: [] }
  const urls = args.filter((a) => /^studio:/i.test(a))
  const files = args.filter((a) => !urls.includes(a) && !a.startsWith('-') && /\.(studio\/?|mp4|mov)$/i.test(a))
  return { urls, files: files.map((a) => resolve(cwd, a)) }
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s // a stray "%" in a raw name
  }
}

const O_EXLOCK = 0x20 // macOS open(2): wait for an exclusive flock on the file

/** Wait for this launch's turn at the single-instance lock, then run `fn`: launches that start at the
 *  same moment take turns. The flock is released when `fn` returns, or when the process ends, even in
 *  a crash. Without a lockable file (read-only or unsupported volume), `fn` runs at once. */
export function inTurn<T>(file: string, fn: () => T): T {
  let fd: number | null = null
  try {
    mkdirSync(dirname(file), { recursive: true })
    fd = openSync(file, constants.O_CREAT | constants.O_RDWR | O_EXLOCK, 0o600)
  } catch {
    // run without turns
  }
  try {
    return fn()
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
