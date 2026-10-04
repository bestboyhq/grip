import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Clip, Zoom } from '../../../shared/project.ts'
import { removeOutputRange, timeMap, toOutput } from '../../../shared/timemap.ts'
import * as M from './model.ts'
import { stressProject } from './stress.ts'
import { Waveforms } from './waveform.ts'

const clip = (start: number, end: number, speed = 1, id = `c${start}`): Clip => ({ id, start, end, speed, volume: 1 })
const zoom = (id: string, start: number, end: number): Zoom => ({ id, start, end, level: 2, target: { kind: 'cursor' }, enabled: true })
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
const parts = (clips: Clip[], zooms: Zoom[] = []): M.Parts => ({ clips, zooms, layouts: [], masks: [], duration: 30 })

test('an item spanning a cut shows each surviving piece; only the outer pieces own handles', () => {
  const m = M.buildModel(parts([clip(0, 10), clip(20, 30, 2)], [zoom('z', 8, 24)]), [], [])
  assert.deepEqual(
    m.zooms.blocks.map((b) => [b.a, b.b, b.head, b.tail]),
    [[8, 10, true, false], [10, 12, false, true]],
  )
  assert.equal(M.blockAt(m.zooms, 11)?.a, 10)
  assert.equal(M.blockAt(m.zooms, 15), null)
  // A split or speed change inside an item is no cut: one block (one label), not two.
  const sped = M.buildModel(parts([clip(0, 10), clip(10, 20, 2)], [zoom('z', 8, 14)]), [{ start: 9, end: 11, label: '⌘A' }], [])
  assert.deepEqual(sped.zooms.blocks.map((b) => [b.a, b.b, b.head, b.tail]), [[8, 12, true, true]])
  assert.equal(sped.keys.blocks.length, 1)
})

test('lanes are reused while their inputs keep identity', () => {
  const p = parts([clip(0, 10)], [zoom('z', 1, 2)])
  const a = M.buildModel(p, [], [])
  const b = M.buildModel({ ...p, masks: [] }, [], [], a)
  assert.equal(b.zooms, a.zooms)
  assert.notEqual(M.buildModel({ ...p, clips: [clip(0, 9)] }, [], [], a).zooms, a.zooms)
})

test('cut markers show removed source and restore it', () => {
  let clips = removeOutputRange([clip(0, 30)], 10, 17)
  clips = [{ ...clips[0], start: 2 }, ...clips.slice(1)] // trimmed head too
  const m = M.buildModel(parts(clips), [], [])
  assert.deepEqual(m.cuts.map((c) => [c.after, c.removed]), [[-1, 2], [0, 7]])
  near(m.cuts[1].t, 8)
  const restored = M.restoreCut(M.restoreCut(clips, 0, 30), -1, 30)
  assert.deepEqual(restored.map((c) => [c.start, c.end]), [[0, 30]]) // seamless and alike: merged back into one
})

test('a dragged clip edge lands exactly under the pointer on a sped-up clip', () => {
  const clips = [clip(0, 10), clip(20, 40, 4), clip(50, 60)]
  const map = timeMap(clips)
  const lim = M.clipLimits(clips, 1, 100)
  assert.deepEqual(lim, { lo: 10, hi: 50 })
  // end edge: dragged from output 15 to 13.25
  const end = M.trimClip(clips, 1, 'end', M.edgeSource(map, 1, 13.25), lim)
  near(timeMap(end).outStarts[2], 13.25)
  // start edge: dragged from output 10 to 11.5, drawn at outStart + (new - old) / speed
  const start = M.trimClip(clips, 1, 'start', M.edgeSource(map, 1, 11.5), lim)
  near(map.outStarts[1] + (start[1].start - 20) / 4, 11.5)
  // growing stops at the source the neighbours use
  assert.equal(M.trimClip(clips, 1, 'start', M.edgeSource(map, 1, 0), lim)[1].start, 10)
  assert.equal(M.trimClip(clips, 1, 'end', M.edgeSource(map, 1, 99), lim)[1].end, 50)
})

test('clip edits', () => {
  const clips = [clip(0, 10), clip(10, 20), clip(25, 30)]
  assert.equal(M.removeClips(clips, new Set(clips.map((c) => c.id))), clips, 'never removes every clip')
  assert.deepEqual(M.removeClips(clips, new Set(['c10'])).map((c) => c.start), [0, 25])
  assert.deepEqual(M.mergeClips(clips, 1).map((c) => [c.start, c.end]), [[0, 10], [10, 30]])
  const pasted = M.insertClips(clips, 5, [clips[2]])
  assert.deepEqual(pasted.map((c) => [c.start, c.end]), [[0, 5], [25, 30], [5, 10], [10, 20], [25, 30]])
  assert.notEqual(pasted[1].id, clips[2].id)
  assert.deepEqual(M.duplicateClips(clips, new Set(['c0'])).map((c) => c.start), [0, 0, 10, 25])
})

test('the playhead keeps its source moment across edits, or moves to the next surviving one', () => {
  const whole = timeMap([clip(0, 30)])
  const cut = timeMap(removeOutputRange([clip(0, 30)], 10, 17))
  near(M.sameMoment(whole, cut, 20), 13) // after the removed stretch: shifts left with its content
  near(M.sameMoment(whole, cut, 12), 10) // inside it: lands on the cut
  near(M.sameMoment(cut, whole, 13), 20) // undo: back to the same frame
  near(M.sameMoment(whole, timeMap([clip(0, 10), clip(10, 30, 2)]), 20), 15) // speed change
})

test('items never overlap: fit, move, resize, paste', () => {
  const zs = [zoom('a', 2, 4), zoom('b', 6, 8)]
  assert.deepEqual(M.fit(zs, 4.5, 7.5, 30), [4, 6]) // shrinks into the gap
  assert.deepEqual(M.fit(zs, 8.5, 10, 30), [8.5, 10])
  assert.deepEqual(M.fit(zs, 3, 4, 30), [4, 5]) // a start inside an item moves to its end
  assert.deepEqual(M.fit(zs, 29.5, 31, 30), [28.5, 30]) // shifts left to keep its length
  assert.equal(M.fit([...zs, zoom('c', 4.05, 5)], 4.01, 5, 30), null) // gap too small
  const moved = M.moveItems(zs, new Set(['a']), 5, 30)
  assert.deepEqual([moved[0].start, moved[0].end], [4, 6]) // stops at b
  const both = M.moveItems(zs, new Set(['a', 'b']), -5, 30)
  assert.deepEqual(both.map((z) => z.start), [0, 4]) // the group stops at 0
  assert.equal(M.resizeItem(zs, 'a', 'end', 7, 30)[0].end, 6)
  assert.equal(M.resizeItem(zs, 'a', 'end', 1, 30)[0].end, 2 + M.MIN_LEN)
  const { items, added } = M.placeCopies(zs, zs, 1, 30)
  assert.equal(added.length, 2)
  assert.deepEqual(items.slice(2).map((z) => [z.start, z.end]), [[4, 6], [8, 10]])
})

test('keystroke chips: shortcuts stand alone, typing runs merge', () => {
  const key = (t: number, key: string, mods: Array<'⌘' | '⇧'> = []) => ({ t, type: 'key' as const, down: true, key, code: 0, mods })
  const chips = M.keyChips([key(1, 'h'), key(1.2, 'i', ['⇧']), key(1.4, '⌫'), key(3, 'k', ['⌘']), key(5, '↩')])
  assert.deepEqual(chips.map((c) => [c.label, c.start]), [['Typing', 1], ['⌘K', 3], ['↩', 5]])
  near(chips[0].end, 1.7)
})

test('formatting', () => {
  assert.deepEqual(M.ticks(50), { major: 2, minor: 0.5 })
  assert.equal(M.label(65, 5, false), '1:05')
  assert.equal(M.label(65.5, 0.5, false), '1:05.5')
  assert.equal(M.label(3725, 300, true), '1:02:05')
  assert.equal(M.clock(8.27), '0:08.27')
  assert.equal(M.clock(3723.456), '1:02:03.46')
  assert.equal(M.span(8.04), '8s')
  assert.equal(M.span(125), '2m 05s')
  assert.equal(M.levelForDigit(2), 2)
  assert.equal(M.levelForDigit(0), 6)
})

test('2-hour stress project: model builds fast and stays consistent', () => {
  const { project: p, events, transcript } = stressProject()
  const keys = M.keyChips(events)
  const words = M.wordChips(transcript, {})
  const input = { ...p, duration: p.sources.duration }
  let m = M.buildModel(input, keys, words)
  const t0 = performance.now()
  for (let i = 0; i < 10; i++) m = M.buildModel({ ...input, clips: p.clips.slice() }, keys, words, m) // every lane remaps
  const ms = (performance.now() - t0) / 10
  console.log(`  full remap: ${ms.toFixed(1)} ms, ${m.captions.blocks.length} words, ${m.zooms.blocks.length} zoom blocks, ${(m.map.duration / 3600).toFixed(2)} h`)
  assert.ok(m.map.duration > 7000 && m.map.duration < 7400)
  assert.equal(m.clips.blocks.length, 500)
  assert.ok(m.zooms.blocks.length >= 300)
  for (const l of [m.zooms, m.captions, m.keys]) for (let k = 1; k < l.blocks.length; k++) assert.ok(l.blocks[k - 1].a <= l.blocks[k].a)
  // every surviving word piece maps back into its word's source range
  for (const b of m.captions.blocks.slice(0, 2000)) {
    const w = m.captions.items[b.i]
    assert.ok(toOutput(m.map, w.start) === null || toOutput(m.map, w.start)! <= b.a + 1e-6)
  }
  assert.ok(ms < 40, `remapping a 2-hour project took ${ms} ms; dragging a clip edge remaps every frame`)
})

test('waveform tiles: fetched once per tile, coarser cached levels stand in while finer ones load', async () => {
  const calls: Array<[number, number, number]> = []
  let loaded = 0
  const w = new Waveforms(async (_url, from, to, buckets) => {
    calls.push([from, to, buckets])
    return new Float32Array(buckets * 2).map((_, i) => (i % 2 ? 0.5 : -0.25))
  }, () => loaded++)
  const coarse = w.level(0.08)
  assert.equal(w.peak('a', coarse, 0, 0.08), -1) // nothing cached yet: starts a fetch
  assert.equal(w.peak('a', coarse, 0, 0.08), -1) // in flight: not fetched twice
  await new Promise((r) => setTimeout(r))
  assert.equal(calls.length, 1)
  assert.equal(loaded, 1)
  assert.equal(w.peak('a', coarse, 0, 0.08), 0.5)
  assert.equal(w.peak('a', coarse - 2, 0, 0.02), 0.5) // finer level not loaded: the coarse tile answers
  assert.equal(calls.length, 2) // ...and the finer tile was requested
})
