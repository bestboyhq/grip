// Owner: transcript. On-device speech to text, and the "transcript:*" IPC channels:
//   transcript:status() -> { model: boolean, size }   whether the speech model is downloaded, its bytes
//   transcript:run(bundle) -> Transcript | null       null when cancelled. Downloads the model on first
//     use, transcribes the mic track, writes sources/transcript.json, sets sources.transcript.
//   transcript:progress (event) { bundle, phase: 'queued' | 'download' | 'transcribe', progress 0..1,
//     received?, total? (download bytes) }
//   transcript:cancel(bundle)
//   transcript:load(bundle) -> Transcript | null
//   transcript:export(bundle, 'srt' | 'vtt', text) -> saved path | null (save dialog)
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'
import { native } from './native.ts'
import { readProject, updateProject } from './projects.ts'
import { detectLanguage, isFiller } from '../src/engine/transcript/index.ts'
import type { Transcript } from '../src/shared/project.ts'

// NVIDIA Parakeet TDT 0.6B v3, int8 ONNX export, pinned to a revision so the checksums hold.
const MODEL_URL = 'https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce/'
const MODEL_FILES: ModelFile[] = [
  { name: 'encoder-model.int8.onnx', size: 652183999, sha256: '6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09' },
  { name: 'decoder_joint-model.int8.onnx', size: 18202004, sha256: 'eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70' },
  { name: 'vocab.txt', size: 93939, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d' },
]
const MODEL_SIZE = MODEL_FILES.reduce((s, f) => s + f.size, 0)
const TRANSCRIPT = 'sources/transcript.json'

export interface ModelFile {
  name: string
  size: number
  sha256: string
}

const modelDir = () => join(app.getPath('userData'), 'models', 'parakeet-tdt-0.6b-v3-int8')
const sizeOf = (path: string) => stat(path).then((s) => s.size, () => -1)

/** Download `url` to `path`, resumable: bytes land in `<path>.part`, a later call continues where
 *  the last one stopped, and the file only takes its name once its size and checksum match. */
export async function download(url: string, f: ModelFile, path: string, signal: AbortSignal, progress: (received: number) => void) {
  const part = path + '.part'
  let have = Math.max(0, await sizeOf(part))
  let hash: Hash = createHash('sha256')
  if (have > f.size) {
    await rm(part)
    have = 0
  }
  if (have) for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)
  progress(have)
  if (have < f.size) {
    const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal })
    if (!res.ok || !res.body) throw new Error(`The speech model download failed (HTTP ${res.status}).`)
    if (have && res.status !== 206) [have, hash] = [0, createHash('sha256')] // no resume support: start over
    let received = have
    await pipeline(
      Readable.fromWeb(res.body as ReadableStream),
      async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          hash.update(chunk)
          received += chunk.length
          progress(received)
          yield chunk
        }
      },
      createWriteStream(part, { flags: have ? 'a' : 'w' }),
      { signal },
    )
  }
  if ((await sizeOf(part)) !== f.size || hash.digest('hex') !== f.sha256) {
    await rm(part, { force: true })
    throw new Error('The speech model download was damaged. Try again.')
  }
  await rename(part, path)
}

async function ensureModel(signal: AbortSignal, progress: (received: number) => void): Promise<string> {
  const dir = modelDir()
  await mkdir(dir, { recursive: true })
  let done = 0
  for (const f of MODEL_FILES) {
    const path = join(dir, f.name)
    if ((await sizeOf(path)) !== f.size) await download(MODEL_URL + f.name, f, path, signal, (n) => progress(done + n))
    done += f.size
  }
  return dir
}

/** The bundle a renderer names must be an absolute .grip folder path; files stay inside it. */
function inBundle(bundle: unknown, file: string): string {
  if (typeof bundle !== 'string' || !isAbsolute(bundle) || !bundle.endsWith('.grip')) throw new Error('Not a Grip project.')
  const path = resolve(bundle, file)
  if (!path.startsWith(resolve(bundle) + sep)) throw new Error('Not a Grip project file.')
  return path
}

async function writeAtomic(path: string, data: string) {
  const tmp = path + '.tmp'
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmp, path)
}

type Progress = { phase: 'queued' | 'download' | 'transcribe'; progress: number; received?: number; total?: number }

async function transcribe(bundle: string, signal: AbortSignal, send: (p: Progress) => void): Promise<Transcript> {
  signal.throwIfAborted()
  const s = (await readProject(bundle)).sources
  const audio = s.mic?.file ?? (s.imported ? s.screen?.file : undefined) ?? s.system?.file
  if (!audio) throw new Error('This recording has no audio to transcribe.')
  const path = inBundle(bundle, audio)
  if ((await sizeOf(path)) < 0) throw new Error(`The recording's audio file is missing (${audio}).`)
  const dir = await ensureModel(signal, (received) => send({ phase: 'download', progress: received / MODEL_SIZE, received, total: MODEL_SIZE }))
  send({ phase: 'transcribe', progress: 0 })
  const words = await native.transcribe(path, { modelDir: dir }, (progress) => send({ phase: 'transcribe', progress }), signal)
  const language = detectLanguage(words, app.getLocale().slice(0, 2))
  const transcript: Transcript = { language, words: words.map((w) => (isFiller(w.text, language) ? { ...w, filler: true } : w)) }
  await writeAtomic(inBundle(bundle, TRANSCRIPT), JSON.stringify(transcript))
  // A source, not an edit: set on disk under the save lock; open editors get it via projects:sources.
  await updateProject(bundle, (p) => void (p.sources.transcript = TRANSCRIPT))
  return transcript
}

/** One plain-language line for the UI. */
function reason(err: unknown): string {
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'ENOSPC') return `Not enough disk space for the speech model (${Math.round(MODEL_SIZE / 1e6)} MB).`
  if (e instanceof TypeError && /fetch/i.test(e.message)) return 'Could not download the speech model. Check your internet connection and try again.'
  return e?.message ?? String(err)
}

const jobs = new Map<string, AbortController>()
let queue: Promise<unknown> = Promise.resolve() // one at a time: each run holds the model in memory

export function registerTranscript() {
  ipcMain.handle('transcript:status', async () => {
    const sizes = await Promise.all(MODEL_FILES.map((f) => sizeOf(join(modelDir(), f.name))))
    return { model: sizes.every((s, i) => s === MODEL_FILES[i].size), size: MODEL_SIZE }
  })

  ipcMain.handle('transcript:run', async (e, bundle: string) => {
    inBundle(bundle, 'project.json')
    if (jobs.has(bundle)) throw new Error('This project is already being transcribed.')
    const ac = new AbortController()
    jobs.set(bundle, ac)
    let last = { phase: '', at: 0 }
    const send = (p: Progress) => {
      const now = Date.now()
      if (p.phase === last.phase && p.progress < 1 && now - last.at < 100) return // ~10 updates a second
      last = { phase: p.phase, at: now }
      if (!e.sender.isDestroyed()) e.sender.send('transcript:progress', { bundle, ...p })
    }
    try {
      send({ phase: 'queued', progress: 0 })
      const job = queue.then(() => transcribe(bundle, ac.signal, send))
      queue = job.catch(() => {})
      return await job
    } catch (err) {
      if (ac.signal.aborted) return null
      throw new Error(reason(err))
    } finally {
      jobs.delete(bundle)
    }
  })

  ipcMain.handle('transcript:cancel', (_e, bundle: string) => jobs.get(bundle)?.abort())

  ipcMain.handle('transcript:load', async (_e, bundle: string): Promise<Transcript | null> => {
    inBundle(bundle, 'project.json')
    const file = (await readProject(bundle)).sources.transcript ?? TRANSCRIPT // the file is the truth
    try {
      const t = JSON.parse(await readFile(inBundle(bundle, file), 'utf8'))
      return Array.isArray(t?.words) ? t : null
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error(`Could not read the transcript: ${reason(err)}`)
    }
  })

  ipcMain.handle('transcript:export', async (e, bundle: string, format: 'srt' | 'vtt', text: string) => {
    inBundle(bundle, 'project.json')
    if ((format !== 'srt' && format !== 'vtt') || typeof text !== 'string') throw new Error('Unknown subtitle format.')
    const name = basename(bundle, '.grip').replace(/[/:]/g, '-')
    const options = {
      defaultPath: join(dirname(bundle), `${name}.${format}`),
      filters: [{ name: format === 'srt' ? 'SubRip subtitles' : 'WebVTT subtitles', extensions: [format] }],
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return null
    await writeFile(filePath, text)
    return filePath
  })
}
