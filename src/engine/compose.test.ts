import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject } from '../shared/project.ts'
import { timeMap } from '../shared/timemap.ts'
import type { InputEvent } from '../shared/events.ts'
import { prepare } from './scene.ts'
import { motionAt, shutter, SHUTTER } from './compose.ts'

const clip = (start: number, end: number) => ({ id: `${start}`, start, end, speed: 1, volume: 1 })

test('shutter samples are centered on t and never cross a cut', () => {
  const m = timeMap([clip(0, 10), clip(20, 30)])
  const mid = shutter(m, 5)
  assert.ok(Math.abs(mid[0] - (5 - SHUTTER / 2)) < 1e-12 && Math.abs(mid.at(-1)! - (5 + SHUTTER / 2)) < 1e-12)
  assert.ok(shutter(m, 9.999).every((t) => t <= 10 + 1e-12), 'end of the first clip stays in it')
  assert.ok(shutter(m, 10).every((t) => t >= 10 - 1e-12), 'start of the second clip stays in it')
  assert.ok(shutter(m, 0).every((t) => t >= 0))
})

test('motion samples only when something moves, and only with motion blur on', () => {
  const p = createProject('t', { duration: 10, screen: { file: 's.mp4', width: 2880, height: 1800, fps: 30, scale: 2 }, events: 'e.jsonl' })
  const events: InputEvent[] = []
  for (let t = 0; t <= 10; t += 1 / 120) events.push({ t, type: 'move', x: t < 5 ? 1000 : 1000 + (t - 5) * 2000, y: 500 })
  const at = (t: number) => motionAt(prepare({ project: p, events, transcript: null, width: 1920, height: 1080 }), t)
  assert.equal(at(2), undefined, 'still cursor and view: one sample')
  const moving = at(7)
  assert.ok(moving && moving.cursors.length > 1 && moving.cursors[0]!.x < moving.cursors.at(-1)!.x, 'moving cursor: shutter samples, oldest first')
  p.style.motionBlur = false
  assert.equal(at(7), undefined)
})
