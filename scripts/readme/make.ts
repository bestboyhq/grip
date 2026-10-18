// Renders a README demo into a Grip project that looks like a fresh recording: the scene's render(t)
// captured frame by frame into screen.mp4 (no cursor, Grip draws it), the scripted pointer, keys, and
// ink into events.jsonl, an optional voice into mic.m4a, and the demo's starting edits.
// Run: npx electron scripts/readme/make.ts <demo> [out.grip]   (a demo is a folder next to this file:
// scene.html with a global render(t), and demo.ts default-exporting a Demo)
import { app, BrowserWindow } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createProject, type Project } from '../../src/shared/project.ts'
import type { InputEvent } from '../../src/shared/events.ts'
import { SCALE } from './input.ts'

export interface Demo {
  name: string // project name
  width: number // CSS px of the scene; the video is SCALE times that
  height: number
  duration: number // s
  fps?: number // default 30
  script?: unknown // handed to the scene as ?s=<json>
  events(): InputEvent[] // video px
  voice?: string // `say` text; [[slnc 500]] is a 500 ms pause
  edit?(p: Project): void // starting edits: background, cursor, zooms, captions
}

const dir = process.argv.find((a) => !a.startsWith('-') && !a.endsWith('.ts') && !a.endsWith('.grip') && !a.includes('/'))
if (!dir) throw new Error('Usage: npx electron scripts/readme/make.ts <demo> [out.grip]')
const demo: Demo = (await import(join(import.meta.dirname, dir, 'demo.ts'))).default
const out = resolve(process.argv.find((a) => a.endsWith('.grip')) ?? join(import.meta.dirname, '../../.context/readme', `${demo.name}.grip`))
const src = join(out, 'sources')
const fps = demo.fps ?? 30
app.setPath('userData', join(tmpdir(), `grip-readme-${process.pid}`)) // renders run side by side
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })

async function screen() {
  const { width: w, height: h } = demo
  const win = new BrowserWindow({ width: w, height: h, show: false, webPreferences: { offscreen: { deviceScaleFactor: SCALE } as any } })
  await win.loadFile(join(import.meta.dirname, dir!, 'scene.html'), { query: { s: JSON.stringify(demo.script ?? null) } })
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 0)')
  const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${w * SCALE}x${h * SCALE}`, '-r', String(fps), '-i', '-',
    '-c:v', 'h264_videotoolbox', '-b:v', '24M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(src, 'screen.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] })
  for (let i = 0; i < Math.round(demo.duration * fps); i++) {
    await win.webContents.executeJavaScript(`render(${i / fps}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    const bmp = (await win.webContents.capturePage()).toBitmap()
    if (!enc.stdin.write(bmp)) await new Promise((r) => enc.stdin.once('drain', r))
  }
  enc.stdin.end()
  await new Promise((r) => enc.on('exit', r))
  win.destroy()
}

function voice(text: string) {
  const speech = join(src, 'speech.aiff')
  execFileSync('say', ['-v', 'Samantha', '-o', speech, text])
  ff(['-i', speech, '-af', `apad=whole_dur=${demo.duration}`, '-t', String(demo.duration), '-ac', '1', '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', join(src, 'mic.m4a')])
  rmSync(speech)
}

app.whenReady().then(async () => {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'events.jsonl'), demo.events().sort((a, b) => a.t - b.t).map((e) => JSON.stringify(e)).join('\n') + '\n')
  if (demo.voice) voice(demo.voice)
  await screen()
  const project = createProject(demo.name, {
    duration: demo.duration,
    screen: { file: 'sources/screen.mp4', width: demo.width * SCALE, height: demo.height * SCALE, fps, scale: SCALE },
    ...(demo.voice ? { mic: { file: 'sources/mic.m4a', channels: 1, sampleRate: 48000 } } : {}),
    events: 'sources/events.jsonl',
  })
  project.style.cursor.set = 'builtin' // the events name standard cursors, with no images beside them
  demo.edit?.(project)
  writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2))
  console.log(out)
  app.quit()
})
