// macOS wallpaper discovery and import on a fake Desktop Pictures folder with hostile names: only
// wallpapers whose image is on disk, System Settings order, previews, one full-resolution copy per bundle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findMacWallpapers, importMacWallpaper, listMacWallpapers } from './wallpapers.ts'

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
