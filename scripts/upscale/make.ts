// Training pages for the UI-text upscaler (train.py): random screens of UI (page.html) rendered at 1x, 2x, and 4x,
// so each density has the next one up as its ground truth. Text is the system dictionary and this repo's own code.
// Run: npx electron scripts/run.ts scripts/upscale/make.ts <out dir> [pages, default 160]
// Writes <out>/<seed>-<density>x.png.
import { app, BrowserWindow, nativeImage } from 'electron'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [outArg, countArg] = process.argv.slice(2)
if (!outArg) throw new Error('Usage: scripts/upscale/make.ts <out dir> [pages]')
const out = resolve(outArg)
const count = Number(countArg ?? 160)
const W = 800, H = 600, DENSITIES = [1, 2, 4]

const root = join(import.meta.dirname, '../..')
const words = readFileSync('/usr/share/dict/words', 'utf8').split('\n').filter((w) => /^[a-z]{2,12}$/.test(w))
const files = execFileSync('git', ['ls-files', 'src', 'electron', 'native/src', 'scripts'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /\.(ts|svelte|rs|wgsl)$/.test(f))

app.commandLine.appendSwitch('force-color-profile', 'srgb') // the same colors whatever display the Mac has
app.setPath('userData', join(out, '.electron'))

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true })
  const wins = DENSITIES.map((deviceScaleFactor) => new BrowserWindow({ width: W, height: H, show: false, webPreferences: { offscreen: { deviceScaleFactor } as any } }))
  for (let seed = 1; seed <= count; seed++) {
    const lines = readFileSync(join(root, files[(seed * 7919) % files.length]), 'utf8').split('\n').map((l) => l.replace(/\t/g, '  ').slice(0, 140))
    const payload = { seed, width: W, height: H, code: lines, words: Array.from({ length: 4000 }, (_, i) => words[(seed * 104729 + i * 7307) % words.length]) }
    await Promise.all(wins.map(async (win, i) => {
      await win.loadFile(join(import.meta.dirname, 'page.html'))
      await win.webContents.executeJavaScript(`build(${JSON.stringify(payload)}); document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`)
      // Settled: two captures alike, and not the blank one a window shows before its first paint.
      const blank = (b: Buffer) => b.every((v, k) => v === b[k % 4])
      let bmp: Buffer = Buffer.alloc(0)
      for (let tries = 0, next; ; tries++) {
        if (tries > 100) throw new Error(`Page ${seed} at ${DENSITIES[i]}x never painted`)
        next = (await win.webContents.capturePage()).toBitmap()
        if (next.equals(bmp) && !blank(next)) break
        bmp = next
        await new Promise((r) => setTimeout(r, 50))
      }
      if (bmp.length !== W * H * DENSITIES[i] ** 2 * 4) throw new Error(`Page ${seed} at ${DENSITIES[i]}x came out ${bmp.length / 4} px`)
      writeFileSync(join(out, `${seed}-${DENSITIES[i]}x.png`), nativeImage.createFromBitmap(bmp, { width: W * DENSITIES[i], height: H * DENSITIES[i] }).toPNG())
    }))
    if (seed % 20 === 0) console.log(`${seed}/${count} pages`)
  }
  app.exit(0)
})
