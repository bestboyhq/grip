// Owner: projects. Style presets: one portable `.studiopreset` file each (JSON, assets embedded as
// base64), stored in <userData>/presets/<id>.studiopreset. Export copies the file; import validates
// it. Applying writes the assets into the bundle under content-addressed names and returns the style
// for the editor to apply as an undoable edit. A missing asset falls back to the default.
//
//   projects:presets:list() -> Preset[]
//   projects:presets:save(name, bundlePath, style) -> Preset   (assets read from the bundle)
//   projects:presets:apply(id, bundlePath) -> { style }
//   projects:presets:import(file?) -> Preset | null      (no file: open dialog)
//   projects:presets:export(id, file?) -> string | null  (no file: save dialog)
//   projects:presets:delete(id)
import electron from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { defaultStyle, type Style } from '../src/shared/project.ts'
import { normalizeStyle } from '../src/shared/migrate.ts'
import { bundleArg, locked, writeFileAtomic } from './projects.ts'

const FORMAT = 'studio-preset'
const VERSION = 1
const MAX_BYTES = 100 << 20
const EXT = '.studiopreset'

export interface Preset {
  id: string
  name: string
  style: Style
}
interface PresetFile {
  format: typeof FORMAT
  version: number
  name: string
  style: Style
  /** Asset name as referenced by `style` -> file content, base64. */
  assets: Record<string, string>
}

export const presetsDir = () => join(electron.app.getPath('userData'), 'presets')

// ponytail: parses every preset including its embedded assets; put the header on its own line if
// people keep dozens of presets with large background images.
export async function listPresets(dir = presetsDir()): Promise<Preset[]> {
  const out: Preset[] = []
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith(EXT)) continue
    try {
      const p = await readPreset(join(dir, f))
      out.push({ id: f.slice(0, -EXT.length), name: p.name, style: p.style })
    } catch (e) {
      console.warn(`[presets] skipped ${f}:`, (e as Error).message)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Save `style` as a preset, embedding the background image and LUT it references in `bundle`. */
export async function savePreset(name: string, bundle: string, style: unknown, dir = presetsDir()): Promise<Preset> {
  const s = normalizeStyle(structuredClone(style))
  const assets: Record<string, string> = {}
  const embed = async (rel: string) => {
    const data = await readFile(join(bundle, rel)).catch(() => null)
    if (!data) return undefined
    const key = assetName(data, rel)
    assets[key] = data.toString('base64')
    return key
  }
  await relink(s, embed)
  const preset: PresetFile = { format: FORMAT, version: VERSION, name: presetName(name), style: s, assets }
  const id = randomUUID()
  await mkdir(dir, { recursive: true })
  await writeFileAtomic(join(dir, id + EXT), JSON.stringify(preset))
  return { id, name: preset.name, style: s }
}

/** Write the preset's assets into `bundle`/assets and return its style pointing at them. */
export async function applyPreset(id: string, bundle: string, dir = presetsDir()): Promise<Style> {
  const p = await readPreset(presetFile(id, dir))
  await locked(() => relink(p.style, async (key) => {
    if (!Object.hasOwn(p.assets, key)) return undefined
    const data = Buffer.from(p.assets[key], 'base64')
    const rel = assetName(data, key)
    const file = join(bundle, rel)
    if (!(await stat(file).catch(() => null))) {
      await mkdir(join(bundle, 'assets')).catch((e) => { if (e.code !== 'EEXIST') throw e }) // never recreate a moved bundle
      await writeFileAtomic(file, data)
    }
    return rel
  }))
  return p.style
}

export async function importPreset(file: string, dir = presetsDir()): Promise<Preset> {
  const p = await readPreset(file)
  const id = randomUUID()
  await mkdir(dir, { recursive: true })
  await writeFileAtomic(join(dir, id + EXT), JSON.stringify(p))
  return { id, name: p.name, style: p.style }
}

export async function exportPreset(id: string, file: string, dir = presetsDir()): Promise<void> {
  await copyFile(presetFile(id, dir), file)
}

export async function deletePreset(id: string, dir = presetsDir()): Promise<void> {
  await rm(presetFile(id, dir), { force: true })
}

/** Read and validate a preset file. Presets from other people are untrusted input. */
async function readPreset(file: string): Promise<PresetFile> {
  const size = (await stat(file).catch(() => { throw new Error('This preset file was not found.') })).size
  if (size > MAX_BYTES) throw new Error('This preset is too large.')
  let p: any
  try {
    p = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    throw new Error('This is not a Studio preset file.')
  }
  if (p?.format !== FORMAT || !Number.isInteger(p.version)) throw new Error('This is not a Studio preset file.')
  if (p.version > VERSION) throw new Error('This preset was made by a newer version of Studio. Update Studio to use it.')
  const assets = p.assets ?? {}
  if (typeof assets !== 'object' || Array.isArray(assets) || !Object.values(assets).every((v) => typeof v === 'string')) throw new Error('This preset is damaged.')
  try {
    return { format: FORMAT, version: VERSION, name: presetName(p.name), style: normalizeStyle(p.style), assets }
  } catch {
    throw new Error('This preset is damaged.')
  }
}

/** Point the background image and LUT at `map(path)`; when that is undefined (missing asset), fall
 *  back to the default background and no LUT. */
async function relink(s: Style, map: (path: string) => Promise<string | undefined>) {
  if (s.background.kind === 'image') {
    const file = await map(s.background.file)
    s.background = file ? { kind: 'image', file } : defaultStyle().background
  }
  if (s.camera.lut && !s.camera.lut.startsWith('grade:')) { // built-in grades are not files
    const lut = await map(s.camera.lut)
    if (lut) s.camera.lut = lut
    else delete s.camera.lut
  }
}

/** Content-addressed, so applying presets never overwrites an asset another style still uses. */
function assetName(data: Uint8Array, from: string) {
  const ext = extname(from).toLowerCase()
  return `assets/${createHash('sha256').update(data).digest('hex').slice(0, 16)}${/^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''}`
}

function presetFile(id: unknown, dir: string) {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new Error('Unknown preset.')
  return join(dir, id + EXT)
}

const presetName = (name: unknown) => (typeof name === 'string' && name.trim() ? [...name.trim()].slice(0, 100).join('') : 'Untitled preset')

export function registerPresets() {
  const { ipcMain, dialog, BrowserWindow } = electron
  ipcMain.handle('projects:presets:list', () => listPresets())
  ipcMain.handle('projects:presets:save', (_e, name: unknown, path: unknown, style: unknown) => savePreset(name as string, bundleArg(path), style))
  ipcMain.handle('projects:presets:apply', async (_e, id: unknown, path: unknown) => ({ style: await applyPreset(id as string, bundleArg(path)) }))
  ipcMain.handle('projects:presets:delete', (_e, id: unknown) => deletePreset(id as string))
  ipcMain.handle('projects:presets:import', async (e, file?: unknown) => {
    if (file === undefined) {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = { properties: ['openFile' as const], filters: [{ name: 'Studio Preset', extensions: [EXT.slice(1)] }] }
      const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
      if (r.canceled || !r.filePaths[0]) return null
      file = r.filePaths[0]
    }
    if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('Import needs an absolute file path.')
    return importPreset(file)
  })
  ipcMain.handle('projects:presets:export', async (e, id: unknown, file?: unknown) => {
    if (file === undefined) {
      const name = (await listPresets()).find((p) => p.id === id)?.name ?? 'Preset'
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = { defaultPath: join(electron.app.getPath('documents'), name.replace(/[/:]/g, '-') + EXT), filters: [{ name: 'Studio Preset', extensions: [EXT.slice(1)] }] }
      const r = await (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts))
      if (r.canceled || !r.filePath) return null
      file = r.filePath
    }
    if (typeof file !== 'string' || !isAbsolute(file)) throw new Error('Export needs an absolute file path.')
    await exportPreset(id as string, file)
    return file
  })
}
