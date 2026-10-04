import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject, type Clip, type Transcript } from '../../shared/project.ts'
import type { InputEvent, Modifier } from '../../shared/events.ts'
import { mapRange, removeSourceRange, setSpeed, timeMap } from '../../shared/timemap.ts'
import { prepare, sceneAt, type SceneInput } from '../scene.ts'
import { breakLines, captionAt, classifyKey, clicksAt, keystrokesAt, maxLineChars } from './index.ts'

const key = (t: number, k: string, mods: Modifier[] = [], hold = 0.08): InputEvent[] => [
  { t, type: 'key', down: true, key: k, code: 0, mods },
  { t: t + hold, type: 'key', down: false, key: k, code: 0, mods },
]
const click = (t: number, x: number, y: number): InputEvent => ({ t, type: 'down', x, y, button: 'left' })

const SPEECH = 'Hi! Um, so today I want to show you how to create a new project. First you click on the project name field and type a name. Then you hit create, and that is basically it.'
function transcript(): Transcript {
  return { language: 'en', words: SPEECH.split(' ').map((text, i) => ({ start: 0.5 + i * 0.3, end: 0.5 + i * 0.3 + 0.24, text, filler: text === 'Um,' })) }
}

function input(clips?: Clip[], width = 1920, height = 1080, events: InputEvent[] = [], aspect: '16:9' | '9:16' = '16:9'): SceneInput {
  const project = createProject('Demo #1 ✨ café', { duration: 30, screen: { file: 'sources/screen.mp4', width: 2880, height: 1800, fps: 30, scale: 2 } })
  if (clips) project.clips = clips
  project.style.aspect = aspect
  project.style.captions.visible = true
  project.style.captions.mode = 'word'
  return { project, events, transcript: transcript(), width, height }
}

test('classifyKey: shortcuts in macOS order, typing hidden, fn only when meant', () => {
  assert.deepEqual(classifyKey('p', ['⌘', '⇧']), { keys: ['⇧', '⌘', 'P'], bare: false })
  assert.deepEqual(classifyKey('k', ['⌘', '⌥', '⇧', '⌃']), { keys: ['⌃', '⌥', '⇧', '⌘', 'K'], bare: false })
  assert.equal(classifyKey('L', ['⇧']), 'typing')
  assert.equal(classifyKey('ą', ['⌥']), 'typing') // Polish ⌥a
  assert.equal(classifyKey('Space', []), 'typing')
  assert.deepEqual(classifyKey('Space', ['⌘']), { keys: ['⌘', 'Space'], bare: false })
  assert.deepEqual(classifyKey('Return', []), { keys: ['↩'], bare: true })
  assert.deepEqual(classifyKey('↓', ['fn']), { keys: ['↓'], bare: true }) // macOS flags arrows with fn
  assert.deepEqual(classifyKey('F5', ['fn']), { keys: ['F5'], bare: true })
  assert.deepEqual(classifyKey('e', ['fn']), { keys: ['fn', 'E'], bare: false })
  assert.deepEqual(classifyKey('1', ['⌘']), { keys: ['⌘', '1'], bare: false })
  assert.equal(classifyKey('⌘', ['⌘']), null) // a modifier on its own
  assert.equal(classifyKey('', ['⌘']), null) // unmapped key on a non-Latin layout
})

test('keystrokes: grouping, repeats, typing, secure input, cuts, stacking', () => {
  const events: InputEvent[] = [
    // typing with a ↩ inside: nothing shows
    ...[...'hello'].flatMap((c, i) => key(1 + i * 0.1, c)),
    ...key(1.5, '↩'),
    // ⌘Z three times: one group, ×3
    ...key(4, 'z', ['⌘']), ...key(4.4, 'z', ['⌘']), ...key(4.8, 'z', ['⌘']),
    // ↓ held for 2 s with key repeat: one group, count 1, visible until release + linger
    { t: 8, type: 'key', down: true, key: '↓', code: 0, mods: ['fn'] },
    ...Array.from({ length: 50 }, (_, i): InputEvent => ({ t: 8.5 + i * 0.03, type: 'key', down: true, key: '↓', code: 0, mods: ['fn'] })),
    { t: 10, type: 'key', down: false, key: '↓', code: 0, mods: ['fn'] },
    // password field
    { t: 13, type: 'secure', on: true }, ...key(13.5, 'v', ['⌘']), { t: 14, type: 'secure', on: false },
    // isolated ⎋
    ...key(16, 'Escape'),
    // inside a cut (20-22)
    ...key(21, 's', ['⌘']),
    // a key-up lost (pause, torn file): the next press still shows
    { t: 26.5, type: 'key', down: true, key: 's', code: 0, mods: ['⌘'] }, ...key(29, 's', ['⌘']),
    // four quick shortcuts: stack of at most three
    ...key(24, 'a', ['⌘']), ...key(24.3, 'c', ['⌘']), ...key(24.6, 'v', ['⌘']), ...key(24.9, 'n', ['⌘']),
  ]
  events.sort((a, b) => a.t - b.t)
  const p = prepare(input([{ id: 'a', start: 0, end: 20, speed: 1, volume: 1 }, { id: 'b', start: 22, end: 30, speed: 1, volume: 1 }], 1920, 1080, events))
  const at = (t: number) => keystrokesAt(p.overlays, t)
  const all = new Set<string>()
  for (let t = 0; t < 28.5; t += 1 / 30) for (const k of at(t)) if (k.opacity > 0) all.add(k.keys.join(''))
  assert.deepEqual([...all].sort(), ['⌘A', '⌘C', '⌘N', '⌘S', '⌘V', '⌘Z', '↓', '⎋'].sort())
  assert.equal(at(27).at(-1)!.age < 1e-9, true) // source 29 -> output 27: shown as a fresh press

  const z = at(5).find((k) => k.keys.join('') === '⌘Z')!
  assert.equal(z.count, 3)
  assert.ok(Math.abs(z.age - 0.2) < 1e-9)
  const down = at(10.5)
  assert.equal(down.length, 1)
  assert.equal(down[0].count, 1)
  assert.equal(down[0].opacity, 1) // still on screen 0.5 s after a 2 s hold
  assert.equal(at(10 + 1.2 + 0.31).length, 0) // gone after linger + fade
  assert.equal(at(13.6).length, 0)
  // output 23.5 = source 25.5: four shortcuts pressed, the oldest pushed out of the three-high stack
  const stack = at(23.5)
  assert.equal(stack.at(-1)!.keys.join(''), '⌘N')
  assert.equal(stack.filter((k) => k.opacity > 0.01).length, 3)
  const ys = stack.map((k) => k.y)
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'newest at the bottom')
})

test('clicks: mapped through cuts, positioned on the screen rect, gone after their life', () => {
  const events = [click(2, 1440, 900), click(11, 0, 0), click(15, 2880, 1800)]
  const clips = removeSourceRange([{ id: 'a', start: 0, end: 30, speed: 1, volume: 1 }], 10, 12)
  const p = prepare(input(clips, 1920, 1080, events))
  const screen = sceneAt(p, 0).screen!.rect
  const c = clicksAt(p.overlays, 2.1)
  assert.equal(c.length, 1)
  assert.ok(Math.abs(c[0].x - (screen.x + screen.w / 2)) < 1e-9 && Math.abs(c[0].y - (screen.y + screen.h / 2)) < 1e-9)
  assert.ok(Math.abs(c[0].age - 0.1) < 1e-9)
  for (let t = 9; t < 11; t += 0.01) assert.equal(clicksAt(p.overlays, t).length, 0) // the click at source 11 is cut
  const last = clicksAt(p.overlays, 13) // source 15 -> output 13
  assert.equal(last.length, 1)
  assert.ok(Math.abs(last[0].x - (screen.x + screen.w)) < 1e-9 && last[0].age < 1e-9)
  assert.equal(clicksAt(p.overlays, 14).length, 0)
  p.input.project.style.cursor.click = 'none'
  assert.equal(clicksAt(p.overlays, 2.1).length, 0)
})

test('captions: every surviving word shows at its mapped time, cut words never, after any cuts and speed changes', () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let round = 0; round < 25; round++) {
    let clips: Clip[] = [{ id: 'a', start: 0, end: 30, speed: 1, volume: 1 }]
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 28
      clips = removeSourceRange(clips, a, a + rnd() * 2)
      const m = timeMap(clips)
      const s = rnd() * m.duration
      clips = setSpeed(clips, s, Math.min(m.duration, s + rnd() * 3), [0.5, 1.5, 2, 4][i])
    }
    const inp = input(clips)
    const p = prepare(inp)
    const m = timeMap(clips)
    const seen = new Set<string>()
    for (let t = 0; t < m.duration; t += 1 / 60) for (const w of captionAt(p.overlays, t)?.words ?? []) if (w.progress > 0) seen.add(w.text)
    for (const w of inp.transcript!.words) {
      const ranges = mapRange(m, w.start, w.end)
      if (w.filler) continue
      if (!ranges.length) {
        // cut away: never on screen (unless the same text is spoken elsewhere)
        if (inp.transcript!.words.filter((x) => x.text === w.text).length === 1) assert.ok(!seen.has(w.text), `${w.text} is cut but shows`)
        continue
      }
      for (const [s] of ranges) {
        const cap = captionAt(p.overlays, s + 1e-4)
        assert.ok(cap, `no caption at ${s} for ${w.text}`)
        const shown = cap.words.find((x) => x.text === w.text && x.active)
        assert.ok(shown, `${w.text} not active at ${s} (round ${round})`)
      }
    }
  }
})

test('captions: a cut between two words starts a new caption', () => {
  // cut "on the project name" (words 18-21): "click" and "field" meet at a jump cut
  const clips = removeSourceRange([{ id: 'a', start: 0, end: 30, speed: 1, volume: 1 }], 0.5 + 18 * 0.3, 0.5 + 22 * 0.3)
  const p = prepare(input(clips))
  const field = captionAt(p.overlays, 0.5 + 18 * 0.3 + 1e-4)!
  assert.ok(field.words[0].text === 'field' && !field.words.some((w) => w.text === 'click'), field.words.map((w) => w.text).join(' '))
})

test('captions: fillers hidden, edits applied, lines fit the aspect, pure in t', () => {
  const inp = input()
  inp.project.captionEdits = { 0: 'Hello!', 3: '' } // fix a word, delete another ("today")
  const p = prepare(inp)
  const texts = new Set<string>()
  for (let t = 0; t < 30; t += 0.05) for (const w of captionAt(p.overlays, t)?.words ?? []) texts.add(w.text)
  assert.ok(texts.has('Hello!') && !texts.has('Hi!') && !texts.has('Um,') && !texts.has('today'))

  assert.ok(maxLineChars(1080, 1920, 44) < maxLineChars(1920, 1080, 44), 'vertical gets shorter lines')
  for (const [w, h, aspect] of [[1920, 1080, '16:9'], [1080, 1920, '9:16']] as const) {
    const q = prepare(input(undefined, w, h, [], aspect))
    const max = maxLineChars(w, h, 44)
    for (let t = 0; t < 30; t += 0.05) {
      const cap = captionAt(q.overlays, t)
      if (!cap) continue
      for (const l of [0, 1]) assert.ok(cap.words.filter((x) => x.line === l).map((x) => x.text).join(' ').length <= max)
      assert.ok(cap.words.every((x) => x.line <= 1))
    }
    // a sentence too long for one caption splits evenly, never leaving one word alone
    const project = captionAt(q.overlays, 0.5 + 13 * 0.3 + 0.1)!
    assert.ok(project.words.some((x) => x.text === 'project.') && project.words.length > 2, `${aspect}: orphan`)
  }
  // the same project at preview size breaks lines exactly like the export
  const small = prepare(input(undefined, 640, 360))
  const big = prepare(input(undefined, 3840, 2160))
  for (let t = 0; t < 30; t += 0.1) assert.deepEqual(captionAt(small.overlays, t)?.words, captionAt(big.overlays, t)?.words)

  // purity: any order, same answers
  const times = Array.from({ length: 300 }, (_, i) => i * 0.1)
  const forward = times.map((t) => JSON.stringify(sceneAt(p, t)))
  const shuffled = [...times.keys()].sort(() => Math.random() - 0.5)
  for (const i of shuffled) assert.equal(JSON.stringify(sceneAt(p, times[i])), forward[i])
})

test('breakLines balances two lines with the shorter one on top', () => {
  const words = 'so today I want to show you how to create a new project'.split(' ')
  const lines = breakLines(words, 42)
  const top = words.filter((_, i) => lines[i] === 0).join(' ')
  const bottom = words.filter((_, i) => lines[i] === 1).join(' ')
  assert.ok(top.length <= bottom.length && bottom.length - top.length < 8, `${top} / ${bottom}`)
  assert.deepEqual(breakLines(['short', 'line'], 42), [0, 0])
  assert.deepEqual(breakLines(['Supercalifragilisticexpialidocious'], 10), [0])
})
