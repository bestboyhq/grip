import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject } from '../shared/project.ts'
import { timeMap } from '../shared/timemap.ts'
import type { InputEvent } from '../shared/events.ts'
import { prepare, preparePaths, sceneAt } from './scene.ts'
import { motionAt, prefetchCut, shutter, SHUTTER } from './compose.ts'

const clip = (start: number, end: number) => ({ id: `${start}`, start, end, speed: 1, volume: 1 })

test('shutter samples are centered on t and never cross a cut', () => {
  const m = timeMap([clip(0, 10), clip(20, 30)])
  const mid = shutter(m, 5)
  assert.ok(Math.abs(mid[0] - (5 - SHUTTER / 2)) < 1e-12 && Math.abs(mid.at(-1)! - (5 + SHUTTER / 2)) < 1e-12)
  const half = shutter(m, 5, 0.5)
  assert.ok(Math.abs(half.at(-1)! - half[0] - SHUTTER / 2) < 1e-12, 'the motion blur amount scales the shutter')
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
  p.style.motionBlur = 0
  assert.equal(at(7), undefined)
})

test('rendering in sequence decodes the clip after a cut ahead, on every source, from half a second before it', () => {
  const p = prepare({ project: { ...createProject('t', { duration: 30 }), clips: [clip(0, 10), clip(20, 30)] }, events: [], transcript: null, width: 640, height: 360 })
  const calls: Array<[string, number, number]> = []
  const source = (name: string) => ({ width: 1, height: 1, duration: 30, frameAt: async () => null, close() {}, prefetch: (t: number, now: number) => void calls.push([name, t, now]) })
  const media = { screen: source('screen'), camera: source('camera') }
  prefetchCut(p, media, 9)
  assert.deepEqual(calls, [], 'a second before the cut: nothing yet')
  prefetchCut(p, media, 9.6)
  assert.deepEqual(calls, [['screen', 20, 9.6], ['camera', 20, 9.6]], 'the next clip starts at source 20; playback is at source 9.6')
  calls.length = 0
  prefetchCut(p, media, 19.8)
  assert.deepEqual(calls, [], 'the last clip: no cut ahead')
})

test('preparePaths reuses what an edit left alone, and matches a fresh preparation', () => {
  const project = createProject('t', { duration: 20, screen: { file: 's.mp4', width: 2880, height: 1800, fps: 30, scale: 2 }, events: 'e.jsonl' })
  project.zooms = [{ id: 'z', start: 4, end: 9, level: 2, target: { kind: 'cursor' }, enabled: true }]
  const events: InputEvent[] = []
  for (let t = 0; t <= 20; t += 1 / 120) events.push({ t, type: 'move', x: 1400 + Math.sin(t) * 900, y: 900 + Math.cos(t / 2) * 600 })
  events.push({ t: 5, type: 'down', x: 600, y: 400, button: 'left' }, { t: 5.1, type: 'up', x: 600, y: 400, button: 'left' })
  const input = { project, events, transcript: null, width: 1920, height: 1200 }
  const a = preparePaths(input)

  project.style.background = { kind: 'color', color: '#123456' }
  project.style.cursor.size = 2
  const b = preparePaths(input)
  assert.ok(b.cursor === a.cursor && b.zoom === a.zoom, 'background and cursor size: both reused')

  project.zooms[0].level = 3
  const c = preparePaths(input)
  assert.ok(c.cursor === a.cursor && c.zoom !== a.zoom, 'a zoom edit: the cursor path is reused, the camera is not')

  project.style.padding = 120
  const d = preparePaths(input)
  assert.ok(d.cursor === a.cursor && d.zoom !== c.zoom, 'padding moves the screen: the camera follows')

  // With a corner camera the view keeps the cursor out from under it: moving the camera moves the view.
  project.sources.camera = { file: 'c.mp4', width: 1280, height: 720, fps: 30, scale: 1 }
  const withCam = preparePaths(input)
  project.style.camera.position = 'top-left'
  const moved = preparePaths(input)
  assert.ok(moved.zoom !== withCam.zoom, 'a camera corner change: the camera path is recomputed')
  delete project.sources.camera
  project.style.camera.position = 'bottom-right'

  project.clips = [clip(0, 8), clip(11, 20)]
  const e = preparePaths(input)
  assert.ok(e.cursor !== a.cursor && e.zoom !== d.zoom, 'a cut: both again')

  const fresh = preparePaths({ ...input, events: [...events] }) // other events: nothing to reuse
  assert.deepEqual([e.cursor.x, e.cursor.y, e.zoom.data], [fresh.cursor.x, fresh.cursor.y, fresh.zoom.data], 'reused paths equal a cold preparation')
  // The preview hands the worker's paths to prepare(); export lets it compute them: the same frames.
  const viaPaths = prepare(input, e)
  const inline = prepare({ ...input, events: [...events] })
  for (let t = 0; t < 17; t += 0.37) assert.deepEqual(sceneAt(viaPaths, t), sceneAt(inline, t))
})
