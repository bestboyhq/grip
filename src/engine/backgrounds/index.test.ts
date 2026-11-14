import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { WALLPAPERS, DEFAULT_WALLPAPER, wallpaper, parseColor, oklab } from './index.ts'

test('wallpapers: unique ids, valid styles and palettes, the default exists, unknown ids fall back', () => {
  assert.equal(new Set(WALLPAPERS.map((w) => w.id)).size, WALLPAPERS.length)
  assert.equal(wallpaper(DEFAULT_WALLPAPER).id, DEFAULT_WALLPAPER)
  assert.equal(wallpaper('from-the-future').id, DEFAULT_WALLPAPER)
  assert.equal(wallpaper('dusk').id, DEFAULT_WALLPAPER) // a wallpaper of the removed Soft collection
  for (const w of WALLPAPERS) {
    assert.ok(existsSync(new URL(`../gpu/wallpapers/${w.style}.wgsl`, import.meta.url)), `${w.id}: no style ${w.style}`)
    assert.ok(w.name && w.collection, w.id)
    assert.ok(w.colors.length >= 4 && w.colors.length <= 20 && w.colors.every((c) => parseColor(c)), w.id)
    assert.ok(w.params.length >= 16 && w.params.length <= 112 && w.params.every(Number.isFinite), w.id) // a sky of four points, then at most four dunes
  }
})

test('parseColor handles hex and rgb forms, rejects junk', () => {
  assert.deepEqual(parseColor('#fff'), [1, 1, 1, 1])
  assert.deepEqual(parseColor('#00000080')?.map((v) => +v.toFixed(3)), [0, 0, 0, 0.502])
  assert.deepEqual(parseColor('rgb(255, 0, 51)')?.map((v) => +v.toFixed(3)), [1, 0, 0.2, 1])
  assert.deepEqual(parseColor('rgba(0 0 0 / 50%)'), [0, 0, 0, 0.5])
  assert.equal(parseColor('#12'), null)
  assert.equal(parseColor('not a color'), null) // no canvas in Node
})

test('oklab matches reference values', () => {
  const near = (a: number[], b: number[]) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-4), `${a} != ${b}`)
  near(oklab([1, 1, 1]), [1, 0, 0])
  near(oklab([0, 0, 0]), [0, 0, 0])
  near(oklab([1, 0, 0]), [0.62796, 0.22486, 0.12585])
})
