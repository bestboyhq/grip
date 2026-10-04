import { test } from 'node:test'
import assert from 'node:assert/strict'
import { springProgress, springDuration } from './spring.ts'

test('spring settles at 1 and starts at 0, for any damping', () => {
  for (const damping of [5, 26, 40, 100]) {
    const c = { stiffness: 170, damping, mass: 1 }
    assert.equal(springProgress(0, c), 0)
    assert.ok(Math.abs(springProgress(springDuration(c) + 0.5, c) - 1) < 2e-3, `damping ${damping}`)
  }
  assert.ok(Number.isFinite(springProgress(0.1, { stiffness: 170, damping: 26, mass: 0 })))
})
