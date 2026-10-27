// Renders the landing page's Open Graph image from its hero: builds the site, opens the card (bestboy.dev/grip/og) in
// an offscreen window at 1200x630 and 1x in dark mode, and writes the screenshot to site/src/lib/og.jpg with og.hash,
// the fingerprint of what it shows, beside it. The site's tests compare that fingerprint with every build.
// Run: npx electron scripts/og.ts
import { app, BrowserWindow, nativeTheme, net, session } from 'electron'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fingerprint, HASH, IMAGE } from '../site/og.ts'

const site = join(import.meta.dirname, '../site')
const build = join(site, 'build')
execFileSync('npm', ['run', 'build'], { cwd: site, stdio: 'inherit' })
app.setPath('userData', join(tmpdir(), `grip-og-${process.pid}`))
app.commandLine.appendSwitch('force-color-profile', 'srgb') // the same colors whatever display the Mac has

// Waits until the card is whole: every font and image in, and the glow, the one part a script draws, drawn.
const settled = `(async () => {
  await document.fonts.ready
  await Promise.all([...document.images].map((image) => image.decode()))
  const glow = document.querySelector('canvas')
  for (let frame = 0; glow.width !== glow.clientWidth; frame++) {
    if (frame > 600) throw new Error('The glow never drew')
    await new Promise(requestAnimationFrame)
  }
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  return [...document.fonts].filter((font) => font.status === 'loaded').map((font) => font.family)
})()`

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  const web = session.fromPartition('og')
  // The built site as the worker serves it, a page at its path without .html.
  web.protocol.handle('http', (request) => {
    const file = join(build, decodeURIComponent(new URL(request.url).pathname))
    return net.fetch(pathToFileURL(existsSync(file) ? file : `${file}.html`).href)
  })
  const win = new BrowserWindow({ width: 1200, height: 630, show: false, webPreferences: { offscreen: { deviceScaleFactor: 1 }, session: web } })
  await win.loadURL('http://localhost/grip/og')
  const fonts: string[] = await win.webContents.executeJavaScript(settled)
  if (!fonts.includes('Inter Variable')) throw new Error(`Inter never loaded, only: ${fonts.join(', ')}`)
  // Two frames in a row the same, a moment apart: nothing on the card is still coming in.
  let shot = await win.webContents.capturePage()
  for (let tries = 1; ; tries++) {
    await new Promise((done) => setTimeout(done, 250))
    const next = await win.webContents.capturePage()
    if (next.toBitmap().equals(shot.toBitmap())) break
    if (tries === 20) throw new Error('The card never settled')
    shot = next
  }
  const { width, height } = shot.getSize()
  if (width !== 1200 || height !== 630) throw new Error(`The card rendered at ${width}x${height}, not 1200x630`)
  writeFileSync(IMAGE, shot.toJPEG(95))
  writeFileSync(HASH, `${fingerprint(build)}\n`)
  console.log(IMAGE)
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
