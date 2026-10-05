// Synthetic recording fixture: a project bundle that looks like a real recording, for tests and
// agents without Screen Recording permission. Run: `npx electron scripts/fixture/make.ts [out.grip]`
// Default: .context/fixtures/Demo #1 ✨ café.grip (hostile name on purpose).
// Produces: screen.mp4 (2880x1800@30, no cursor), camera.mp4, mic.m4a (spoken, with fillers),
// system.m4a (click blips), events.jsonl (moves, clicks, keys, scroll), project.json.
import { app, BrowserWindow } from 'electron'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createProject } from '../../src/shared/project.ts'
import type { InputEvent } from '../../src/shared/events.ts'

const W = 1440, H = 900, SCALE = 2, FPS = 30, DURATION = 24
const out = resolve(process.argv.find((a) => a.endsWith('.grip')) ?? join(import.meta.dirname, '../../.context/fixtures/Demo #1 ✨ café.grip'))
const src = join(out, 'sources')

// Timeline (seconds). Points in CSS px of the 1440x900 page; events are written in video px (x2).
const SCRIPT = {
  focus: 6.0,
  typing: { start: 6.6, text: 'Launch plan Q4 — Zürich', cps: 9 },
  click: { down: 11.2, up: 11.35 },
  scroll: { start: 15, dur: 2.5, px: 500 },
}
const TARGETS: Array<[number, number, number]> = [
  // [t, x, y] waypoints the cursor passes through
  [0, 700, 500], [1.5, 260, 130], [3, 330, 190], [5.6, 620, 236], [6.4, 622, 238], [9.5, 640, 300],
  [11, 486, 384], [11.6, 488, 386], [13, 900, 520], [14.5, 760, 640], [18, 760, 640], [20, 1100, 300], [24, 1150, 280],
]

function cursorAt(t: number): [number, number] {
  let i = 0
  while (i + 1 < TARGETS.length - 1 && TARGETS[i + 1][0] <= t) i++
  const [t0, x0, y0] = TARGETS[i], [t1, x1, y1] = TARGETS[i + 1]
  const p = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
  const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2 // human-ish ease with a little wobble
  const wob = Math.sin(t * 37) * 1.2 * (1 - Math.abs(2 * p - 1))
  return [x0 + (x1 - x0) * e + wob, y0 + (y1 - y0) * e - wob]
}

function events(): InputEvent[] {
  const ev: InputEvent[] = []
  for (let t = 0; t <= DURATION; t += 1 / 120) {
    const [x, y] = cursorAt(t)
    ev.push({ t: +t.toFixed(4), type: 'move', x: x * SCALE, y: y * SCALE })
  }
  const click = (t: number, up: number) => {
    const [x, y] = cursorAt(t)
    ev.push({ t, type: 'down', x: x * SCALE, y: y * SCALE, button: 'left' }, { t: up, type: 'up', x: x * SCALE, y: y * SCALE, button: 'left' })
  }
  click(SCRIPT.focus, SCRIPT.focus + 0.1)
  click(SCRIPT.click.down, SCRIPT.click.up)
  ;[...SCRIPT.typing.text].forEach((ch, i) => {
    const t = SCRIPT.typing.start + i / SCRIPT.typing.cps
    const key = ch === ' ' ? 'Space' : ch
    const mods: Array<'⇧'> = ch !== ch.toLowerCase() ? ['⇧'] : []
    ev.push({ t, type: 'key', down: true, key, code: 0, mods }, { t: t + 0.06, type: 'key', down: false, key, code: 0, mods })
  })
  ev.push({ t: SCRIPT.focus + 4.6, type: 'key', down: true, key: 'A', code: 0, mods: ['⌘'] }, { t: SCRIPT.focus + 4.7, type: 'key', down: false, key: 'A', code: 0, mods: ['⌘'] })
  for (let t = SCRIPT.scroll.start; t < SCRIPT.scroll.start + SCRIPT.scroll.dur; t += 0.05) {
    const [x, y] = cursorAt(t)
    ev.push({ t: +t.toFixed(3), type: 'scroll', x: x * SCALE, y: y * SCALE, dx: 0, dy: -10 })
  }
  return ev.sort((a, b) => a.t - b.t)
}

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

async function screen() {
  const win = new BrowserWindow({ width: W, height: H, show: false, webPreferences: { offscreen: { deviceScaleFactor: SCALE } as any } })
  await win.loadFile(join(import.meta.dirname, 'scene.html'), { query: { s: JSON.stringify(SCRIPT) } })
  const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W * SCALE}x${H * SCALE}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'h264_videotoolbox', '-b:v', '16M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(src, 'screen.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] })
  for (let i = 0; i < DURATION * FPS; i++) {
    await win.webContents.executeJavaScript(`render(${i / FPS}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    const bmp = (await win.webContents.capturePage()).toBitmap()
    if (!enc.stdin.write(bmp)) await new Promise((r) => enc.stdin.once('drain', r))
  }
  enc.stdin.end()
  await new Promise((r) => enc.on('exit', r))
  win.destroy()
}

function audio() {
  const speech = join(src, 'speech.aiff')
  execFileSync('say', ['-v', 'Samantha', '-o', speech,
    '[[slnc 700]] Hi! Um, so today I want to show you how to create a new project. [[slnc 600]] Uh, first, you click on the project name field, and you type a name. ' +
    '[[slnc 900]] Then you hit create project, and, um, that is basically it. [[slnc 1500]] You can scroll down to see all of your projects here. Thanks for watching!'])
  ff(['-i', speech, '-af', `apad=whole_dur=${DURATION}`, '-t', String(DURATION), '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', join(src, 'mic.m4a')])
  rmSync(speech)
  const blips = [SCRIPT.focus, SCRIPT.click.down].map((t) => `between(t,${t},${t + 0.08})*sin(2*PI*1200*t)*0.2`).join('+')
  ff(['-f', 'lavfi', '-i', `aevalsrc='${blips}':s=48000:d=${DURATION}:c=stereo`, '-c:a', 'aac', '-b:a', '128k', join(src, 'system.m4a')])
}

function camera() {
  ff(['-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=30:d=${DURATION}`, '-c:v', 'h264_videotoolbox', '-b:v', '4M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(src, 'camera.mp4')])
}

app.whenReady().then(async () => {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'events.jsonl'), events().map((e) => JSON.stringify(e)).join('\n') + '\n')
  audio()
  camera()
  await screen()
  const name = out.split('/').pop()!.replace(/\.grip$/, '')
  const project = createProject(name, {
    duration: DURATION,
    screen: { file: 'sources/screen.mp4', width: W * SCALE, height: H * SCALE, fps: FPS, scale: SCALE },
    camera: { file: 'sources/camera.mp4', width: 1280, height: 720, fps: 30, scale: 1 },
    mic: { file: 'sources/mic.m4a', channels: 1, sampleRate: 48000 },
    system: { file: 'sources/system.m4a', channels: 2, sampleRate: 48000 },
    events: 'sources/events.jsonl',
  })
  writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2))
  console.log(out)
  app.quit()
})
