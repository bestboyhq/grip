// Owner: transcript. Pure transcript logic: captions and subtitles through the shared time map,
// filler words and long pauses offered as cuts, and cutting words out of the video, for the editor
// and for agents (resolveWordEdits).
// Words stay in source time; every conversion to output time goes through src/shared/timemap.ts.

import type { Clip, Transcript, Voiceover, Word } from '../../shared/project.ts'
import type { Edit } from '../../shared/edits.ts'
import { mapRange, removeSourceRange, timeMap, type TimeMap } from '../../shared/timemap.ts'
import { sourceSpan, takeAt } from '../../shared/voiceover.ts'

const EPS = 1e-6
const MIN_WORD = 0.04 // s: zero-length ASR words still get a frame
const HOLD = 0.7 // s: a cue stays this long after its last word, unless the next cue or a cut comes first

/** What the video says, in source time: the recording's words but those under a voiceover that mutes
 *  the mic, and each voiceover's words where it plays (`takes`: their transcripts by take id, in take
 *  seconds). A word belongs where its middle is. Merged words carry their caption fix key (Word.key):
 *  the index in the recording's transcript, or "<take id>:<index>" in the take's. With no voiceover
 *  to hear or hide, the recording's transcript itself. */
export function spoken(mic: Transcript | null, takes: Record<string, Transcript>, items: Voiceover[]): Transcript | null {
  const on = items.filter((v) => !v.muted)
  const add: Word[] = []
  for (const v of on) {
    const t = takes[v.take]
    if (!t || v.volume <= 0) continue
    const fa = takeAt(v.knots, v.start)
    const fb = takeAt(v.knots, v.end)
    const words = t.words
    let lo = 0
    let hi = words.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (words[mid].start < fa) lo = mid + 1
      else hi = mid
    }
    while (lo > 0 && words[lo - 1].end > fa) lo--
    for (let i = lo; i < words.length && words[i].start < fb; i++) {
      const w = words[i]
      const r = sourceSpan(v.knots, w.start, w.end)
      const mid = r ? (r[0] + r[1]) / 2 : NaN
      if (r && mid >= v.start && mid < v.end) add.push({ ...w, start: Math.max(r[0], v.start), end: Math.min(r[1], v.end), key: `${v.take}:${i}` })
    }
  }
  // Source ranges where the mic is muted under a voiceover, merged, for a binary search per word.
  const duck: Array<[number, number]> = []
  for (const v of on.filter((v) => v.duck).sort((a, b) => a.start - b.start)) {
    const last = duck.at(-1)
    if (last && v.start <= last[1]) last[1] = Math.max(last[1], v.end)
    else duck.push([v.start, v.end])
  }
  const hidden = (w: Word) => {
    const m = (w.start + w.end) / 2
    let lo = 0
    let hi = duck.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (duck[mid][1] <= m) lo = mid + 1
      else hi = mid
    }
    return lo < duck.length && duck[lo][0] <= m
  }
  const heard = on.find((v) => takes[v.take])
  if (!add.length && !(mic && duck.length && mic.words.some(hidden))) return mic ?? (heard ? { language: takes[heard.take].language, words: [] } : null)
  const words = (mic?.words ?? []).flatMap((w, i) => (hidden(w) ? [] : [{ ...w, key: String(i) }]))
  return { language: mic?.language ?? takes[heard!.take].language, words: [...words, ...add].sort((a, b) => a.start - b.start) }
}

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
export function outputWords(t: Transcript, m: TimeMap, edits: Record<string, string> = {}): OutWord[] {
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
        const text = (edits[w.key ?? i] ?? w.text).replace(/\s+/g, ' ').trim()
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

/** Readable subtitle lines. A phrase ends at a pause over 1 s, as spoken or as played, after a
 *  sentence, and where the video jumps back; a cut that only took out a filler or a few words keeps
 *  the phrase whole, so cleaning up speech never chops its captions. A phrase too long for one line
 *  (42 characters, 7 seconds) splits into lines of even length rather than leaving one word
 *  dangling, each line showing until the next one starts. The last line stays HOLD after its last
 *  word for reading, but never over the next cue or across a cut. */
export function cues(words: OutWord[], m: TimeMap): Cue[] {
  const src = (k: number, out: number) => m.clips[k].start + (out - m.outStarts[k]) * m.clips[k].speed
  const phrases: OutWord[][] = []
  for (const w of words) {
    if (!w.text) continue
    const phrase = phrases[phrases.length - 1]
    const prev = phrase?.[phrase.length - 1]
    const spoken = prev ? src(w.first, w.start) - src(prev.last, prev.end) : NaN // NaN: no phrase yet
    if (!(spoken > -EPS && spoken <= 1) || w.start - prev!.end > 1 || /[.!?…。？！]["'”’»)\]]*$/.test(prev!.text)) phrases.push([w])
    else phrase.push(w)
  }
  const out: Cue[] = []
  for (const phrase of phrases) {
    const chars = phrase.reduce((n, w) => n + w.text.length + 1, -1)
    const lines = Math.max(Math.ceil(chars / 42), Math.ceil((phrase[phrase.length - 1].end - phrase[0].start) / 7))
    let cur: Cue | undefined
    for (const w of phrase) {
      if (cur && (cur.text.length >= chars / lines || cur.text.length + 1 + w.text.length > 42 || w.end - cur.start > 7)) {
        cur.end = w.start
        cur = undefined
      }
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
export function captionCues(t: Transcript, m: TimeMap, edits: Record<string, string> = {}): Cue[] {
  return cues(outputWords(t, m, edits).filter((w) => !t.words[w.i].filler || edits[t.words[w.i].key ?? w.i] !== undefined), m)
}

function stamp(s: number, sep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`
}

export function toSRT(t: Transcript, clips: Clip[], edits: Record<string, string> = {}): string {
  return captionCues(t, timeMap(clips), edits)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`)
    .join('\n')
}

export function toVTT(t: Transcript, clips: Clip[], edits: Record<string, string> = {}): string {
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

/** Cut words out of the video: one removeSourceRange per run of consecutive words (wordRanges). */
export const deleteWords = (clips: Clip[], words: Word[], indices: Iterable<number>): Clip[] =>
  wordRanges(words, indices, Math.max(0, ...clips.map((c) => c.end))).reduce((out, [a, b]) => removeSourceRange(out, a, b), clips)

/** The source ranges that cut `indices` out: one per run of consecutive words, reaching into the
 *  pauses around the run but never into the neighbouring words. */
export function wordRanges(words: Word[], indices: Iterable<number>, sourceEnd: number): Array<[number, number]> {
  const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < words.length).sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  for (let r = 0; r < sorted.length; r++) {
    const i = sorted[r]
    while (sorted[r + 1] === sorted[r] + 1) r++
    const j = sorted[r]
    const before = i > 0 ? words[i - 1].end : 0
    const after = j < words.length - 1 ? words[j + 1].start : Math.max(sourceEnd, words[j].end)
    const a = Math.max(before, words[i].start - Math.min(Math.max(0, words[i].start - before) / 2, REACH))
    const b = Math.min(after, words[j].end + Math.min(Math.max(0, after - words[j].end) / 2, REACH))
    if (b > a) out.push([a, b])
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

// ---- Agents' transcript edits ----

const SNAP = 0.02 // s: a cut edge this close to a word's own edge already leaves the word whole
const MATCH_MAX = 2000 // words match_captions aligns at once
const r2 = (t: number) => Math.round(t * 100) / 100
const list = (ws: string[]) => ws.slice(0, 8).join(', ') + (ws.length > 8 ? `, and ${ws.length - 8} more` : '')
const quote = (ws: string[]) => list(ws.map((w) => `“${w}”`))
const letters = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

/** The caption texts, as [transcript word index, text], that make the captions over output a..b read
 *  `script`: its words aligned to the caption words by their letters and digits (case, accents, and
 *  punctuation aside) at the fewest changes to the captions. A caption word aligned to a script word takes its text,
 *  one the script lacks hides, and a script word left over joins the caption word before it. Throws
 *  when fewer than half of the words align: that script is not what is said there. */
// ponytail: full O(words x script) alignment, so at most MATCH_MAX words a call; band it if whole long videos must go at once.
function matchCaptions(t: Transcript, m: TimeMap, edits: Record<string, string>, script: string, a = 0, b = Infinity) {
  const over = Number.isFinite(b) || a > 0 ? ` over ${r2(a)}-${Number.isFinite(b) ? r2(b) : r2(m.duration)} s` : ''
  const seen = new Set<number>()
  const words = outputWords(t, m, edits).filter((w) => {
    const word = t.words[w.i]
    const shows = !word.filler || edits[word.key ?? w.i] !== undefined // as captionCues shows them
    const mid = (w.start + w.end) / 2
    if (!shows || mid < a || mid > b || seen.has(w.i)) return false
    return seen.add(w.i)
  })
  const tokens: string[] = []
  for (const s of script.split(/\s+/).filter(Boolean)) {
    if (letters(s) || !tokens.length) tokens.push(s)
    else tokens[tokens.length - 1] += ' ' + s // a dash or other mark alone stays with the word before it
  }
  const n = words.length
  const k = tokens.length
  if (!n) throw new Error(`no caption words play${over}, so there is nothing to match.`)
  if (n > MATCH_MAX || k > MATCH_MAX) throw new Error(`match at most ${MATCH_MAX} words at a time: give start and end to match the script part by part.`)
  const said = words.map((w) => letters(w.text || t.words[w.i].text))
  const meant = tokens.map(letters)
  const same = (i: number, j: number) => !!said[i] && said[i] === meant[j]
  // Fewest changes to the captions as they read now: a word keeps its text free (one script word, or
  // the few it already reads), takes one with the same letters at 1, takes another word or hides at 3
  // (hidden already: free), and a script word with no caption word comes in at 3.
  const pair = (i: number, j: number) => (words[i].text === tokens[j] ? 0 : same(i, j) ? 1 : 3)
  const drop = (i: number) => (words[i].text ? 3 : 0)
  const parts = words.map((w) => w.text.split(' ').length)
  /** How many script words up to j word i reads as it is, when that is more than one; else 0. */
  const reads = (i: number, j: number) => {
    for (let r = 2; r <= Math.min(parts[i], j); r++) if (words[i].text === tokens.slice(j - r, j).join(' ')) return r
    return 0
  }
  const cost = new Uint32Array((n + 1) * (k + 1))
  const at = (i: number, j: number) => i * (k + 1) + j
  for (let i = 1; i <= n; i++) cost[at(i, 0)] = cost[at(i - 1, 0)] + drop(i - 1)
  for (let j = 1; j <= k; j++) cost[at(0, j)] = 3 * j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= k; j++) {
      const r = parts[i - 1] > 1 ? reads(i - 1, j) : 0
      cost[at(i, j)] = Math.min(r ? cost[at(i - 1, j - r)] : Infinity, cost[at(i - 1, j - 1)] + pair(i - 1, j - 1), cost[at(i - 1, j)] + drop(i - 1), cost[at(i, j - 1)] + 3)
    }
  }
  const got: string[][] = words.map(() => [])
  const left: Array<[number, string]> = [] // script words with no caption word, after caption word [0]
  let matched = 0
  for (let i = n, j = k; i > 0 || j > 0; ) {
    const c = cost[at(i, j)]
    const r = i && j && parts[i - 1] > 1 ? reads(i - 1, j) : 0
    if (r && c === cost[at(i - 1, j - r)]) {
      matched++
      got[--i] = tokens.slice(j - r, j)
      j -= r
    } else if (i && j && c === cost[at(i - 1, j - 1)] + pair(i - 1, j - 1)) {
      if (same(i - 1, j - 1)) matched++
      got[--i].unshift(tokens[--j])
    } else if (i && c === cost[at(i - 1, j)] + drop(i - 1)) i--
    else left.unshift([i - 1, tokens[--j]])
  }
  if (2 * matched < Math.max(n, k)) {
    throw new Error(`the script matches only ${matched} of the ${n} caption words${over}, so it is not what is said there. Give start and end when it covers only part of the video, or fix single words with set_caption_text.`)
  }
  const lead: string[] = []
  for (const [w, s] of left) {
    let p = w
    while (p >= 0 && !got[p].length) p--
    if (p >= 0) got[p].push(s)
    else lead.push(s)
  }
  if (lead.length) got[got.findIndex((g) => g.length)].unshift(...lead)
  const texts: Array<[number, string]> = []
  const changed: string[] = []
  const hidden: string[] = []
  words.forEach((w, p) => {
    const text = got[p].join(' ')
    if (text === w.text) return
    texts.push([w.i, text])
    if (text) changed.push(`“${w.text || t.words[w.i].text}” → “${text}”`)
    else hidden.push(w.text)
  })
  const note = texts.length
    ? `Matched the captions${over} to the script: ${changed.length ? `changed ${list(changed)}` : ''}${changed.length && hidden.length ? ', and ' : ''}${hidden.length ? `hid ${quote(hidden)}, which the script leaves out` : ''}.`
    : `The captions${over} already read as the script.`
  return { texts, note }
}

/** An agent's edits (src/shared/edits.ts) ready to apply on the timeline `m`: cut_fillers and
 *  shorten_pauses get the output ranges the Transcript tab's buttons cut, match_captions the caption
 *  texts that make the captions read its script (`captionEdits`: the project's caption fixes so far),
 *  and a cut whose edge falls inside a word moves to that word's nearer edge, so no word plays clipped.
 *  `activity`: sorted source seconds of clicks, key presses, and scrolls, which make a pause part of the
 *  demo. `notes` say what Grip decided, for the agent. Throws when a transcript edit has no transcript
 *  to go by, or a script does not fit. */
export function resolveWordEdits(edits: Edit[], t: Transcript | null, m: TimeMap, activity: number[] = [], captionEdits: Record<string, string> = {}): { edits: Edit[]; notes: string[] } {
  const notes: string[] = []
  const plays = t ? outputWords(t, m) : []
  /** The word playing across output time x, not merely touching it. */
  const across = (x: number) => {
    let lo = 0
    let hi = plays.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (plays[mid].start <= x) lo = mid + 1
      else hi = mid
    }
    const w = plays[lo - 1]
    return w && w.start + SNAP < x && x < w.end - SNAP ? w : undefined
  }
  const out = edits.map((e, i): Edit => {
    if (e.type === 'cut_fillers' || e.type === 'shorten_pauses' || e.type === 'match_captions') {
      if (!t) throw new Error(`edits[${i}] (${e.type}) goes by the transcript, and this project has none yet. transcribe_project makes one.`)
      if (e.type === 'match_captions') {
        try {
          const { texts, note } = matchCaptions(t, m, captionEdits, e.text, e.start, e.end)
          notes.push(`edits[${i}]: ${note}`)
          return { ...e, texts }
        } catch (err) {
          throw new Error(`edits[${i}]: ${(err as Error).message}`)
        }
      }
      let source: Array<[number, number]>
      if (e.type === 'cut_fillers') {
        const found = fillers(t, m)
        source = wordRanges(t.words, found, Math.max(0, ...m.clips.map((c) => c.end)))
        notes.push(found.length ? `Cut ${found.length} filler word${found.length === 1 ? '' : 's'}: ${quote(found.map((k) => t.words[k].text))}.` : 'No filler words play in the video: nothing to cut.')
      } else {
        const all = longPauses(t, m, activity)
        const dead = all.filter((p) => !p.busy)
        source = dead.map((p) => [p.start, p.end])
        const busy = all.length - dead.length
        const n = (k: number) => `${k} pause${k === 1 ? '' : 's'}`
        notes.push(
          dead.length
            ? `Shortened ${n(dead.length)} to ${PAUSE_KEEP} s${busy ? `, and left ${n(busy)} with clicks, typing, or scrolling in them, which show the demo` : ''}.`
            : busy
              ? `Left the ${n(busy)} over ${PAUSE_MIN} s as they are: clicks, typing, or scrolling in them show the demo.`
              : `No pause over ${PAUSE_MIN} s to shorten.`,
        )
      }
      return { type: e.type, ranges: source.flatMap(([a, b]) => mapRange(m, a, b)) }
    }
    if (e.type !== 'cut') return e
    const [wa, wb] = [across(e.start), across(e.end)]
    if (!wa && !wb) return e
    if (wa && wa === wb && 2 * (e.end - e.start) < wa.end - wa.start) {
      notes.push(`edits[${i}] would only clip “${wa.text}”, so it cuts nothing. To remove the word, cut ${r2(wa.start)}-${r2(wa.end)} s.`)
      return { type: 'cut', start: e.start, end: e.start }
    }
    // Most of the word on the kept side: it stays whole; most of it inside the cut: it goes whole.
    const a = wa ? (wa === wb || e.start - wa.start < wa.end - e.start ? wa.start : wa.end) : e.start
    const b = wb ? (wa === wb || e.end - wb.start >= wb.end - e.end ? wb.end : wb.start) : e.end
    const why = [wa && `“${wa.text}” ${a === wa.end ? 'stays' : 'goes'} whole`, wb && wb !== wa && `“${wb.text}” ${b === wb.end ? 'goes' : 'stays'} whole`].filter(Boolean).join(', and ')
    notes.push(`edits[${i}]: the cut runs ${r2(a)}-${r2(b)} s instead of ${r2(e.start)}-${r2(e.end)} s, so ${why}.`)
    return { type: 'cut', start: a, end: b }
  })
  return { edits: out, notes }
}
