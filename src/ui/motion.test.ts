import assert from 'node:assert/strict'
import { test } from 'node:test'
import { easeGlide, easeOut } from './motion.ts'

// Each curve at its midpoint s = 0.5, worked out by hand from the CSS cubic-bezier() it copies: x and y there are
// 3 * 0.125 * (p1 + p2) + 0.125 for the control points' x and y.
test('script curves match the CSS curves they copy', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-5, `${a} is not ${b}`)
  near(easeOut(0.3425), 0.875) // cubic-bezier(0.22, 1, 0.36, 1)
  near(easeGlide(0.245), 0.77) // cubic-bezier(0.32, 0.72, 0, 1)
  for (const ease of [easeOut, easeGlide]) {
    assert.equal(ease(0), 0)
    assert.equal(ease(1), 1)
  }
})
