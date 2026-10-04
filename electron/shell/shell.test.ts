import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStudioUrl } from './url.ts'
import { plainError } from './errors.ts'
import { areaOf, fit, place, reachable } from './bounds.ts'
import { readFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'

test('studio:// urls', () => {
  assert.deepEqual(parseStudioUrl('studio://record'), { kind: 'record' })
  assert.deepEqual(parseStudioUrl('studio://record/?mode=area'), { kind: 'record', mode: 'area' })
  assert.deepEqual(parseStudioUrl('studio://record?mode=evil'), { kind: 'record' })
  assert.deepEqual(parseStudioUrl('STUDIO://Stop'), { kind: 'stop' })
  // Hostile names round-trip, encoded or raw.
  const path = '/Users/me/Movies/Demo #1 ✨ café + C++.studio'
  assert.deepEqual(parseStudioUrl(`studio://open?path=${encodeURIComponent(path)}`), { kind: 'open', path })
  assert.deepEqual(parseStudioUrl(`studio://open?path=${path}`), { kind: 'open', path })
  assert.deepEqual(parseStudioUrl(`studio://open?path=${encodeURIComponent(path)}/`), { kind: 'open', path })
  assert.deepEqual(parseStudioUrl('studio://open?path=/a/100%.studio'), { kind: 'open', path: '/a/100%.studio' })
  // Shared project links (the link page's "Open in Studio") import; only http(s) links do.
  const link = 'https://share.example/v/abcdefghijklmnopqrstuv/project.tar?k=key'
  assert.deepEqual(parseStudioUrl(`studio://open?url=${encodeURIComponent(link)}`), { kind: 'import', url: link })
  assert.equal(parseStudioUrl(`studio://open?url=${encodeURIComponent('file:///etc/passwd')}`), null)
  // Only absolute bundle paths open.
  assert.equal(parseStudioUrl('studio://open?path=relative.studio'), null)
  assert.equal(parseStudioUrl('studio://open?path=/etc/passwd'), null)
  assert.equal(parseStudioUrl('studio://delete'), null)
  assert.equal(parseStudioUrl('https://record'), null)
})

test('plain-language errors', () => {
  const full = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
  assert.match(plainError(full).message, /disk is full/)
  assert.match(plainError("Error invoking remote method 'recording:start': Error: write failed (OSStatus -34)").message, /disk is full/)
  assert.match(plainError('AVFoundation error -11807').message, /disk is full/)
  assert.deepEqual(plainError('SCStreamErrorDomain error -3801').permission, 'screen')
  assert.equal(plainError('The user declined TCCs for application, window, display capture').permission, 'screen')
  assert.equal(plainError(new Error('Microphone access denied')).permission, 'microphone')
  assert.match(plainError(Object.assign(new Error('x'), { code: 'EACCES' })).message, /not allowed/)
  assert.match(plainError('EROFS: read-only file system').message, /read-only/)
  // Unknown errors keep their text without the IPC wrapper; nothing becomes empty.
  assert.equal(plainError("Error invoking remote method 'recording:start': Error: camera busy").message, 'camera busy.')
  assert.equal(plainError(undefined).message, 'Something went wrong. Try again.')
  // A plain number inside a word or file name is not a status code.
  assert.equal(plainError('take-34.mov failed').message, 'take-34.mov failed.')
})

test('window placement', () => {
  const main = { x: 0, y: 0, width: 1512, height: 944 }
  const ext = { x: 1512, y: -200, width: 2560, height: 1415 }
  // A window left on an unplugged display is unreachable and comes back fitted.
  const lost = { x: 2000, y: 100, width: 1280, height: 820 }
  assert.equal(reachable(lost, [main, ext]), true)
  assert.equal(reachable(lost, [main]), false)
  assert.deepEqual(fit(lost, main), { x: 232, y: 100, width: 1280, height: 820 })
  // Title bar above the top of the screen is unreachable; a sliver on screen is not enough.
  assert.equal(reachable({ x: 100, y: -50, width: 400, height: 300 }, [main]), false)
  assert.equal(reachable({ x: 1500, y: 100, width: 400, height: 300 }, [main]), false)
  // Bigger than the screen: shrink to fit.
  assert.deepEqual(fit({ x: -10, y: 0, width: 3000, height: 2000 }, main), main)
  assert.deepEqual(place({ width: 880, height: 64 }, main, 20), { x: 316, y: 860, width: 880, height: 64 })
  assert.equal(areaOf({ x: 1400, y: 0, width: 400, height: 300 }, [main, ext]), 1)
  assert.equal(areaOf({ x: 9000, y: 0, width: 10, height: 10 }, [main, ext]), -1)
})

test('the packaged app ships every file the main process imports', () => {
  // An import outside package.json build.files loads in dev and kills the built app at launch.
  const root = join(import.meta.dirname, '../..')
  const globs: string[] = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build.files
  const has = (f: string, neg: boolean) => globs.some((g) => g.startsWith('!') === neg && matchesGlob(f, neg ? g.slice(1) : g))
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    // Runtime imports only: type-only imports and `typeof import()` are erased.
    const src = readFileSync(join(root, file), 'utf8').replace(/(?:import|export)\s+type\b[^;]*?from\s*['"][^'"]*['"]|typeof\s+import\([^)]*\)/g, '')
    for (const m of src.matchAll(/(?:\bfrom|^\s*import|\bimport\()\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) walk(join(dirname(file), m[1]))
  }
  walk('electron/main.ts')
  assert.ok(seen.size > 20, `found only ${seen.size} files`)
  assert.deepEqual([...seen].filter((f) => !has(f, false) || has(f, true)), [])
})
