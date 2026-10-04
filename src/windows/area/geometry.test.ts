import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constrain, formAt, presetFrame, presetSize, resize } from './geometry.ts'

const W = 1512
const H = 982

test('drawing and resizing an area', () => {
  const start = { x: 100, y: 100, width: 0, height: 0 }
  // Draw down-right, and up-left past the start (flips).
  assert.deepEqual(resize(start, 'new', 500, 400, null, W, H), { x: 100, y: 100, width: 400, height: 300 })
  assert.deepEqual(resize(start, 'new', 40, 20, null, W, H), { x: 40, y: 20, width: 60, height: 80 })
  // Locked 16:9 follows the larger drag.
  assert.deepEqual(resize(start, 'new', 260, 400, 16 / 9, W, H), { x: 100, y: 100, width: 300 * (16 / 9), height: 300 })
  // Locked aspect never leaves the display: shrinks to the room left.
  const r = resize({ x: 1400, y: 900, width: 0, height: 0 }, 'new', 2000, 2000, 1, W, H)
  assert.deepEqual(r, { x: 1400, y: 900, width: 82, height: 82 })
  const box = { x: 200, y: 200, width: 400, height: 300 }
  // East edge moves only the right side; west handle past the east edge flips.
  assert.deepEqual(resize(box, 'e', 700, 999, null, W, H), { x: 200, y: 200, width: 500, height: 300 })
  assert.deepEqual(resize(box, 'w', 700, 0, null, W, H), { x: 600, y: 200, width: 100, height: 300 })
  // Edge handle with a ratio grows the other axis around its center.
  assert.deepEqual(resize(box, 's', 0, 600, 1, W, H), { x: 400 - 200, y: 200, width: 400, height: 400 })
  // Handles never collapse an area.
  assert.equal(resize(box, 'se', 201, 201, null, W, H).width, 32)
})

test('area form placement', () => {
  const floor = H - 84 // the recording toolbar's top edge
  // Under the area, centered on it.
  assert.deepEqual(formAt({ x: 100, y: 100, width: 400, height: 300 }, 300, 50, W, floor), { x: 150, y: 414 })
  // An area that ends just above the toolbar: the form goes above it, not under the toolbar.
  assert.deepEqual(formAt({ x: 100, y: 300, width: 400, height: 560 }, 300, 50, W, floor), { x: 150, y: 236 })
  // Full height: inside, above the toolbar.
  assert.deepEqual(formAt({ x: 500, y: 0, width: 500, height: H }, 300, 50, W, floor), { x: 600, y: floor - 12 - 50 })
  // Never past the display's sides.
  assert.equal(formAt({ x: 0, y: 100, width: 100, height: 100 }, 300, 50, W, floor).x, 12)
})

test('constrain and window presets', () => {
  assert.deepEqual(constrain({ x: 1400, y: 0, width: 400, height: 300 }, null, W, H), { x: 1112, y: 0, width: 400, height: 300 })
  const square = constrain({ x: 0, y: 0, width: 3000, height: 100 }, 1, W, H)
  assert.deepEqual(Object.values(square).map(Math.round), [982, 982, 530, 0]) // shrunk to fit, centered, then inside
  // Free: a side typed too large stops at the display; the other side stays.
  assert.deepEqual(constrain({ x: 100, y: 0, width: 960, height: 50000 }, null, W, H), { x: 100, y: 0, width: 960, height: H })
  assert.deepEqual(constrain({ x: 100, y: 0, width: 5, height: 200 }, null, W, H), { x: 100 - 13.5, y: 0, width: 32, height: 200 })
  const work = { x: 0, y: 33, width: 1512, height: 949 }
  assert.deepEqual(presetSize('16:9', work), [1280, 720])
  assert.equal(presetSize('9:16', { x: 0, y: 0, width: 1280, height: 700 }), null)
  // Same top-left, pulled inside the work area.
  assert.deepEqual(presetFrame({ x: 600, y: 500, width: 800, height: 600 }, '16:9', work), { x: 232, y: 262, width: 1280, height: 720 })
  assert.deepEqual(presetFrame({ x: 600, y: 500, width: 800, height: 600 }, 'current', work), { x: 600, y: 500, width: 800, height: 600 })
})
