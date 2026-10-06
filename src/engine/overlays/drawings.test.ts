import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEvents, type InputEvent } from '../../shared/events.ts'
import { createProject } from '../../shared/project.ts'
import { removeSourceRange } from '../../shared/timemap.ts'
import { prepare, sceneAt } from '../scene.ts'
import { DRAW_FADE, DRAW_HOLD, strokesFromEvents, visibleStrokes } from './drawings.ts'

const draw = (t: number, phase: 'start' | 'move' | 'end', x: number, y: number, more = {}): InputEvent => ({ t, type: 'draw', phase, x, y, ...more })
const EVENTS: InputEvent[] = [
  draw(1, 'start', 10, 10, { color: '#00ff00', width: 12 }), draw(1.5, 'move', 20, 20), draw(2, 'end', 30, 30),
  draw(4, 'start', 50, 50), draw(4.5, 'end', 60, 60), // 2 s after the first: same group
  draw(10, 'start', 70, 70), draw(10.4, 'move', 80, 80), // a new group, torn: no end
]

test('strokes: defaults, torn stroke ends at its last point', () => {
  const s = strokesFromEvents(EVENTS)
  assert.deepEqual(s.map((x) => [x.start, x.end, x.color, x.width, x.points.length]), [
    [1, 2, '#00ff00', 12, 3],
    [4, 4.5, '#ff3b30', 8, 2],
    [10, 10.4, '#ff3b30', 8, 2],
  ])
})

test('visibleStrokes: grows as drawn, a group holds then fades together', () => {
  const s = strokesFromEvents(EVENTS)
  const at = (t: number) => visibleStrokes(s, t)
  assert.deepEqual(at(0.5), [])
  assert.deepEqual(at(1.5).map((d) => d.points), [[{ t: 1, x: 10, y: 10 }, { t: 1.5, x: 20, y: 20 }]]) // only what was drawn by t
  assert.deepEqual(at(6).map((d) => d.opacity), [1, 1]) // the first stroke is held by the second
  const mid = at(4.5 + DRAW_HOLD + DRAW_FADE / 2)
  assert.equal(mid.length, 2)
  for (const d of mid) assert.ok(Math.abs(d.opacity - 0.5) < 1e-9)
  assert.deepEqual(at(4.5 + DRAW_HOLD + DRAW_FADE + 1e-6), [])
  assert.deepEqual(at(10.2).map((d) => d.points.length), [1]) // the torn stroke draws
  assert.equal(at(10.4 + DRAW_HOLD).length, 1)
  assert.deepEqual(at(10.4 + DRAW_HOLD + DRAW_FADE + 1e-6), [])
})

test('parseEvents: the pen down/up of a stroke is no click, other clicks stay', () => {
  const jsonl = [
    { t: 0.5, type: 'down', x: 5, y: 5, button: 'left' }, { t: 0.6, type: 'up', x: 5, y: 5, button: 'left' },
    { t: 2.98, type: 'down', x: 100, y: 100, button: 'left' }, // the pen goes down just before the stroke starts
    draw(3, 'start', 100, 100), { t: 3.2, type: 'move', x: 110, y: 110 }, draw(3.2, 'move', 110, 110), draw(3.5, 'end', 120, 120),
    { t: 3.52, type: 'up', x: 120, y: 120, button: 'left' },
    { t: 5, type: 'down', x: 9, y: 9, button: 'left' }, { t: 5.1, type: 'up', x: 9, y: 9, button: 'left' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n{"t": 6, "ty'
  const events = parseEvents(jsonl)
  assert.deepEqual(events.filter((e) => e.type === 'down' || e.type === 'up').map((e) => e.t), [0.5, 0.6, 5, 5.1])
  assert.equal(events.filter((e) => e.type === 'move').length, 1)
  assert.equal(events.filter((e) => e.type === 'draw').length, 3)
})

test('drawings in a scene: through cuts, locked to the screen, off when hidden', () => {
  const project = createProject('Demo #1 ✨ café', { duration: 30, screen: { file: 'sources/screen.mp4', width: 2880, height: 1800, fps: 30, scale: 2 } })
  project.clips = removeSourceRange(removeSourceRange(project.clips, 1.4, 1.6), 9, 12) // the first stroke's middle; all of the torn one
  const input = { project, events: EVENTS, transcript: null, width: 1920, height: 1080 }
  const scene = (t: number) => sceneAt(prepare(input), t)
  const s = scene(5) // source 5.2
  const [a, b] = s.drawings
  assert.equal(s.drawings.length, 2)
  assert.equal(a.points.length, 2) // the point inside the cut is gone
  assert.ok(Math.abs((a.points[1].x - a.points[0].x) / a.width - 20 / 12) < 1e-9) // width scales with the content
  const r = s.screen!.rect
  for (const p of [...a.points, ...b.points]) assert.ok(p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h)
  assert.deepEqual(scene(12.5 - 3.2).drawings, []) // the stroke inside the cut never shows
  project.style.drawings.visible = false
  assert.deepEqual(scene(5).drawings, [])
})
