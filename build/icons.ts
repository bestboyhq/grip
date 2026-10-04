// Renders the app icon and the menu bar icons from SVG, with Electron only (no image tools):
//   npx electron build/icons.ts
// Outputs: build/icon.png (1024 px; electron-builder makes the .icns from it) and
// electron/shell/assets/tray{,Recording}Template{,@2x}.png (macOS template images, black + alpha).
import { app, BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname
const assets = join(here, '../electron/shell/assets')

// Menu bar icon, 18 pt: a screen with a record dot. While recording the screen fills in and the
// dot is cut out of it, so the state reads at a glance in a monochrome menu bar.
const tray = (recording: boolean) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">
  <defs><mask id="m"><rect width="18" height="18" fill="#fff"/><circle cx="9" cy="8.25" r="2.6" fill="#000"/></mask></defs>
  ${
    recording
      ? '<rect x="1.5" y="2.5" width="15" height="11.5" rx="2.6" fill="#000" mask="url(#m)"/>'
      : '<rect x="2.2" y="3.2" width="13.6" height="10.1" rx="2" fill="none" stroke="#000" stroke-width="1.4"/><circle cx="9" cy="8.25" r="2.3" fill="#000"/>'
  }
  <path d="M6.5 16.2h5" stroke="#000" stroke-width="1.4" stroke-linecap="round"/>
</svg>`

const jobs: Array<[svg: string, px: number, out: string]> = [
  [readFileSync(join(here, 'icon.svg'), 'utf8'), 1024, join(here, 'icon.png')],
  [tray(false), 18, join(assets, 'trayTemplate.png')],
  [tray(false), 36, join(assets, 'trayTemplate@2x.png')],
  [tray(true), 18, join(assets, 'trayRecordingTemplate.png')],
  [tray(true), 36, join(assets, 'trayRecordingTemplate@2x.png')],
]

app.whenReady().then(async () => {
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
