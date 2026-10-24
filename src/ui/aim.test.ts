import assert from 'node:assert/strict'
import { test } from 'node:test'
import { submenuAim, toward } from './aim.ts'

// A 232 px menu with 26 px rows; its submenu hangs off the right edge.
const sub = { left: 230, right: 330, top: 0, bottom: 234, width: 100, height: 234 }

test('toward: heading into the submenu, not down the menu or back', () => {
  const from = { x: 150, y: 26 } // left the first row through its bottom edge
  assert.equal(toward({ x: 170, y: 40 }, from, sub), true) // diagonal, down and right
  assert.equal(toward({ x: 220, y: 200 }, from, sub), true)
  assert.equal(toward({ x: 150, y: 60 }, from, sub), false) // straight down the menu
  assert.equal(toward({ x: 120, y: 40 }, from, sub), false) // back left
  // a submenu that opens to the left, as the Export menu's do
  assert.equal(toward({ x: 80, y: 60 }, { x: 100, y: 26 }, { left: -100, right: -3, top: 0, bottom: 234 }), true)
  assert.equal(toward({ x: 120, y: 60 }, { x: 100, y: 26 }, { left: -100, right: -3, top: 0, bottom: 234 }), false)
})

test('submenuAim: rows crossed on the way into the submenu wait; a resting pointer lets them take over', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let open = 'Speed'
  const aim = submenuAim(() => open, (k) => (open = k))
  const attrs = new Set<string>()
  const menu = { setAttribute: (a: string) => attrs.add(a), removeAttribute: (a: string) => attrs.delete(a) }
  const flyout = { getBoundingClientRect: () => sub } as unknown as Element
  const move = (x: number, y: number, key: string) => aim.move({ clientX: x, clientY: y, currentTarget: menu } as unknown as PointerEvent, key, flyout)

  move(150, 20, 'Speed') // on the Speed row
  move(170, 34, 'Volume') // crossing the Volume row toward the submenu
  move(190, 48, '')
  assert.equal(open, 'Speed')
  assert.ok(attrs.has('data-aiming'))
  move(240, 60, 'Speed') // arrived in the submenu
  assert.equal(open, 'Speed')
  assert.ok(!attrs.has('data-aiming'))

  move(150, 20, 'Speed')
  move(150, 40, 'Volume') // straight down: Volume takes over at once
  assert.equal(open, 'Volume')

  move(150, 40, 'Volume')
  move(170, 60, '') // aiming, then resting on a plain row
  assert.equal(open, 'Volume')
  t.mock.timers.tick(300)
  assert.equal(open, '')
  assert.ok(!attrs.has('data-aiming'))
})
