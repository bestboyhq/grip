import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Clip, Voiceover, Zoom } from '../../../shared/project.ts'
import { removeOutputRange, timeMap, toOutput, toSource } from '../../../shared/timemap.ts'
import * as M from './model.ts'
import { stressProject } from './stress.ts'
import { Waveforms } from './waveform.ts'

const clip = (start: number, end: number, speed = 1, id = `c${start}`): Clip => ({ id, start, end, speed, volume: 1 })
const zoom = (id: string, start: number, end: number): Zoom => ({ id, start, end, level: 2, target: { kind: 'cursor' }, enabled: true })
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)
const parts = (clips: Clip[], zooms: Zoom[] = []): M.Parts => ({ clips, zooms, layouts: [], masks: [], voiceovers: [], duration: 30 })
/** A voiceover playing [start, end] of a take recorded over source [s0, s1]. */
const vo = (id: string, start: number, end: number, s0: number, s1: number): Voiceover => ({ id, take: 't', start, end, knots: [[0, s0], [s1 - s0, s1]], volume: 1, duck: true, enhance: true })

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

test('lanes stack as the frame is built and show once they have items, then stay', () => {
  const m = M.buildModel(parts([clip(0, 10)], [zoom('z', 1, 2)]), [{ start: 1, end: 2, label: '⌘A' }], [])
  const shown = new Set<M.ItemTrack>()
  assert.deepEqual(M.tracks(m, true, shown), ['zooms', 'clips', 'keys'])
  const all = { ...m, layouts: { items: [{}] }, masks: { items: [{}] } }
  assert.deepEqual(M.tracks(all, false, shown), ['zooms', 'masks', 'clips', 'keys']) // no camera: no layouts lane
  assert.deepEqual(M.tracks(all, true, shown), ['layouts', 'zooms', 'masks', 'clips', 'keys'])
  assert.deepEqual(M.tracks({ ...m, zooms: { items: [] } }, true, shown), ['layouts', 'zooms', 'masks', 'clips', 'keys']) // last item deleted: still there
  assert.deepEqual(M.tracks(M.buildModel(parts([clip(0, 10)]), [], []), true, new Set()), ['clips']) // a new session starts bare
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
  const hidden = M.restoreCut([clips[0], { ...clips[1], hideCursor: true }], 0, 30)
  assert.equal(hidden.length, 2, 'a clip with other settings stays its own')
})

test('reset trim grows clips over the free source on both sides', () => {
  const clips = [clip(2, 8), clip(12, 20), clip(25, 28)]
  assert.deepEqual(M.resetTrim(clips, new Set(['c12']), 30).map((c) => [c.start, c.end]), [[2, 8], [8, 25], [25, 28]])
  assert.deepEqual(M.resetTrim(clips, new Set(['c2', 'c25']), 30).map((c) => [c.start, c.end]), [[0, 12], [12, 20], [20, 30]])
  const all = M.resetTrim(clips, new Set(clips.map((c) => c.id)), 30)
  assert.deepEqual(all.map((c) => [c.start, c.end]), [[0, 12], [12, 25], [25, 30]], 'each grows into what the earlier ones left')
  assert.equal(M.resetTrim(all, new Set(['c2', 'c12']), 30), all, 'nothing to grow: same array, no undo step')
})

test('a dragged clip edge lands exactly under the pointer on a sped-up clip', () => {
  const clips = [clip(0, 10), clip(20, 40, 4), clip(50, 60)]
  const map = timeMap(clips)
  const lim = M.clipLimits(clips, 1, 100)
  assert.deepEqual(lim, { lo: 10, hi: 50 })
  // end edge: dragged from output 15 to 13.25
  const end = M.trimClip(clips, 1, 'end', M.edgeSource(map, 1, 13.25, 'end'), lim)
  near(timeMap(end).outStarts[2], 13.25)
  // start edge: dragged from output 10 to 11.5, drawn at outStart + (new - old) / speed
  const start = M.trimClip(clips, 1, 'start', M.edgeSource(map, 1, 11.5, 'start'), lim)
  near(map.outStarts[1] + (start[1].start - 20) / 4, 11.5)
  // growing stops at the source the neighbours use
  assert.equal(M.trimClip(clips, 1, 'start', M.edgeSource(map, 1, 0, 'start'), lim)[1].start, 10)
  assert.equal(M.trimClip(clips, 1, 'end', M.edgeSource(map, 1, 99, 'end'), lim)[1].end, 50)
  // leaving the trim lens picks the timeline drag up from where the edge is: it does not move
  for (const side of ['start', 'end'] as const) for (const src of [12, 20, 33.3, 46]) near(M.edgeSource(map, 1, M.edgeOutput(map, 1, src, side), side), src)
})

test('the preview finds a dragged clip edge, inside the clip, in source being trimmed back in, or taken from the next clip', () => {
  const clips = [clip(0, 10), clip(20, 40, 4), clip(50, 60)]
  const lim = M.trimLimits(clips, 1, 100)
  for (const side of ['start', 'end'] as const) {
    const full = timeMap(M.trimClip(clips, 1, side, side === 'start' ? lim.lo : lim.hi, lim))
    for (const src of side === 'start' ? [5, 12, 25] : [33, 46, 55]) near(toSource(full, M.edgeOutput(full, 1, src, side)), src)
  }
})

test('the edge between the parts of a split moves the split: the other part gives way', () => {
  const at = (cs: Clip[]) => cs.map((c) => [c.start, c.end])
  const clips = [clip(0, 10), clip(10, 24, 2)]
  const lim = M.trimLimits(clips, 0, 24)
  assert.deepEqual(lim, { lo: 0, hi: 23.8 })
  assert.deepEqual(at(M.trimClip(clips, 0, 'end', 12, lim)), [[0, 12], [12, 24]])
  assert.deepEqual(at(M.trimClip(clips, 1, 'start', 7, M.trimLimits(clips, 1, 24))), [[0, 7], [7, 24]])
  assert.deepEqual(at(M.trimClip(clips, 0, 'end', 99, lim)), [[0, 23.8], [23.8, 24]], 'down to its shortest, never through it')
  assert.deepEqual(at(M.trimClip(clips, 0, 'end', 8, lim)), [[0, 8], [10, 24]], 'trimmed in, the edge cuts and the other part keeps its source')
  // A start edge taken into a slower part goes on at its speed, so the split stays under the pointer.
  const map = timeMap(clips)
  const rolled = M.trimClip(clips, 1, 'start', M.edgeSource(map, 1, 8, 'start'), M.trimLimits(clips, 1, 24))
  assert.deepEqual(at(rolled), [[0, 8], [8, 24]])
  near(timeMap(rolled).outStarts[1], 8)
  // Past a cut, the edge brings the cut back, then takes over the clip before it, still under the pointer.
  const cut = [clip(0, 5), clip(10, 20, 2)]
  const cutMap = timeMap(cut)
  assert.deepEqual(at(M.trimClip(cut, 1, 'start', 3, M.trimLimits(cut, 1, 20))), [[0, 3], [3, 20]])
  for (const src of [3, 4.5, 7, 12]) near(M.edgeSource(cutMap, 1, M.edgeOutput(cutMap, 1, src, 'start'), 'start'), src)
  near(M.edgeOutput(cutMap, 1, 4.5, 'start'), 2) // 5 s brought back at 2x, then 0.5 s of the clip before at 1x
  // A clip before it whose source comes later is not taken over.
  const swapped = [clip(10, 20), clip(2, 10)]
  assert.deepEqual(at(M.trimClip(swapped, 1, 'start', 0, M.trimLimits(swapped, 1, 20))), [[10, 20], [0, 10]])
  assert.deepEqual(M.trimLimits(swapped, 0, 20), { lo: 10, hi: 20 })
})

test('clip edits', () => {
  const clips = [clip(0, 10), clip(10, 20), clip(25, 30)]
  assert.equal(M.removeClips(clips, new Set(clips.map((c) => c.id))), clips, 'never removes every clip')
  assert.deepEqual(M.removeClips(clips, new Set(['c10'])).map((c) => c.start), [0, 25])
  assert.deepEqual(M.mergeClips(clips, 1).map((c) => [c.start, c.end]), [[0, 10], [10, 30]])
  const pasted = M.insertClips(clips, 5, [{ ...clips[2], id: 'copy' }])
  assert.deepEqual(pasted.map((c) => [c.start, c.end]), [[0, 5], [25, 30], [5, 10], [10, 20], [25, 30]])
  assert.equal(pasted[1].id, 'copy') // the caller's fresh id: paste selects the copies, not the clip it split
  assert.deepEqual(M.duplicateClips(clips, new Set(['c0'])).map((c) => c.start), [0, 0, 10, 25])
  // Q and W: the clip under the playhead loses what comes before it or after it; the other clips stay.
  const sped = [clip(0, 10), clip(10, 20, 2), clip(25, 30)] // the 2× clip plays over output 10..15
  assert.deepEqual(M.trimAt(sped, 12, -1).map((c) => [c.start, c.end]), [[0, 10], [14, 20], [25, 30]])
  assert.deepEqual(M.trimAt(sped, 12, 1).map((c) => [c.start, c.end]), [[0, 10], [10, 14], [25, 30]])
  assert.equal(M.trimAt(sped, 10, -1), sped, 'nothing before the playhead at a clip start')
  const one = [clip(0, 10)]
  assert.equal(M.trimAt(one, 0, 1), one, 'never removes every clip')
})

test('the playhead keeps its source moment across edits, or moves to the next surviving one', () => {
  const whole = timeMap([clip(0, 30)])
  const cut = timeMap(removeOutputRange([clip(0, 30)], 10, 17))
  near(M.sameMoment(whole, cut, 20), 13) // after the removed stretch: shifts left with its content
  near(M.sameMoment(whole, cut, 12), 10) // inside it: lands on the cut
  near(M.sameMoment(cut, whole, 13), 20) // undo: back to the same frame
  near(M.sameMoment(whole, timeMap([clip(0, 10), clip(10, 30, 2)]), 20), 15) // speed change
})

test('layouts and masks never overlap: fit, move, resize, paste', () => {
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

test('voiceovers sit under the video; one moves with its audio, and its edges reach only as far as its take', () => {
  const m = M.buildModel({ ...parts([clip(0, 10)]), voiceovers: [vo('v', 2, 4, 1.5, 5)] }, [], [])
  assert.deepEqual(M.tracks(m, true, new Set()), ['clips', 'voiceovers'])
  const [moved] = M.moveItems([vo('v', 2, 4, 1.5, 5), vo('w', 6, 7, 6, 7)], new Set(['v']), 3, 10)
  assert.deepEqual([moved.start, moved.end, moved.knots], [4, 6, [[0, 3.5], [3.5, 7]]]) // stops at w, the take two seconds later
  assert.equal(M.resizeItem([vo('v', 2, 4, 1.5, 5)], 'v', 'start', 0, 10)[0].start, 1.5)
  assert.equal(M.resizeItem([vo('v', 2, 4, 1.5, 5)], 'v', 'end', 9, 10)[0].end, 5)
  // A pasted copy fitted left of where it was asked for: its audio goes where the copy went.
  const copy = M.placeCopies([vo('w', 6, 7, 6, 7)], [vo('v', 2, 4, 1.5, 5)], 3.5, 10).items[1]
  assert.deepEqual([copy.start, copy.end, copy.knots], [4, 6, [[0, 3.5], [3.5, 7]]])
})

test('zooms pass over each other: a shorter one lies on a longer one, the same while dragged across', () => {
  const zs = [zoom('a', 2, 4), zoom('b', 6, 8)]
  assert.deepEqual(M.fit(zs, 3, 7, 30, M.MIN_LEN, true), [3, 7])
  assert.deepEqual(M.fit(zs, 29.5, 31, 30, M.MIN_LEN, true), [28.5, 30]) // only the recording's ends limit it
  assert.deepEqual(M.moveItems(zs, new Set(['a']), 5, 30, true)[0].start, 7)
  assert.equal(M.resizeItem(zs, 'a', 'end', 7, 30, true)[0].end, 7)
  assert.deepEqual(M.placeCopies(zs, zs, 1, 30, true).items.slice(2).map((z) => [z.start, z.end]), [[3, 5], [7, 9]])
  const lane = (zooms: Zoom[]) => M.buildModel(parts([clip(0, 30)], zooms), [], []).zooms
  const order = (zooms: Zoom[]) => lane(zooms).rank.join('') // bottom up
  assert.equal(order([zoom('in', 4, 6), zoom('out', 2, 10)]), '10') // a zoom inside another draws over it, whichever came first
  assert.equal(order([zoom('a', 2, 6), zoom('b', 4, 8)]), '01') // as long: the later on top
  assert.equal(order([{ ...zoom('off', 4, 5), enabled: false }, zoom('on', 2, 10)]), '01') // turned off under turned on
  // Dragging b (shorter) across a never reorders them.
  for (const start of [9, 5, 1, 0]) assert.equal(order([zoom('a', 2, 6), zoom('b', start, start + 3)]), '01')
  // Where two or more turned-on zooms are on at once, they overlap; touching ends do not.
  const ov = (zooms: Zoom[]) => lane(zooms).overlaps.map((o) => [o.a, o.b, o.items.join('')])
  assert.deepEqual(ov(zs), [])
  assert.deepEqual(ov([zoom('a', 2, 6), zoom('b', 6, 8)]), [])
  assert.deepEqual(ov([zoom('a', 2, 12), zoom('b', 4, 9), zoom('c', 5, 7), zoom('d', 11, 13)]), [[4, 5, '01'], [5, 7, '012'], [7, 9, '01'], [11, 12, '03']])
  assert.deepEqual(ov([zoom('a', 2, 12), { ...zoom('off', 4, 9), enabled: false }]), [])
  // The most zooms on at once: the zoom track grows with it.
  assert.equal(lane(zs).stack, 1)
  assert.equal(lane([zoom('a', 2, 12), zoom('b', 4, 9), zoom('c', 5, 7), zoom('d', 11, 13)]).stack, 3)
  const m = M.buildModel(parts([clip(0, 30)], [zoom('a', 2, 10), zoom('b', 4, 6)]), [], [])
  assert.deepEqual(M.blocksAt(m.zooms, 5).map((b) => b.i), [1, 0]) // the top one first
  assert.equal(M.blockAt(m.zooms, 8)?.i, 0)
})

test('keystroke chips: shortcuts stand alone, typing runs merge', () => {
  const key = (t: number, key: string, mods: Array<'⌘' | '⇧'> = []) => ({ t, type: 'key' as const, down: true, key, code: 0, mods })
  const chips = M.keyChips([key(1, 'h'), key(1.2, 'i', ['⇧']), key(1.4, '⌫'), key(3, 'k', ['⌘']), key(5, '↩')])
  assert.deepEqual(chips.map((c) => [c.label, c.start]), [['Typing', 1], ['⌘K', 3], ['↩', 5]])
  near(chips[0].end, 1.7)
})

test('formatting', () => {
  assert.deepEqual(M.ticks(50), { major: 2, minor: 0.5 })
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
  // CPU time, not wall time: test files run in parallel, and a busy CI runner triples wall time. The
  // best of 10 remaps: a regression slows every one, while a CI virtual Mac's stall lands in a few.
  let ms = Infinity
  for (let i = 0; i < 10; i++) {
    const cpu = process.cpuUsage()
    m = M.buildModel({ ...input, clips: p.clips.slice() }, keys, words, m) // every lane remaps
    const { user, system } = process.cpuUsage(cpu)
    ms = Math.min(ms, (user + system) / 1000)
  }
  console.log(`  full remap: ${ms.toFixed(1)} ms (best of 10), ${m.captions.blocks.length} words, ${m.zooms.blocks.length} zoom blocks, ${(m.map.duration / 3600).toFixed(2)} h`)
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

test('the view rides along with the playhead, eases to seeks, and lets the user scroll away', () => {
  const play = (f: M.Follow, v: M.Viewport, t0: number, t1: number, at: number, still = false) => {
    for (let t = t0; t <= t1 + 1e-9; t += 1 / 60) v.x0 = M.follow(f, v, t, true, at + (t - t0) * 1000, still)
    return v.x0
  }
  const f = M.follower()
  const v: M.Viewport = { x0: 0, w: 10, duration: 100 }
  assert.equal(play(f, v, 0, 5, 0), 0, 'the playhead walks to the middle')
  near(play(f, v, 5, 20, 5000), 20 - 5) // then the view rides along, the playhead in the middle
  // Scrolled back out of view while playing: the view stays, however long; in view again, it rides on after HOLD.
  M.letGo(f, 20_000)
  v.x0 = 2
  assert.equal(play(f, v, 20, 30, 20_000), 2, 'never pulled back to a playhead out of view')
  v.x0 = 32
  assert.equal(play(f, v, 30, 30.5, 30_000), 32, 'in view, it waits while the user may still scroll')
  M.letGo(f, 30_500)
  assert.equal(play(f, v, 30.5, 31.4, 30_500), 32, 'each scroll restarts the wait')
  assert.equal(play(f, v, 31.4, 37, 31_400), 32, 'after the wait the playhead walks to the middle')
  near(play(f, v, 37, 39, 37_000), 39 - 5)
  // Paused, a seek far out of view eases there from a view away, landing in the middle.
  M.follow(f, v, 39, false, 39_000, false)
  M.seeked(f, v, 90, false, 40_000, false)
  const first = M.follow(f, v, 90, false, 40_000, false)
  assert.ok(first >= 85 - 10 && first < 85, `starts a view away: ${first}`)
  assert.equal(M.follow(f, v, 90, false, 40_000 + M.GLIDE, false), 85)
  assert.equal(f.aim, null, 'and stops there')
  // Reduced motion: the view pages instead of sliding.
  const r = M.follower()
  const rv: M.Viewport = { x0: 0, w: 10, duration: 100 }
  assert.equal(play(r, rv, 0, 9.9, 0, true), 0)
  const paged = play(r, rv, 9.9, 10.1, 9900, true)
  assert.ok(Math.abs(paged - (10 - 0.5)) < 0.02, `pages once the playhead leaves, landing near the left: ${paged}`)
  assert.equal(play(r, rv, 10.1, 15, 10_100, true), paged, 'and holds still until the next page')
})
