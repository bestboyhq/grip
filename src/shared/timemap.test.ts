import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Clip } from './project.ts'
import { timeMap, toSource, toOutput, mapRange, splitAt, removeOutputRange, removeSourceRange, setSpeed } from './timemap.ts'

const clip = (start: number, end: number, speed = 1): Clip => ({ id: `${start}`, start, end, speed, volume: 1 })
const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('round trip through cuts and speed changes', () => {
  // source 0-10 normal, cut 10-20, 20-30 at 2x
  const m = timeMap([clip(0, 10), clip(20, 30, 2)])
  near(m.duration, 15)
  near(toSource(m, 5), 5)
  near(toSource(m, 12), 24)
  near(toOutput(m, 24), 12)
  assert.equal(toOutput(m, 15), null)
  near(toOutput(m, 30), 15)
  for (let t = 0; t <= 15; t += 0.37) near(toOutput(m, toSource(m, t)), t)
})

test('mapRange splits a range across a cut', () => {
  const m = timeMap([clip(0, 10), clip(20, 30, 2)])
  assert.deepEqual(mapRange(m, 8, 22), [[8, 10], [10, 11]])
  assert.deepEqual(mapRange(m, 12, 18), [])
})

test('mapRange keeps a range whole across a split that removes nothing, at any speed', () => {
  const m = timeMap(setSpeed(splitAt([clip(0, 30)], 10), 10, 30, 2)) // 0-10 at 1x, 10-30 at 2x
  assert.deepEqual(mapRange(m, 8, 14), [[8, 12]])
  const cut = timeMap([clip(0, 10), clip(10, 20), clip(25, 30)])
  assert.deepEqual(mapRange(cut, 5, 28), [[5, 20], [20, 23]]) // a real cut still splits it
})

test('edits', () => {
  let c = [clip(0, 30)]
  c = splitAt(c, 10)
  assert.equal(c.length, 2)
  c = removeOutputRange(c, 10, 20) // remove source 10-20
  near(timeMap(c).duration, 20)
  near(toSource(timeMap(c), 10), 20)
  c = removeSourceRange(c, 25, 26)
  near(timeMap(c).duration, 19)
  c = setSpeed(c, 0, 10, 4)
  near(timeMap(c).duration, 11.5)
  near(toOutput(timeMap(c), 20), 2.5)
})

test('mapRange matches a linear scan on shuffled, duplicated, sped-up clips', () => {
  const linear = (cs: Clip[], a: number, b: number) => {
    const m = timeMap(cs)
    return cs.flatMap((c, i) => {
      const s = Math.max(a, c.start)
      const e = Math.min(b, c.end)
      return e - s > 1e-9 ? [[m.outStarts[i] + (s - c.start) / c.speed, m.outStarts[i] + (e - c.start) / c.speed]] : []
    })
  }
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const cs: Clip[] = []
  for (let i = 0; i < 300; i++) {
    const s = rnd() * 1000
    cs.push(clip(s, s + 0.1 + rnd() * 20, [0.5, 1, 2, 4][Math.floor(rnd() * 4)]))
  }
  const m = timeMap(cs)
  for (let i = 0; i < 2000; i++) {
    const a = rnd() * 1100 - 50
    const b = a + rnd() * 60
    assert.deepEqual(mapRange(m, a, b), linear(cs, a, b))
  }
})

test('toOutput matches a linear scan (first occurrence wins) on shuffled, duplicated, sped-up clips', () => {
  const linear = (cs: Clip[], src: number) => {
    const m = timeMap(cs)
    const i = cs.findIndex((c, i) => src >= c.start - 1e-9 && (src < c.end - 1e-9 || (i === cs.length - 1 && src <= c.end + 1e-9)))
    return i < 0 ? null : m.outStarts[i] + (Math.max(src, cs[i].start) - cs[i].start) / cs[i].speed
  }
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const cs: Clip[] = []
  for (let i = 0; i < 300; i++) {
    const s = rnd() * 1000
    cs.push(clip(s, s + 0.1 + rnd() * 20, [0.5, 1, 2, 4][Math.floor(rnd() * 4)]))
  }
  cs.push(clip(cs[5].start, cs[5].end)) // a duplicate: the first one wins
  const m = timeMap(cs)
  for (let i = 0; i < 5000; i++) {
    const src = i % 50 === 0 ? cs[i % cs.length].end : rnd() * 1100 - 50 // clip ends too: only the last clip owns its end
    assert.equal(toOutput(m, src), linear(cs, src))
  }
})
