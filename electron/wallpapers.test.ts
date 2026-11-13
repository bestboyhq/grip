// macOS wallpaper discovery and import on a fake Desktop Pictures folder with hostile names: only
// wallpapers whose image is on disk, System Settings order, previews, one full-resolution copy per bundle.
// The Custom library on a temporary folder: one copy per image, newest first, safe paths only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addCustom, findMacWallpapers, importCustom, importMacWallpaper, listCustom, listMacWallpapers, removeCustom } from './wallpapers.ts'

test('macOS wallpapers: discovery, order, previews, import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'Desktop #1 ✨ café '))
  const pics = join(root, 'Desktop Pictures')
  const assets = join(root, 'AssetsV2')
  await mkdir(join(pics, '.thumbnails'), { recursive: true })
  await mkdir(join(pics, '.wallpapers', 'Horizon é'), { recursive: true })
  await mkdir(join(assets, '0a1b.asset', 'AssetData'), { recursive: true })
  await mkdir(join(assets, '2c3d.asset', 'AssetData'), { recursive: true })
  const heic = (out: string, size: number) => execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', '-z', String(size), String(size), '/System/Library/Desktop Pictures/Solid Colors/Black.png', '--out', out], { stdio: 'ignore' })
  heic(join(pics, 'Café #1 ✨.heic'), 640)
  heic(join(pics, '.thumbnails', 'Café #1 ✨.heic'), 64)
  heic(join(pics, '.thumbnails', 'Café #1 ✨ Light.heic'), 64)
  heic(join(pics, '.wallpapers', 'Horizon é', 'Horizon é.heic'), 640)
  heic(join(assets, '0a1b.asset', 'AssetData', 'Big Sur.heic'), 640)
  await writeFile(join(pics, 'Not Downloaded.madesktop'), '<plist/>') // a stub without its asset
  await writeFile(join(pics, '.orderedPictures.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array><string>Big Sur.madesktop</string><string>Café #1 ✨.heic</string></array></plist>`)

  const found = await findMacWallpapers(pics, assets)
  assert.deepEqual(found.map((w) => w.name), ['Big Sur', 'Café #1 ✨', 'Horizon é'])
  assert.equal(found[1].thumb, join(pics, '.thumbnails', 'Café #1 ✨ Light.heic'), 'the light half of a dynamic wallpaper')
  assert.equal(found[0].thumb, found[0].image, 'no system preview: the image itself')

  const list = await listMacWallpapers(pics, assets)
  assert.equal(list.length, 3)
  assert.ok(list.every((w) => w.thumb.startsWith('data:image/jpeg;base64,')))
  assert.equal(list[1].file, 'assets/macOS Café #1 ✨.jpg')

  const bundle = join(root, 'Demo #1 ✨ café.grip')
  await mkdir(bundle)
  await writeFile(join(bundle, 'project.json'), '{}')
  const file = await importMacWallpaper(bundle, 'Café #1 ✨', pics, assets)
  assert.equal(file, 'assets/macOS Café #1 ✨.jpg')
  assert.match(execFileSync('/usr/bin/sips', ['-g', 'format', '-g', 'pixelWidth', join(bundle, file)], { encoding: 'utf8' }), /format: jpeg\s+pixelWidth: 640/)
  assert.equal(await importMacWallpaper(bundle, 'Café #1 ✨', pics, assets), file, 'picked again: the same copy')
  assert.deepEqual(await readdir(join(bundle, 'assets')), ['macOS Café #1 ✨.jpg'])
  await assert.rejects(importMacWallpaper(bundle, '../../etc/passwd', pics, assets), /no longer installed/)
  await assert.rejects(importMacWallpaper('relative', 'Big Sur', pics, assets), /Invalid/)
})

test('custom backgrounds: add, list newest first, import, remove', async () => {
  const root = await mkdtemp(join(tmpdir(), 'Custom #1 ✨ café '))
  const lib = join(root, 'Library #2 é')
  const png = (out: string, size: number) => execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(size), String(size), '/System/Library/Desktop Pictures/Solid Colors/Black.png', '--out', out], { stdio: 'ignore' })
  png(join(root, 'My bg #2 ✨.png'), 64)
  png(join(root, 'Sea é.png'), 32)
  await writeFile(join(root, 'Broken.png'), 'not an image')

  const a = await addCustom(join(root, 'My bg #2 ✨.png'), lib)
  assert.match(a.file, /^assets\/[0-9a-f]{16}\/My bg #2 ✨\.png$/)
  assert.equal(a.name, 'My bg #2 ✨')
  assert.ok(a.thumb.startsWith('data:image/jpeg;base64,'))
  assert.deepEqual(await addCustom(join(root, 'My bg #2 ✨.png'), lib), a, 'added again: the one copy')
  await utimes(join(lib, a.file), 1, 1)
  const b = await addCustom(join(root, 'Sea é.png'), lib)
  assert.deepEqual((await listCustom(lib)).map((c) => c.file), [b.file, a.file], 'newest first')

  await assert.rejects(addCustom(join(root, 'Broken.png'), lib), /could not be read as an image/)
  assert.equal((await listCustom(lib)).length, 2, 'a broken image leaves nothing behind')
  await assert.rejects(addCustom(join(root, 'Sea.gif'), lib), /not a PNG, JPEG, or WebP/)
  await assert.rejects(addCustom('Sea é.png', lib), /Invalid/)

  const bundle = join(root, 'Demo #1 ✨ café.grip')
  await mkdir(bundle)
  await writeFile(join(bundle, 'project.json'), '{}')
  assert.equal(await importCustom(bundle, a.file, lib), a.file, 'the same path in the bundle')
  assert.deepEqual(await readFile(join(bundle, a.file)), await readFile(join(root, 'My bg #2 ✨.png')))
  assert.equal(await importCustom(bundle, a.file, lib), a.file, 'picked again: the same copy')
  await assert.rejects(importCustom(bundle, 'assets/../../project.json', lib), /Unknown/)
  await assert.rejects(removeCustom('assets/0123456789abcdef/../../x.png', lib), /Unknown/)

  await removeCustom(a.file, lib)
  assert.deepEqual((await listCustom(lib)).map((c) => c.file), [b.file])
  assert.deepEqual(await readdir(join(lib, 'assets')), [b.file.split('/')[1]], 'its folder goes too')
  assert.ok((await stat(join(bundle, a.file))).isFile(), 'the project keeps its copy')
  await assert.rejects(importCustom(bundle.replace('Demo', 'Other'), b.file, lib), /no longer on disk/)
})
