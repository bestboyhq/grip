import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Clip, Transcript, Word } from '../../shared/project.ts'
import { removeOutputRange, removeSourceRange, setSpeed, timeMap, toSource } from '../../shared/timemap.ts'
import { cues, deleteWords, detectLanguage, fillers, isFiller, longPauses, outputWords, shortenPauses, toSRT, toVTT, wordAt } from './index.ts'

// Words as Parakeet gives them for the fixture mic track (source seconds).
const SPOKEN: Array<[number, number, string]> = [
  [0.62, 1.0, 'Hi,'], [1.22, 1.53, 'um,'], [1.74, 1.96, 'so'], [1.96, 2.33, 'today'], [2.33, 2.47, 'I'], [2.47, 2.62, 'want'],
  [2.62, 2.77, 'to'], [2.77, 2.99, 'show'], [2.99, 3.14, 'you'], [3.14, 3.36, 'how'], [3.36, 3.5, 'to'], [3.5, 3.8, 'create'],
  [3.8, 3.94, 'a'], [3.94, 4.24, 'new'], [4.24, 4.9, 'project.'], [5.7, 6.03, 'Ah,'], [6.27, 6.73, 'first,'], [6.94, 7.16, 'you'],
  [7.16, 7.45, 'click'], [7.45, 7.6, 'on'], [7.6, 7.74, 'the'], [7.74, 8.18, 'project'], [8.18, 8.47, 'name'], [8.47, 8.84, 'field,'],
  [9.05, 9.15, 'and'], [9.15, 9.31, 'you'], [9.31, 9.52, 'type'], [9.52, 9.67, 'a'], [9.67, 10.09, 'name.'], [11.2, 11.46, 'Then'],
  [11.46, 11.66, 'you'], [11.66, 11.86, 'hit'], [11.93, 12.32, 'create'], [12.32, 12.72, 'project,'], [12.93, 13.28, 'and'],
  [13.47, 13.79, 'um,'], [14.0, 14.12, 'that'], [14.12, 14.3, 'is'], [14.3, 14.83, 'basically'], [14.83, 15.07, 'it.'],
  [16.77, 17.06, 'You'], [17.06, 17.27, 'can'], [17.27, 17.7, 'scroll'], [17.7, 17.91, 'down'], [17.91, 18.05, 'to'], [18.05, 18.27, 'see'],
  [18.27, 18.41, 'all'], [18.41, 18.55, 'of'], [18.55, 18.7, 'your'], [18.7, 19.19, 'projects'], [19.19, 19.48, 'here,'],
  [19.78, 20.05, 'thanks'], [20.05, 20.19, 'for'], [20.19, 20.73, 'watching.'],
]
const words: Word[] = SPOKEN.map(([start, end, text]) => ({ start, end, text, filler: isFiller(text, 'en') || undefined }))
const transcript: Transcript = { language: 'en', words }
const DURATION = 24
const full = (): Clip[] => [{ id: 'a', start: 0, end: DURATION, speed: 1, volume: 1 }]

/** Seconds of [a, b) that the clips still play. */
const heard = (clips: Clip[], a: number, b: number) => clips.reduce((s, c) => s + Math.max(0, Math.min(b, c.end) - Math.max(a, c.start)), 0)

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

test('after any cuts and speed changes, every caption word lands where it is spoken', () => {
  for (let run = 0; run < 200; run++) {
    const r = rng(run + 1)
    let clips = full()
    for (let n = 0; n < 1 + run % 7; n++) {
      const m = timeMap(clips)
      const a = r() * m.duration
      const b = Math.min(m.duration, a + r() * 3)
      const op = r()
      if (op < 0.35) clips = removeOutputRange(clips, a, b)
      else if (op < 0.6) clips = removeSourceRange(clips, r() * DURATION, r() * DURATION + r() * 2)
      else if (op < 0.85) clips = setSpeed(clips, a, b, [0.5, 1.5, 2, 4][Math.floor(r() * 4)])
      else clips = deleteWords(clips, words, [Math.floor(r() * words.length)])
      if (!clips.length) clips = full()
    }
    const m = timeMap(clips)
    const out = outputWords(transcript, m)

    for (const o of out) {
      const w = words[o.i]
      // The source playing anywhere inside the caption word is that word.
      for (const f of [0.02, 0.5, 0.98]) {
        const src = toSource(m, o.start + (o.end - o.start) * f)
        assert.ok(src >= w.start - 1e-6 && src <= w.end + 1e-6, `run ${run}: "${w.text}" shown at source ${src}, spoken ${w.start}-${w.end}`)
      }
    }
    // A word the cuts left whole plays, one that they removed does not.
    words.forEach((w, i) => {
      const left = heard(clips, w.start, w.end) / (w.end - w.start)
      if (left > 0.999) assert.ok(out.some((o) => o.i === i), `run ${run}: "${w.text}" plays but has no caption`)
      if (left < 1e-6) assert.ok(!out.some((o) => o.i === i), `run ${run}: "${w.text}" was cut but has a caption`)
    })
    // No cue runs across a cut: between two words of a cue, all source time plays.
    for (const c of cues(out, m)) {
      for (let k = 1; k < c.words.length; k++) {
        const [p, q] = [words[c.words[k - 1].i], words[c.words[k].i]]
        assert.ok(q.start >= p.end - 1e-6 && heard(clips, p.end, q.start) >= q.start - p.end - 1e-6, `run ${run}: cue "${c.text}" spans a cut`)
      }
      assert.ok(c.text.length <= 42 && c.end > c.start)
      // The hold after the last word never crosses a cut either.
      const a = toSource(m, c.words[c.words.length - 1].end - 1e-6)
      const b = toSource(m, c.end - 1e-6)
      assert.ok(b >= a - 1e-6 && heard(clips, a, b) >= b - a - 1e-6, `run ${run}: cue "${c.text}" holds across a cut`)
    }
  }
})

test('SRT and VTT: cues in output time, split at cuts, sped up, with caption fixes', () => {
  // Cut "Ah, first," (5.7-6.73 source), and play "Then you hit create project," at 2x.
  let clips = deleteWords(full(), words, [15, 16])
  const m0 = timeMap(clips)
  const thenAt = outputWords(transcript, m0).find((o) => words[o.i].text === 'Then')!.start
  clips = setSpeed(clips, thenAt, thenAt + (12.72 - 11.2), 2)
  const srt = toSRT(transcript, clips, { 0: 'Hello,' })
  const blocks = srt.trim().split('\n\n').map((b) => b.split('\n'))
  // Fillers stay out (as on the video); the cue lingers until the next one starts.
  assert.deepEqual(blocks[0], ['1', '00:00:00,620 --> 00:00:03,140', 'Hello, so today I want to show you'])
  assert.ok(!srt.includes('Ah,') && !srt.includes('first,'))
  assert.ok(toSRT(transcript, full(), { 1: 'um,' }).includes('Hi, um, so'), 'a caption fix brings a filler back')
  const cut = 6.73 + Math.min((6.94 - 6.73) / 2, 0.5) - (5.7 - Math.min((5.7 - 4.9) / 2, 0.5)) // 1.535 s removed
  const then = blocks.find((b) => b[2].startsWith('Then'))!
  const ts = (s: number) => new Date(Math.round(s * 1000)).toISOString().slice(11, 23).replace('.', ',')
  // "Then ... project," plays at 2x right after the cut, "and" at 1x; the phrase splits in even halves,
  // and the first half stays until the second starts.
  const end = 11.2 - cut + (12.72 - 11.2) / 2 + (12.93 - 12.72)
  assert.equal(then[1], `${ts(11.2 - cut)} --> ${ts(end)}`)
  assert.equal(then[2], 'Then you hit create project,')
  // The last cue lingers HOLD (0.7 s) after "watching." when nothing follows.
  assert.equal(blocks.at(-1)![1].split(' --> ')[1], ts(20.73 + 0.7 - cut - (12.72 - 11.2) / 2))
  const vtt = toVTT({ language: 'en', words: [{ start: 0, end: 1, text: '<b>&' }] }, full())
  assert.equal(vtt, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.700\n&lt;b&gt;&amp;\n')
})

test('deleting words keeps every frame of their neighbours', () => {
  const um = words.findIndex((w) => w.text === 'um,')
  const clips = deleteWords(full(), words, [um, um + 1, 30]) // "um, so" and "you" in "Then you hit"
  for (const i of [um - 1, um + 2, 29, 31]) assert.equal(heard(clips, words[i].start, words[i].end), words[i].end - words[i].start)
  for (const i of [um, um + 1, 30]) assert.equal(heard(clips, words[i].start, words[i].end), 0)
  assert.equal(clips.length, 3, 'one cut per run of consecutive words')
  // Reaches half into each pause, but at most 0.5 s: a long silent stretch is never swallowed.
  const last = deleteWords(full(), words, [words.length - 1])
  assert.ok(Math.abs(heard(last, 20.73, DURATION) - (DURATION - 20.73 - 0.5)) < 1e-9)
})

test('filler words: true fillers only, per language', () => {
  assert.deepEqual(fillers(transcript, timeMap(full())).map((i) => words[i].text), ['um,', 'Ah,', 'um,'])
  for (const t of ['Um,', 'uhh', 'Hmm.', 'erm']) assert.ok(isFiller(t, 'en'), t)
  for (const t of ['so', 'like', 'um-hum', 'I']) assert.ok(!isFiller(t, 'en'), t)
  assert.ok(isFiller('Ähm,', 'de') && !isFiller('um', 'de'), 'German "um" means "around"')
  assert.ok(!isFiller('em', 'pt') && isFiller('em', 'es'), 'Portuguese "em" means "in"')
  assert.ok(!isFiller('um', 'xx'))
  const after = deleteWords(full(), words, fillers(transcript, timeMap(full())))
  assert.deepEqual(fillers(transcript, timeMap(after)), [])
  assert.equal(detectLanguage(words), 'en')
  const de = 'Ich zeige dir, wie das geht. Das ist nicht schwer und du kannst es auch.'.split(' ').map((text) => ({ start: 0, end: 1, text }))
  assert.equal(detectLanguage(de), 'de')
  assert.equal(detectLanguage([{ start: 0, end: 1, text: 'Hmm.' }], 'fr'), 'fr')
})

test('long pauses: suggested, shortened, and kept when the demo is busy', () => {
  const m = timeMap(full())
  const all = longPauses(transcript, m)
  assert.deepEqual(all.map((p) => words[p.after].text), ['name.', 'it.'])
  assert.deepEqual(all.map((p) => p.busy), [false, false])
  const activity = [10.6, 15.2, 16] // a shortcut in the first pause, scrolling in the second
  assert.deepEqual(longPauses(transcript, m, activity).map((p) => p.busy), [true, true])
  assert.deepEqual(longPauses(transcript, m, [11.1]).map((p) => p.busy), [false, false], 'a click in the kept edge is fine')
  const clips = shortenPauses(full(), all)
  assert.ok(Math.abs(heard(clips, 15.07, 16.77) - 0.5) < 1e-9)
  assert.deepEqual(longPauses(transcript, timeMap(clips)), [], 'nothing left to shorten')
  assert.equal(wordAt(words, 15.5), -1)
  assert.equal(words[wordAt(words, 16.8)].text, 'You')
})
