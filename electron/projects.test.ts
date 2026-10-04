// Bundle lifecycle on a real file system: unique and hostile names, atomic save with backup,
// migration refusal, rename, recovery of interrupted recordings, import, thumbnails, recents, presets.
// Needs ffmpeg (as does the fixture generator). Software H.264: VideoToolbox can stall when another
// process holds the hardware encoder, which would hang the suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, truncate, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createProject, PROJECT_VERSION } from '../src/shared/project.ts'
import { createBundle, importVideo, readProject, recentProjects, recoverBundles, renameBundle, sanitizeName, saveProject, saveThumbnail, updateProject, updateRecent, writeNewRecording, writeProject } from './projects.ts'
import { applyPreset, deletePreset, exportPreset, importPreset, listPresets, savePreset } from './presets.ts'

const root = await mkdtemp(join(tmpdir(), 'studio #1 ✨ café '))
const ff = (...args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
const media = join(root, 'media')
await mkdir(media)
ff('-f', 'lavfi', '-i', 'testsrc2=s=320x200:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2:sample_rate=48000', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', join(media, 'Clip #2 ✨ é.mov'))
ff('-f', 'lavfi', '-i', 'sine=f=440:d=3:sample_rate=44100', '-ac', '2', '-c:a', 'aac', join(media, 'mic.m4a'))
ff('-f', 'lavfi', '-i', 'testsrc2=s=640x400:r=30:d=6', '-c:v', 'libx264', '-g', '30', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', join(media, 'screen.mp4'))
ff('-f', 'lavfi', '-i', 'testsrc2=s=320x200:r=30:d=1', '-c:v', 'prores_ks', join(media, 'prores.mov'))
ff('-f', 'lavfi', '-i', 'testsrc2=s=320x200:d=1', '-frames:v', '1', join(media, 'thumb.png'))

const sources = { duration: 4, screen: { file: 'sources/screen.mp4', width: 640, height: 400, fps: 30, scale: 2 } }
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

test('new bundles get unique names, even when created concurrently', async () => {
  const dir = join(root, 'unique')
  const names = []
  for (let i = 0; i < 3; i++) names.push(basename(await createBundle('Recording', dir), '.studio'))
  assert.deepEqual(names, ['Recording', 'Recording 2', 'Recording 3'])
  const many = await Promise.all(Array.from({ length: 12 }, () => createBundle('Same', dir)))
  assert.equal(new Set(many).size, 12)
  for (const b of many) assert.ok((await stat(join(b, 'sources'))).isDirectory())
})

test('hostile names round-trip; separators and hidden-file dots are sanitized', async () => {
  const dir = join(root, 'hostile')
  const name = 'Demo #1 ✨ café & 50% "quotes" 👩‍👩‍👧'
  const bundle = await createBundle(name, dir)
  assert.equal(basename(bundle), `${name}.studio`)
  await writeProject(bundle, createProject(name, sources))
  assert.equal((await readProject(bundle)).name, name)
  assert.equal(sanitizeName('Q4/plan: v2'), 'Q4-plan- v2')
  assert.equal(sanitizeName('  ..hidden  '), 'hidden')
  assert.equal(sanitizeName('a\u0000b\nc'), 'abc')
  assert.equal(sanitizeName('/'), '-')
  assert.equal(sanitizeName(' .. '), 'Untitled')
  assert.equal(sanitizeName('café'), 'café') // NFD in, NFC out
  const long = sanitizeName('👩‍👩‍👧'.repeat(100))
  assert.ok(Buffer.byteLength(long) <= 200 && /^(👩‍👩‍👧)+$/u.test(long), 'truncated on a grapheme boundary')
  assert.equal(basename(await createBundle(long, dir)), `${long}.studio`)
})

test('save keeps the previous version; a damaged project.json opens from the backup', async () => {
  const bundle = await createBundle('Saves', join(root, 'saves'))
  const v1 = createProject('Saves', sources)
  await writeProject(bundle, v1)
  await writeProject(bundle, { ...v1, playhead: 2 })
  assert.equal((await json(join(bundle, 'project.json'))).playhead, 2)
  assert.equal((await json(join(bundle, 'project.json.bak'))).playhead, 0)
  assert.deepEqual((await readdir(bundle)).sort(), ['project.json', 'project.json.bak', 'sources'])
  await writeFile(join(bundle, 'project.json'), '{"version": 1, "na')
  assert.equal((await readProject(bundle)).playhead, 0)
  await writeProject(bundle, { ...v1, playhead: 3 }) // a damaged file never replaces a good backup
  assert.equal((await json(join(bundle, 'project.json.bak'))).playhead, 0)
  await assert.rejects(writeProject(bundle, { ...v1, clips: [{ id: 'x', start: 1, end: 0, speed: 1, volume: 1 }] }), /Invalid project: clips\[0\]/)
})

test('a stale editor save never undoes sources patched in the main process', async () => {
  const bundle = await createBundle('Patched', join(root, 'patched'))
  const editorCopy = createProject('Patched', { ...sources, camera: { file: 'sources/camera.mp4', width: 1280, height: 720, fps: 30, scale: 1 } })
  await writeProject(bundle, editorCopy)
  await updateProject(bundle, (p) => (p.sources.camera!.matte = 'sources/matte.mp4')) // camera analysis finishes
  await saveProject(bundle, { ...editorCopy, playhead: 2 }) // autosave from the editor's older copy
  const p = await readProject(bundle)
  assert.equal(p.sources.camera?.matte, 'sources/matte.mp4')
  assert.equal(p.playhead, 2)
})

test('a project from a newer app is refused, never replaced by its older backup', async () => {
  const bundle = await createBundle('Newer', join(root, 'newer'))
  await writeProject(bundle, createProject('Newer', sources))
  await writeFile(join(bundle, 'project.json'), JSON.stringify({ ...createProject('Name inside the file', sources), version: PROJECT_VERSION + 1 }))
  await writeFile(join(bundle, 'project.json.bak'), JSON.stringify(createProject('Newer', sources)))
  await assert.rejects(readProject(bundle), /“Newer” was saved by a newer version of Studio\. Update Studio to open it\./)
})

test('open clamps the playhead and drops assets that are gone', async () => {
  const bundle = await createBundle('Assets', join(root, 'assets'))
  const p = createProject('Assets', sources)
  p.playhead = 99
  p.style.background = { kind: 'image', file: 'assets/gone.jpg' }
  p.style.camera.lut = 'assets/gone.cube'
  await writeProject(bundle, p)
  const r = await readProject(bundle)
  assert.equal(r.playhead, 4)
  assert.equal(r.style.background.kind, 'wallpaper')
  assert.equal(r.style.camera.lut, undefined)
})

test('rename handles collisions, case-only changes, and later saves to the old path', async () => {
  const dir = join(root, 'rename')
  const a = await createBundle('Alpha', dir)
  await createBundle('Beta ✨', dir)
  await writeProject(a, createProject('Alpha', sources))
  const b = await renameBundle(a, 'Beta ✨')
  assert.equal(basename(b), 'Beta ✨ 2.studio')
  assert.equal((await readProject(b)).name, 'Beta ✨ 2')
  await writeProject(a, { ...createProject('x', sources), playhead: 1 }) // stale path follows the move
  assert.equal((await readProject(b)).playhead, 1)
  const c = await renameBundle(b, 'beta ✨ 2')
  assert.equal(basename(c), 'beta ✨ 2.studio')
  assert.ok((await readdir(dir)).includes('beta ✨ 2.studio'))
  assert.equal(await renameBundle(c, 'beta ✨ 2'), c)
  const again = await createBundle('Alpha', dir) // the old name is free again and must not follow the move
  assert.equal(again, a)
  await writeProject(again, { ...createProject('Alpha', sources), playhead: 2 })
  assert.equal((await readProject(c)).playhead, 1)
  assert.deepEqual((await readdir(dir)).sort(), ['Alpha.studio', 'Beta ✨.studio', 'beta ✨ 2.studio'])
})

test('an interrupted recording is rebuilt from the files on disk', async () => {
  const dir = join(root, 'recover')
  const crashed = await createBundle('Crashed #1 ✨', dir)
  const src = join(crashed, 'sources')
  execFileSync('cp', [join(media, 'screen.mp4'), join(media, 'mic.m4a'), src])
  await truncate(join(src, 'screen.mp4'), Math.floor((await stat(join(src, 'screen.mp4'))).size * 0.6)) // torn mid-fragment
  await writeFile(join(src, 'events.jsonl'), '{"t":0.1,"type":"move","x":1,"y":2}\n{"t":0.2,"ty')
  const empty = await createBundle('Empty', dir) // crashed before any data: nothing to recover
  const fine = await createBundle('Fine', dir)
  await writeProject(fine, createProject('Fine', sources))
  const fromBak = await createBundle('Backup', dir)
  await writeFile(join(fromBak, 'project.json.bak'), JSON.stringify({ ...createProject('Backup', sources), playhead: 3 }))

  const found = await recoverBundles(dir)
  assert.deepEqual(found.map((r) => r.name).sort(), ['Backup', 'Crashed #1 ✨'])
  const p = await readProject(crashed)
  assert.equal(p.name, 'Crashed #1 ✨')
  assert.ok(p.sources.duration >= 3 && p.sources.duration < 6, `duration ${p.sources.duration}`)
  assert.deepEqual({ ...p.sources.screen, scale: 0 }, { file: 'sources/screen.mp4', width: 640, height: 400, fps: 30, scale: 0 })
  assert.deepEqual(p.sources.mic, { file: 'sources/mic.m4a', channels: 2, sampleRate: 44100 })
  assert.equal(p.sources.events, 'sources/events.jsonl')
  assert.equal(p.sources.camera, undefined)
  assert.deepEqual(p.clips.map((c) => [c.start, c.end]), [[0, p.sources.duration]])
  assert.equal((await readProject(fromBak)).playhead, 3)
  assert.equal(await stat(join(empty, 'project.json')).catch(() => null), null)
  assert.deepEqual(await recoverBundles(dir), [])
})

test('a finished recording opens already directed: auto zooms from its clicks', async () => {
  const bundle = await createBundle('Take #1 ✨', join(root, 'new'))
  const lines = [{ t: 0, type: 'move', x: 100, y: 100 }]
  for (const t of [1, 1.4, 1.8]) lines.push({ t, type: 'down', x: 320, y: 200, button: 'left' } as never, { t: t + 0.05, type: 'up', x: 320, y: 200, button: 'left' } as never)
  await writeFile(join(bundle, 'sources', 'events.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'))
  const p = await writeNewRecording(bundle, { ...sources, events: 'sources/events.jsonl' })
  assert.ok(p.zooms.length >= 1 && p.zooms.every((z) => z.auto && z.enabled && z.start < 1 && z.end > 1.8), JSON.stringify(p.zooms))
  assert.deepEqual((await readProject(bundle)).zooms, p.zooms)
  const quiet = await writeNewRecording(await createBundle('Quiet', join(root, 'new')), sources) // no events: no zooms, no error
  assert.deepEqual(quiet.zooms, [])
})

test('import clones an .mp4/.mov into a new bundle', async () => {
  const dir = join(root, 'import')
  const file = join(media, 'Clip #2 ✨ é.mov')
  const bundle = await importVideo(file, dir)
  assert.equal(basename(bundle), 'Clip #2 ✨ é.studio')
  const p = await readProject(bundle)
  assert.equal(p.sources.imported, true)
  assert.deepEqual(p.sources.screen, { file: 'sources/screen.mov', width: 320, height: 200, fps: 30, scale: 1 })
  assert.deepEqual(p.sources.mic, { file: 'sources/screen.mov', channels: 1, sampleRate: 48000 })
  assert.equal(p.sources.events, undefined)
  assert.ok(Math.abs(p.sources.duration - 2) < 0.1)
  assert.ok((await readFile(join(bundle, 'sources/screen.mov'))).equals(await readFile(file)))
  assert.equal(basename(await importVideo(file, dir)), 'Clip #2 ✨ é 2.studio')
  await assert.rejects(importVideo(join(media, 'mic.m4a'), dir), /imports \.mp4 and \.mov/)
  await assert.rejects(importVideo(join(media, 'missing.mp4'), dir), /was not found/)
  await assert.rejects(importVideo(join(media, 'prores.mov'), dir), /codec Studio can't play \(prores\)/)
  await writeFile(join(media, 'junk.mp4'), 'not a video')
  await assert.rejects(importVideo(join(media, 'junk.mp4'), dir), /can't read “junk\.mp4”/)
  assert.deepEqual((await readdir(dir)).sort(), ['Clip #2 ✨ é 2.studio', 'Clip #2 ✨ é.studio']) // failures leave nothing behind
})

test('thumbnail is saved and becomes the Finder icon of a package', async () => {
  const bundle = await createBundle('Thumb #1 ✨', join(root, 'thumb'))
  await saveThumbnail(bundle, await readFile(join(media, 'thumb.png')))
  assert.ok((await readFile(join(bundle, 'thumbnail.png'))).equals(await readFile(join(media, 'thumb.png'))))
  const flags = execFileSync('xattr', ['-px', 'com.apple.FinderInfo', bundle], { encoding: 'utf8' }).replace(/\s/g, '')
  const finderFlags = parseInt(flags.slice(16, 20), 16)
  assert.ok(finderFlags & 0x2000, 'package bit')
  assert.ok(finderFlags & 0x0400, 'custom icon')
  await assert.rejects(saveThumbnail(bundle, new TextEncoder().encode('GIF89a')), /PNG/)
})

test('recent projects: most recent first, deduplicated, missing ones skipped', async () => {
  const dir = join(root, 'recent')
  const file = join(root, 'userdata', 'recent.json')
  const [a, b] = [await createBundle('A', dir), await createBundle('B ✨', dir)]
  await writeProject(a, createProject('A', sources))
  await writeProject(b, createProject('B ✨', { ...sources, duration: 7 }))
  await saveThumbnail(b, await readFile(join(media, 'thumb.png')))
  for (const p of [a, b, a, join(dir, 'Gone.studio')]) await updateRecent((l) => [p, ...l.filter((x) => x !== p)], file)
  const list = await recentProjects(file)
  assert.deepEqual(list.map((r) => [r.name, r.duration, r.thumbnail && basename(r.thumbnail)]), [['A', 4, null], ['B ✨', 7, 'thumbnail.png']])
  assert.equal((await json(file)).length, 3) // the missing one is kept (unplugged drive), just not listed
})

test('presets bundle their assets, apply anywhere, and fall back to defaults for missing ones', async () => {
  const dir = join(root, 'presets')
  const from = await createBundle('From', join(root, 'pre'))
  const to = await createBundle('To', join(root, 'pre'))
  await mkdir(join(from, 'assets'))
  await writeFile(join(from, 'assets', 'bg.JPG'), 'image bytes')
  await writeFile(join(from, 'assets', 'look.cube'), 'LUT_3D_SIZE 2')
  const style = createProject('', sources).style
  style.padding = 12
  style.background = { kind: 'image', file: 'assets/bg.JPG' }
  style.camera.lut = 'assets/look.cube'

  const saved = await savePreset('Warm ✨ #1', from, style, dir)
  assert.deepEqual((await listPresets(dir)).map((p) => p.name), ['Warm ✨ #1'])
  const applied = await applyPreset(saved.id, to, dir)
  assert.equal(applied.padding, 12)
  assert.ok(applied.background.kind === 'image' && /^assets\/[0-9a-f]{16}\.jpg$/.test(applied.background.file))
  assert.equal(await readFile(join(to, (applied.background as { file: string }).file), 'utf8'), 'image bytes')
  assert.equal(await readFile(join(to, applied.camera.lut!), 'utf8'), 'LUT_3D_SIZE 2')

  const exported = join(root, 'Warm.studiopreset')
  await exportPreset(saved.id, exported, dir)
  await deletePreset(saved.id, dir)
  assert.deepEqual(await listPresets(dir), [])
  const imported = await importPreset(exported, dir)
  assert.equal((await applyPreset(imported.id, to, dir)).padding, 12)

  await rm(join(from, 'assets', 'bg.JPG'))
  const partial = await savePreset('Partial', from, style, dir)
  assert.deepEqual(partial.style.background, createProject('', sources).style.background)

  // Hostile preset: traversal in asset names and style paths never escapes the bundle.
  const hostile = join(root, 'hostile.studiopreset')
  await writeFile(hostile, JSON.stringify({ format: 'studio-preset', version: 1, name: 'Evil', style: { background: { kind: 'image', file: 'x/../../../evil.jpg' } }, assets: {} }))
  await assert.rejects(importPreset(hostile, dir), /damaged/)
  await writeFile(hostile, JSON.stringify({ format: 'studio-preset', version: 1, name: 'Sneaky', style: { background: { kind: 'image', file: 'assets/../x.jpg' } }, assets: { 'assets/../x.jpg': 'aGk=' } }))
  await assert.rejects(importPreset(hostile, dir), /damaged/)
  await writeFile(hostile, JSON.stringify({ format: 'studio-preset', version: 1, name: 'Proto', style: { background: { kind: 'image', file: '__proto__' } }, assets: {} }))
  const proto = await importPreset(hostile, dir)
  assert.equal((await applyPreset(proto.id, to, dir)).background.kind, 'wallpaper')
  await writeFile(hostile, JSON.stringify({ format: 'studio-preset', version: 99, name: 'Future', style: {}, assets: {} }))
  await assert.rejects(importPreset(hostile, dir), /newer version of Studio/)
  await assert.rejects(applyPreset('../../etc/passwd', to, dir), /Unknown preset/)
})

test.after(() => rm(root, { recursive: true, force: true }))
