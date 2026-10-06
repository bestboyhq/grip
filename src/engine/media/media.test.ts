// Decoding needs WebCodecs, so these checks run in Electron: this file generates test media with
// ffmpeg, starts Vite, and launches itself as Electron's main script, which opens the
// PlayerChecks lab (src/windows/dev/labs/PlayerChecks.svelte) hidden and reports its results.
// Covers: frameAt on VFR H.264 with B-frames, HEVC, and the fixture; stepping backward; decoding
// ahead across a cut; a bounded read cache; AAC priming alignment; seamless music loops; an imported
// .mp4 as its own audio; renderAudio length, 2x, chunk joins; peaks cache; editing a 2-hour project
// without stalling the editor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../../..')

if (process.versions.electron) {
  // ---- Electron main: open the lab, wait for window.__checks, print it ----
  const { app } = await import('electron')
  const { registerMediaProtocol } = await import('../../../electron/media.ts')
  const { openWindow } = await import('../../../electron/windows.ts')
  // The memory check measures the renderer heap: exact numbers, after a forced collection.
  app.commandLine.appendSwitch('js-flags', '--expose-gc')
  app.commandLine.appendSwitch('enable-precise-memory-info')
  // Not awaited: Electron emits 'ready' only after the main module finishes evaluating.
  app.whenReady().then(async () => {
    registerMediaProtocol()
    const win = openWindow(process.env.STUDIO_CHECK_ROUTE!)
    const deadline = Date.now() + 120_000
    let result: unknown = null
    while (Date.now() < deadline && !result) {
      await new Promise((r) => setTimeout(r, 250))
      result = await win.webContents.executeJavaScript('window.__checks ?? null').catch(() => null)
    }
    process.stdout.write(`CHECKS ${JSON.stringify(result)}\n`)
    app.exit(result ? 0 : 1)
  })
} else {
  const { createServer } = await import('vite')

  const ff = (dir: string, args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: dir })

  function makeMedia(dir: string) {
    // 24 frames at t_i = 0.04 i + 0.002 i^2 (variable frame rate), gray level 16 + 8 i, B-frames on.
    ff(dir, ['-f', 'lavfi', '-i', "nullsrc=s=128x128:r=25:d=0.96,format=yuv420p,geq=lum='16+8*N':cb=128:cr=128,settb=1/1000,setpts='(0.04*N+0.002*N*N)/TB'",
      '-fps_mode', 'passthrough', '-enc_time_base:v', '1/1000', '-c:v', 'libx264', '-bf', '3', '-g', '8', '-crf', '1', '-pix_fmt', 'yuv420p', '-video_track_timescale', '1000', 'vfr.mp4'])
    // HEVC, 30 fps, gray level 16 + 3 i.
    ff(dir, ['-f', 'lavfi', '-i', "nullsrc=s=128x128:r=30:d=2,format=yuv420p,geq=lum='16+3*N':cb=128:cr=128",
      '-c:v', 'libx265', '-tag:v', 'hvc1', '-crf', '4', '-x265-params', 'bframes=3:keyint=15:log-level=error', '-pix_fmt', 'yuv420p', 'hevc.mp4'])
    // A portrait phone clip: 128x64 frames, left half white, plus a 90 degree display rotation.
    ff(dir, ['-f', 'lavfi', '-i', "nullsrc=s=128x64:r=30:d=1,format=yuv420p,geq=lum='if(lt(X,64),235,16)':cb=128:cr=128", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'flat.mp4'])
    ff(dir, ['-display_rotation', '90', '-i', 'flat.mp4', '-c', 'copy', 'rotated.mov'])
    // 6 s at 30 fps with a keyframe every second, like a recording.
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=128x128:r=30:d=6', '-c:v', 'libx265', '-tag:v', 'hvc1', '-x265-params', 'keyint=30:log-level=error', '-pix_fmt', 'yuv420p', 'gop.mp4'])
    // 6 s of noise, 56 MB: a file bigger than a read cache should keep.
    ff(dir, ['-f', 'lavfi', '-i', "nullsrc=s=640x360:r=30:d=6,format=yuv420p,geq=lum='random(1)*255':cb=128:cr=128", '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '6', '-g', '30', '-pix_fmt', 'yuv420p', 'big.mp4'])
    // AAC with 2 ms clicks at exactly 1.0 s and 2.5 s.
    const clicks = "aevalsrc='0.8*(between(t,1,1.002)+between(t,2.5,2.502))':s=48000:d=4"
    ff(dir, ['-f', 'lavfi', '-i', clicks, '-c:a', 'aac', '-b:a', '192k', 'click.m4a'])
    // 2 s of a 44.1 kHz sine, for music loops.
    ff(dir, ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-af', 'volume=4', '-c:a', 'aac', '-b:a', '192k', 'tone44.m4a'])
    // An "imported" video with its own audio track.
    ff(dir, ['-f', 'lavfi', '-i', 'testsrc2=s=128x128:r=30:d=3', '-f', 'lavfi', '-i', clicks.replace('d=4', 'd=3'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', 'av.mp4'])
  }

  test('decoding and mixing in Electron (WebCodecs)', { timeout: 240_000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'studio media '))
    // No HMR: an edit in the worktree mid-run would remount the lab, starting a second run of every
    // check in the same page, whose mixing sessions evict and re-prime the first run's.
    const server = await createServer({ configFile: join(root, 'vite.config.ts'), root: join(root, 'src'), logLevel: 'error', server: { port: 0, hmr: false } })
    try {
      makeMedia(dir)
      await server.listen()
      const fixture = join(root, '.context/fixtures/Demo #1 ✨ café.grip')
      if (!existsSync(fixture)) t.diagnostic(`no fixture at ${fixture}: run npx electron scripts/fixture/make.ts to include its checks`)
      const route = `dev?lab=PlayerChecks&dir=${encodeURIComponent(dir)}${existsSync(fixture) ? `&fixture=${encodeURIComponent(fixture)}` : ''}${process.env.CI ? '&slow=1' : ''}`
      const electron = (await import('electron')).default as unknown as string
      const { stdout } = await promisify(execFile)(electron, [import.meta.filename], {
        env: { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls!.local[0], STUDIO_HIDDEN: '1', STUDIO_CHECK_ROUTE: route },
        timeout: 200_000,
      })
      const line = stdout.split('\n').find((l) => l.startsWith('CHECKS '))
      const checks: Array<{ name: string; ok: boolean; detail: string }> | null = line ? JSON.parse(line.slice(7)) : null
      if (!checks) throw new Error('the lab reported no results')
      assert.ok(checks.length >= 5, `only ${checks.length} checks ran`)
      for (const c of checks) {
        await t.test(c.name, () => {
          t.diagnostic(`${c.name}: ${c.detail}`)
          assert.ok(c.ok, c.detail)
        })
      }
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
