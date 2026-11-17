import { test } from 'node:test'
import assert from 'node:assert/strict'
import { easeOut, springProgress, springDuration } from './spring.ts'

test('spring settles at 1 and starts at 0, for any damping', () => {
  for (const damping of [5, 26, 40, 100]) {
    const c = { stiffness: 170, damping, mass: 1 }
    assert.equal(springProgress(0, c), 0)
    assert.ok(Math.abs(springProgress(springDuration(c) + 0.5, c) - 1) < 2e-3, `damping ${damping}`)
  }
  assert.ok(Number.isFinite(springProgress(0.1, { stiffness: 170, damping: 26, mass: 0 })))
})

test('easeOut is CSS ease-out, cubic-bezier(0, 0, 0.58, 1)', () => {
  // Points of the curve from its control points: (x, y) at s along it.
  for (const s of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const x = 3 * (1 - s) * s * s * 0.58 + s ** 3
    const y = 3 * (1 - s) * s * s + s ** 3
    assert.ok(Math.abs(easeOut(x) - y) < 1e-6, `at ${x}`)
  }
  assert.deepEqual([easeOut(-1), easeOut(0), easeOut(1), easeOut(2), easeOut(NaN)], [0, 0, 1, 1, 0])
  assert.ok(Math.abs(easeOut(0.5) - 0.6847) < 1e-4)
})
