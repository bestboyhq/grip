// `studio://` automation URLs (Raycast, Shortcuts, scripts):
//   studio://record[?mode=display|window|area|device]   open the recording picker
//   studio://stop                                         finish the recording in progress
//   studio://open?path=<absolute path to a .studio bundle>
//   studio://open?url=<shared project link>               download it and open it (electron/share.ts)
// Pure: no electron imports, so node:test can run it.

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

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s // a stray "%" in a raw name
  }
}
