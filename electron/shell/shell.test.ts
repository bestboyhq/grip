import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inTurn, parseLaunch, parseGripUrl } from './url.ts'
import { plainError } from './errors.ts'
import { areaOf, arrangement, fit, place, reachable, under } from './bounds.ts'
import { hold, release } from './session.ts'
import { withScale } from './png.ts'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, matchesGlob } from 'node:path'
import { promisify } from 'node:util'

test('grip:// urls', () => {
  assert.deepEqual(parseGripUrl('grip://record'), { kind: 'record' })
  assert.deepEqual(parseGripUrl('grip://record/?mode=area'), { kind: 'record', mode: 'area' })
  assert.deepEqual(parseGripUrl('grip://record?mode=evil'), { kind: 'record' })
  assert.deepEqual(parseGripUrl('GRIP://Stop'), { kind: 'stop' })
  // Hostile names round-trip, encoded or raw.
  const path = '/Users/me/Movies/Demo #1 ✨ café + C++.grip'
  assert.deepEqual(parseGripUrl(`grip://open?path=${encodeURIComponent(path)}`), { kind: 'open', path })
  assert.deepEqual(parseGripUrl(`grip://open?path=${path}`), { kind: 'open', path })
  assert.deepEqual(parseGripUrl(`grip://open?path=${encodeURIComponent(path)}/`), { kind: 'open', path })
  assert.deepEqual(parseGripUrl('grip://open?path=/a/100%.grip'), { kind: 'open', path: '/a/100%.grip' })
  // Shared project links (the link page's "Open in Grip") import; only http(s) links do.
  const link = 'https://share.example/v/abcdefghijklmnopqrstuv/project.tar?k=key'
  assert.deepEqual(parseGripUrl(`grip://open?url=${encodeURIComponent(link)}`), { kind: 'import', url: link })
  assert.equal(parseGripUrl(`grip://open?url=${encodeURIComponent('file:///etc/passwd')}`), null)
  // Only absolute bundle paths open.
  assert.equal(parseGripUrl('grip://open?path=relative.grip'), null)
  assert.equal(parseGripUrl('grip://open?path=/etc/passwd'), null)
  assert.equal(parseGripUrl('grip://delete'), null)
  assert.equal(parseGripUrl('https://record'), null)
})

test('launch arguments', () => {
  const exe = '/Applications/Grip.app/Contents/MacOS/Grip'
  // A second instance from another directory: its relative paths are its own.
  assert.deepEqual(parseLaunch([exe, '--allow-file-access-from-files', 'Demo #1 ✨.grip', 'clip.mov', 'grip://stop'], '/Users/me/Movies'), {
    urls: ['grip://stop'],
    files: ['/Users/me/Movies/Demo #1 ✨.grip', '/Users/me/Movies/clip.mov'],
  })
  // A grip://open URL is a URL, not a file, though it ends in .grip.
  assert.deepEqual(parseLaunch([exe, 'grip://open?path=/a/b.grip'], '/'), { urls: ['grip://open?path=/a/b.grip'], files: [] })
  // Dev labs: first launch keeps the order; a second instance gets switches first, then ".".
  assert.equal(parseLaunch(['electron', '.', '--lab', 'RecorderShell'], '/').lab, 'RecorderShell')
  assert.equal(parseLaunch(['electron', '--lab', '--enable-logging', '.', 'RecorderShell&ref=/x.png'], '/').lab, 'RecorderShell&ref=/x.png')
  assert.deepEqual(parseLaunch(['electron', '.'], '/'), { urls: [], files: [] })
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
  assert.match(plainError(new Error('net::ERR_INTERNET_DISCONNECTED')).message, /offline/)
  assert.match(plainError(Object.assign(new Error('404 \n"method: GET"\nHeaders: {}'), { statusCode: 404 })).message, /Try again later/)
  assert.match(plainError('Unable to find latest version on GitHub, please ensure a production release exists: HttpError: 404 \n"method: GET"').message, /Try again later/)
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
  // The drag-to-allow panel: under System Settings, over its bottom edge when the screen ends, never off it.
  const panel = { width: 380, height: 72 }
  assert.deepEqual(under(panel, { x: 400, y: 100, width: 700, height: 600 }, main, 12), { x: 560, y: 712, ...panel })
  assert.deepEqual(under(panel, { x: 400, y: 300, width: 700, height: 600 }, main, 12), { x: 560, y: 816, ...panel })
  assert.deepEqual(under(panel, { x: -300, y: 100, width: 500, height: 600 }, main, 12), { x: 0, y: 712, ...panel })
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

test('the packaged app opens .grip bundles by their type, declared once', () => {
  // electron-builder appends a document type per fileAssociation to mac.extendInfo's own list.
  const build = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')).build
  const uti = build.mac.extendInfo.UTExportedTypeDeclarations.find((t: any) => t.UTTypeTagSpecification['public.filename-extension'].includes('grip')).UTTypeIdentifier
  const fromAssociations = build.fileAssociations.map((f: any) => ({ CFBundleTypeExtensions: [f.ext].flat() }))
  const types = [...(build.mac.extendInfo.CFBundleDocumentTypes ?? []), ...fromAssociations]
  const grip = types.filter((t) => t.LSItemContentTypes?.includes(uti) || t.CFBundleTypeExtensions?.includes('grip'))
  assert.equal(grip.length, 1)
  assert.deepEqual(grip[0].LSItemContentTypes, [uti])
  assert.equal(grip[0].LSHandlerRank, 'Owner')
})

test('finish or delete while the engine starts runs once it records', () => {
  // Finish clicked twice while starting: one stop, sent when recording begins.
  let held = hold(hold(null, 'stop'), 'stop')
  assert.deepEqual(release(held, 'starting'), [null, 'stop'])
  assert.deepEqual(release(held, 'recording'), ['stop', null])
  // Delete wins over Finish, in either order.
  assert.equal(hold(hold(null, 'stop'), 'cancel'), 'cancel')
  assert.equal(hold(hold(null, 'cancel'), 'stop'), 'cancel')
  // The start failed: there is nothing to stop, and nothing stays held for the next take.
  held = hold(null, 'cancel')
  assert.deepEqual(release(held, 'idle'), [null, null])
})

test('display arrangement: only real changes rebuild the picker', () => {
  const workArea = { x: 0, y: 33, width: 1512, height: 949 }
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea, scaleFactor: 2, rotation: 0 }
  const now = arrangement([display])
  // The Dock or menu bar changing the work area is the burst macOS sends all the time.
  const docked = { ...display, workArea: { ...workArea, height: 870 } }
  assert.equal(arrangement([docked]), now)
  assert.notEqual(arrangement([{ ...display, scaleFactor: 1 }]), now)
  assert.notEqual(arrangement([{ ...display, bounds: { x: 0, y: 0, width: 1728, height: 1117 } }]), now)
  assert.notEqual(arrangement([display, { ...display, id: 2 }]), now)
})

test('launches that start together take turns at the single-instance lock', async () => {
  // Chromium's lock lets two simultaneous launches both win, or drops the arguments of one.
  const root = mkdtempSync(join(tmpdir(), 'studio turns #1 ✨ '))
  const file = join(root, 'userdata', 'launch.lock')
  const launch = `import { inTurn } from ${JSON.stringify(join(import.meta.dirname, 'url.ts'))}
    const [start, end] = inTurn(${JSON.stringify(file)}, () => {
      const start = Date.now()
      while (Date.now() - start < 150); // a slow singleton handoff
      return [start, Date.now()]
    })
    console.log(start, end)`
  const runs = await Promise.all([1, 2, 3, 4].map(() => promisify(execFile)(process.execPath, ['--input-type=module', '-e', launch])))
  const turns = runs.map((r) => r.stdout.trim().split(' ').map(Number)).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < turns.length; i++) assert.ok(turns[i][0] >= turns[i - 1][1], `launch ${i} overlapped: ${JSON.stringify(turns)}`)
  assert.equal(inTurn(join(root, 'userdata', 'launch.lock', 'not a dir'), () => 'ran'), 'ran', 'an unlockable file never blocks a launch')
  rmSync(root, { recursive: true, force: true })
})

test('screenshots carry their pixel density, like the ones macOS takes', () => {
  const chunk = (type: string, data: number[]) => {
    const b = Buffer.alloc(12 + data.length)
    b.writeUInt32BE(data.length)
    b.write(type, 4, 'latin1')
    Buffer.from(data).copy(b, 8)
    return b
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const png = Buffer.concat([sig, chunk('IHDR', Array(13).fill(1)), chunk('pHYs', Array(9).fill(0)), chunk('IDAT', [1, 2, 3]), chunk('IEND', [])])
  const out = withScale(png, 2)
  const types: string[] = []
  for (let i = 8; i < out.length; i += 12 + out.readUInt32BE(i)) types.push(out.toString('latin1', i + 4, i + 8))
  assert.deepEqual(types, ['IHDR', 'pHYs', 'IDAT', 'IEND']) // the old density replaced, right after the header
  const phys = 8 + 25
  assert.equal(out.readUInt32BE(phys + 8), 5669) // 144 dpi
  assert.equal(out.readUInt8(phys + 16), 1)
  assert.deepEqual([...out.subarray(out.length - 12 - 15, out.length - 12)].slice(8, 11), [1, 2, 3])
})
