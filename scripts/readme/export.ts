// Exports the README demos through the running app: each demo's animated AVIFs into .github/readme, and the
// landing page's clips into .context/readme for site/media.sh. The page frames every clip in a card,
// so hero, loupe, and captions leave out their wallpaper, padding, corners, and shadow; the MacBook
// keeps its frame, and the formats clip is the 16:9, 1:1, and 9:16 exports side by side (formats/strip.html).
// The README follows its reader's theme, so each AVIF comes as <name>.avif and <name>-light.avif, from make.ts's
// two takes of the scene. The page shows the light take in either theme, as <name>-light.mp4; the formats strip
// renders in both, for its two AVIFs. Every clip runs at 60 fps: a GIF cannot, since it keeps whole hundredths
// of a second per frame, and GitHub drops a README's <video>.
// Run after make.ts, with the app up (STUDIO_CDP_PORT=9333 npm run dev), with an ffmpeg built with libsvtav1 (Homebrew's is):
// npx electron scripts/readme/export.ts [demo...]   (all six by default)
import { app, BrowserWindow, nativeTheme } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { Demo } from './make.ts'

const ROOT = join(import.meta.dirname, '../..')
const OUT = join(ROOT, '.context/readme')
const README = join(ROOT, '.github/readme')
const FPS = 60
const PORT = process.env.STUDIO_CDP_PORT ?? '9333'
const FRAMELESS = { padding: 0, radius: 0, shadow: 0 }
const mp4 = (size: number) => ({ format: 'mp4', size, fps: FPS, codec: 'h264', quality: 'studio', loop: 0, maxMB: 0 })
const ASPECTS = { wide: '16:9', square: '1:1', tall: '9:16' }
const SCREENS = { dark: 'sources/screen.mp4', light: 'sources/screen-light.mp4' } // make.ts's takes
// The site's exports of each demo: name, style over the demo's, options. The hero fills the page's
// width; the cards are about 620 px wide, so 720 p is sharp on a Retina screen.
const SITE: Record<string, Array<[string, object, object]>> = {
  hero: [['hero', FRAMELESS, mp4(1440)]],
  loupe: [['loupe', FRAMELESS, mp4(720)]],
  captions: [['captions', FRAMELESS, mp4(720)]],
  macbook: [['macbook', {}, mp4(720)]],
  formats: Object.entries(ASPECTS).map(([k, aspect]) => [`formats-${k}`, { aspect }, mp4(1080)]),
  ink: [],
}

/** Evaluates `expr` in one of the app's windows over CDP. */
async function evaluate(expr: string): Promise<any> {
  const pages: Array<{ url: string; webSocketDebuggerUrl: string }> = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const page = pages.find((t) => /#\/(recorder|editor)\b/.test(t.url)) // export windows have no window.studio
  if (!page) throw new Error(`No Grip window on CDP port ${PORT}: start the app with STUDIO_CDP_PORT=${PORT} npm run dev`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  const { result }: any = await new Promise((r) => ws.addEventListener('message', (e) => r(JSON.parse(String(e.data))), { once: true }))
  ws.close()
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const invoke = (channel: string, ...args: unknown[]) => evaluate(`window.studio.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`)
const run = promisify(execFile)

/** A README AVIF of a FPS clip, at most 1660 px wide, twice the README's column. Lossy WebP left blocks and streaks
 *  that built up over each loop on still wallpapers and dark sidebars. AV1 in screen content mode at crf 24 keeps
 *  every frame within 48 dB PSNR of the clip, its text as sharp, at a quarter of the WebP's bytes; crf 30 looks the
 *  same on the loupe demo for a third fewer bytes, with no margin for the others. The scale drops the clip's sRGB
 *  transfer, and a browser reads the untagged AV1 as BT.709, which lifts dark UI, so setparams tags it again. */
async function avif(src: string, dest: string) {
  const vf = "scale='min(1660,iw)':-2:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p10le," +
    'setparams=colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1:range=tv'
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-an', '-vf', vf, '-c:v', 'libsvtav1', '-crf', '24', '-preset', '4',
    '-svtav1-params', 'scm=1', '-movie_timescale', String(FPS), dest])
}

/** The formats clip in each theme: strip.html stepped through every frame of the three exports, at twice its size. */
async function strip(duration: number, fps = FPS, scale = 2) {
  const win = new BrowserWindow({ width: 1280, height: 440, show: false, webPreferences: { offscreen: { deviceScaleFactor: scale } as any } })
  for (const theme of Object.keys(SCREENS) as Array<keyof typeof SCREENS>) {
    nativeTheme.themeSource = theme
    const query = Object.fromEntries(Object.keys(ASPECTS).map((k) => [k, pathToFileURL(join(OUT, `formats-${k}-${theme}.mp4`)).href]))
    await win.loadFile(join(import.meta.dirname, 'formats/strip.html'), { query })
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => 0)')
    const enc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${1280 * scale}x${440 * scale}`, '-r', String(fps), '-i', '-',
      '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', join(OUT, `formats-${theme}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] })
    enc.on('exit', (code) => code && app.exit(code)) // a failed encoder never drains, so the capture would wait forever
    for (let i = 0; i < Math.round(duration * fps); i++) {
      await win.webContents.executeJavaScript(`seek(${(i + 0.5) / fps}).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
      // A seeked frame can paint late, so a frame counts once two captures agree.
      let bmp = (await win.webContents.capturePage()).toBitmap()
      for (let next; !(next = (await win.webContents.capturePage()).toBitmap()).equals(bmp); ) bmp = next
      if (!enc.stdin.write(bmp)) await new Promise((r) => enc.stdin.once('drain', r))
    }
    enc.stdin.end()
    await new Promise((r) => enc.on('exit', r))
  }
  win.destroy()
}

app.on('window-all-closed', () => {}) // the strip's window closing must not quit before the AVIFs are done
app.whenReady().then(async () => {
  const names = process.argv.filter((a) => a in SITE)
  const demos: Record<string, Demo> = {}
  const requests: object[] = []
  const tmp = mkdtempSync(join(tmpdir(), 'grip-readme-'))
  // The README's AVIFs: [clip, AVIF]. A demo's clip is its framed take; the formats clip is the strip.
  const avifs: Array<[string, string]> = []
  for (const name of names.length ? names : Object.keys(SITE)) {
    const demo: Demo = (demos[name] = (await import(join(import.meta.dirname, name, 'demo.ts'))).default)
    const bundle = join(OUT, `${demo.name}.grip`)
    const read = () => JSON.parse(readFileSync(join(bundle, 'project.json'), 'utf8'))
    let p = read()
    // Captions show once the voice is transcribed (the first run downloads the speech model).
    if (p.sources.mic && !p.sources.transcript) await invoke('transcript:run', bundle).then(() => (p = read()))
    const add = (style: object, options: object, path: string, file = SCREENS.dark) =>
      requests.push({ bundle, project: { ...p, sources: { ...p.sources, screen: { ...p.sources.screen, file } }, style: { ...p.style, ...style } }, options, dest: 'file', path, quiet: true })
    for (const [theme, file] of Object.entries(SCREENS)) {
      const dest = join(README, `${name}${theme === 'light' ? '-light' : ''}.avif`)
      if (name === 'formats') avifs.push([join(OUT, `formats-${theme}.mp4`), dest])
      else {
        const take = join(tmp, `${name}-${theme}.mp4`)
        add({}, mp4(1080), take, file)
        avifs.push([take, dest])
      }
    }
    const themes: Array<[string, string]> = name === 'formats' ? Object.entries(SCREENS) : [['light', SCREENS.light]]
    for (const [base, style, options] of SITE[name])
      for (const [theme, file] of themes) add(style, options, join(OUT, `${base}-${theme}.mp4`), file)
  }
  const ids: string[] = (await invoke('export:enqueue', requests)).map((j: { id: string }) => j.id)
  for (;;) {
    const jobs: Array<{ id: string; state: string; path: string; error?: string }> = (await invoke('export:list')).filter((j: { id: string }) => ids.includes(j.id))
    const failed = jobs.find((j) => j.state === 'failed' || j.state === 'canceled')
    if (failed) throw new Error(`${failed.path}: ${failed.error ?? failed.state}`)
    if (jobs.every((j) => j.state === 'done')) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (demos.formats) await strip(demos.formats.duration)
  for (const [src, dest] of avifs) await avif(src, dest) // one at a time: each encoder already takes every core
  rmSync(tmp, { recursive: true })
  app.quit()
}).catch((e) => {
  console.error(e)
  app.exit(1)
})
