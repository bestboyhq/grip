import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrowHead, LINE, tiny } from './annotate.ts'

test('the arrow shaft ends inside its head, and short arrows get a smaller head', () => {
  const a = { x: 0, y: 0 }
  const long = arrowHead(a, { x: 200, y: 0 })
  assert.equal(long.tip.x, 200)
  assert.ok(long.shaft.x > long.left.x && long.shaft.x < 200, 'shaft stops between the head base and the tip')
  assert.equal(long.left.x, long.right.x)
  assert.equal(long.left.y, -long.right.y)
  assert.ok(200 - long.left.x <= LINE * 4.2 + 1e-9)
  const short = arrowHead(a, { x: 0, y: 10 })
  assert.ok(10 - short.left.y <= 5.5 + 1e-9, 'head at most 55% of a short arrow')
  assert.equal(short.left.y, short.right.y)
})

test('slips of the mouse are not marks', () => {
  assert.ok(tiny({ kind: 'arrow', color: '#fff', a: { x: 0, y: 0 }, b: { x: 2, y: 2 } }))
  assert.ok(!tiny({ kind: 'rect', color: '#fff', a: { x: 0, y: 0 }, b: { x: 20, y: 2 } }))
  assert.ok(tiny({ kind: 'text', color: '#fff', at: { x: 0, y: 0 }, text: '  ' }))
  assert.ok(!tiny({ kind: 'pen', color: '#fff', points: [{ x: 1, y: 1 }] }))
})
