// The landing page's hero: the Grip editor playing the hero demo's light take, one take per wallpaper a visitor
// can pick. A take is the running editor stepped frame by frame over CDP: seek, wait until the preview has drawn
// that moment, capture the window. While a visitor watches, the editor plays, so its transport shows Pause; a
// visitor who pauses sees Play, cut from the window while the editor really is paused, and the button answers the
// pointer as it does in the app. macOS draws the window's controls outside the page, so they are drawn in. The
// geometry the page needs to hand the editor to a visitor (where the timeline puts each moment, the play button,
// each wallpaper's tile) is measured from the same window.
// Writes site/static/media/editor-<wallpaper>.mp4, editor.webp, editor-transport.webp, and site/src/lib/editor.json.
// Run after make.ts, with the app up (STUDIO_CDP_PORT=9333 npm run dev): node scripts/readme/editor.ts
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import hero from './hero/demo.ts'

const ROOT = join(import.meta.dirname, '../..')
const MEDIA = join(ROOT, 'site/static/media')
const PORT = process.env.STUDIO_CDP_PORT ?? '9333'
const W = 1440, H = 900, SCALE = 2, FPS = 60, WIDTH = 2304 // the window in CSS px, captured at 2x, encoded at WIDTH
const STILL = 0.1 // the still's moment, shown until the take plays and instead of it under reduced motion
// The project's own wallpaper first, the one the page opens on; the rest span the collection's colors.
const WALLPAPERS = ['Nacre', 'Halo', 'Meringue', 'Marbling']
const PAUSE = 'M6 4.5h2.6v11H6zM11.4 4.5H14v11h-2.6z' // the transport's pause icon, as Timeline.svelte draws it

// The editor opens a copy of the demo whose screen is the light take: Grip's window is dark, the page around it
// either, and the light app inside reads in both.
const bundle = join(ROOT, '.context/readme/editor', `${hero.name}.grip`)
rmSync(bundle, { recursive: true, force: true })
cpSync(join(ROOT, '.context/readme', `${hero.name}.grip`), bundle, { recursive: true })
const project = JSON.parse(readFileSync(join(bundle, 'project.json'), 'utf8'))
project.sources.screen.file = 'sources/screen-light.mp4'
writeFileSync(join(bundle, 'project.json'), JSON.stringify(project))
execFileSync('npm', ['run', 'dev', '--', '--open', bundle], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, STUDIO_CDP_PORT: PORT } })

let ws: WebSocket | undefined // the editor's page, once attach() finds it
let id = 0
function send(method: string, params: object = {}): Promise<any> {
  const me = ++id
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent) => {
      const m = JSON.parse(String(e.data))
      if (m.id !== me) return
      ws!.removeEventListener('message', on)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
    ws!.addEventListener('message', on)
    ws!.send(JSON.stringify({ id: me, method, params }))
  })
}
async function run(expression: string): Promise<any> {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
// The editor's page: the one whose project is the copy, once its player is ready.
async function attach(): Promise<void> {
  for (let i = 0; i < 120; i++, await new Promise((r) => setTimeout(r, 500))) {
    const pages: Array<{ url: string; webSocketDebuggerUrl: string }> = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    for (const page of pages.filter((p) => /#\/editor\b/.test(p.url))) {
      ws = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((r) => ws!.addEventListener('open', r, { once: true }))
      const ours = await run(`import('/lib/doc.svelte.ts').then(({ doc }) => doc.path === ${JSON.stringify(bundle)})`)
        .then((yes) => yes && run(`import('/lib/player.svelte.ts').then(({ player }) => player.duration > 0)`))
        .catch(() => false)
      if (ours) return
      ws.close()
    }
  }
  throw new Error(`No editor showed ${bundle} on CDP port ${PORT}: start the app with STUDIO_CDP_PORT=${PORT} npm run dev`)
}
// An editor left open by an earlier run still wears its changes: start from a fresh page.
await attach()
await send('Page.reload')
ws!.close()
await new Promise((r) => setTimeout(r, 1000))
await attach()

const shot = async (format: 'png' | 'jpeg') =>
  Buffer.from((await send('Page.captureScreenshot', { format, ...(format === 'jpeg' && { quality: 95 }) })).data, 'base64')

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false })
const geometry = await run(`(async () => {
  const [{ player, seek, stats }, { doc }] = await Promise.all([import('/lib/player.svelte.ts'), import('/lib/doc.svelte.ts')])
  const raf = () => new Promise((r) => requestAnimationFrame(r))
  // A seek counts once the preview has drawn it; the title keeps reading Saved, as it does while a project plays.
  window.__at = async (t) => {
    if (Math.abs(player.time - t) < 1e-6) await window.__at(t < 1 ? 1 : 0) // a seek to where it is draws nothing
    const before = stats.frames
    seek(t)
    for (let i = 0; i < 600 && stats.frames === before; i++) await raf()
    doc.dirty = false
    await raf(); await raf()
    if (stats.frames === before) throw new Error('The preview drew nothing at ' + t)
  }
  const one = (selector) => {
    const el = document.querySelector(selector)
    if (!el) throw new Error('The editor has no ' + selector)
    return el
  }
  const tab = one('button[role=tab][aria-label="Background"]')
  if (tab.getAttribute('aria-selected') !== 'true') tab.click()
  await raf(); await raf()
  const rect = (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 100) / 100) }
  // The tray on show: a collection switch leaves a hidden copy of the last one behind.
  const tiles = new Map()
  for (const r of document.querySelectorAll('input[type=radio][aria-label]'))
    if (r.getBoundingClientRect().width && !tiles.has(r.getAttribute('aria-label'))) tiles.set(r.getAttribute('aria-label'), r)
  window.__wallpaper = (name) => {
    if (!tiles.has(name)) throw new Error('No wallpaper tile ' + name)
    tiles.get(name).click()
  }
  // The window's controls, where Grip asks macOS to put them (electron/windows.ts), as macOS draws them.
  const lights = document.createElement('div')
  lights.style.cssText = 'position:fixed;left:12px;top:13px;display:flex;gap:8px;z-index:2147483647;pointer-events:none'
  lights.innerHTML = ['#ff5f57', '#febc2e', '#28c840'].map((c) => '<i style="width:12px;height:12px;border-radius:50%;background:' + c + ';box-shadow:inset 0 0 0 0.5px rgb(0 0 0 / 0.2)"></i>').join('')
  document.body.append(lights)
  window.__wallpaper(${JSON.stringify(WALLPAPERS[0])})
  await window.__at(${STILL}); await new Promise((r) => setTimeout(r, 800)) // the resized preview settles
  await window.__at(${STILL})
  return {
    play: rect(one('button.play')),
    timeline: rect(one('section.timeline canvas')),
    tiles: Object.fromEntries(${JSON.stringify(WALLPAPERS)}.map((n) => { if (!tiles.has(n)) throw new Error('No wallpaper tile ' + n); return [n, rect(tiles.get(n))] })),
  }
})()`)

// The transport as a visitor finds it, cut from the window: paused, paused under the pointer, and playing under
// the pointer (playing alone is in the takes). One sprite, left to right.
const work = mkdtempSync(join(tmpdir(), 'grip-editor-'))
const ff = (...args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
const [px, py, pw, ph] = geometry.play.map((v: number) => Math.round(v * SCALE))
const mouse = (x: number, y: number) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
const hover = async (name: string) => {
  await mouse(geometry.play[0] + geometry.play[2] / 2, geometry.play[1] + geometry.play[3] / 2)
  await run('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
  writeFileSync(join(work, name), await shot('png'))
  await mouse(W * 0.7, 20) // the title bar's empty stretch, where nothing reacts
  await run('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
}
writeFileSync(join(work, 'still.png'), await shot('png'))
await hover('paused-hover.png')
await run(`(() => { const p = document.querySelector('button.play svg path'); if (!p) throw new Error('No play icon'); p.setAttribute('d', ${JSON.stringify(PAUSE)}) })()`)
await hover('playing-hover.png')
const cut = `crop=${pw}:${ph}:${px}:${py}`
ff('-i', join(work, 'still.png'), '-i', join(work, 'paused-hover.png'), '-i', join(work, 'playing-hover.png'), '-filter_complex',
  `[0]${cut}[a];[1]${cut}[b];[2]${cut}[c];[a][b][c]hstack=3`, join(work, 'transport.png'))
ff('-i', join(work, 'still.png'), '-vf', `scale=${WIDTH}:-2:flags=lanczos`, join(work, 'still-web.png'))
mkdirSync(MEDIA, { recursive: true })
execFileSync('cwebp', ['-quiet', '-q', '88', join(work, 'still-web.png'), '-o', join(MEDIA, 'editor.webp')])
execFileSync('cwebp', ['-quiet', '-lossless', join(work, 'transport.png'), '-o', join(MEDIA, 'editor-transport.webp')])

// Playing: one take per wallpaper. A visitor drags the playhead, so a keyframe every half second keeps any seek short.
const frames = Math.round(hero.duration * FPS)
const slug = (name: string) => name.toLowerCase().replace(/\W+/g, '-')
let ends: [Buffer, Buffer] | undefined
for (const name of WALLPAPERS) {
  await run(`window.__wallpaper(${JSON.stringify(name)})`)
  const dir = join(work, slug(name))
  mkdirSync(dir)
  for (let i = 0; i < frames; i++) {
    await run(`window.__at(${i / FPS})`)
    writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.jpg`), await shot('jpeg'))
  }
  ends ??= [readFileSync(join(dir, 'f0000.jpg')), readFileSync(join(dir, `f${String(frames - 1).padStart(4, '0')}.jpg`))]
  ff('-framerate', String(FPS), '-i', join(dir, 'f%04d.jpg'), '-an', '-vf', `scale=${WIDTH}:-2:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '26', '-level:v', '5.1', '-g', String(FPS / 2), '-movflags', '+faststart',
    join(MEDIA, `editor-${slug(name)}.mp4`))
  console.log(`editor-${slug(name)}.mp4`)
}

// Where the timeline puts a moment: the playhead is the one thing in it that moves, so the columns where the first
// and the last frame differ most are the playhead at 0 and at the last frame.
const [tx, ty, tw, th] = geometry.timeline.map((v: number) => Math.round(v * SCALE))
const gray = (jpeg: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:', '-vf',
  `crop=${tw}:${th}:${tx}:${ty},format=gray`, '-f', 'rawvideo', 'pipe:'], { input: jpeg, maxBuffer: 1 << 26 })
const [a, b] = ends!.map(gray)
const brighter = (p: Buffer, q: Buffer) => {
  let best = 0, at = -1
  for (let x = 0; x < tw; x++) {
    let sum = 0
    for (let y = 0; y < th; y++) sum += Math.max(0, p[y * tw + x] - q[y * tw + x])
    if (sum > best) [best, at] = [sum, x]
  }
  if (best < th * 40) throw new Error('No playhead in the timeline')
  return (tx + at + 0.5) / SCALE
}
const x0 = brighter(a, b), x1 = brighter(b, a)
const round = (v: number) => Math.round(v * 100) / 100
writeFileSync(join(ROOT, 'site/src/lib/editor.json'), JSON.stringify({
  width: W, height: H, fps: FPS, frames,
  still: 'media/editor.webp',
  transport: { box: geometry.play, src: 'media/editor-transport.webp' },
  timeline: { box: geometry.timeline, x0: round(x0), perSecond: round((x1 - x0) / ((frames - 1) / FPS)) },
  wallpapers: WALLPAPERS.map((name) => ({ name, box: geometry.tiles[name], src: `media/editor-${slug(name)}.mp4` })),
}, null, '\t') + '\n')
rmSync(work, { recursive: true })
ws!.close()
