import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cornerAt, formatTime, outputPoint, reason, resumeAt, screenPoint } from './helpers.ts'
import type { Clip } from '../../shared/project.ts'
import type { Scene } from '../../engine/scene.ts'

const clip = (start: number, end: number, speed = 1): Clip => ({ id: `${start}`, start, end, speed, volume: 1 })

test('resumeAt maps the saved source playhead through cuts and speed, and snaps out of cut ranges', () => {
  const clips = [clip(0, 4), clip(10, 20, 2)] // 4..10 is cut; second clip plays at 2x
  assert.equal(resumeAt(clips, 2), 2)
  assert.equal(resumeAt(clips, 12), 4 + 1)
  assert.equal(resumeAt(clips, 5), 4) // cut: end of the first clip is nearest
  assert.equal(resumeAt(clips, 9.5), 4) // cut: start of the second clip is nearest
  assert.equal(resumeAt(clips, 99), 9) // past the end: the last frame
})

test('screenPoint inverts the zoom view, outputPoint is its inverse', () => {
  const scene = {
    width: 1920,
    height: 1080,
    view: { center: { x: 600, y: 400 }, scale: 2 },
    screen: { rect: { x: 160, y: 90, w: 1600, h: 900 } },
  } as unknown as Scene
  const p = screenPoint(scene, 960, 540)! // frame center shows the view center
  assert.deepEqual(p, { x: (600 - 160) / 1600, y: (400 - 90) / 900 })
  const back = outputPoint(scene, p.x, p.y)!
  assert.ok(Math.abs(back.x - 960) < 1e-9 && Math.abs(back.y - 540) < 1e-9)
  assert.deepEqual(screenPoint(scene, -5000, 5000), { x: 0, y: 1 }) // clamped to the screen
  assert.equal(screenPoint({ ...scene, screen: null }, 0, 0), null)
})

test('cornerAt picks the quadrant', () => {
  assert.equal(cornerAt(10, 10, 100, 100), 'top-left')
  assert.equal(cornerAt(90, 10, 100, 100), 'top-right')
  assert.equal(cornerAt(10, 90, 100, 100), 'bottom-left')
  assert.equal(cornerAt(90, 90, 100, 100), 'bottom-right')
})

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00.00')
  assert.equal(formatTime(5.58), '0:05.58')
  assert.equal(formatTime(723.1), '12:03.10')
  assert.equal(formatTime(3723.456), '1:02:03.45')
  assert.equal(formatTime(-1), '0:00.00')
  // One formatter for clock, ruler, and clip labels: the same moment reads the same everywhere.
  assert.equal(formatTime(11.365384615384615), '0:11.36')
  assert.equal(formatTime(11.37), '0:11.37') // float noise never shows the previous hundredth
  assert.equal(formatTime(11.96, 0), '0:11')
  assert.equal(formatTime(0.1 * 29, 1), '0:02.9')
  assert.equal(formatTime(65.5, 1), '1:05.5')
  assert.equal(formatTime(300, 0, true), '0:05:00')
})

test('reason strips the IPC wrapper', () => {
  assert.equal(reason(new Error("Error invoking remote method 'editor:importAsset': Error: The disk is full.")), 'The disk is full.')
  assert.equal(reason('plain'), 'plain')
  assert.match(reason(new Error("Error invoking remote method 'projects:open': Error: ENOENT: no such file or directory, open '/x/project.json'")), /moved, renamed, or deleted/)
})
