import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Stall, cleanOptions, frameCount, gifDelay, passes, safeFileName, uniqueName, watch } from './options.ts'

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
