import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Clip } from './project.ts'
import { timeMap } from './timemap.ts'
import { land, pieces, place, punch, slid, sourceAt, takeAt, trim } from './voiceover.ts'

const clip = (start: number, end: number, speed = 1): Clip => ({ id: `${start}`, start, end, speed, volume: 1 })

test('a take lands in source time through the cuts and speed changes it was recorded over', () => {
  // Source 0-4 at 1x, then 6-10 at 2x (4-6 cut): output 0-4, 4-6. Take second 0 played at output 1
  // (a second of countdown), the video from output 2 on.
  const m = timeMap([clip(0, 4), clip(6, 10, 2)])
  const spans = place(m, 1, 2)
  assert.deepEqual(spans, [{ start: 2, end: 10, knots: [[1, 2], [3, 4], [3, 6], [5, 10]] }])
  // Stopped at take second 4 (output 5, source 8).
  const [sp] = trim(spans, 4)
  assert.deepEqual(sp, { start: 2, end: 8, knots: [[1, 2], [3, 4], [3, 6], [4, 8]] })
  // On the timeline it was recorded on, it plays as recorded: one piece, at normal speed.
  assert.deepEqual(pieces(m, sp), [{ o0: 2, o1: 5, f0: 1, rate: 1 }])
  // A cut made after (source 3-4) cuts it, and a speed change stretches it like the mic.
  assert.deepEqual(pieces(timeMap([clip(0, 3), clip(6, 10)]), sp), [{ o0: 2, o1: 3, f0: 1, rate: 1 }, { o0: 3, o1: 5, f0: 3, rate: 0.5 }])
  // The source the take was recorded through a cut of, cut back in, plays nothing of it.
  assert.deepEqual(pieces(timeMap([clip(0, 10)]), sp), [{ o0: 2, o1: 4, f0: 1, rate: 1 }, { o0: 6, o1: 8, f0: 3, rate: 0.5 }])
  // Take time at a source moment, and back.
  assert.deepEqual([takeAt(sp.knots, 5), takeAt(sp.knots, 7), sourceAt(sp.knots, 3), sourceAt(sp.knots, 3.5)], [3, 3.5, 4, 7])
  // A slide moves its audio with it.
  assert.deepEqual(slid(sp, 1), { start: 3, end: 9, knots: [[1, 3], [3, 5], [3, 7], [4, 9]] })
  // Splits that change nothing leave no knots behind.
  assert.deepEqual(place(timeMap([clip(0, 2), clip(2, 5)]), 0, 1), [{ start: 1, end: 5, knots: [[1, 1], [5, 5]] }])
})

test('a new take punches in over what it covers, and a jump back in the video starts a new item', () => {
  const old = land([], 'a', [{ start: 1, end: 5, knots: [[0, 1], [4, 5]] }])
  const next = land(old, 'b', trim(place(timeMap([clip(0, 10)]), 0, 2), 3)) // take seconds 2-3 over source 2-3
  assert.deepEqual(next.map((v) => [v.take, v.start, v.end]), [['a', 1, 2], ['a', 3, 5], ['b', 2, 3]])
  assert.equal(next[0].id, old[0].id) // the part before keeps its id
  assert.deepEqual(next.map((v) => [v.volume, v.duck, v.enhance]).at(-1), [1, true, true])
  assert.deepEqual(punch(next, [{ start: 0, end: 10, knots: [[0, 0], [10, 10]] }]), [])
  // Clips out of order: source 5-8 plays first, then 0-3.
  const back = place(timeMap([clip(5, 8), clip(0, 3)]), 0, 0)
  assert.deepEqual(back, [{ start: 5, end: 8, knots: [[0, 5], [3, 8]] }, { start: 0, end: 3, knots: [[3, 0], [6, 3]] }])
  // A clip played twice: the later pass is the voiceover of that source moment.
  const twice = land([], 'c', place(timeMap([clip(0, 3), clip(1, 2)]), 0, 0))
  assert.deepEqual(twice.map((v) => [v.start, v.end]), [[0, 1], [2, 3], [1, 2]])
})
