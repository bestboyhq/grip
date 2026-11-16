import assert from 'node:assert/strict'
import { test } from 'node:test'
import { staircase } from './bands.ts'

// A 720 x 360 frame whose level at column x is level(x) on every row.
const frame = (level: (x: number) => number) => Uint8Array.from({ length: 720 * 360 }, (_, i) => level(i % 720))

test('a dark ramp in wide flat bands is a staircase, and the same ramp stepping every few px is not', () => {
  const stepped = staircase(frame((x) => 12 + Math.min(5, Math.floor(x / 48))), 720, 360)
  assert.equal(stepped?.along, 'row')
  assert.equal(stepped?.bands.length, 6)
  assert.equal(staircase(frame((x) => 12 + Math.min(40, Math.floor(x / 4))), 720, 360), null)
})

test('wide bands on a light page are steps no eye sees', () => {
  assert.equal(staircase(frame((x) => 220 + Math.min(5, Math.floor(x / 48))), 720, 360), null)
})
