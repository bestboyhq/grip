import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject, defaultStyle, PROJECT_VERSION } from './project.ts'
import { migrate, normalizeStyle, validateProject } from './migrate.ts'

const project = () =>
  createProject('Demo #1 ✨ café', {
    duration: 24,
    screen: { file: 'sources/screen.mp4', width: 2880, height: 1800, fps: 30, scale: 2 },
    mic: { file: 'sources/mic.m4a', channels: 1, sampleRate: 48000 },
    events: 'sources/events.jsonl',
  })
const roundTrip = (x: unknown) => JSON.parse(JSON.stringify(x))

test('a current project passes through unchanged', () => {
  const p = project()
  assert.deepEqual(migrate(roundTrip(p)), p)
})

test('older versions step through every migration in order', () => {
  const v1 = { ...roundTrip(project()), version: 1, title: 'Old', clips: undefined, cuts: [{ id: 'a', from: 0, to: 5 }] }
  const steps = {
    1: (p: any) => ({ ...p, name: p.title }), // v1 -> v2: title renamed to name
    2: (p: any) => ({ ...p, clips: p.cuts.map((c: any) => ({ id: c.id, start: c.from, end: c.to, speed: 1, volume: 1 })) }), // v2 -> v3
  }
  const p = migrate(v1, steps, 3)
  assert.equal(p.version, 3)
  assert.equal(p.name, 'Old')
  assert.deepEqual(p.clips, [{ id: 'a', start: 0, end: 5, speed: 1, volume: 1 }])
  assert.throws(() => migrate({ ...roundTrip(project()), version: 1 }, {}, 2), /can't upgrade projects from format 1/)
})

test('a newer project is refused with a clear message', () => {
  const p = { ...roundTrip(project()), version: PROJECT_VERSION + 1 }
  assert.throws(() => migrate(p), (e: any) => e.code === 'ENEWER' && /“Demo #1 ✨ café” was saved by a newer version of Grip\. Update Grip/.test(e.message))
})

test('fields added since the project was saved get their defaults; unknown fields survive', () => {
  const p = roundTrip(project())
  delete p.style.cursor.clickSound
  delete p.style.captions
  delete p.audio.system
  delete p.masks
  delete p.autoZoomed
  p.style.background = { kind: 'color', color: '#123456' }
  p.futureField = { keep: true }
  const m = migrate(p) as any
  assert.equal(m.style.cursor.clickSound, defaultStyle().cursor.clickSound)
  assert.deepEqual(m.style.captions, defaultStyle().captions)
  assert.deepEqual(m.audio.system, { volume: 1, muted: false })
  assert.deepEqual(m.masks, [])
  assert.equal(m.autoZoomed, false, 'an older project gets its auto zooms on the next open')
  assert.deepEqual(m.style.background, { kind: 'color', color: '#123456' }) // unions are not merged
  assert.deepEqual(m.futureField, { keep: true })
})

test('malformed projects are rejected', () => {
  const bad: Array<[string, (p: any) => void]> = [
    ['not a Grip project', (p) => delete p.version],
    ['clips[0]', (p) => (p.clips[0].speed = 0)],
    ['clips[0]', (p) => (p.clips[0].end = p.clips[0].start)],
    ['sources.screen', (p) => (p.sources.screen.file = '../../../etc/passwd')],
    ['sources.screen', (p) => (p.sources.screen.file = '/etc/passwd')],
    ['sources.duration', (p) => (p.sources.duration = -1)],
    ['zooms[0]', (p) => p.zooms.push({ id: 'z', start: 1, end: 2, level: 2, target: { kind: 'point' }, enabled: true })],
    ['style.padding', (p) => (p.style.padding = '80')],
    ['style.background', (p) => (p.style.background = { kind: 'image', file: '../x.jpg' })],
    ['style.aspect', (p) => (p.style.aspect = 'wide')],
    ['captionEdits', (p) => (p.captionEdits = { 3: 7 })],
    ['playhead', (p) => (p.playhead = null)],
  ]
  for (const [what, breakIt] of bad) {
    const p = roundTrip(project())
    breakIt(p)
    assert.throws(() => migrate(p), (e: Error) => e.message.includes(what), what)
  }
  assert.throws(() => migrate(null), /not a Grip project/)
  assert.throws(() => validateProject({ ...project(), playhead: NaN }), /playhead/)
  const sources = roundTrip(project())
  delete sources.sources
  assert.throws(() => migrate(sources), /sources/)
})

test('styles from presets are completed and checked', () => {
  const s = normalizeStyle({ padding: 10, camera: { size: 200 } })
  assert.equal(s.padding, 10)
  assert.equal(s.camera.size, 200)
  assert.equal(s.camera.shape, defaultStyle().camera.shape)
  assert.deepEqual(s.background, defaultStyle().background)
  assert.throws(() => normalizeStyle({ camera: { lut: '/etc/passwd' } }), /style\.camera\.lut/)
  assert.throws(() => normalizeStyle('x'), /style/)
})

test('v1 motion switches become v2 presets, in projects and presets', () => {
  for (const [smooth, blur, animation, amount] of [[true, true, 'smooth', 1], [false, false, 'none', 0]] as const) {
    const v1 = roundTrip(project())
    v1.version = 1
    delete v1.style.cursor.animation
    delete v1.style.screenAnimation
    v1.style.cursor.smooth = smooth
    v1.style.motionBlur = blur
    const p = migrate(roundTrip(v1))
    assert.equal(p.style.cursor.animation, animation)
    assert.equal(p.style.motionBlur, amount)
    assert.equal(p.style.screenAnimation, 'focused')
    assert.ok(!('smooth' in p.style.cursor))
    assert.deepEqual(normalizeStyle(roundTrip(v1.style)), p.style)
  }
})
