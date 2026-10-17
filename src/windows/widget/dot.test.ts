import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paintDot } from './dot.ts'

test('recording dot: cold is the logo gradient, still; hot churns', () => {
  const n = 12
  const paint = (t: number, heat: number) => {
    const px = new Uint8ClampedArray(n * n * 4)
    paintDot(px, n, t, heat)
    return px
  }
  const cold = paint(0, 0)
  const rgb = (px: Uint8ClampedArray, x: number, y: number) => [...px.slice(4 * (y * n + x), 4 * (y * n + x) + 3)]
  const near = (a: number[], b: number[]) => a.every((c, k) => Math.abs(c - b[k]) < 24)
  assert.ok(near(rgb(cold, 0, 0), [0x19, 0x57, 0xfa]), 'top left: the logo blue')
  assert.ok(near(rgb(cold, n - 1, n - 1), [0xfb, 0x86, 0x00]), 'bottom right: the logo orange')
  assert.deepEqual(paint(5, 0), cold, 'cold: nothing moves')
  assert.notDeepEqual(paint(0.5, 1), paint(0, 1), 'hot: the colors move')
})
