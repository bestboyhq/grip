import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUDIO_BITRATE, Stall, cleanOptions, estimateBytes, frameCount, gifDelay, gifRefit, jobOptions, mp4Plan, passes, safeFileName, uniqueName, videoBitrate, watch } from './options.ts'

test('frame counts and GIF delays add up to the timeline', () => {
  assert.equal(frameCount(24, 30), 720)
  assert.equal(frameCount(19.5333333, 60), 1172)
  assert.equal(frameCount(0.001, 30), 1)
  for (const fps of [10, 15, 24, 30]) {
    const n = frameCount(7.3, fps)
    let cs = 0
    for (let i = 0; i < n; i++) cs += gifDelay(i, fps)
    assert.equal(cs, Math.round((n * 100) / fps), `fps ${fps}`)
    for (let i = 0; i < n; i++) assert.ok(gifDelay(i, fps) >= 2, 'browsers slow down delays under 2 cs')
  }
})

test('a GIF size limit lands close under the target, in few passes', () => {
  // The fixture's 720p30 GIF as measured: MB after each tenth of its frames (bursty: a page change at
  // 50-60%), and its full size at other scales of 720p (bytes grow about as pixels^0.7-0.8).
  const curve = [0, 0.58, 1.03, 2.68, 3.09, 4.01, 7.76, 8.89, 9.57, 9.95, 10.31]
  const shape = (f: number) => {
    const i = Math.min(9, Math.floor(f * 10))
    return (curve[i] + (curve[i + 1] - curve[i]) * (f * 10 - i)) / curve[10]
  }
  const sizes = [[0.5, 3.64], [2 / 3, 5.44], [1, 10.31], [1.5, 19.97]]
  const total = (k: number) => {
    const i = Math.max(0, Math.min(sizes.length - 2, sizes.findIndex(([s]) => s > k) - 1))
    const [[k0, b0], [k1, b1]] = [sizes[i], sizes[i + 1]]
    return b0 * Math.exp((Math.log(b1 / b0) / Math.log(k1 / k0)) * Math.log(k / k0))
  }
  for (const limit of [3, 5, 8]) {
    // The probe (240p, a third of 720p) sets the first pass; a pass over the limit refits from its projection.
    let k = Math.min(1, (1 / 3) * gifRefit(limit, total(1 / 3)))
    let passes = 0
    for (let over = true; over; ) {
      passes++
      over = false
      for (let i = 1; i <= 720; i++) {
        const size = total(k) * shape(i / 720)
        if (size > limit) {
          k *= gifRefit(limit, size / shape(i / 720))
          over = true
          break
        }
      }
    }
    assert.ok(total(k) > 0.85 * limit, `limit ${limit} MB: ${total(k).toFixed(2)} MB`)
    assert.ok(passes <= 2, `limit ${limit} MB: ${passes} passes after the probe`)
  }
})

test('hostile project names make safe, faithful file names', () => {
  assert.equal(safeFileName('Demo #1 ✨ café'), 'Demo #1 ✨ café')
  assert.equal(safeFileName('a/b:c'), 'a-b-c')
  assert.equal(safeFileName('..hidden'), 'hidden')
  assert.equal(safeFileName(' \u0000 '), '-')
  assert.equal(safeFileName('   '), 'Untitled')
  assert.ok(new TextEncoder().encode(safeFileName('✨'.repeat(200))).length <= 220)
  const taken = new Set(['x.mp4', 'x 2.mp4'])
  assert.equal(uniqueName('x', 'mp4', (n) => taken.has(n)), 'x 3.mp4')
  assert.equal(uniqueName('x', 'gif', (n) => taken.has(n)), 'x.gif')
})

test('options from storage or IPC snap to valid values', () => {
  assert.deepEqual(cleanOptions({ format: 'gif', size: 2160, fps: 60, maxMB: 10 }), { ...cleanOptions({ format: 'gif' }), maxMB: 10 })
  assert.equal(cleanOptions({ format: 'gif' }).size, 720)
  assert.equal(cleanOptions({ codec: 'prores' as never }).codec, 'h264')
  assert.equal(cleanOptions(null).format, 'mp4')
  assert.equal(cleanOptions({ format: 'mp4', maxMB: 20 }).maxMB, 20)
})

test('an MP4 size limit gives up as little as it must, and never plans past the limit', () => {
  const base = { width: 1920, height: 1080 }
  const o = { fps: 60, quality: 'social', codec: 'h264' } as const
  const limit = 20e6
  const normal = { ...base, fps: 60, bitrate: videoBitrate(1920, 1080, o), audio: AUDIO_BITRATE }
  assert.deepEqual(mp4Plan(3600, 0, base, o), normal, 'no limit')
  assert.deepEqual(mp4Plan(10, limit, base, o), normal, 'fits: the selected quality, untouched')
  const capped = mp4Plan(60, limit, base, o)!
  assert.deepEqual({ ...capped, bitrate: 0 }, { ...normal, bitrate: 0 })
  assert.ok(capped.bitrate < normal.bitrate, 'tight: same picture, lower bitrate')
  const slower = mp4Plan(120, limit, base, o)!
  assert.ok(slower.height === 1080 && slower.fps === 30, 'tighter: 30 fps before a smaller picture')
  const small = mp4Plan(300, limit, base, o)!
  assert.ok(small.height < 1080 && small.height >= 360 && small.fps === 30 && small.audio === 96_000, `very tight: smaller picture, ${small.width}x${small.height}`)
  assert.ok(small.width % 2 === 0 && small.height % 2 === 0 && Math.abs(small.width / small.height - 16 / 9) < 0.01, 'even sides, same aspect')
  assert.equal(mp4Plan(3600, limit, base, o), null, 'an hour cannot fit in 20 MB')
  for (const d of [1, 10, 30, 60, 120, 300, 600]) {
    const p = mp4Plan(d, limit, base, o)!
    assert.ok(((p.bitrate + p.audio) * d) / 8 < 0.9 * limit, `${d} s`)
  }
  assert.equal(estimateBytes(600, 1920, 1080, { ...cleanOptions(null), maxMB: 20 }), limit)
})

test('share links are always H.264 MP4, whatever the dialog shows', () => {
  const gif = { format: 'gif', size: 480, fps: 10, maxMB: 5 } as const
  for (const dest of ['share', 'temp'] as const) {
    assert.deepEqual(jobOptions(dest, gif), { ...cleanOptions({ ...gif, format: 'mp4' }), codec: 'h264', maxMB: 0 })
    assert.equal(jobOptions(dest, { codec: 'hevc', size: 2160 }).codec, 'h264')
    assert.equal(jobOptions(dest, { codec: 'hevc', size: 2160 }).size, 2160)
  }
  assert.equal(jobOptions('file', gif).format, 'gif')
  assert.equal(jobOptions('clipboard', { codec: 'hevc' }).codec, 'hevc')
})

test('a stalled step rejects with Stall; retried passes never move the bar backwards', async () => {
  assert.equal(await watch(Promise.resolve(7), 'video encoder', 50), 7)
  await assert.rejects(watch(new Promise(() => {}), 'video encoder', 20), (e) => e instanceof Stall && e.what === 'video encoder')
  const shown: number[] = []
  const next = passes({ write: async () => {}, progress: (p) => shown.push(p) })
  next().progress(0.3, 'Rendering')
  const retry = next() // e.g. the hardware encoder stalled at 30%
  for (const p of [0, 0.5, 0.99]) retry.progress(p, 'Rendering')
  assert.deepEqual(shown.map((p) => +p.toFixed(2)), [0.3, 0.3, 0.65, 0.99])
})
