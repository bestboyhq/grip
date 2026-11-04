import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject, type Project, type Transcript } from './project.ts'
import { timeMap } from './timemap.ts'
import { applyEdits, parseEdits } from './edits.ts'

const project = (): Project => createProject('Demo #1 ✨ café', { duration: 30 })
const ranges = (p: Project) => p.clips.map((c) => [c.start, c.end, c.speed])
const transcript: Transcript = { language: 'en', words: [{ start: 1, end: 1.4, text: 'Hello' }, { start: 1.5, end: 2, text: 'wrold' }] }
const apply = (p: Project, edits: unknown, t: Transcript | null = transcript) => applyEdits(p, parseEdits(edits), { mode: 'loupe', size: 200 }, t)

test('every time is on the timeline as it was before the list', () => {
  const p = project()
  apply(p, [{ type: 'cut', start: 10, end: 12 }, { type: 'cut', start: 2, end: 4 }, { type: 'add_zoom', start: 20, end: 22 }])
  assert.deepEqual(ranges(p), [[0, 2, 1], [4, 10, 1], [12, 30, 1]])
  assert.equal(timeMap(p.clips).duration, 26)
  const [z] = p.zooms
  assert.deepEqual([z.start, z.end, z.level, z.target, z.mode, z.size], [20, 22, 2, { kind: 'cursor' }, 'loupe', 200]) // source time from the old timeline
  assert.equal(p.autoZoomed, true)

  const q = project()
  apply(q, [{ type: 'set_speed', start: 0, end: 10, speed: 2 }, { type: 'cut', start: 20, end: 25 }, { type: 'cut', start: 22, end: 30 }])
  assert.deepEqual(ranges(q), [[0, 10, 2], [10, 20, 1]]) // overlapping cuts join, the speed change moves neither
  apply(q, [{ type: 'add_zoom', start: 1, end: 4, level: 3, x: 0.25, y: 0.75 }])
  assert.deepEqual([q.zooms[0].start, q.zooms[0].end, q.zooms[0].level, q.zooms[0].target], [2, 8, 3, { kind: 'point', x: 0.25, y: 0.75 }])
})

test('a zoom names its look, or takes the last one picked', () => {
  const p = project()
  apply(p, [{ type: 'add_zoom', start: 1, end: 2, look: 'zoom' }, { type: 'add_zoom', start: 3, end: 4, look: 'loupe' }, { type: 'add_zoom', start: 5, end: 6 }])
  assert.deepEqual(p.zooms.map((z) => [z.mode, z.size]), [[undefined, undefined], ['loupe', 200], ['loupe', 200]])
  applyEdits(p, parseEdits([{ type: 'add_zoom', start: 7, end: 8, look: 'loupe' }]), {}, null) // the last pick was a zoom
  assert.deepEqual([p.zooms[3].mode, p.zooms[3].size], ['loupe', undefined])
  assert.throws(() => parseEdits([{ type: 'add_zoom', start: 1, end: 2, look: 'lens' }]), /look must be zoom or loupe/)
})

test('captions: fixed words, hidden words, style', () => {
  const p = project()
  apply(p, [{ type: 'set_caption_text', index: 1, text: ' world ' }, { type: 'set_caption_text', index: 0, text: '' }, { type: 'set_captions', visible: true, mode: 'word', color: '#FFD60A' }])
  assert.deepEqual(p.captionEdits, { 0: '', 1: 'world' })
  assert.deepEqual([p.style.captions.visible, p.style.captions.mode, p.style.captions.color, p.style.captions.font], [true, 'word', '#FFD60A', 'system-ui'])
  apply(p, [{ type: 'set_caption_text', index: 0, text: 'Hello' }]) // back to what was said: the fix goes
  assert.deepEqual(p.captionEdits, { 1: 'world' })
})

test('all or nothing, with a message that says what to fix', () => {
  const p = project()
  const before = JSON.stringify(p)
  const fails = (edits: unknown, message: RegExp, t: Transcript | null = transcript) => {
    assert.throws(() => apply(p, edits, t), message)
    assert.equal(JSON.stringify(p), before)
  }
  fails([], /at least one edit/)
  fails([{ type: 'trim', start: 0, end: 1 }], /type must be one of cut, restore_cut/)
  fails([{ type: 'cut', start: 0, end: 1, strat: 2 }], /no field “strat”/)
  fails([{ type: 'cut', start: 5, end: 5 }], /end must be a number of seconds after start/)
  fails([{ type: 'cut', start: '1', end: 2 }], /start must be a number/)
  fails([{ type: 'set_speed', start: 0, end: 1, speed: 20 }], /speed must be a number from 0.25× to 8×/)
  fails([{ type: 'add_zoom', start: 0, end: 1, x: 0.5 }], /x and y go together/)
  fails([{ type: 'set_captions' }], /at least one of visible/)
  fails([{ type: 'set_captions', color: 'red' }], /hex color/)
  fails([{ type: 'set_captions', font: 'Comic Sans MS' }], /font must be one of system-ui/)
  fails([{ type: 'cut', start: 0, end: 2 }, { type: 'remove_zoom', id: 'nope' }], /no zoom has the id “nope”/)
  fails([{ type: 'cut', start: 0, end: 5 }, { type: 'set_speed', start: 4, end: 6, speed: 2 }], /overlap \(4-5 s\)/)
  fails([{ type: 'cut', start: 31, end: 40 }], /past the end of the 30 s video/)
  fails([{ type: 'cut', start: 0, end: 40 }], /remove the whole video/)
  fails([{ type: 'set_caption_text', index: 2, text: 'x' }], /has 2 words, so there is no word 2/)
  fails([{ type: 'set_caption_text', index: 0, text: 'x' }], /no transcript/, null)
  fails([{ type: 'restore_cut', at: 3 }], /nothing is cut at 3 s\. Nothing is cut/)
  fails([{ type: 'cut_fillers', ranges: [[0, 1]] }], /no field “ranges”/)
  fails([{ type: 'match_captions', text: 'Hi', texts: [[0, 'Hi']] }], /no field “texts”/)
  fails([{ type: 'match_captions', text: ' ' }], /text must be the script/)
  fails([{ type: 'set_zoom', id: 'nope', end: 3 }], /no zoom has the id “nope”/)
  fails([{ type: 'set_zoom', id: 'nope' }], /at least one of start, end, level/)
})

test('a cut comes back, alone or beside other edits', () => {
  const p = project()
  apply(p, [{ type: 'cut', start: 4, end: 6 }, { type: 'cut', start: 10, end: 12 }])
  assert.deepEqual(ranges(p), [[0, 4, 1], [6, 10, 1], [12, 30, 1]])
  // Cuts now play at 4 s and 8 s. Restore the first, cut later in the same call: times as before the call.
  apply(p, [{ type: 'restore_cut', at: 4.1 }, { type: 'cut', start: 20, end: 22 }])
  assert.deepEqual(ranges(p), [[0, 10, 1], [12, 24, 1], [26, 30, 1]], 'the restored clips join; the later cut lands where it was asked')
  assert.throws(() => apply(p, [{ type: 'restore_cut', at: 10 }, { type: 'cut', start: 10, end: 11 }]), /both change the video at 10 s/)
  assert.throws(() => apply(p, [{ type: 'restore_cut', at: 6 }]), /nothing is cut at 6 s\. The video has cuts at 10 s, 22 s/)
})

test('filler and pause ranges cut like cuts, under their own index', () => {
  const p = project()
  applyEdits(p, [{ type: 'cut_fillers', ranges: [[1, 2], [5, 6]] }, { type: 'cut', start: 5.5, end: 7 }], {}, null)
  assert.deepEqual(ranges(p), [[0, 1, 1], [2, 5, 1], [7, 30, 1]])
  assert.throws(() => applyEdits(project(), [{ type: 'shorten_pauses' }], {}, null), /no ranges/)
  assert.throws(() => applyEdits(project(), [{ type: 'match_captions', text: 'Hi' }], {}, null), /no texts/)
  assert.throws(() => applyEdits(project(), [{ type: 'set_speed', start: 0, end: 3, speed: 2 }, { type: 'cut_fillers', ranges: [[2, 4]] }], {}, null), /edits\[0\] and edits\[1\] overlap/)
})

test('set_zoom moves a zoom on the timeline as it was, and keeps the rest of it', () => {
  const p = project()
  apply(p, [{ type: 'cut', start: 2, end: 4 }, { type: 'add_zoom', start: 5, end: 8, level: 3, x: 0.2, y: 0.3, look: 'loupe' }])
  const id = p.zooms[0].id
  assert.deepEqual([p.zooms[0].start, p.zooms[0].end], [5, 8], 'the list read 5-8 s before its cut')
  apply(p, [{ type: 'set_zoom', id, end: 9 }]) // now after the cut: 9 s plays the recording's 11 s
  assert.deepEqual([p.zooms[0].start, p.zooms[0].end, p.zooms[0].level, p.zooms[0].mode, p.zooms[0].size], [5, 11, 3, 'loupe', 200], 'end in output time; start, level, look kept')
  apply(p, [{ type: 'set_zoom', id, start: 1, level: 2, x: 0.5, y: 0.5 }])
  assert.deepEqual([p.zooms[0].start, p.zooms[0].end, p.zooms[0].level, p.zooms[0].target], [1, 11, 2, { kind: 'point', x: 0.5, y: 0.5 }])
  p.zooms[0].auto = true
  apply(p, [{ type: 'set_zoom', id, level: 4 }])
  assert.equal(p.zooms[0].auto, undefined, 'an auto zoom an agent changes is its own')
  assert.throws(() => apply(p, [{ type: 'set_zoom', id, start: 12 }]), /would end \(9 s\) before it starts \(12 s\)/)
})

test('a list sent as a JSON string, and optional fields sent as null, read as meant', () => {
  const edits = parseEdits(JSON.stringify([{ type: 'add_zoom', start: 1, end: 3, level: null, x: null, y: null, look: null }]))
  assert.deepEqual(edits, [{ type: 'add_zoom', start: 1, end: 3 }])
  assert.throws(() => parseEdits('cut 1 to 2'), /not a string/)
})
