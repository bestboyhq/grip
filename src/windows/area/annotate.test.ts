import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrowOutline, LINE, moved, shapeAt, tiny, type Shape } from './annotate.ts'

test('an arrow is one outline: a tapered shaft and a swept-back head, smaller on short arrows', () => {
  const [tip, left, neckL, tailL, tailR, neckR, right] = arrowOutline({ x: 0, y: 0 }, { x: 200, y: 0 })
  assert.deepEqual(tip, { x: 200, y: 0 })
  assert.ok(left.x < neckL.x && neckL.x < tip.x, 'the barbs sweep back past the neck')
  assert.ok(Math.abs(tailL.y) < Math.abs(neckL.y) && Math.abs(neckL.y) < Math.abs(left.y), 'tail < shaft < head')
  assert.equal(tailL.x, 0)
  for (const [l, r] of [[left, right], [neckL, neckR], [tailL, tailR]]) assert.deepEqual([l.x, l.y], [r.x, -r.y])
  assert.ok(200 - left.x <= LINE * 5 + 1e-9)
  const short = arrowOutline({ x: 0, y: 0 }, { x: 0, y: 10 })
  assert.ok(10 - short[1].y <= 6 + 1e-9, 'head at most 60% of a short arrow')
})

test('slips of the mouse are not marks', () => {
  assert.ok(tiny({ kind: 'arrow', color: '#fff', a: { x: 0, y: 0 }, b: { x: 2, y: 2 } }))
  assert.ok(!tiny({ kind: 'rect', color: '#fff', a: { x: 0, y: 0 }, b: { x: 20, y: 2 } }))
  assert.ok(tiny({ kind: 'text', color: '#fff', at: { x: 0, y: 0 }, text: '  ' }))
  assert.ok(!tiny({ kind: 'pen', color: '#fff', points: [{ x: 1, y: 1 }] }))
})

test('a drawn shape is picked up where it shows, topmost first, and moves whole', () => {
  const shapes: Shape[] = [
    { kind: 'rect', color: '#fff', a: { x: 100, y: 100 }, b: { x: 300, y: 200 } },
    { kind: 'arrow', color: '#fff', a: { x: 0, y: 0 }, b: { x: 100, y: 100 } },
    { kind: 'text', color: '#fff', at: { x: 400, y: 10 }, text: 'Hi\nthere' },
    { kind: 'blur', color: '#fff', a: { x: 500, y: 300 }, b: { x: 450, y: 250 } },
    { kind: 'pen', color: '#fff', points: [{ x: 0, y: 300 }, { x: 50, y: 300 }] },
  ]
  const at = (x: number, y: number) => shapeAt(shapes, { x, y }, (line) => line.length * 10)
  assert.equal(at(100, 100), 1, 'where the arrow ends on the rectangle, the arrow (drawn later) wins')
  assert.equal(at(200, 102), 0, 'the rectangle by its edge')
  assert.equal(at(200, 150), -1, 'not inside: a mark can go there')
  assert.equal(at(452, 48), 2, 'the second, longer line of text')
  assert.equal(at(452, 70), -1)
  assert.equal(at(475, 275), 3, 'anywhere on a pixelated box')
  assert.equal(at(25, 303), 4)
  assert.equal(at(25, 320), -1)
  assert.deepEqual(moved(shapes[4], 10, -5), { kind: 'pen', color: '#fff', points: [{ x: 10, y: 295 }, { x: 60, y: 295 }] })
  assert.deepEqual(moved(shapes[2], 1, 2), { kind: 'text', color: '#fff', at: { x: 401, y: 12 }, text: 'Hi\nthere' })
  assert.deepEqual(moved(shapes[0], 1, 1), { kind: 'rect', color: '#fff', a: { x: 101, y: 101 }, b: { x: 301, y: 201 } })
})
