// Edits an agent asks for (electron/agents.ts): checked like any untrusted input, then applied to a
// project all at once. Every time is output seconds on the timeline as it was before the list, the
// one get_project shows, whatever the list does to it: cuts, restored cuts, and speed changes run from
// the end back, so none moves the times of another, and zooms take their source times from the
// timeline before any of them. cut_fillers and shorten_pauses are Grip's own transcript cuts, and
// match_captions its own caption fixes: main works out their ranges and word texts (resolveWordEdits
// in src/engine/transcript) before the list is applied. auto_zoom is Grip's own auto zooms: main
// works them out from the recording's clicks and typing (generateAutoZooms in src/engine/zoom). Main
// applies a list to a closed project on disk; an open editor applies it as one undo step
// (Editor.svelte). Pure: node:test runs it.

import { CAPTION_FONTS, uid, type Project, type Style, type Transcript, type Zoom, type ZoomLook } from './project.ts'
import { clipAt, cuts, mapRange, removeOutputRange, restoreCut, setSpeed, timeMap, toSource, type Cut } from './timemap.ts'

type Captions = Style['captions']
export type Edit =
  | { type: 'cut'; start: number; end: number }
  | { type: 'restore_cut'; at: number }
  // Output ranges filled in by resolveWordEdits; an agent sends neither field.
  | { type: 'cut_fillers' | 'shorten_pauses'; ranges?: Array<[number, number]> }
  | { type: 'set_speed'; start: number; end: number; speed: number }
  | { type: 'add_zoom'; start: number; end: number; level?: number; x?: number; y?: number; look?: 'zoom' | 'loupe' }
  // Source ranges filled in by main from the recording's clicks and typing; an agent sends none.
  | { type: 'auto_zoom'; level?: number; look?: 'zoom' | 'loupe'; spans?: Array<[number, number]> }
  | { type: 'set_zoom'; id: string; start?: number; end?: number; level?: number; x?: number; y?: number }
  | { type: 'remove_zoom'; id: string }
  | { type: 'set_caption_text'; index: number; text: string }
  // Word texts as [transcript word index, text], filled in by resolveWordEdits; an agent sends the script.
  | { type: 'match_captions'; text: string; start?: number; end?: number; texts?: Array<[number, string]> }
  | ({ type: 'set_captions' } & Partial<Captions>)

/** What the editor's own controls offer: the speed menu, the zoom level slider, the caption size slider. */
export const LIMITS = { speed: [0.25, 8], level: [1.1, 6], captionSize: [20, 120] } as const
const MIN_ZOOM = 0.1 // s, the shortest item the timeline makes (timeline/model.ts MIN_LEN)
const MAX_EDITS = 1000
const MAX_TEXT = 200
const MAX_SCRIPT = 20000
const EPS = 1e-6
const NEAR = 0.25 // s: restore_cut takes the cut this close to its time, the nearest one
const CHOICES = {
  mode: ['line', 'word'],
  position: ['bottom', 'top'],
  animation: ['appear', 'fade', 'slide'],
  font: CAPTION_FONTS.map((f) => f.value),
} as const
const FIELDS: Record<Edit['type'], string[]> = {
  cut: ['start', 'end'],
  restore_cut: ['at'],
  cut_fillers: [],
  shorten_pauses: [],
  set_speed: ['start', 'end', 'speed'],
  add_zoom: ['start', 'end', 'level', 'x', 'y', 'look'],
  auto_zoom: ['level', 'look'],
  set_zoom: ['id', 'start', 'end', 'level', 'x', 'y'],
  remove_zoom: ['id'],
  set_caption_text: ['index', 'text'],
  match_captions: ['text', 'start', 'end'],
  set_captions: ['visible', 'mode', 'position', 'size', 'color', 'font', 'animation'],
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const sec = (t: number) => String(Math.round(t * 100) / 100)

/** `x` as a list of edits, or an Error that says which edit is wrong and how. Some models send the list
 *  as a JSON string, and every optional field as null: both read as meant. */
export function parseEdits(x: unknown): Edit[] {
  if (typeof x === 'string') {
    try {
      x = JSON.parse(x)
    } catch {
      throw new Error('edits must be a list of edits, not a string.')
    }
  }
  if (!Array.isArray(x) || !x.length) throw new Error('edits must be a list with at least one edit.')
  if (x.length > MAX_EDITS) throw new Error(`Send at most ${MAX_EDITS} edits at once.`)
  return x.map((raw: any, i): Edit => {
    const at = `edits[${i}]`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${at} must be an object with a type.`)
    const e = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)) as any
    const fields = Object.hasOwn(FIELDS, e.type) ? FIELDS[e.type as Edit['type']] : null
    if (!fields) throw new Error(`${at}.type must be one of ${Object.keys(FIELDS).join(', ')}.`)
    for (const k of Object.keys(e)) if (k !== 'type' && !fields.includes(k)) throw new Error(`${at} (${e.type}) has no field “${k}”. It takes ${fields.join(', ')}.`)
    const check = (ok: boolean, what: string) => {
      if (!ok) throw new Error(`${at}.${what}`)
    }
    const range = () => {
      check(num(e.start) && e.start >= 0, 'start must be a number of seconds, 0 or more.')
      check(num(e.end) && e.end > e.start, 'end must be a number of seconds after start.')
      return { start: e.start as number, end: e.end as number }
    }
    const within = (k: string, [lo, hi]: readonly [number, number], unit = '') => check(num(e[k]) && e[k] >= lo && e[k] <= hi, `${k} must be a number from ${lo}${unit} to ${hi}${unit}.`)
    const look = () => check(e.look === undefined || e.look === 'zoom' || e.look === 'loupe', 'look must be zoom or loupe.')
    const point = () => {
      check((e.x === undefined) === (e.y === undefined), 'x and y go together: give both to aim at a point, or neither to follow the cursor.')
      if (e.x !== undefined) for (const k of ['x', 'y']) within(k, [0, 1])
    }
    switch (e.type as Edit['type']) {
      case 'cut':
        return { type: 'cut', ...range() }
      case 'restore_cut':
        check(num(e.at) && e.at >= 0, 'at must be the time of a cut, in output seconds, as get_project lists the cuts.')
        return { type: 'restore_cut', at: e.at }
      case 'cut_fillers':
      case 'shorten_pauses':
        return { type: e.type }
      case 'set_speed':
        within('speed', LIMITS.speed, '×')
        return { type: 'set_speed', ...range(), speed: e.speed }
      case 'add_zoom': {
        const r = range()
        if (e.level !== undefined) within('level', LIMITS.level, '×')
        point()
        look()
        return { type: 'add_zoom', ...r, ...(e.level !== undefined && { level: e.level }), ...(e.x !== undefined && { x: e.x, y: e.y }), ...(e.look && { look: e.look }) }
      }
      case 'auto_zoom':
        if (e.level !== undefined) within('level', LIMITS.level, '×')
        look()
        return { type: 'auto_zoom', ...(e.level !== undefined && { level: e.level }), ...(e.look && { look: e.look }) }
      case 'set_zoom': {
        check(typeof e.id === 'string' && !!e.id, 'id must be the id of a zoom, as get_project lists it.')
        check(fields.some((k) => k !== 'id' && e[k] !== undefined), 'set_zoom needs at least one of start, end, level, or x and y.')
        for (const k of ['start', 'end']) if (e[k] !== undefined) check(num(e[k]) && e[k] >= 0, `${k} must be a number of seconds, 0 or more.`)
        if (e.start !== undefined && e.end !== undefined) check(e.end > e.start, 'end must be a number of seconds after start.')
        if (e.level !== undefined) within('level', LIMITS.level, '×')
        point()
        return { type: 'set_zoom', ...Object.fromEntries(fields.filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) } as Edit
      }
      case 'remove_zoom':
        check(typeof e.id === 'string' && !!e.id, 'id must be the id of a zoom, as get_project lists it.')
        return { type: 'remove_zoom', id: e.id }
      case 'set_caption_text':
        check(Number.isInteger(e.index) && e.index >= 0, 'index must be the index of a transcript word, as get_transcript lists it.')
        check(typeof e.text === 'string' && e.text.length <= MAX_TEXT, `text must be a string of at most ${MAX_TEXT} characters ('' hides the word).`)
        return { type: 'set_caption_text', index: e.index, text: e.text }
      case 'match_captions':
        check(typeof e.text === 'string' && !!e.text.trim() && e.text.length <= MAX_SCRIPT, `text must be the script the captions read, at most ${MAX_SCRIPT} characters.`)
        for (const k of ['start', 'end']) if (e[k] !== undefined) check(num(e[k]) && e[k] >= 0, `${k} must be a number of seconds, 0 or more.`)
        if (e.start !== undefined && e.end !== undefined) check(e.end > e.start, 'end must be a number of seconds after start.')
        return { type: 'match_captions', text: e.text, ...(e.start !== undefined && { start: e.start }), ...(e.end !== undefined && { end: e.end }) }
      case 'set_captions': {
        check(fields.some((k) => e[k] !== undefined), `set_captions needs at least one of ${fields.join(', ')}.`)
        if (e.visible !== undefined) check(typeof e.visible === 'boolean', 'visible must be true or false.')
        for (const k of ['mode', 'position', 'animation', 'font'] as const) if (e[k] !== undefined) check((CHOICES[k] as readonly string[]).includes(e[k]), `${k} must be one of ${CHOICES[k].join(', ')}.`)
        if (e.size !== undefined) within('size', LIMITS.captionSize)
        if (e.color !== undefined) check(typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color), 'color must be a hex color like #ffffff.')
        return { type: 'set_captions', ...Object.fromEntries(fields.filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) }
      }
    }
  })
}

/** A zoom the user adds, from the timeline or an agent: the project's auto zoom level, following the
 *  cursor unless it aims at a point, in the look of the last zoom picked (settings.zoomLook). */
export function newZoom(p: Project, start: number, end: number, look: ZoomLook, at?: { x: number; y: number }, level?: number): Zoom {
  return { id: uid(), start, end, level: level ?? (p.style.autoZoom.level || 2), target: at ? { kind: 'point', ...at } : { kind: 'cursor' }, enabled: true, ...look }
}

/** Apply `edits` (from parseEdits, with resolveWordEdits' ranges and texts and auto_zoom's spans) to `p`
 *  in place, all or nothing: an edit that does not fit the project (a range past the end, an unknown
 *  zoom, a word the transcript lacks) throws before `p` changes. New zooms take `look` unless they name
 *  theirs (a loupe keeps `look`'s size and shape); caption text is checked against `transcript`. */
export function applyEdits(p: Project, edits: Edit[], look: ZoomLook, transcript: Transcript | null): void {
  const m = timeMap(p.clips)
  const clamp = (e: { start: number; end: number }, i: number): [number, number] => {
    if (e.start >= m.duration - EPS) throw new Error(`edits[${i}] starts at ${sec(e.start)} s, past the end of the ${sec(m.duration)} s video.`)
    return [e.start, Math.min(e.end, m.duration)]
  }

  // Cuts, restored cuts, and speed changes, from the end back. Overlapping cuts join; any other overlap,
  // or anything touching a restored cut, is ambiguous.
  const jumps = cuts(m, p.sources.duration)
  const spans: Array<{ i: number; a: number; b: number; speed?: number; restore?: number }> = []
  edits.forEach((e, i) => {
    if (e.type === 'restore_cut') {
      const c = jumps.reduce<Cut | null>((best, c) => (Math.abs(c.t - e.at) <= NEAR && (!best || Math.abs(c.t - e.at) < Math.abs(best.t - e.at)) ? c : best), null)
      if (!c) throw new Error(`edits[${i}]: nothing is cut at ${sec(e.at)} s. ${jumps.length ? `The video has cuts at ${jumps.map((c) => `${sec(c.t)} s`).join(', ')}.` : 'Nothing is cut from this video.'}`)
      spans.push({ i, a: c.t, b: c.t, restore: c.after })
    } else if (e.type === 'cut_fillers' || e.type === 'shorten_pauses') {
      if (!e.ranges) throw new Error(`edits[${i}] (${e.type}) has no ranges: resolveWordEdits works them out first.`)
      for (const [a, b] of e.ranges) if (b - a > EPS && a < m.duration - EPS) spans.push({ i, a, b: Math.min(b, m.duration) })
    } else if (e.type === 'cut' || e.type === 'set_speed') {
      const [a, b] = clamp(e, i)
      spans.push({ i, a, b, speed: e.type === 'set_speed' ? e.speed : undefined })
    }
  })
  spans.sort((x, y) => x.a - y.a)
  const runs: typeof spans = []
  for (const s of spans) {
    const prev = runs.at(-1)
    const restoring = prev && (prev.restore !== undefined || s.restore !== undefined)
    if (!prev || (restoring ? s.a > prev.b + EPS : s.a >= prev.b - EPS)) runs.push({ ...s })
    else if (!restoring && prev.speed === undefined && s.speed === undefined) prev.b = Math.max(prev.b, s.b)
    else if (restoring) throw new Error(`edits[${prev.i}] and edits[${s.i}] both change the video at ${sec(s.a)} s. Restore a cut in one call, then cut or change speed there in the next.`)
    else throw new Error(`edits[${prev.i}] and edits[${s.i}] overlap (${sec(s.a)}-${sec(Math.min(prev.b, s.b))} s). A speed change can't overlap a cut or another speed change in one call.`)
  }
  let clips = p.clips
  for (const r of runs.reverse()) {
    if (r.restore !== undefined) clips = restoreCut(clips, r.restore, p.sources.duration)
    else clips = r.speed === undefined ? removeOutputRange(clips, r.a, r.b) : setSpeed(clips, r.a, r.b, r.speed)
  }
  if (!clips.length) throw new Error('These cuts would remove the whole video. Keep at least part of it.')

  let zooms = p.zooms
  let captionEdits = p.captionEdits
  let captions = p.style.captions
  let autoZoom = p.style.autoZoom
  const named = (want?: 'zoom' | 'loupe'): ZoomLook => (want === 'zoom' ? {} : want === 'loupe' && look.mode !== 'loupe' ? { mode: 'loupe' } : look)
  /** Output range a..b as a zoom's source range, on the timeline before the list. */
  const sourceOf = (a: number, b: number, i: number): [number, number] => {
    if (b - a < MIN_ZOOM) throw new Error(`edits[${i}]: a zoom lasts at least ${MIN_ZOOM} s.`)
    const start = toSource(m, a)
    const end = toSource(m, b)
    // The range jumps back in the recording (clips out of order): the zoom ends with the clip it starts in.
    return [start, end > start ? end : m.clips[clipAt(m, a)].end]
  }
  edits.forEach((e, i) => {
    if (e.type === 'add_zoom') {
      const [start, end] = sourceOf(...clamp(e, i), i)
      zooms = [...zooms, newZoom(p, start, end, named(e.look), e.x === undefined ? undefined : { x: e.x, y: e.y! }, e.level)]
    } else if (e.type === 'auto_zoom') {
      if (!e.spans) throw new Error(`edits[${i}] (auto_zoom) has no spans: generateAutoZooms works them out first.`)
      // As the editor's Auto zoom: on at this level, its zooms in place of the ones it placed before.
      autoZoom = { enabled: true, level: e.level ?? (autoZoom.level || 2) }
      const level = autoZoom.level
      zooms = [...zooms.filter((z) => !z.auto), ...e.spans.map(([a, b]) => ({ ...newZoom(p, a, b, named(e.look), undefined, level), auto: true }))]
    } else if (e.type === 'set_zoom') {
      const z = zooms.find((z) => z.id === e.id)
      if (!z) throw new Error(`edits[${i}]: no zoom has the id “${e.id}”. get_project lists the zooms.`)
      let range: [number, number] | undefined
      if (e.start !== undefined || e.end !== undefined) {
        // The ends not given stay where the zoom plays now.
        const spans = mapRange(m, z.start, z.end)
        if (!spans.length && (e.start === undefined || e.end === undefined)) throw new Error(`edits[${i}]: zoom “${e.id}” is cut out of the video, so give both start and end.`)
        const a = e.start ?? spans[0][0]
        const b = e.end ?? spans.at(-1)![1]
        if (b <= a) throw new Error(`edits[${i}]: the zoom would end (${sec(b)} s) before it starts (${sec(a)} s).`)
        range = sourceOf(...clamp({ start: a, end: b }, i), i)
      }
      const { auto: _, ...manual } = z // the agent placed it: turning auto zoom off leaves it be
      const target = e.x === undefined ? z.target : { kind: 'point' as const, x: e.x, y: e.y! }
      zooms = zooms.map((y) => (y === z ? { ...manual, ...(range && { start: range[0], end: range[1] }), ...(e.level !== undefined && { level: e.level }), target } : y))
    } else if (e.type === 'remove_zoom') {
      if (!zooms.some((z) => z.id === e.id)) throw new Error(`edits[${i}]: no zoom has the id “${e.id}”. get_project lists the zooms.`)
      zooms = zooms.filter((z) => z.id !== e.id)
    } else if (e.type === 'set_caption_text') caption(e.index, e.text, i)
    else if (e.type === 'match_captions') {
      if (!e.texts) throw new Error(`edits[${i}] (match_captions) has no texts: resolveWordEdits works them out first.`)
      for (const [index, text] of e.texts) caption(index, text, i)
    } else if (e.type === 'set_captions') {
      const { type: _, ...patch } = e
      captions = { ...captions, ...patch }
    }
  })
  function caption(index: number, text: string, i: number) {
    if (!transcript) throw new Error('This project has no transcript, so its captions have no words to fix. transcribe_project makes one.')
    const word = transcript.words[index]
    if (!word) throw new Error(`edits[${i}]: the transcript has ${transcript.words.length} words, so there is no word ${index}.`)
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
    const at = word.key ?? index
    captionEdits = { ...captionEdits }
    if (clean(text) === clean(word.text)) delete captionEdits[at]
    else captionEdits[at] = clean(text)
  }

  if (clips !== p.clips) p.clips = clips
  if (zooms !== p.zooms) p.zooms = zooms
  if (captionEdits !== p.captionEdits) p.captionEdits = captionEdits
  if (captions !== p.style.captions) p.style.captions = captions
  if (autoZoom !== p.style.autoZoom) p.style.autoZoom = autoZoom
  p.autoZoomed = true // the agent directed it: opening it later never adds auto zooms back
}
