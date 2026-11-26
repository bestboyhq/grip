import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject } from '../../shared/project.ts'
import { prepare, sceneAt } from '../scene.ts'
import { MODELS, upRegion } from './upscale.ts'

// An area recording of 1526 x 858 px exported at 1440p: shown past its density even at rest.
const scene = (w: number, h: number, out = 2560) => {
  const p = createProject('t', { duration: 10, screen: { file: 's.mp4', width: w, height: h, fps: 60, scale: 1 }, events: 'e.jsonl' })
  return sceneAt(prepare({ project: p, events: [], transcript: null, width: out, height: (out * 9) / 16 }), 1)
}

test('the networks have the layout upscale.wgsl reads', () => {
  for (const [scale, layers] of Object.entries(MODELS)) {
    assert.equal(layers[0]!.in, 1, 'the first layer reads luma')
    assert.equal(layers.at(-1)!.out, Number(scale) ** 2 / 4, 'the last writes one channel per redrawn px')
    for (const [i, l] of layers.entries()) {
      assert.ok(l.out <= 4 && l.in <= 4, 'GROUPS in upscale.wgsl')
      assert.equal(l.w.length, 9 * l.in * l.out * 16)
      assert.equal(l.b.length, l.out * 4)
      if (i > 0) assert.equal(l.in, layers[i - 1]!.out)
    }
  }
  assert.ok(MODELS[2] && MODELS[4])
})

test('a recording shown at or under its density is not redrawn', () => {
  assert.equal(upRegion(scene(2880, 1800, 1920), 2880, 1800), null)
  assert.equal(upRegion(scene(1526, 858, 1280), 1526, 858), null)
})

test('a low-density recording is redrawn where the frame shows it, denser the more it is magnified', () => {
  const s = scene(1526, 858)
  const whole = upRegion(s, 1526, 858)!
  assert.deepEqual([whole.x, whole.y, whole.w, whole.h, whole.scale], [0, 0, 1526, 858, 2])
  assert.deepEqual(whole.valid, [0, 0, 1526, 858], 'the recording edge repeats, as in training')

  s.view = { center: { x: s.width / 2, y: s.height / 2 }, scale: 2.5 } // a zoom at the center: m ~ 0.24
  const zoomed = upRegion(s, 1526, 858)!
  assert.equal(zoomed.scale, 4)
  assert.ok(zoomed.w < 1526 / 2 && zoomed.h < 858 / 2 && Math.abs(zoomed.x + zoomed.w / 2 - 763) < 2, 'only the part the zoom shows')
  assert.ok(zoomed.valid[0] > zoomed.x && zoomed.valid[2] < zoomed.x + zoomed.w, 'less what reads past its edge')
})

test('a lens over a dense recording redraws what it magnifies', () => {
  const s = scene(2880, 1800, 1920)
  s.loupes = [{ x: 500, y: 300, radius: 100, scale: 3, opacity: 1, lift: 0, stretch: { x: 0, y: 0 } }]
  const r = upRegion(s, 2880, 1800)!
  const k = 2880 / s.screen!.rect.w
  assert.ok(r && r.x <= (400 - s.screen!.rect.x) * k && r.x + r.w >= (600 - s.screen!.rect.x) * k && r.w < 2880 / 2)
})

test('a region too large to redraw at 4x falls back to 2x', () => {
  const s = scene(7680, 4320, 7680) // 8K shown at 8K, zoomed 3x: 2560 x 1440 px at m 0.33
  s.view = { center: { x: s.width / 2, y: s.height / 2 }, scale: 3 }
  assert.equal(upRegion(s, 7680, 4320)!.scale, 2)
})
