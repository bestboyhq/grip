// Owner: transcript. Pure transcript logic: captions and subtitles through the shared time map,
// filler words and long pauses offered as cuts, and cutting words out of the video.
// Words stay in source time; every conversion to output time goes through src/shared/timemap.ts.

import type { Clip, Transcript, Word } from '../../shared/project.ts'
import { mapRange, removeSourceRange, timeMap, type TimeMap } from '../../shared/timemap.ts'

const EPS = 1e-6
const MIN_WORD = 0.04 // s: zero-length ASR words still get a frame
const HOLD = 0.7 // s: a cue stays this long after its last word, unless the next cue or a cut comes first

/** A word as it plays: output seconds, caption fix applied. `i` indexes transcript.words;
 *  `first`/`last` are the clips it plays in (more than one when a split runs through it). */
export interface OutWord {
  i: number
  start: number
  end: number
  text: string
  first: number
  last: number
}

/** The words that survive the cuts, in output order. A word cut through keeps each piece that
 *  holds more than half of it; a word in a repeated clip plays, and shows, each time. Words last
 *  at least MIN_WORD, so a zero-length word from the recognizer is never lost. */
export function outputWords(t: Transcript, m: TimeMap, edits: Record<number, string> = {}): OutWord[] {
  const words = t.words
  const endOf = (w: Word) => Math.max(w.end, w.start + MIN_WORD)
  const out: Array<OutWord & { heard: number }> = []
  m.clips.forEach((c, k) => {
    // First word that reaches into the clip: binary search on start, then step back over long words.
    let lo = 0
    let hi = words.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (words[mid].start < c.start) lo = mid + 1
      else hi = mid
    }
    while (lo > 0 && endOf(words[lo - 1]) > c.start) lo--
    for (let i = lo; i < words.length && words[i].start < c.end; i++) {
      const w = words[i]
      const s = Math.max(w.start, c.start)
      const e = Math.min(endOf(w), c.end)
      if (e - s <= EPS) continue
      const start = m.outStarts[k] + (s - c.start) / c.speed
      const end = m.outStarts[k] + (e - c.start) / c.speed
      const prev = out[out.length - 1]
      if (prev && prev.i === i && prev.last === k - 1 && Math.abs(m.clips[k - 1].end - c.start) < EPS) {
        // The same word running on into the next clip, which picks up where this one stopped.
        prev.end = end
        prev.last = k
        prev.heard += e - s
      } else {
        const text = (edits[i] ?? w.text).replace(/\s+/g, ' ').trim()
        out.push({ i, start, end, text, first: k, last: k, heard: e - s })
      }
    }
  })
  return out
    .filter((o) => o.heard > (endOf(words[o.i]) - words[o.i].start) / 2)
    .map(({ heard: _, ...o }) => o)
}

export interface Cue {
  start: number // output seconds
  end: number
  text: string
  words: OutWord[]
}

/** Readable subtitle lines. A phrase ends at a cut (so no cue shows a word the viewer no longer
 *  hears), at a pause over 1 s, and after a sentence; a phrase too long for one line (42 characters,
 *  7 seconds) splits into lines of even length rather than leaving one word dangling. A cue stays
 *  HOLD after its last word for reading, but never over the next cue or across a cut. */
export function cues(words: OutWord[], m: TimeMap): Cue[] {
  const phrases: OutWord[][] = []
  for (const w of words) {
    if (!w.text) continue
    const phrase = phrases[phrases.length - 1]
    const prev = phrase?.[phrase.length - 1]
    if (!prev || cutBetween(m, prev.last, w.first) || w.start - prev.end > 1 || /[.!?…。？！]["'”’»)\]]*$/.test(prev.text)) phrases.push([w])
    else phrase.push(w)
  }
  const out: Cue[] = []
  for (const phrase of phrases) {
    const chars = phrase.reduce((n, w) => n + w.text.length + 1, -1)
    const lines = Math.max(Math.ceil(chars / 42), Math.ceil((phrase[phrase.length - 1].end - phrase[0].start) / 7))
    let cur: Cue | undefined
    for (const w of phrase) {
      if (cur && (cur.text.length >= chars / lines || cur.text.length + 1 + w.text.length > 42 || w.end - cur.start > 7)) cur = undefined
      if (!cur) out.push((cur = { start: w.start, end: w.end, text: w.text, words: [w] }))
      else {
        cur.end = w.end
        cur.text += ' ' + w.text
        cur.words.push(w)
      }
    }
  }
  // Output end of the run of contiguous clips each clip belongs to: where the next cut is.
  const n = m.clips.length
  const runEnd = new Float64Array(n)
  for (let k = n - 1; k >= 0; k--) {
    const c = m.clips[k]
    runEnd[k] = k + 1 < n && Math.abs(c.end - m.clips[k + 1].start) < EPS ? runEnd[k + 1] : m.outStarts[k] + (c.end - c.start) / c.speed
  }
  out.forEach((c, i) => (c.end = Math.max(c.end, Math.min(c.end + HOLD, out[i + 1]?.start ?? Infinity, runEnd[c.words[c.words.length - 1].last]))))
  return out
}

/** The captions: what the video shows and what SRT and VTT export, so both agree on which words
 *  show when. Filler words stay out unless a caption fix brings one back. */
export function captionCues(t: Transcript, m: TimeMap, edits: Record<number, string> = {}): Cue[] {
  return cues(outputWords(t, m, edits).filter((w) => !t.words[w.i].filler || edits[w.i] !== undefined), m)
}

/** Whether source time is missing between clip a and a later clip b: a cut, or clips out of order. */
function cutBetween(m: TimeMap, a: number, b: number): boolean {
  for (let k = a; k < b; k++) if (Math.abs(m.clips[k].end - m.clips[k + 1].start) > EPS) return true
  return a > b
}

function stamp(s: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
}

export function toSRT(t: Transcript, clips: Clip[], edits: Record<number, string> = {}): string {
  return captionCues(t, timeMap(clips), edits)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`)
    .join('\n')
}

export function toVTT(t: Transcript, clips: Clip[], edits: Record<number, string> = {}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const body = captionCues(t, timeMap(clips), edits).map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${esc(c.text)}\n`)
  return ['WEBVTT\n', ...body].join('\n')
}

/** Index of the word spoken at source time `src`, or -1 in a pause. */
export function wordAt(words: Word[], src: number): number {
  let lo = 0
  let hi = words.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (words[mid].start <= src) lo = mid
    else hi = mid - 1
  }
  return words.length && words[lo].start <= src && src < words[lo].end ? lo : -1
}

// ---- Filler words ----

/** True hesitation sounds per language, never real words: German "um" (around), Portuguese "em"
 *  (in), and English "like" or "so" all stay. Matched after lowercasing and dropping punctuation;
 *  letters may stretch ("ummm"). Languages without a list get no filler suggestions. */
const FILLERS: Record<string, RegExp> = {
  en: /^(u+h+|u+m+|u+h+m+|e+r+|e+r+m+|a+h+|h+m+|m{2,})$/,
  de: /^(ä+h+|ä+h+m+|ö+h+|ö+h+m+|h+m+|m{2,})$/,
  fr: /^(e+u+h+|h+e+u+|h+u+m+|h+m+|m{2,})$/,
  es: /^(e+h+|e+m+|e+h+m+|h+m+|m{2,})$/,
  it: /^(e+h+|e+h+m+|h+m+|m{2,})$/,
  pt: /^(h+ã+|ã+h+|a+h+n+|h+u+m+|h+m+|m{2,})$/,
  nl: /^(e+h+|e+h+m+|u+h+|u+h+m+|h+m+|m{2,})$/,
  pl: /^(y{2,}|e{2,}|e+h+|e+h+m+|e+m+|h+m+|m{2,})$/,
  sv: /^(e+h+|e+h+m+|ö+h+|h+m+|m{2,})$/,
  da: /^(ø+h+|ø+h+m+|h+m+|m{2,})$/,
  cs: /^(e+h+m+|e{2,}|é{2,}|h+m+|m{2,})$/,
  sk: /^(e+h+m+|e{2,}|é{2,}|h+m+|m{2,})$/,
  ru: /^(э+|э+м+|х+м+|м{2,})$/,
  uk: /^(е{2,}|е+м+|х+м+|м{2,})$/,
}

const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export function isFiller(text: string, language: string): boolean {
  return FILLERS[language.slice(0, 2)]?.test(bare(text)) ?? false
}

/** Frequent words of the 25 languages Parakeet v3 speaks, to tell them apart. */
const COMMON: Record<string, string> = {
  en: 'the and is to of you that it this i',
  de: 'und der die das ist nicht ich ein zu sie',
  fr: 'le la les et est je vous que un une pas',
  es: 'el la los que y es en de no un por',
  it: 'il che di è e la non un per sono',
  pt: 'o que de não é um uma para com os você',
  nl: 'de het een en is dat niet ik je van',
  pl: 'i nie się to że jest w na jak co',
  sv: 'och att det är som en jag inte på för',
  da: 'og at det er en jeg ikke på til som',
  cs: 'a je to že se na v jsem ne jak',
  sk: 'a je to že sa na v som nie ako',
  ru: 'и в не что на я это он с как',
  uk: 'і в не що на я це він з як',
  bg: 'и в не че на да е се за това',
  hr: 'i je u da se na su ne to što',
  sl: 'in je v da se na so ne to pa',
  fi: 'ja on ei se että hän oli mutta minä tämä',
  hu: 'a az és hogy nem is egy van meg ez',
  ro: 'și în că nu este o un pe cu la',
  el: 'και το να η ο είναι δεν του τα σε',
  et: 'ja on ei et see ka oli mis aga kui',
  lv: 'un ir ka ar no par uz bet tas es',
  lt: 'ir yra kad ne su į tai bet o kaip',
  mt: 'u li ta il ma huwa hija għal fil jien',
}
const COMMON_SETS = Object.entries(COMMON).map(([lang, s]) => [lang, new Set(s.split(' '))] as const)

/** The transcript's language (ISO 639-1) from its most frequent words, else `fallback`. */
export function detectLanguage(words: Word[], fallback = 'und'): string {
  const hits = new Map<string, number>()
  for (const w of words.slice(0, 3000)) {
    const b = bare(w.text)
    for (const [lang, set] of COMMON_SETS) if (set.has(b)) hits.set(lang, (hits.get(lang) ?? 0) + 1)
  }
  let best = fallback
  let most = 1 // one common word is not evidence
  for (const [lang, n] of hits) if (n > most) [best, most] = [lang, n]
  return best
}

// ---- Editing by transcript ----

/** How far a word cut reaches into the pause on each side, at most: half the pause, so the pause
 *  left behind is as long as a natural one, but never seconds of a silent demo. */
const REACH = 0.5

/** Cut words out of the video: one removeSourceRange per run of consecutive words, reaching into
 *  the pauses around the run but never into the neighbouring words. */
export function deleteWords(clips: Clip[], words: Word[], indices: Iterable<number>): Clip[] {
  const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < words.length).sort((a, b) => a - b)
  const sourceEnd = Math.max(0, ...clips.map((c) => c.end))
  let out = clips
  for (let r = 0; r < sorted.length; r++) {
    const i = sorted[r]
    while (sorted[r + 1] === sorted[r] + 1) r++
    const j = sorted[r]
    const before = i > 0 ? words[i - 1].end : 0
    const after = j < words.length - 1 ? words[j + 1].start : Math.max(sourceEnd, words[j].end)
    const a = Math.max(before, words[i].start - Math.min(Math.max(0, words[i].start - before) / 2, REACH))
    const b = Math.min(after, words[j].end + Math.min(Math.max(0, after - words[j].end) / 2, REACH))
    if (b > a) out = removeSourceRange(out, a, b)
  }
  return out
}

/** Indices of the words that still play, ascending. */
export function keptWords(t: Transcript, m: TimeMap): number[] {
  return [...new Set(outputWords(t, m).map((o) => o.i))].sort((a, b) => a - b)
}

/** Filler words that still play: one click cuts them all with deleteWords. */
export function fillers(t: Transcript, m: TimeMap): number[] {
  return keptWords(t, m).filter((i) => t.words[i].filler)
}

export interface Pause {
  after: number // index of the word before the pause
  start: number // the cut that shortens it, source seconds
  end: number
  length: number // how long the pause plays now, output seconds
  busy: boolean // a click, key press, or scroll happens in it: the demo, not dead air
}

export const PAUSE_MIN = 1 // pauses that play longer than this are suggested...
export const PAUSE_KEEP = 0.5 // ...and shortened to this

/** Long pauses between spoken words, with the cut that shortens each to PAUSE_KEEP. A pause with
 *  a click, key press, or scroll inside (`activity`, sorted source seconds) is marked busy: it is
 *  the demo itself, so it is shown but not suggested. */
export function longPauses(t: Transcript, m: TimeMap, activity: number[] = []): Pause[] {
  const kept = keptWords(t, m)
  const slowest = Math.min(...m.clips.map((c) => c.speed))
  const out: Pause[] = []
  for (let k = 0; k + 1 < kept.length; k++) {
    const a = t.words[kept[k]].end
    const b = t.words[kept[k + 1]].start
    if ((b - a) / slowest <= PAUSE_MIN) continue // most gaps: too short at any speed, skip the mapping
    const length = mapRange(m, a, b).reduce((sum, [s, e]) => sum + e - s, 0)
    const start = a + PAUSE_KEEP / 2
    const end = b - PAUSE_KEEP / 2
    if (length <= PAUSE_MIN || end - start < EPS) continue
    let lo = 0
    let hi = activity.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (activity[mid] < start) lo = mid + 1
      else hi = mid
    }
    out.push({ after: kept[k], start, end, length, busy: lo < activity.length && activity[lo] < end })
  }
  return out
}

export const shortenPauses = (clips: Clip[], pauses: Pause[]): Clip[] =>
  pauses.reduce((c, p) => removeSourceRange(c, p.start, p.end), clips)
