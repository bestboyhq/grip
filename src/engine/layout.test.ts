import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject, type Project, type Rect } from '../shared/project.ts'
import { timeMap } from '../shared/timemap.ts'
import { prepareLayout, layoutAt, fitScreen, deviceGeometry, deviceBounds, cameraCrop, faceAt, silentRanges, voiceRanges } from './layout.ts'

const W = 1920, H = 1080
const project = (edit: (p: Project) => void = () => {}) => {
  const p = createProject('t', {
    duration: 30,
    screen: { file: 's.mp4', width: 2880, height: 1800, fps: 30, scale: 2 },
    camera: { file: 'c.mp4', width: 1280, height: 720, fps: 30, scale: 1 },
  })
  edit(p)
  return p
}
const at = (p: Project, t: number, w = W, h = H, faces?: Parameters<typeof prepareLayout>[0]['faces']) =>
  layoutAt(prepareLayout({ project: p, events: [], transcript: null, width: w, height: h, faces }, timeMap(p.clips), Math.min(w, h) / 1080), t)
const inside = (r: Rect, w: number, h: number) => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= w + 1e-6 && r.y + r.h <= h + 1e-6
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6
const close = (a: Rect, b: Rect, eps = 1e-6) => assert.ok(['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k as keyof Rect] - b[k as keyof Rect]) < eps), `${JSON.stringify(a)} != ${JSON.stringify(b)}`)

test('screen fits the padded frame, centered, aspect kept, with or without a device', () => {
  for (const device of ['none', 'macbook', 'iphone', 'ipad'] as const) {
    const box = { x: 80, y: 80, w: 1760, h: 920 }
    const s = fitScreen(box, 2880, 1800, device)
    assert.ok(Math.abs(s.w / s.h - 1.6) < 1e-9)
    const b = deviceBounds(device, s)
    assert.ok(b.x >= box.x - 1e-6 && b.y >= box.y - 1e-6 && b.x + b.w <= box.x + box.w + 1e-6 && b.y + b.h <= box.y + box.h + 1e-6, device)
    assert.ok(Math.abs(b.x - box.x - (box.x + box.w - b.x - b.w)) < 1e-6 || Math.abs(b.y - box.y - (box.y + box.h - b.y - b.h)) < 1e-6, `${device} centered`)
  }
})

test('inset: the recording keeps its aspect inside a frame grown by the inset, which fits the padding', () => {
  for (const device of ['none', 'macbook', 'iphone'] as const) {
    const box = { x: 80, y: 80, w: 1760, h: 920 }
    const s = fitScreen(box, 2880, 1800, device, 40)
    assert.ok(Math.abs(s.w / s.h - 1.6) < 1e-9, device)
    const b = deviceBounds(device, { x: s.x - 40, y: s.y - 40, w: s.w + 80, h: s.h + 80 })
    assert.ok(b.x >= box.x - 1e-6 && b.y >= box.y - 1e-6 && b.x + b.w <= box.x + box.w + 1e-6 && b.y + b.h <= box.y + box.h + 1e-6, device)
    assert.ok(Math.max(b.w - box.w, b.h - box.h) > -1e-3, `${device}: as large as fits`)
  }
  const l = at(project((p) => Object.assign(p.style, { inset: 30, radius: 40 })), 1)
  assert.equal(l.screen!.inset, 30)
  assert.ok(Math.abs(l.screen!.rect.y - 30 - 80) < 1e-6, 'frame touches the padding')
  assert.equal(l.screen!.radius, 40)
})

test('device mockups follow orientation: Dynamic Island on top in portrait, on the left in landscape', () => {
  const island = (s: Rect) => deviceGeometry('iphone', s)!.parts.find((p) => p.over)!.rect
  const portrait = { x: 0, y: 0, w: 390, h: 844 }
  const i = island(portrait)
  assert.ok(Math.abs(i.x + i.w / 2 - 195) < 1e-6 && i.y < 50 && i.w > i.h)
  const j = island({ x: 0, y: 0, w: 844, h: 390 })
  assert.ok(Math.abs(j.y + j.h / 2 - 195) < 1e-6 && j.x < 50 && j.h > j.w)
  const mac = deviceGeometry('macbook', { x: 0, y: 0, w: 1600, h: 1000 })!
  assert.ok(mac.parts.some((p) => p.rect.y >= 1000 && p.rect.w > 1600), 'laptop base below and wider than the lid')
  assert.equal(deviceGeometry('none', portrait), null)
})

test('camera layouts: pip in the corner, split side by side or stacked, fullscreen, hidden', () => {
  const pip = at(project(), 1)
  assert.ok(pip.camera && inside(pip.camera.rect, W, H) && pip.camera.rect.x > W / 2 && pip.camera.rect.y > H / 2)
  const split = at(project((p) => (p.layouts = [{ id: 'a', start: 0, end: 30, kind: 'split' }])), 1)
  assert.ok(split.camera && split.screen && !overlap(split.camera.rect, split.screen.rect) && inside(split.camera.rect, W, H) && inside(split.screen.rect, W, H))
  assert.ok(split.camera.rect.x > split.screen.rect.x, 'camera on the right for a right-side position')
  const stacked = at(project((p) => (p.layouts = [{ id: 'a', start: 0, end: 30, kind: 'split' }])), 1, 1080, 1920)
  assert.ok(stacked.camera && stacked.screen && stacked.camera.rect.y > stacked.screen.rect.y + stacked.screen.rect.h - 1e-6, 'stacked under the screen')
  const full = at(project((p) => (p.layouts = [{ id: 'a', start: 0, end: 30, kind: 'fullscreen' }])), 1)
  close(full.camera!.rect, { x: 0, y: 0, w: W, h: H })
  assert.equal(at(project((p) => (p.layouts = [{ id: 'a', start: 0, end: 30, kind: 'hidden' }])), 1).camera, null)
  const off = at(project((p) => ((p.layouts = [{ id: 'a', start: 0, end: 30, kind: 'split' }]), (p.style.camera.visible = false))), 1)
  assert.equal(off.camera, null)
  close(off.screen!.rect, pip.screen!.rect) // a split with the camera off keeps the whole frame for the screen
  const circle = at(project((p) => Object.assign(p.style.camera, { shape: 'circle', aspect: 1.5 })), 1).camera!
  assert.equal(circle.radius, Math.min(circle.rect.w, circle.rect.h) / 2, 'non-square circle is a capsule')
})

test('a corner camera steps back toward its corner while zoomed in; split and fullscreen keep their size', () => {
  const prep = (p: Project) => prepareLayout({ project: p, events: [], transcript: null, width: W, height: H }, timeMap(p.clips), H / 1080)
  const pip = prep(project())
  const rest = layoutAt(pip, 1).camera!.rect
  const zoomed = layoutAt(pip, 1, 1).camera!.rect
  assert.ok(Math.abs(zoomed.w - rest.w * 0.7) < 1e-6 && Math.abs(zoomed.h - rest.h * 0.7) < 1e-6)
  assert.ok(Math.abs(zoomed.x + zoomed.w - (rest.x + rest.w)) < 1e-6 && Math.abs(zoomed.y + zoomed.h - (rest.y + rest.h)) < 1e-6, 'anchored at the bottom-right corner')
  const half = layoutAt(pip, 1, 0.5).camera!.rect
  assert.ok(half.w < rest.w && half.w > zoomed.w, 'in between while the zoom animates')
  const tl = prep(project((p) => (p.style.camera.position = 'top-left')))
  const a = layoutAt(tl, 1).camera!.rect, b = layoutAt(tl, 1, 1).camera!.rect
  assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6, 'anchored at the top-left corner')
  for (const kind of ['split', 'fullscreen'] as const) {
    const l = prep(project((p) => (p.layouts = [{ id: 'a', start: 0, end: 30, kind }])))
    close(layoutAt(l, 5, 1).camera!.rect, layoutAt(l, 5).camera!.rect)
  }
})

test('layout changes animate in output time, and an interrupted transition blends without a jump', () => {
  const p = project((p) => (p.layouts = [{ id: 'a', start: 5, end: 30, kind: 'fullscreen' }]))
  const before = at(p, 4.99).camera!.rect
  const settled = at(p, 7).camera!.rect
  close(settled, { x: 0, y: 0, w: W, h: H })
  const mid = at(p, 5.15).camera!.rect
  assert.ok(mid.w > before.w + 1 && mid.w < W - 1, 'mid transition is in between')
  // Continuity at the change and through the whole animation.
  for (let t = 4.9; t < 6; t += 0.01) {
    const a = at(p, t).camera!.rect, b = at(p, t + 0.001).camera!.rect
    assert.ok(Math.abs(a.w - b.w) < 15 && Math.abs(a.x - b.x) < 15, `jump at ${t}`)
  }
  // Interrupted: fullscreen for 0.1 s then back to pip. The return starts from where it got to.
  const q = project((p) => (p.layouts = [{ id: 'a', start: 5, end: 5.1, kind: 'fullscreen' }]))
  const reached = at(q, 5.0999).camera!.rect
  close(at(q, 5.1).camera!.rect, reached, 2)
  close(at(q, 8).camera!.rect, before)
})

test('the camera hides and comes back in place: a fullscreen camera fades where it is, not toward the corner', () => {
  const p = project((p) => (p.layouts = [{ id: 'a', start: 0, end: 5, kind: 'fullscreen' }, { id: 'b', start: 5, end: 10, kind: 'hidden' }, { id: 'c', start: 10, end: 15, kind: 'fullscreen' }]))
  const center = (r: Rect) => [r.x + r.w / 2, r.y + r.h / 2]
  for (const t of [5.05, 5.15, 10.05, 10.15]) {
    const cam = at(p, t).camera!
    assert.ok(cam.opacity > 0 && cam.opacity < 1, `fading at ${t}`)
    const [x, y] = center(cam.rect)
    assert.ok(Math.abs(x - W / 2) < 1e-6 && Math.abs(y - H / 2) < 1e-6, `stays centered at ${t}`)
  }
  close(at(p, 12).camera!.rect, { x: 0, y: 0, w: W, h: H })
  const q = project((p) => (p.layouts = [{ id: 'b', start: 5, end: 10, kind: 'hidden' }]))
  const pip = at(q, 1).camera!.rect
  const [px, py] = center(pip), [hx, hy] = center(at(q, 5.1).camera!.rect)
  assert.ok(Math.abs(px - hx) < 1e-6 && Math.abs(py - hy) < 1e-6, 'a corner camera shrinks around its center')
})

test('a layout item across a cut keeps its state; one starting after a cut is timed in output time', () => {
  // Cut source 10-20. The item spans the cut: no transition at the seam.
  const p = project((p) => {
    p.clips = [{ id: 'a', start: 0, end: 10, speed: 1, volume: 1 }, { id: 'b', start: 20, end: 30, speed: 1, volume: 1 }]
    p.layouts = [{ id: 'l', start: 5, end: 25, kind: 'fullscreen' }]
  })
  close(at(p, 9.99).camera!.rect, at(p, 10.05).camera!.rect, 1e-6)
  // Item at source 22-30 starts at output 12 after the cut.
  const q = project((p) => {
    p.clips = [{ id: 'a', start: 0, end: 10, speed: 1, volume: 1 }, { id: 'b', start: 20, end: 30, speed: 1, volume: 1 }]
    p.layouts = [{ id: 'l', start: 22, end: 30, kind: 'fullscreen' }]
  })
  close(at(q, 11.99).camera!.rect, at(q, 1).camera!.rect)
  close(at(q, 14).camera!.rect, { x: 0, y: 0, w: W, h: H })
})

test('masks are locked to the screen and fade outside their range, never inside it', () => {
  const p = project((p) => (p.masks = [{ id: 'm', start: 5, end: 8, kind: 'blur', rect: { x: 0.25, y: 0.5, w: 0.5, h: 0.25 } }]))
  const l = at(p, 5)
  assert.equal(l.masks[0].opacity, 1)
  const s = l.screen!.rect
  close(l.masks[0].rect, { x: s.x + 0.25 * s.w, y: s.y + 0.5 * s.h, w: 0.5 * s.w, h: 0.25 * s.h })
  assert.ok(at(p, 4.9).masks[0].opacity > 0 && at(p, 4.9).masks[0].opacity < 1)
  assert.equal(at(p, 4).masks.length, 0)
  assert.equal(at(p, 8).masks[0].opacity, 1)
})

test('camera crop keeps the tile aspect, stays inside the frame, and centers the face', () => {
  const rect = { x: 0, y: 0, w: 300, h: 300 }
  const c = cameraCrop(rect, 1280, 720, null)
  assert.ok(Math.abs((c.w * 1280) / (c.h * 720) - 1) < 1e-9 && Math.abs(c.x - (1 - c.w) / 2) < 1e-9)
  const f = cameraCrop(rect, 1280, 720, { x: 0.6, y: 0.3, w: 0.1, h: 0.18 })
  assert.ok(Math.abs((f.w * 1280) / (f.h * 720) - 1) < 1e-9 && f.h < 1, 'zoomed in on the face, aspect kept')
  assert.ok(Math.abs(f.x + f.w / 2 - 0.65) < 1e-9, 'face centered horizontally')
  const edge = cameraCrop(rect, 1280, 720, { x: 0.95, y: 0.0, w: 0.05, h: 0.1 })
  assert.ok(edge.x >= 0 && edge.y >= 0 && edge.x + edge.w <= 1 + 1e-9 && edge.y + edge.h <= 1 + 1e-9, 'clamped inside')
})

test('face track is smoothed and holds through detection gaps', () => {
  const faces = Array.from({ length: 60 }, (_, i) => ({ t: i / 15, x: 0.4 + (i % 2 ? 0.02 : -0.02), y: 0.3, w: 0.2, h: 0.3 }))
  const f = faceAt(faces, 2)!
  assert.ok(Math.abs(f.x - 0.4) < 0.005, 'jitter averaged out')
  assert.ok(Math.abs(faceAt(faces, 30)!.x - faces[59].x) < 1e-9, 'holds the last face')
  const follow = at(project((p) => (p.style.camera.followFace = true)), 2, W, H, faces)
  assert.ok(follow.camera!.crop.h < 1, 'face follow crops in')
})

test('hide when silent: speech keeps the camera, long silences hide it', () => {
  const m = timeMap([{ id: 'a', start: 0, end: 30, speed: 1, volume: 1 }])
  const words = [{ start: 1, end: 2, text: 'hi' }, { start: 2.2, end: 3, text: 'there' }, { start: 12, end: 13, text: 'bye' }]
  assert.deepEqual(silentRanges(words, m).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), [[3.8, 11.4], [13.8, 30]])
  const p = project((p) => (p.style.camera.hideWhenSilent = true))
  const l = (t: number) => layoutAt(prepareLayout({ project: p, events: [], transcript: { language: 'en', words }, width: W, height: H }, m, 1), t)
  assert.ok(l(2).camera && l(2).camera!.opacity === 1)
  assert.equal(l(8).camera, null)
})

test('hide when silent without a transcript: speech comes from the mic levels, clicks and room tone do not count', () => {
  const d = 30
  const n = d * 20
  const level = (t: number) => (t >= 1 && t < 3) || (t >= 12 && t < 13) ? 0.3 : Math.abs(t - 7) < 0.03 ? 0.6 : 0.003 // speech, a key click, room tone
  const peaks = new Float32Array(2 * n)
  for (let i = 0; i < n; i++) peaks.set([-level((i + 0.5) / 20), level((i + 0.5) / 20) * 0.9], 2 * i)
  const speech = voiceRanges(peaks, d)
  assert.deepEqual(speech.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), [[1, 3], [12, 13]])
  assert.deepEqual(voiceRanges(new Float32Array(2 * n).fill(0.002), d), [], 'room tone only: no speech')
  assert.deepEqual(voiceRanges(new Float32Array(2 * n).fill(0.3), d), [[0, d]], 'talking throughout')
  const m = timeMap([{ id: 'a', start: 0, end: d, speed: 1, volume: 1 }])
  const p = project((p) => (p.style.camera.hideWhenSilent = true))
  const l = (t: number) => layoutAt(prepareLayout({ project: p, events: [], transcript: null, speech, width: W, height: H }, m, 1), t)
  assert.ok(l(2).camera && l(2).camera!.opacity === 1)
  assert.equal(l(8).camera, null)
})
