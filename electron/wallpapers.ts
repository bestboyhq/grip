// Owner: compositor. "wallpapers:*" IPC channels, the inspector's macOS collection:
//   wallpapers:macos() -> Array<{ name, file, thumb }>   installed system wallpapers; file is the
//                                                        bundle path picking one imports to, thumb a JPEG data URL
//   wallpapers:importMacos(bundle, name) -> "assets/macOS <name>.jpg"
// We cannot ship Apple's artwork, so the collection is what this Mac has installed. Picking one converts
// its primary image (the light one of a dynamic wallpaper) to a full-resolution JPEG in the bundle: an
// ordinary image background, so the project stays portable and export matches preview.
import electron from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { importAsset } from './editor.ts'

export const DESKTOP = '/System/Library/Desktop Pictures'
/** Where System Settings puts wallpapers it downloads on demand (a .madesktop in DESKTOP is the stub). */
export const ASSETS = '/System/Library/AssetsV2/com_apple_MobileAsset_DesktopPicture'

const run = promisify(execFile)
const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false)
const dirs = async (dir: string) => (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => join(dir, d.name))
const heics = async (dir: string) => (await readdir(dir).catch(() => [])).filter((f) => extname(f).toLowerCase() === '.heic').map((f) => join(dir, f))

/** The bundle path a macOS wallpaper imports to. The inspector matches it to show the tile as selected. */
export const macFile = (name: string) => `assets/macOS ${name}.jpg`

/** System wallpapers whose full image is on disk now, in System Settings order, each with its best
 *  small preview. Stubs of not yet downloaded wallpapers have no image and are skipped. */
export async function findMacWallpapers(root = DESKTOP, assets = ASSETS): Promise<Array<{ name: string; image: string; thumb: string }>> {
  const images = [
    ...(await heics(root)),
    ...(await Promise.all((await dirs(join(root, '.wallpapers'))).map(heics))).flat(),
    ...(await Promise.all((await dirs(assets)).map((d) => heics(join(d, 'AssetData'))))).flat(),
  ]
  // ponytail: names come from file names; a downloaded asset named unlike its .madesktop shows under
  // its file name. Map through the asset catalog's DesktopPictureID if that ever looks wrong.
  const order: string[] = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(root, '.orderedPictures.plist')])
    .then(({ stdout }) => JSON.parse(stdout).map((f: string) => basename(f, extname(f))), () => [])
  const seen = new Set<string>()
  const found = []
  for (const image of images) {
    const name = basename(image, extname(image)).normalize('NFC') // the file system may hand back NFD
    if (seen.has(name)) continue
    seen.add(name)
    // A dynamic wallpaper's own preview shows light and dark halves; the import takes the light one.
    const previews = [`${name} Light.heic`, `${name}.heic`].map((f) => join(root, '.thumbnails', f)).concat(join(dirname(image), `${name} Thumbnail@2x.png`))
    const ok = await Promise.all(previews.map(isFile))
    found.push({ name, image, thumb: previews.find((_, i) => ok[i]) ?? image })
  }
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  return found.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}

async function convert(src: string, out: string, args: string[]) {
  await run('/usr/bin/sips', ['-s', 'format', 'jpeg', ...args, src, '--out', out])
  if (!(await isFile(out))) throw new Error(`sips wrote no ${basename(out)}`)
}

async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'grip-wallpaper-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const thumbs = new Map<string, Promise<string>>()
/** A preview as a small JPEG data URL, converted once per app run. */
function thumbnail(src: string): Promise<string> {
  let p = thumbs.get(src)
  if (!p) {
    p = inTemp(async (dir) => {
      const out = join(dir, 'thumb.jpg')
      await convert(src, out, ['-s', 'formatOptions', '85', '-Z', '192'])
      return `data:image/jpeg;base64,${(await readFile(out)).toString('base64')}`
    })
    p.catch(() => thumbs.delete(src))
    thumbs.set(src, p)
  }
  return p
}

export async function listMacWallpapers(root?: string, assets?: string) {
  const found = await findMacWallpapers(root, assets)
  const previews = await Promise.allSettled(found.map((w) => thumbnail(w.thumb)))
  return found.flatMap((w, i) => (previews[i].status === 'fulfilled' ? [{ name: w.name, file: macFile(w.name), thumb: previews[i].value }] : []))
}

/** Converts a macOS wallpaper into the bundle; picking it again reuses that copy. The renderer is
 *  untrusted: it names a wallpaper, never a path. */
export async function importMacWallpaper(bundle: unknown, name: unknown, root?: string, assets?: string): Promise<string> {
  if (typeof bundle !== 'string' || !isAbsolute(bundle)) throw new Error('Invalid import request.')
  const w = (await findMacWallpapers(root, assets)).find((x) => x.name === name)
  if (!w) throw new Error('This wallpaper is no longer installed on this Mac.')
  const file = macFile(w.name)
  if (await isFile(join(bundle, file))) return file
  return inTemp(async (dir) => {
    const out = join(dir, basename(file))
    // Full resolution, the source's color profile kept (Display P3 for most), quality high enough
    // that smooth gradients show no blocking at 5K.
    await convert(w.image, out, ['-s', 'formatOptions', '95']).catch(() => {
      throw new Error(`“${w.name}” could not be converted. Check that the disk has free space.`)
    })
    return importAsset(bundle, out, 'image')
  })
}

export function registerWallpapers() {
  electron.ipcMain.handle('wallpapers:macos', () => listMacWallpapers())
  electron.ipcMain.handle('wallpapers:importMacos', (_e, bundle, name) => importMacWallpaper(bundle, name))
}
