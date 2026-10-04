import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WALLPAPERS, DEFAULT_WALLPAPER, wallpaper, parseColor, oklab } from './index.ts'
import { defaultStyle } from '../../shared/project.ts'

test('wallpapers: 10-14 with unique ids, the default exists, unknown ids fall back', () => {
  assert.ok(WALLPAPERS.length >= 10 && WALLPAPERS.length <= 14)
  assert.equal(new Set(WALLPAPERS.map((w) => w.id)).size, WALLPAPERS.length)
  const style = defaultStyle().background
  assert.ok(style.kind === 'wallpaper' && style.id === DEFAULT_WALLPAPER && wallpaper(DEFAULT_WALLPAPER).id === 'dusk')
  assert.equal(wallpaper('from-the-future').id, DEFAULT_WALLPAPER)
  for (const w of WALLPAPERS) {
    assert.ok(w.points.length >= 2 && w.points.length <= 12, w.id)
    assert.ok(w.points.every(([, , r, c]) => r > 0 && parseColor(c)), w.id)
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
