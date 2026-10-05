import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { InputEvent, Modifier } from '../../shared/events.ts'
import { idleSegments, keyCaps, removeJitter, typingSegments } from './index.ts'

const move = (t: number, x: number, y: number): InputEvent => ({ t, type: 'move', x, y })
const click = (t: number, x: number, y: number): InputEvent[] => [
  { t, type: 'down', x, y, button: 'left' },
  { t: t + 0.08, type: 'up', x, y, button: 'left' },
]
const key = (t: number, k: string, mods: Modifier[] = []): InputEvent[] => [
  { t, type: 'key', down: true, key: k, code: 0, mods },
  { t: t + 0.06, type: 'key', down: false, key: k, code: 0, mods },
]
const type = (t: number, text: string, every = 0.12) => [...text].flatMap((c, i) => key(t + i * every, c === ' ' ? 'Space' : c))
const sorted = (...e: InputEvent[][]) => e.flat().sort((a, b) => a.t - b.t)

test('typing: pauses split stretches, shortcuts and clicks do not count, the last release ends it', () => {
  const events = sorted(
    type(1, 'hello world'), // 11 keys, 1.0 .. 2.26
    type(4, 'next'), // after a 1.7 s pause: a new stretch
    key(6, 'C', ['⌘']), key(6.2, 'V', ['⌘']), key(6.4, 'A', ['⌘']), key(6.6, 'Z', ['⌘']), // shortcuts only
    type(8, 'ab'), click(8.3, 10, 10), type(8.4, 'cdef'), // a click splits; 'ab' is too short
    key(12, '⇧'), key(12.1, 'L', ['⇧']), type(12.2, 'ong'), // modifiers alone do not count
  )
  assert.deepEqual(typingSegments(events), [
    { start: 1, end: 1 + 10 * 0.12 + 0.06 },
    { start: 4, end: 4 + 3 * 0.12 + 0.06 },
    { start: 8.4, end: 8.4 + 3 * 0.12 + 0.06 },
    { start: 12.1, end: 12.2 + 2 * 0.12 + 0.06 },
  ])
  assert.deepEqual(typingSegments([]), [])
})

test('idle: still stretches from the start to the duration, jitter and keys do not wake the cursor', () => {
  const events = sorted(
    [move(0, 100, 100)], // initial position, not a move
    [move(3, 102, 101)], // 2.2 px nudge: still idle
    type(3.5, 'typing'), // typing with a still mouse: idle
    [move(5, 200, 100), move(5.1, 300, 100)],
    click(5.5, 300, 100),
    [move(9, 301, 100)], // jitter
    [{ t: 10, type: 'scroll', x: 300, y: 100, dx: 0, dy: -40 }],
  )
  assert.deepEqual(idleSegments(events, 2, 15), [
    { start: 0, end: 5 },
    { start: 5.58, end: 10 },
    { start: 10, end: 15 },
  ])
  assert.deepEqual(idleSegments(events, 6), []) // no duration: no open tail
  assert.deepEqual(idleSegments([], 2, 3), [{ start: 0, end: 3 }])
})

test('jitter: in-place nudges go, real slow motion and every non-move event stay', () => {
  const nudges = [move(1, 101, 100), move(1.01, 100, 100), move(2, 100, 102), move(2.01, 100, 100), move(3, 98.5, 100)]
  const slow = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => move(4 + i * 0.05, 100 + i, 100)) // 1 px steps, leaves the radius
  const keys = key(2.5, 'a')
  const events = sorted([move(0, 100, 100)], nudges, keys, slow, click(5, 108, 100), [move(6, 109, 101)])
  const out = removeJitter(events)
  assert.deepEqual(out, sorted([move(0, 100, 100)], keys, slow, click(5, 108, 100)))

  // A slow approach that ends in a click inside the radius keeps its lead-in.
  const approach = sorted([move(0, 0, 0), move(0.1, 1, 0), move(0.2, 2, 0), move(0.3, 1.5, 0), move(0.4, 3, 0)], click(0.5, 3, 0))
  assert.deepEqual(removeJitter(approach), sorted([move(0, 0, 0), move(0.3, 1.5, 0), move(0.4, 3, 0)], click(0.5, 3, 0)))

  const clean = sorted([move(0, 0, 0), move(1, 50, 0)], click(2, 50, 0))
  assert.equal(removeJitter(clean), clean)
})

test('keycaps: macOS order, typed characters carry their own ⇧ and ⌥', () => {
  const k = (label: string, mods: Modifier[] = []) => keyCaps({ t: 0, type: 'key', down: true, key: label, code: 0, mods })
  assert.deepEqual(k('P', ['⇧', '⌘']), ['⇧', '⌘', 'P'])
  assert.deepEqual(k('L', ['⇧']), ['L'])
  assert.deepEqual(k('ą', ['⌥']), ['ą'])
  assert.deepEqual(k('Ж', ['⇧']), ['Ж'])
  assert.deepEqual(k('⇥', ['⇧']), ['⇧', '⇥'])
  assert.deepEqual(k('↩', ['⇧']), ['⇧', '↩'])
  assert.deepEqual(k('Space', ['⌃']), ['⌃', 'Space'])
  assert.deepEqual(k('F5', ['fn']), ['fn', 'F5'])
  assert.deepEqual(k('⇧', ['⇧', '⌘']), ['⇧', '⌘']) // ⇧ pressed while ⌘ is held
  assert.deepEqual(k('⌘', ['⌘']), ['⌘'])
  assert.deepEqual(k('⌘', []), ['⌘']) // its release
})
