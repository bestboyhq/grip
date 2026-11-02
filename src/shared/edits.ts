// Edits an agent asks for (electron/agents.ts): checked like any untrusted input, then applied to a
// project all at once. Every time is output seconds on the timeline as it was before the list, the
// one get_project shows, whatever the list does to it: cuts and speed changes run from the end back,
// so none moves the times of another, and zooms take their source times from the timeline before any
// of them. Main applies a list to a closed project on disk; an open editor applies it as one undo
// step (Editor.svelte). Pure: node:test runs it.

import { CAPTION_FONTS, uid, type Project, type Style, type Transcript, type Zoom, type ZoomLook } from './project.ts'
import { clipAt, removeOutputRange, setSpeed, timeMap, toSource } from './timemap.ts'

type Captions = Style['captions']
export type Edit =
  | { type: 'cut'; start: number; end: number }
  | { type: 'set_speed'; start: number; end: number; speed: number }
  | { type: 'add_zoom'; start: number; end: number; level?: number; x?: number; y?: number }
  | { type: 'remove_zoom'; id: string }
  | { type: 'set_caption_text'; index: number; text: string }
  | ({ type: 'set_captions' } & Partial<Captions>)

/** What the editor's own controls offer: the speed menu, the zoom level slider, the caption size slider. */
export const LIMITS = { speed: [0.25, 8], level: [1.1, 6], captionSize: [20, 120] } as const
const MIN_ZOOM = 0.1 // s, the shortest item the timeline makes (timeline/model.ts MIN_LEN)
const MAX_EDITS = 1000
const MAX_TEXT = 200
const EPS = 1e-6
const CHOICES = {
  mode: ['line', 'word'],
  position: ['bottom', 'top'],
  animation: ['appear', 'fade', 'slide'],
  font: CAPTION_FONTS.map((f) => f.value),
} as const
const FIELDS: Record<Edit['type'], string[]> = {
  cut: ['start', 'end'],
  set_speed: ['start', 'end', 'speed'],
  add_zoom: ['start', 'end', 'level', 'x', 'y'],
  remove_zoom: ['id'],
  set_caption_text: ['index', 'text'],
  set_captions: ['visible', 'mode', 'position', 'size', 'color', 'font', 'animation'],
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const sec = (t: number) => String(Math.round(t * 100) / 100)

/** `x` as a list of edits, or an Error that says which edit is wrong and how. */
export function parseEdits(x: unknown): Edit[] {
  if (!Array.isArray(x) || !x.length) throw new Error('edits must be a list with at least one edit.')
  if (x.length > MAX_EDITS) throw new Error(`Send at most ${MAX_EDITS} edits at once.`)
  return x.map((e: any, i): Edit => {
    const at = `edits[${i}]`
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${at} must be an object with a type.`)
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
    switch (e.type as Edit['type']) {
      case 'cut':
        return { type: 'cut', ...range() }
      case 'set_speed':
        within('speed', LIMITS.speed, '×')
        return { type: 'set_speed', ...range(), speed: e.speed }
      case 'add_zoom': {
        const r = range()
        if (e.level !== undefined) within('level', LIMITS.level, '×')
        check((e.x === undefined) === (e.y === undefined), 'x and y go together: give both to aim at a point, or neither to follow the cursor.')
        if (e.x !== undefined) for (const k of ['x', 'y']) within(k, [0, 1])
        return { type: 'add_zoom', ...r, ...(e.level !== undefined && { level: e.level }), ...(e.x !== undefined && { x: e.x, y: e.y }) }
      }
      case 'remove_zoom':
        check(typeof e.id === 'string' && !!e.id, 'id must be the id of a zoom, as get_project lists it.')
        return { type: 'remove_zoom', id: e.id }
      case 'set_caption_text':
        check(Number.isInteger(e.index) && e.index >= 0, 'index must be the index of a transcript word, as get_transcript lists it.')
        check(typeof e.text === 'string' && e.text.length <= MAX_TEXT, `text must be a string of at most ${MAX_TEXT} characters ('' hides the word).`)
        return { type: 'set_caption_text', index: e.index, text: e.text }
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

/** Apply `edits` (from parseEdits) to `p` in place, all or nothing: an edit that does not fit the
 *  project (a range past the end, an unknown zoom, a word the transcript lacks) throws before `p`
 *  changes. New zooms take `look`; caption text is checked against `transcript`. */
export function applyEdits(p: Project, edits: Edit[], look: ZoomLook, transcript: Transcript | null): void {
  const m = timeMap(p.clips)
  const clamp = (e: { start: number; end: number }, i: number): [number, number] => {
    if (e.start >= m.duration - EPS) throw new Error(`edits[${i}] starts at ${sec(e.start)} s, past the end of the ${sec(m.duration)} s video.`)
    return [e.start, Math.min(e.end, m.duration)]
  }

  // Cuts and speed changes, from the end back. Overlapping cuts join; any other overlap is ambiguous.
  const spans: Array<{ i: number; a: number; b: number; speed?: number }> = []
  edits.forEach((e, i) => {
    if (e.type !== 'cut' && e.type !== 'set_speed') return
    const [a, b] = clamp(e, i)
    spans.push({ i, a, b, speed: e.type === 'set_speed' ? e.speed : undefined })
  })
  spans.sort((x, y) => x.a - y.a)
  const runs: typeof spans = []
  for (const s of spans) {
    const prev = runs.at(-1)
    if (!prev || s.a >= prev.b - EPS) runs.push({ ...s })
    else if (prev.speed === undefined && s.speed === undefined) prev.b = Math.max(prev.b, s.b)
    else throw new Error(`edits[${prev.i}] and edits[${s.i}] overlap (${sec(s.a)}-${sec(Math.min(prev.b, s.b))} s). A speed change can't overlap a cut or another speed change in one call.`)
  }
  let clips = p.clips
  for (const r of runs.reverse()) clips = r.speed === undefined ? removeOutputRange(clips, r.a, r.b) : setSpeed(clips, r.a, r.b, r.speed)
  if (!clips.length) throw new Error('These cuts would remove the whole video. Keep at least part of it.')

  let zooms = p.zooms
  let captionEdits = p.captionEdits
  let captions = p.style.captions
  edits.forEach((e, i) => {
    if (e.type === 'add_zoom') {
      const [a, b] = clamp(e, i)
      if (b - a < MIN_ZOOM) throw new Error(`edits[${i}]: a zoom lasts at least ${MIN_ZOOM} s.`)
      const start = toSource(m, a)
      let end = toSource(m, b)
      // The range jumps back in the recording (clips out of order): the zoom ends with the clip it starts in.
      if (end <= start) end = m.clips[clipAt(m, a)].end
      zooms = [...zooms, newZoom(p, start, end, look, e.x === undefined ? undefined : { x: e.x, y: e.y! }, e.level)]
    } else if (e.type === 'remove_zoom') {
      if (!zooms.some((z) => z.id === e.id)) throw new Error(`edits[${i}]: no zoom has the id “${e.id}”. get_project lists the zooms.`)
      zooms = zooms.filter((z) => z.id !== e.id)
    } else if (e.type === 'set_caption_text') {
      if (!transcript) throw new Error('This project has no transcript, so its captions have no words to fix. Transcribe it in Grip first (Captions in the inspector).')
      const word = transcript.words[e.index]
      if (!word) throw new Error(`edits[${i}]: the transcript has ${transcript.words.length} words, so there is no word ${e.index}.`)
      const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
      captionEdits = { ...captionEdits }
      if (clean(e.text) === clean(word.text)) delete captionEdits[e.index]
      else captionEdits[e.index] = clean(e.text)
    } else if (e.type === 'set_captions') {
      const { type: _, ...patch } = e
      captions = { ...captions, ...patch }
    }
  })

  if (clips !== p.clips) p.clips = clips
  if (zooms !== p.zooms) p.zooms = zooms
  if (captionEdits !== p.captionEdits) p.captionEdits = captionEdits
  if (captions !== p.style.captions) p.style.captions = captions
  p.autoZoomed = true // the agent directed it: opening it later never adds auto zooms back
}
