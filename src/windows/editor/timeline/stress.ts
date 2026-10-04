// A synthetic 2-hour project for performance checks: 500 clips (some sped up, cuts between),
// 300 zooms, 60 camera layouts, 40 masks, ~20k transcript words, keystrokes, and 10 Hz mouse moves.
// Deterministic, so frame-time measurements compare across runs.

import { createProject, type Project, type Transcript, type Word } from '../../../shared/project.ts'
import type { InputEvent } from '../../../shared/events.ts'

export function stressProject(): { project: Project; events: InputEvent[]; transcript: Transcript } {
  let seed = 42
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]

  const clips: Project['clips'] = []
  let src = 0
  for (let i = 0; i < 500; i++) {
    src += rnd() < 0.7 ? rnd() * 6 : 0 // most clips follow a cut
    const len = 8 + rnd() * 16
    const speed = rnd() < 0.85 ? 1 : pick([1.5, 2, 4])
    clips.push({ id: `c${i}`, start: src, end: src + len, speed, volume: rnd() < 0.9 ? 1 : pick([0, 0.5, 1.5]) })
    src += len
  }
  const duration = Math.ceil(src + 5)

  const spread = <T>(n: number, minLen: number, maxLen: number, make: (i: number, start: number, end: number) => T) =>
    Array.from({ length: n }, (_, i) => {
      const slot = duration / n
      const len = Math.min(slot * 0.9, minLen + rnd() * (maxLen - minLen))
      const start = i * slot + rnd() * (slot - len)
      return make(i, start, start + len)
    })

  const project = createProject('Stress 2h ✨ #500', {
    duration,
    screen: { file: 'sources/screen.mp4', width: 3840, height: 2160, fps: 60, scale: 2 },
    camera: { file: 'sources/camera.mp4', width: 1920, height: 1080, fps: 30, scale: 1 },
    mic: { file: 'sources/mic.m4a', channels: 1, sampleRate: 48000 },
    system: { file: 'sources/system.m4a', channels: 2, sampleRate: 48000 },
    events: 'sources/events.jsonl',
  })
  project.clips = clips
  project.zooms = spread(300, 1.5, 9, (i, start, end) => ({
    id: `z${i}`,
    start,
    end,
    level: pick([1.5, 2, 2, 2.5, 3]),
    target: rnd() < 0.8 ? { kind: 'cursor' } : { kind: 'point', x: rnd(), y: rnd() },
    auto: rnd() < 0.7,
    enabled: rnd() < 0.9,
  }))
  project.layouts = spread(60, 5, 60, (i, start, end) => ({ id: `l${i}`, start, end, kind: pick(['pip', 'fullscreen', 'hidden', 'split'] as const) }))
  project.masks = spread(40, 2, 20, (i, start, end) => ({
    id: `m${i}`,
    start,
    end,
    kind: pick(['blur', 'pixelate', 'highlight'] as const),
    rect: { x: 0.3, y: 0.3, w: 0.3, h: 0.2 },
  }))

  const events: InputEvent[] = []
  for (let t = 0; t < duration; t += 0.1) events.push({ t, type: 'move', x: 1920 + Math.sin(t) * 800, y: 1080 + Math.cos(t / 3) * 500 })
  for (let t = 3; t < duration; t += 20 + rnd() * 40) {
    if (rnd() < 0.5) events.push({ t, type: 'key', down: true, key: pick(['K', 'S', 'P', 'Z', 'C', 'V']), code: 0, mods: pick([['⌘'], ['⇧', '⌘'], ['⌥', '⌘']]) })
    else for (let k = 0; k < 20; k++) events.push({ t: t + k * 0.12, type: 'key', down: true, key: 'abcdefghij'[k % 10], code: 0, mods: [] })
  }
  events.sort((a, b) => a.t - b.t)

  const lexicon = ['so', 'here', 'we', 'open', 'the', 'editor', 'and', 'um', 'click', 'export', 'timeline', 'zoom', 'like', 'this', 'video']
  const words: Word[] = []
  for (let t = 0.5; t < duration - 1; ) {
    const text = pick(lexicon)
    const len = 0.15 + rnd() * 0.3
    words.push({ start: t, end: t + len, text, filler: text === 'um' || text === 'like' })
    t += len + (rnd() < 0.1 ? 1 + rnd() * 2 : 0.05)
  }
  return { project, events, transcript: { language: 'en', words } }
}
