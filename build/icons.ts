// Renders the app icon and the menu bar icons:
//   npx electron build/icons.ts
// Outputs: build/icon.png (1024 px, the dev dock icon and the onboarding logo) and
// electron/shell/assets/tray{,Recording}Template{,@2x}.png (macOS template images, black + alpha) and
// trayUpdate{Dark,Light}{,@2x}.png (in color, per menu bar appearance).
// The packaged app's icon is build/Grip.icon itself; electron-builder compiles it.
import { app, BrowserWindow, nativeImage } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const here = import.meta.dirname
const assets = join(here, '../electron/shell/assets')

// Menu bar icon, 18 pt: the app mark, two crop corners around a record dot. While recording it
// inverts to a filled tile with the mark cut out, so the state reads at a glance in a monochrome menu bar.
// An update waiting for a restart adds a blue badge in the empty top left corner. Color rules out a
// template image, so that one comes twice, its glyph in the white or the black of the menu bar's own icons.
// Two crop corners (top right, bottom left) on the square lo..hi: arm length a, corner radius r.
const mark = (lo: number, hi: number, a: number, r: number) =>
  `M${hi - a} ${lo}H${hi - r}A${r} ${r} 0 0 1 ${hi} ${lo + r}V${lo + a}M${lo + a} ${hi}H${lo + r}A${r} ${r} 0 0 1 ${lo} ${hi - r}V${hi - a}`
const glyph = (color: string) =>
  `<path d="${mark(1.8, 16.2, 5.8, 2.9)}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/><circle cx="9" cy="9" r="2.6" fill="${color}"/>`
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">${body}</svg>`
const idle = svg(glyph('#000'))
const recording = svg(
  `<defs><mask id="m"><rect width="18" height="18" fill="#fff"/><path d="${mark(3.6, 14.4, 4.4, 2.2)}" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/><circle cx="9" cy="9" r="2.2" fill="#000"/></mask></defs><rect x="0.5" y="0.5" width="17" height="17" rx="4.2" fill="#000" mask="url(#m)"/>`,
)
// macOS draws template icons in labelColor and badges in systemBlue, each per appearance.
const update = (dark: boolean) => svg(`${glyph(dark ? '#fff' : 'rgb(0 0 0 / 0.85)')}<circle cx="3.6" cy="3.6" r="2.6" fill="${dark ? '#0a84ff' : '#007aff'}"/>`)

const jobs: Array<[svg: string, px: number, out: string]> = [
  [idle, 18, join(assets, 'trayTemplate.png')],
  [idle, 36, join(assets, 'trayTemplate@2x.png')],
  [recording, 18, join(assets, 'trayRecordingTemplate.png')],
  [recording, 36, join(assets, 'trayRecordingTemplate@2x.png')],
  [update(true), 18, join(assets, 'trayUpdateDark.png')],
  [update(true), 36, join(assets, 'trayUpdateDark@2x.png')],
  [update(false), 18, join(assets, 'trayUpdateLight.png')],
  [update(false), 36, join(assets, 'trayUpdateLight@2x.png')],
]

// build/icon.png as macOS draws Grip.icon (Liquid Glass, Display P3): compile it with actool into a
// stub app and take the app's Quick Look thumbnail. The stub needs a signed executable, or macOS
// badges the icon as unopenable; a fresh name per run dodges the icon cache.
async function appIcon() {
  const dir = mkdtempSync(join(tmpdir(), 'grip-icon-'))
  const contents = join(dir, `Grip${Date.now()}.app/Contents`)
  mkdirSync(join(contents, 'Resources'), { recursive: true })
  mkdirSync(join(contents, 'MacOS'))
  execFileSync('xcrun', ['actool', join(here, 'Grip.icon'), '--compile', join(contents, 'Resources'), '--output-partial-info-plist', join(dir, 'partial.plist'), '--app-icon', 'Grip', '--enable-on-demand-resources', 'NO', '--development-region', 'en', '--target-device', 'mac', '--minimum-deployment-target', '26.0', '--platform', 'macosx'])
  copyFileSync('/usr/bin/true', join(contents, 'MacOS/stub'))
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.bestboyhq.grip.icon${Date.now()}</string><key>CFBundleExecutable</key><string>stub</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconName</key><string>Grip</string></dict></plist>`)
  execFileSync('codesign', ['-fs', '-', join(contents, '..')])
  const img = await nativeImage.createThumbnailFromPath(join(contents, '..'), { width: 1024, height: 1024 })
  writeFileSync(join(here, 'icon.png'), img.toPNG())
  rmSync(dir, { recursive: true })
  console.log(join(here, 'icon.png'))
}

app.whenReady().then(async () => {
  await appIcon()
  mkdirSync(assets, { recursive: true })
  // Render big and downsample: crisp edges at every size, whatever the display's scale.
  const size = 512
  const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, enableLargerThanScreen: true, useContentSize: true })
  for (const [svg, px, out] of jobs) {
    const html = `<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 200))
    const img = await win.webContents.capturePage()
    writeFileSync(out, img.resize({ width: px, height: px, quality: 'best' }).toPNG())
    console.log(out)
  }
  app.quit()
})
