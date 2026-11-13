// Owner: agents. record_demo (electron/agents.ts): Grip opens a web page where nobody sees it, runs an
// agent's steps on it with real input, and keeps it as a fresh recording: the page's pixels as the screen
// track (no cursor in them), and the input as events.jsonl, so auto zoom, the smooth cursor, and click
// effects apply. Then it exports an MP4 and a GIF, and shares the MP4 when asked.
//
//   The page: an offscreen window in its own in-memory session, sandboxed and without Node, that opens no
//   popups, downloads, dialogs (a confirm says no), or permissions. It needs no Screen Recording permission and never shows.
//   Frames: the page paints into GPU textures, which reach a hidden encoder window (#/demo,
//   src/windows/demo/Demo.svelte) as VideoFrames, each at the source time it painted; a page paints only
//   when it changes, as a screen does. Input: webContents.sendInputEvent, the pointer gliding to each
//   target as a hand would (src/shared/demo.ts), logged as the recorder logs it, in video px.
//   A run that fails leaves nothing: until its last step the bundle holds only .part files, which a
//   crash leaves to recoverBundles, and a failed step removes the bundle.
//
//   Encoder window: demo:ready(codec)   demo:write(position, bytes)   demo:done()   demo:fail(message)
//   event demo:finish()   to it: the last frame is in, so it closes the file
import { BrowserWindow, ipcMain, session, sharedTexture, type IpcMainInvokeEvent, type OffscreenSharedTexture, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, rename, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createBundle, probe, projectsDir, readProject, updateProject, writeNewRecording } from './projects.ts'
import { recordingName } from './recording.ts'
import { exportListeners, exportWithoutAsking, SIGNED_OUT } from './export.ts'
import { accountToken } from './account.ts'
import { shareFile } from './share.ts'
import { parseLink } from './feedback.ts'
import { ShareError } from './upload.ts'
import { openWindow } from './windows.ts'
import { settings } from './shell/settings.ts'
import { plainError } from './shell/errors.ts'
import { chapters, glide, parseDemo, parseKey, smooth, travel, typedAt, type Demo, type Key, type Pt, type Selector, type Step } from '../src/shared/demo.ts'
import type { InputEvent, Modifier } from '../src/shared/events.ts'
import { timeMap, toOutput } from '../src/shared/timemap.ts'
import { cleanOptions, defaultOptions, formatBytes, type JobInfo } from '../src/engine/export/options.ts'

type Args = Record<string, unknown>
type Image = { data: string; mimeType: string }
type Result = { text: string; data: Record<string, unknown>; images?: Image[]; failed?: boolean }
type Progress = (percent: number, message: string) => void
/** get_frame: a project's frame, rendered as the export renders it. */
type Frame = (a: Args) => Promise<{ image?: Image }>
type Done = { index: number; label: string; say?: string; ok: boolean; start: number; end: number; error?: string }
type Run = { id: string; name: string; phase: string; percent: number; tell: Set<() => void>; result?: Promise<Result> }

const SCALE = 2 // video px per CSS px, as on a Retina screen
const FPS = 30 // the recorder's default
const WAIT_MS = 45_000 // as electron/agents.ts: a call returns by then, and export_status waits again
const STEP_MS = 10_000 // a target has this long to show, come into view, and hold still
const LOAD_MS = 30_000
const LEAD_MS = 800 // the page before the first step
const TAIL_MS = 1500 // and after the last
const MAX_SECONDS = 600
const CPS = 12 // typing, characters a second
const FRAME_HEIGHT = 540
const WORLD = 1024 // the isolated world Grip reads the page from: page scripts never see it
const PARTITION = 'demo' // in memory: nothing a demo page stores outlives Grip

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** `p`, or an error saying `late` once `ms` pass first. */
function within<T>(p: Promise<T>, ms: number, late: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  p.catch(() => {}) // settled after the race too: never unhandled
  return Promise.race([p, new Promise<never>((_, no) => (timer = setTimeout(() => no(new Error(late)), ms)))]).finally(() => clearTimeout(timer))
}
const sec = (t: number) => Math.round(t * 100) / 100
const quote = (s: Selector) => ('css' in s ? s.css : s.exact ? `text="${s.text}"` : `text=${s.text}`)
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
/** A step that could not go on: why, in plain language. */
class Stop extends Error {}

const runs = new Map<string, Run>() // the last 20, so export_status answers for a finished one too
let busy: Run | undefined

/** record_demo: waits up to 45 s, then answers with the run's id for export_status. */
export function recordDemo(a: Args, progress: Progress, frame: Frame): Promise<Result> {
  const demo = parseDemo(a)
  // link: the video becomes the next version behind an earlier link, which shares it.
  const versionOf = a.link === undefined ? undefined : parseLink(a.link).id
  if (versionOf) demo.share = true
  if (demo.share && !accountToken()) throw new Error(SIGNED_OUT)
  if (busy) throw new Error(`Grip records one demo at a time, and “${busy.name}” is still going: export_status with the id ${busy.id} waits for it.`)
  const name = demo.title ?? recordingName(new Date(), (n) => existsSync(join(projectsDir(), `${n}.grip`)), 'Demo')
  const run: Run = (busy = { id: randomUUID(), name, phase: 'Loading the page', percent: 0, tell: new Set() })
  run.result = make(run, demo, frame, versionOf)
    .catch((e): Result => {
      const text = plainError(e).message
      return { text, data: { message: text, id: run.id, state: 'failed' }, failed: true }
    })
    .finally(() => (busy = undefined))
  runs.set(run.id, run)
  if (runs.size > 20) runs.delete(runs.keys().next().value!)
  return settle(run, progress)
}

/** export_status for a record_demo id; null for any other id. */
export function demoStatus(id: unknown, progress: Progress): Promise<Result> | null {
  const run = typeof id === 'string' ? runs.get(id) : undefined
  return run ? settle(run, progress) : null
}

function settle(run: Run, progress: Progress): Promise<Result> {
  const tell = () => progress(run.percent, `${run.phase}, ${run.percent}%`)
  run.tell.add(tell)
  tell()
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<null>((r) => (timer = setTimeout(r, WAIT_MS, null)))
  return Promise.race([run.result!, late]).then((r) => {
    clearTimeout(timer)
    run.tell.delete(tell)
    if (r) return r
    const text = `Still working on “${run.name}”: ${run.phase}, ${run.percent}%. export_status with the id ${run.id} waits for it.`
    return { text, data: { message: text, id: run.id, state: 'running', phase: run.phase, progress: run.percent / 100 } }
  })
}

function stage(run: Run, phase: string, percent: number) {
  run.phase = phase
  run.percent = Math.max(run.percent, Math.min(99, Math.floor(percent)))
  for (const f of run.tell) f()
}

// ---- After the recording ----

const watching = new Map<string, (j: JobInfo) => void>()
exportListeners.push((j) => watching.get(j.id)?.(j))

/** The export once it ends, and its progress meanwhile. */
function ended(id: string, progress: (p: number) => void): Promise<JobInfo> {
  return new Promise((resolve) =>
    watching.set(id, (j) => {
      if (j.state !== 'done' && j.state !== 'failed' && j.state !== 'canceled') return progress(j.progress)
      watching.delete(id)
      resolve(j)
    }),
  )
}

async function make(run: Run, demo: Demo, frame: Frame, versionOf?: string): Promise<Result> {
  const r = await record(run, demo)
  if (!('bundle' in r)) return r
  const { bundle, done } = r
  const map = timeMap((await readProject(bundle)).clips)
  const out = (t: number) => sec(toOutput(map, t) ?? t)
  const steps = done.map((s) => ({ index: s.index, label: s.label, ok: true, time: out(s.start), end: out(s.end) }))
  const marks = chapters(done.filter((s) => s.say).map((s) => ({ t: out(s.start), title: s.say! })))

  // Both exports queue now and run one after the other, while the editor renders the frames.
  stage(run, 'Exporting', 50)
  const jobs = await Promise.all([exportWithoutAsking({ bundle, options: defaultOptions(), dest: 'file' }), exportWithoutAsking({ bundle, options: cleanOptions({ format: 'gif' }), dest: 'file' })])
  const at = [0, 0]
  const exports = jobs.map((j, i) =>
    ended(j.id, (p) => {
      at[i] = p
      stage(run, i ? 'Exporting the GIF' : 'Exporting the MP4', 50 + 22 * (at[0] + at[1]))
    }),
  )
  const images: Image[] = []
  let missing = ''
  for (const s of steps) {
    try {
      const { image } = await frame({ project: bundle, time: s.end, size: FRAME_HEIGHT })
      if (image) images.push(image)
    } catch (e) {
      missing = ` No frames from step ${s.index} on: ${plainError(e).message}`
      break
    }
  }
  const [mp4, gif] = await Promise.all(exports)

  let link: string | undefined
  let version: number | undefined
  let shared = ''
  if (demo.share && mp4.state === 'done') {
    stage(run, 'Uploading', 95)
    try {
      const job = await shareFile(mp4.path, { title: demo.title ?? run.name, project: bundle, private: demo.private, chapters: marks, versionOf, ...(gif.state === 'done' && { gif: gif.path }), copy: false })
      link = job?.link
      version = versionOf ? job?.remote?.version : undefined
      const as = version ? `, version ${version}: wherever the link was posted, it plays once uploaded` : ''
      shared = link ? `\nLink: ${link}${as} (the video keeps uploading in the background)` : '\nThe upload was canceled in Grip.'
    } catch (e) {
      shared = `\n${e instanceof ShareError && e.status === 402 ? e.message : `The video was saved, but the upload failed: ${plainError(e).message}`}`
    }
  }
  const file = (j: JobInfo, what: string) => (j.state === 'done' ? `${what}: ${j.path}${j.bytes ? ` (${formatBytes(j.bytes)})` : ''}` : `${what}: the export ${j.state === 'canceled' ? 'was canceled in Grip' : `failed. ${j.error ?? ''}`.trim()}`)
  const seconds = sec(map.duration)
  const text = [
    `Recorded “${run.name}”: ${seconds} s, ${count(steps.length, 'step')}, each one done.`,
    ...steps.map((s) => `- ${s.index} at ${s.time} s: ${s.label}`),
    `Project: ${bundle} (auto zooms on its clicks and typing, as after a recording; get_project and edit_project work on it)`,
    file(mp4, 'MP4'),
    file(gif, 'GIF'),
  ].join('\n') + shared + (images.length ? `\nImage n is step n as it ended, as get_frame renders it.${missing}` : missing)
  const failed = mp4.state !== 'done' || gif.state !== 'done' || (demo.share && !link)
  const data = {
    message: text,
    id: run.id,
    state: 'done',
    project: bundle,
    seconds,
    steps,
    chapters: marks,
    ...(mp4.state === 'done' && { mp4: mp4.path }),
    ...(gif.state === 'done' && { gif: gif.path }),
    ...(link && { link }),
    ...(version && { version }),
  }
  return { text, data, images, ...(failed && { failed: true }) }
}

// ---- The recording ----

type Look = { state: 'missing' | 'hidden' | 'invalid' } | { state: 'outside' | 'covered' | 'ready'; x: number; y: number; by?: string }
/** A paint, released once nothing holds it: neither record() nor a frame on its way to the encoder. */
type Shot = { texture: OffscreenSharedTexture; refs: number }
const drop = (s: Shot) => --s.refs || s.texture.release()

/** Runs in the page's isolated world, so it must hold everything it uses: where `sel` is, or why it is not
 *  ready for the pointer. `reveal` scrolls it to the middle first. */
function lookup(sel: Selector, reveal: boolean) {
  const visible = (e: Element) => e.getClientRects().length > 0 && e.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  let el: Element | undefined
  if ('css' in sel) {
    let all: Element[]
    try {
      all = [...document.querySelectorAll(sel.css)]
    } catch {
      return { state: 'invalid' }
    }
    el = all.find(visible) ?? all[0]
  } else {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    const want = sel.exact ? sel.text : sel.text.toLowerCase()
    const has = (e: Element) => {
      const t = norm(e instanceof HTMLInputElement ? e.value : (e.textContent ?? ''))
      return sel.exact ? t === want : t.toLowerCase().includes(want)
    }
    const skip = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']
    // The innermost elements that hold the text: a button's label, not the toolbar around it.
    const hits = [...document.querySelectorAll('body *')].filter((e) => !skip.includes(e.tagName) && has(e) && ![...e.children].some(has))
    el = hits.find(visible) ?? hits[0]
  }
  if (!el) return { state: 'missing' }
  if (!visible(el)) return { state: 'hidden' }
  if (reveal) el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { state: 'outside', x, y }
  const hit = document.elementFromPoint(x, y)
  if (hit && !el.contains(hit)) return { state: 'covered', x, y, by: hit.tagName.toLowerCase() + (hit.id ? `#${hit.id}` : '') + [...hit.classList].slice(0, 2).map((c) => `.${c}`).join('') }
  return { state: 'ready', x, y }
}

let guarded = false
/** The demo session, fresh for each run. It grants nothing and downloads nothing. */
async function demoSession() {
  const ses = session.fromPartition(PARTITION)
  if (!guarded) {
    guarded = true
    ses.setPermissionRequestHandler((_wc, _p, answer) => answer(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', (e) => e.preventDefault())
  }
  await ses.clearStorageData()
  await ses.clearCache()
  return ses
}

/** The encoder window's IPC: one encoder at a time, and only it may call. */
let encoder: { wc: WebContents; ready(codec: string): void; write(position: number, data: Uint8Array): Promise<void>; done(): Promise<void>; fail(message: string): void } | undefined
let channels = false
function listen() {
  if (channels) return
  channels = true
  const own = (e: IpcMainInvokeEvent) => {
    if (!encoder || e.sender !== encoder.wc) throw new Error('Not the demo encoder.')
    return encoder
  }
  ipcMain.handle('demo:ready', (e, codec: unknown) => own(e).ready(String(codec)))
  ipcMain.handle('demo:write', (e, position: unknown, data: unknown) => {
    if (!Number.isSafeInteger(position) || (position as number) < 0 || !(data instanceof Uint8Array)) throw new Error('Invalid demo write.')
    return own(e).write(position as number, data)
  })
  ipcMain.handle('demo:done', (e) => own(e).done())
  ipcMain.handle('demo:fail', (e, message: unknown) => own(e).fail(String(message).slice(0, 500)))
}

/** The page, recorded while its steps run. A failed step answers with why and the page as it gave up. */
async function record(run: Run, demo: Demo): Promise<Result | { bundle: string; done: Done[] }> {
  listen()
  const ses = await demoSession()
  const page = new BrowserWindow({
    width: demo.width,
    height: demo.height,
    useContentSize: true,
    show: false,
    // disableDialogs: an alert returns at once and a confirm says no, with nothing on screen.
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, disableDialogs: true, offscreen: { useSharedTexture: true, deviceScaleFactor: SCALE } },
  })
  const wc = page.webContents
  let enc: BrowserWindow | undefined
  let held: Shot | undefined // the page as it shows now
  let fh: FileHandle | undefined
  let bundle = ''
  let broken = '' // why the page or the encoder stopped
  const done: Done[] = []
  let current: Done | undefined
  try {
    wc.setFrameRate(FPS)
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (e) => /^(https?|file):/.test(e.url) || e.preventDefault())
    wc.on('did-fail-load', (_e, code, why, url, main) => main && code !== -3 && (broken = `${url} did not load (${why})`)) // -3: replaced by another load
    wc.on('did-navigate', (_e, url, status) => status >= 400 && (broken = `${url} answered HTTP ${status}`))
    wc.on('render-process-gone', (_e, d) => (broken = `the page stopped (${d.reason})`))
    // A hidden page has no focus: emulated, typing lands, and :focus styles show as they would on screen.
    // The debugger answers only once the page has a renderer, so a blank page comes first.
    await within(wc.loadURL('about:blank'), LOAD_MS, 'Grip could not open a page.')
    wc.debugger.attach('1.3')
    await within(wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }), 5000, 'Grip could not focus the page.')

    // Frames: a page paints only when it changes, and invalidate() paints no texture, so the latest paint is
    // held: it opens the video and closes it. A paint waits while one is on its way, so the encoder sets
    // the pace and the last state always lands.
    let live = false
    let t0: number | undefined // performance.now() of the first frame: source time 0
    let painted = () => {}
    const first = new Promise<void>((r) => (painted = r))
    let sending = false
    let next: { shot: Shot; ms: number } | undefined
    const send = async (shot: Shot, ms: number) => {
      sending = true
      const imported = sharedTexture.importSharedTexture({ textureInfo: shot.texture.textureInfo, allReferencesReleased: () => drop(shot) })
      try {
        await sharedTexture.sendSharedTexture({ frame: enc!.webContents.mainFrame, importedSharedTexture: imported }, t0 === undefined ? 0 : (ms - t0) / 1000)
        if (t0 === undefined) {
          t0 = ms
          painted()
        }
      } catch (e) {
        console.warn('[demo] a frame did not reach the encoder:', e)
      } finally {
        imported.release()
      }
      sending = false
      const n = next
      next = undefined
      if (n) void send(n.shot, n.ms)
    }
    const queue = (shot: Shot, ms = performance.now()) => {
      shot.refs++
      if (!sending) return void send(shot, ms)
      if (next) drop(next.shot)
      next = { shot, ms }
    }
    wc.on('paint', (e) => {
      if (!e.texture) return
      if (held) drop(held)
      held = { texture: e.texture, refs: 1 }
      if (live) queue(held)
    })

    await within(wc.loadURL(demo.url), LOAD_MS, `it did not finish loading within ${LOAD_MS / 1000} s`).catch((e) => {
      throw new Error(`Grip could not load ${demo.url}: ${broken || plainError(e).message}`)
    })
    if (broken) throw new Error(`Grip could not load ${demo.url}: ${broken}.`)

    bundle = await createBundle(run.name)
    run.name = basename(bundle, '.grip') // made unique, and safe for Finder
    const part = join(bundle, 'sources', 'screen.part.mp4')
    fh = await open(part, 'w')
    const file = fh
    let writes = Promise.resolve()
    let ready = (_: string) => {}
    let closed = () => {}
    let failed = (_: Error) => {}
    const started = new Promise<string>((r) => (ready = r))
    const finished = new Promise<void>((resolve, reject) => ((closed = resolve), (failed = reject)))
    finished.catch(() => {}) // the encoder can fail mid-step: check() reports it there
    enc = openWindow(`demo?w=${demo.width * SCALE}&h=${demo.height * SCALE}&fps=${FPS}`, { show: false, width: 320, height: 240, webPreferences: { backgroundThrottling: false } })
    const encWin = enc
    encoder = {
      wc: enc.webContents,
      ready,
      write: (position, data) => (writes = writes.then(() => file.write(data, 0, data.byteLength, position).then(() => {}))),
      done: async () => {
        await writes
        closed()
      },
      fail: (m) => {
        broken = `Grip’s encoder stopped: ${m}`
        failed(new Error(broken))
      },
    }
    enc.webContents.on('render-process-gone', (_e, d) => encoder?.wc === encWin.webContents && encoder.fail(`its window stopped (${d.reason})`))
    await within(started, 20_000, 'Grip’s encoder did not start within 20 s.')

    // Recording from the first frame on.
    const events: InputEvent[] = []
    const now = () => (performance.now() - t0!) / 1000
    const log = (e: Record<string, unknown>) => events.push({ t: Math.round(now() * 1e4) / 1e4, ...e } as InputEvent)
    live = true
    if (held) queue(held)
    await within(first, 5000, `${demo.url} painted nothing within 5 s.`)

    let kind: 'arrow' | 'pointer' | 'ibeam' = 'arrow'
    const shown = () => log({ type: 'cursor', id: kind, hotX: 8, hotY: 8, w: 64, h: 64, scale: SCALE, kind }) // the built-in set draws it
    // Chromium's names: 'pointer' is the arrow, 'hand' the pointing hand.
    wc.on('cursor-changed', (_e, type) => {
      const k = type === 'hand' ? 'pointer' : type === 'text' || type === 'vertical-text' ? 'ibeam' : 'arrow'
      if (k === kind) return
      kind = k
      shown()
    })
    shown()
    let pointer: Pt = [demo.width / 2, demo.height / 2]
    const check = () => {
      if (broken) throw new Stop(broken)
    }
    const look = async (sel: Selector, reveal = false): Promise<Look> =>
      wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${lookup.toString()})(${JSON.stringify(sel)}, ${reveal})` }]).catch(() => ({ state: 'missing' })) // mid-navigation
    const moveTo = ([x, y]: Pt) => {
      wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) })
      log({ type: 'move', x: x * SCALE, y: y * SCALE })
      pointer = [x, y]
    }
    const travelTo = async (to: Pt) => {
      const d = travel(Math.hypot(to[0] - pointer[0], to[1] - pointer[1]))
      const at = glide([[0, ...pointer], [d, ...to]])
      for (const start = performance.now(); ; await sleep(1000 / 60)) {
        const t = Math.min(d, (performance.now() - start) / 1000)
        moveTo(at(t))
        if (t >= d) return
      }
    }
    const click = async ([x, y]: Pt) => {
      const [cx, cy] = [Math.round(x), Math.round(y)]
      log({ type: 'down', x: x * SCALE, y: y * SCALE, button: 'left' })
      wc.sendInputEvent({ type: 'mouseDown', x: cx, y: cy, button: 'left', clickCount: 1 })
      await sleep(90)
      wc.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 })
      log({ type: 'up', x: x * SCALE, y: y * SCALE, button: 'left' })
    }
    const press = async (k: Key) => {
      log({ type: 'key', down: true, key: k.label, code: 0, mods: k.mods })
      if (k.edit) {
        // ⌘A, ⌘Z, ⌘←: the editing command goes with the key, and runs unless the page takes the key itself.
        const { command, key, code, vk } = k.edit
        const e = { key, code, windowsVirtualKeyCode: vk, modifiers: k.modifiers.reduce((b, m) => b | { alt: 1, control: 2, meta: 4, shift: 8 }[m], 0) }
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e, commands: [command] })
        await sleep(60)
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...e })
      } else {
        wc.sendInputEvent({ type: 'keyDown', keyCode: k.code, modifiers: k.modifiers })
        if (k.char) wc.sendInputEvent({ type: 'char', keyCode: k.char, modifiers: k.modifiers })
        await sleep(60)
        wc.sendInputEvent({ type: 'keyUp', keyCode: k.code, modifiers: k.modifiers })
      }
      log({ type: 'key', down: false, key: k.label, code: 0, mods: k.mods })
    }
    const typeText = async (text: string) => {
      const from = performance.now() / 1000
      for (const [i, ch] of [...text].entries()) {
        await sleep(Math.max(0, typedAt(from, i, CPS) * 1000 - performance.now()))
        check()
        if (ch === '\n' || ch === '\t') {
          await press(parseKey(ch === '\n' ? 'Enter' : 'Tab'))
          continue
        }
        const key = ch === ' ' ? 'Space' : ch
        const mods: Modifier[] = /[A-Z]/.test(ch) ? ['⇧'] : []
        log({ type: 'key', down: true, key, code: 0, mods })
        if (/^[\x20-\x7e]$/.test(ch)) {
          wc.sendInputEvent({ type: 'keyDown', keyCode: ch })
          wc.sendInputEvent({ type: 'char', keyCode: ch })
          await sleep(40)
          wc.sendInputEvent({ type: 'keyUp', keyCode: ch })
        } else await wc.insertText(ch) // accents, emoji: no key on a US layout types them
        log({ type: 'key', down: false, key, code: 0, mods })
      }
    }
    /** Wheel the page under the pointer until (x, y) is in the middle of the view, as a hand scrolls. */
    const wheelTo = async (sel: Selector, x: number, y: number) => {
      const [dx, dy] = [x < 0 || x >= demo.width ? x - demo.width / 2 : 0, y - demo.height / 2]
      const dur = Math.min(1.5, 0.35 + Math.hypot(dx, dy) / 2500)
      let [sx, sy] = [0, 0] // whole px sent so far
      for (const start = performance.now(); ; await sleep(1000 / 60)) {
        const p = Math.min(1, (performance.now() - start) / 1000 / dur)
        const [wx, wy] = [Math.round(-dx * smooth(p)) - sx, Math.round(-dy * smooth(p)) - sy]
        sx += wx
        sy += wy
        const [px, py] = pointer.map(Math.round)
        if (wx || wy) {
          wc.sendInputEvent({ type: 'mouseWheel', x: px, y: py, deltaX: wx, deltaY: wy, canScroll: true, hasPreciseScrollingDeltas: true })
          log({ type: 'scroll', x: pointer[0] * SCALE, y: pointer[1] * SCALE, dx: wx * SCALE, dy: wy * SCALE })
        }
        if (p >= 1) break
      }
      await sleep(150)
      // ponytail: the wheel scrolls what is under the pointer; a target in another scrolling box jumps into view instead.
      const l = await look(sel)
      if (l.state === 'outside' && Math.abs(l.x - x) < 1 && Math.abs(l.y - y) < 1) await look(sel, true)
    }
    const why = (sel: Selector, l: Look) =>
      l.state === 'missing' ? `nothing on the page matches ${quote(sel)} after ${STEP_MS / 1000} s`
      : l.state === 'hidden' ? `${quote(sel)} is on the page but hidden`
      : l.state === 'outside' ? `${quote(sel)} stays out of view, even after scrolling`
      : l.state === 'covered' ? `${quote(sel)} is under ${l.by}, which would take the click`
      : `${quote(sel)} keeps moving`
    /** Where the pointer can act on `sel`: shown, in view (scrolled there), uncovered, and still. `view`: in view is enough. */
    const reach = async (sel: Selector, view = false): Promise<Pt> => {
      const until = performance.now() + STEP_MS
      let last: Look | undefined
      for (let scrolls = 0; ; await sleep(50)) {
        check()
        const l = await look(sel)
        if (l.state === 'invalid') throw new Stop(`${quote(sel)} is not a valid CSS selector`)
        if (l.state === 'outside' && scrolls++ < 3) {
          await wheelTo(sel, l.x, l.y)
          continue
        }
        if ('x' in l && (view ? l.state !== 'outside' : l.state === 'ready' && last?.state === 'ready' && Math.hypot(l.x - last.x, l.y - last.y) < 1)) return [l.x, l.y]
        if (performance.now() > until) throw new Stop(why(sel, l))
        last = l
      }
    }
    const appear = async (sel: Selector) => {
      const until = performance.now() + STEP_MS
      for (; ; await sleep(50)) {
        check()
        const l = await look(sel)
        if (l.state === 'invalid') throw new Stop(`${quote(sel)} is not a valid CSS selector`)
        if (l.state !== 'missing' && l.state !== 'hidden') return
        if (performance.now() > until) throw new Stop(why(sel, l))
      }
    }
    /** Let the page answer: `ms`, then any load a step started. */
    const calm = async (ms: number) => {
      await sleep(ms)
      for (const until = performance.now() + LOAD_MS; wc.isLoading(); await sleep(50)) if (performance.now() > until) throw new Stop(`the page did not finish loading within ${LOAD_MS / 1000} s`)
      check()
    }
    const act = async (s: Step) => {
      if (s.do === 'click') {
        await travelTo(await reach(s.target))
        await click(pointer)
        await calm(600)
      } else if (s.do === 'hover') {
        await travelTo(await reach(s.target))
        await calm(700)
      } else if (s.do === 'type') {
        if (s.into) {
          await travelTo(await reach(s.into))
          await click(pointer)
          await calm(250)
        }
        await typeText(s.text)
        await calm(500)
      } else if (s.do === 'press') {
        await press(s.key)
        await calm(500)
      } else if (s.do === 'scroll') {
        await reach(s.target, true)
        await calm(500)
      } else if ('ms' in s) await calm(s.ms)
      else {
        await appear(s.target)
        await calm(300)
      }
    }

    moveTo(pointer)
    await sleep(LEAD_MS)
    for (const [i, s] of demo.steps.entries()) {
      stage(run, `Step ${i + 1} of ${demo.steps.length}: ${s.label}`, (50 * i) / demo.steps.length)
      current = { index: i + 1, label: s.label, ...(s.say ? { say: s.say } : {}), ok: false, start: now(), end: 0 }
      await act(s)
      check()
      done.push({ ...current, ok: true, end: now() })
      current = undefined
      if (now() > MAX_SECONDS) throw new Stop(`the demo ran past ${MAX_SECONDS / 60} minutes`)
    }
    await sleep(TAIL_MS)

    // The last frame at the end, so the video lasts as long as the page did; then the file closes.
    stage(run, 'Saving the recording', 50)
    queue(held!)
    live = false
    while (sending) await sleep(10)
    enc.webContents.send('demo:finish')
    await within(finished, 30_000, 'Grip’s encoder did not finish the file within 30 s.')
    await fh.close()
    fh = undefined
    await writeFile(join(bundle, 'sources', 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    await rename(part, join(bundle, 'sources', 'screen.mp4'))
    const p = await probe(join(bundle, 'sources', 'screen.mp4'))
    if (!p?.video) throw new Error('The recording came out empty.')
    const { width, height } = p.video
    await writeNewRecording(bundle, { duration: p.duration, screen: { file: 'sources/screen.mp4', width, height, fps: FPS, scale: SCALE }, events: 'sources/events.jsonl' }, { preset: settings().preset, autoZoom: settings().autoZoom, zoomLook: settings().zoomLook })
    // The events name standard cursors, with no images beside them: the built-in set draws them.
    await updateProject(bundle, (pr) => {
      if ((pr.style.cursor.set ?? 'system') === 'system') pr.style.cursor.set = 'builtin'
    })
    return { bundle, done }
  } catch (e) {
    if (!bundle || !(e instanceof Stop || current)) throw e
    // A step failed: say which and why, show the page as it gave up, and keep nothing.
    const shot = await wc.capturePage().catch(() => null)
    const image = shot && !shot.isEmpty() ? shot.resize({ height: FRAME_HEIGHT, quality: 'good' }).toJPEG(80) : null
    const failedStep = current ?? done.at(-1)
    const reason = e instanceof Stop ? e.message : plainError(e).message
    const n = demo.steps.length
    const text = `Step ${failedStep?.index ?? 1} of ${n}${failedStep ? ` (${failedStep.label})` : ''} failed: ${reason}. Grip stopped there and kept nothing.${image ? ' The image is the page as the step gave up.' : ''}`
    const steps = [...done, ...(current ? [{ ...current, error: reason }] : [])].map((s) => ({ index: s.index, label: s.label, ok: s.ok, time: sec(s.start), ...(s.error && { error: s.error }) }))
    return { text, data: { message: text, id: run.id, state: 'failed', step: failedStep?.index ?? 1, steps }, images: image ? [{ data: image.toString('base64'), mimeType: 'image/jpeg' }] : [], failed: true }
  } finally {
    if (encoder?.wc === enc?.webContents) encoder = undefined
    if (held) drop(held)
    if (wc.debugger.isAttached()) wc.debugger.detach()
    page.destroy()
    enc?.destroy()
    await fh?.close().catch(() => {})
    if (bundle && !existsSync(join(bundle, 'project.json'))) await rm(bundle, { recursive: true, force: true })
  }
}
