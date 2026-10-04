// Owner: editor. "editor:*" IPC channels:
//   editor:importAsset(bundle, file, kind) -> "assets/<name>"
//   editor:tempFile(name) -> absolute path of a new temp file (the Share button's video export)
//   editor:closed()  the window finished saving after "editor:close" (electron/shell/recorder.ts)
// Copies a user-picked file (background image, LUT, music) into the bundle, so projects stay portable
// and sources stay immutable. The renderer is untrusted: both paths and the kind are validated here.
import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { safeFileName } from '../src/engine/export/options.ts'

const KINDS: Record<string, { ext: string[]; max: number; what: string }> = {
  image: { ext: ['.png', '.jpg', '.jpeg', '.webp'], max: 200e6, what: 'a PNG, JPEG, or WebP image' },
  lut: { ext: ['.cube'], max: 100e6, what: 'a .cube LUT' },
  audio: { ext: ['.m4a', '.mp3', '.aac', '.wav'], max: 4e9, what: 'an M4A, MP3, AAC, or WAV file' },
}

export async function importAsset(bundle: unknown, file: unknown, kind: unknown): Promise<string> {
  const k = typeof kind === 'string' ? KINDS[kind] : undefined
  if (!k || typeof bundle !== 'string' || typeof file !== 'string' || !isAbsolute(bundle) || !isAbsolute(file)) {
    throw new Error('Invalid import request.')
  }
  const name = basename(file)
  if (!k.ext.includes(extname(file).toLowerCase())) throw new Error(`“${name}” is not ${k.what}.`)
  if (!(await stat(join(bundle, 'project.json')).catch(() => null))) throw new Error('This project is no longer on disk.')
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) throw new Error(`“${name}” could not be found.`)
  if (info.size > k.max) throw new Error(`“${name}” is too large.`)

  // Already inside this bundle (re-picking an imported asset): reference it in place.
  const rel = relative(bundle, file)
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.split('\\').join('/')

  const dir = join(bundle, 'assets')
  await mkdir(dir, { recursive: true })
  const ext = extname(name)
  for (let i = 1; ; i++) {
    const target = i === 1 ? name : `${basename(name, ext)} ${i}${ext}`
    try {
      // EXCL makes the unique-name check atomic; FICLONE makes it an instant APFS clone.
      await copyFile(file, join(dir, target), constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
      return `assets/${target}`
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOSPC') throw new Error('The disk is full.')
      if (code !== 'EEXIST') throw new Error(`“${name}” could not be copied into the project.`)
    }
  }
}

export function registerEditor() {
  ipcMain.handle('editor:importAsset', (_e, bundle, file, kind) => importAsset(bundle, file, kind))
  // In export's temp root, which it sweeps after a day: long enough for a resumable upload.
  ipcMain.handle('editor:tempFile', async (_e, name: unknown) => {
    const dir = join(app.getPath('temp'), 'Studio Exports', randomUUID())
    await mkdir(dir, { recursive: true })
    return join(dir, safeFileName(String(name ?? '')) || 'Studio.mp4')
  })
}
