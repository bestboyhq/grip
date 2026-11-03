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
  fails([{ type: 'trim', start: 0, end: 1 }], /type must be one of cut, set_speed/)
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
})
