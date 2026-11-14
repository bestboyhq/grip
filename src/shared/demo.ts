// Owner: agents. A demo an agent records with record_demo (electron/demo.ts): its arguments checked, its
// selectors and keys read, and the hand-like pointer that moves between its targets. Pure: no DOM, no Node.
import type { Modifier } from './events.ts'

export type Pt = [number, number]
/** CSS: the first visible match. text: the innermost element whose text contains `text` in any case,
 *  or is exactly `text` when `exact`, its spaces collapsed. */
export type Selector = { css: string } | { text: string; exact: boolean }
/** A key press: what Electron sends (keyCode, modifiers), what the recorder would log (label, mods), the
 *  character it types, when it types one, and the editing command a Mac's key bindings make of it, with
 *  the DOM key, code, and key code that command goes with. */
export type Key = {
  code: string
  modifiers: Array<'shift' | 'control' | 'alt' | 'meta'>
  label: string
  mods: Modifier[]
  char?: string
  edit?: { command: string; key: string; code: string; vk: number }
}
export type Step =
  | { do: 'click' | 'hover' | 'scroll'; target: Selector; label: string; say?: string }
  | { do: 'type'; text: string; into?: Selector; label: string; say?: string }
  | { do: 'press'; key: Key; label: string; say?: string }
  | { do: 'wait'; target: Selector; label: string; say?: string }
  | { do: 'wait'; ms: number; label: string; say?: string }
export type Demo = { url: string; steps: Step[]; width: number; height: number; title?: string; share: boolean; private: boolean }

export const MAX_STEPS = 30
export const MAX_WAIT_MS = 30_000
export const SIZE = { width: [320, 1920, 1440], height: [240, 1200, 900] } as const // CSS px: min, max, default
const ACTIONS = ['click', 'hover', 'type', 'press', 'scroll', 'wait'] as const

/** 0..1 eased in and out, with no jerk at either end. */
export const smooth = (p: number) => p * p * p * (p * (6 * p - 15) + 10)

/** The pointer at t along [t, x, y] waypoints: eased between them, on a slight arc like a hand. */
export function glide(path: Array<[number, number, number]>) {
  return (t: number): Pt => {
    let i = 0
    while (i + 2 < path.length && path[i + 1][0] <= t) i++
    const [t0, x0, y0] = path[i]
    const [t1, x1, y1] = path[i + 1] ?? path[i]
    const p = t1 > t0 ? smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))) : 1
    const bow = Math.sin(Math.PI * p) * 0.05
    return [x0 + (x1 - x0) * p - (y1 - y0) * bow, y0 + (y1 - y0) * p + (x1 - x0) * bow]
  }
}

/** Seconds a hand takes to move the pointer `d` CSS px onto a target (Fitts's law, a 40 px target). */
export const travel = (d: number) => (d < 1 ? 0 : 0.25 + 0.12 * Math.log2(1 + d / 40))

/** When character i of a text typed from t0 lands, at `cps` characters a second with a little human unevenness. */
export const typedAt = (t0: number, i: number, cps = 10) => t0 + (i + 0.35 * Math.sin(i * 2.7)) / cps

export function parseSelector(s: unknown, what: string): Selector {
  if (typeof s !== 'string' || !s.trim()) throw new Error(`${what} must be a CSS selector or text=…`)
  if (s.length > 500) throw new Error(`${what} takes at most 500 characters.`)
  const text = /^text=(.*)$/s.exec(s.trim())?.[1]
  if (text === undefined) return { css: s.trim() }
  const quoted = /^"(.*)"$/s.exec(text)
  const want = (quoted ? quoted[1] : text).replace(/\s+/g, ' ').trim()
  if (!want) throw new Error(`${what} names no text after text=.`)
  return { text: want, exact: !!quoted }
}

/** Keys by the names web tests use: [Electron keyCode, the recorder's label, the character typed]. */
const KEYS: Record<string, [string, string, string?]> = {
  Enter: ['Enter', '↩', '\r'], Tab: ['Tab', '⇥'], Escape: ['Escape', '⎋'], Backspace: ['Backspace', '⌫'], Delete: ['Delete', '⌦'],
  ArrowLeft: ['Left', '←'], ArrowRight: ['Right', '→'], ArrowUp: ['Up', '↑'], ArrowDown: ['Down', '↓'],
  Home: ['Home', '↖'], End: ['End', '↘'], PageUp: ['PageUp', '⇞'], PageDown: ['PageDown', '⇟'], Space: ['Space', 'Space', ' '],
}
/** In the recorder's order: ⌃ ⌥ ⇧ ⌘. */
const MODS: Array<[string, Key['modifiers'][number], Modifier]> = [['Control', 'control', '⌃'], ['Alt', 'alt', '⌥'], ['Shift', 'shift', '⇧'], ['Meta', 'meta', '⌘']]
/** The ⌘ shortcuts a Mac's key bindings turn into editing commands. A page edits with them only when the
 *  command comes with the key, as a real keyboard's does. Copy, cut, and paste stay out: a demo never
 *  reads or replaces the clipboard. */
const EDITS: Record<string, string> = {
  'Meta+A': 'selectAll', 'Meta+Z': 'undo', 'Shift+Meta+Z': 'redo', 'Meta+Backspace': 'deleteToBeginningOfLine',
  'Meta+ArrowLeft': 'moveToLeftEndOfLine', 'Meta+ArrowRight': 'moveToRightEndOfLine', 'Meta+ArrowUp': 'moveToBeginningOfDocument', 'Meta+ArrowDown': 'moveToEndOfDocument',
  'Shift+Meta+ArrowLeft': 'moveToLeftEndOfLineAndModifySelection', 'Shift+Meta+ArrowRight': 'moveToRightEndOfLineAndModifySelection',
  'Shift+Meta+ArrowUp': 'moveToBeginningOfDocumentAndModifySelection', 'Shift+Meta+ArrowDown': 'moveToEndOfDocumentAndModifySelection',
}
const VK: Record<string, number> = { Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }

/** "Enter", "a", "F5", "Meta+K", "Shift+Tab": the key last, its modifiers before it, joined by +. */
export function parseKey(s: unknown): Key {
  const bad = () => new Error(`press must be a key like Enter, Escape, Tab, ArrowDown, a, or F5, with modifiers before it like Meta+K or Shift+Tab; “${String(s)}” is not one.`)
  if (typeof s !== 'string' || !s) throw bad()
  const parts = s === '+' ? ['+'] : s.endsWith('++') ? [...s.slice(0, -2).split('+'), '+'] : s.split('+')
  const name = parts.pop()!
  const held = MODS.filter(([n]) => parts.includes(n))
  if (held.length !== parts.length || new Set(parts).size !== parts.length) throw bad()
  const modifiers = held.map((m) => m[1])
  const mods = held.map((m) => m[2])
  const command = modifiers.some((m) => m === 'meta' || m === 'control' || m === 'alt')
  const letter = name.length === 1 ? name.toUpperCase() : ''
  const edit = EDITS[[...held.map((m) => m[0]), letter || name].join('+')]
  const edits = edit ? { edit: { command: edit, key: letter ? name.toLowerCase() : name, code: letter ? `Key${letter}` : name, vk: letter ? letter.charCodeAt(0) : VK[name] } } : {}
  const known = KEYS[name] ?? (/^F([1-9]|1\d|20)$/.test(name) ? [name, name] : null)
  if (known) return { code: known[0], modifiers, label: known[1], mods, ...(known[2] && !command ? { char: known[2] } : {}), ...edits }
  if (!/^[\x21-\x7e]$/.test(name)) throw bad()
  return { code: name, modifiers, label: name, mods, ...(command ? {} : { char: name }), ...edits }
}

const quote = (s: Selector) => ('css' in s ? s.css : s.exact ? `text="${s.text}"` : `text=${s.text}`)

/** record_demo's arguments, checked: each step exactly one action and its say. Throws in plain language. */
export function parseDemo(a: Record<string, unknown>): Demo {
  let url: URL
  try {
    url = new URL(String(a.url))
  } catch {
    throw new Error('url must be a full http, https, or file URL.')
  }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('url must be an http, https, or file URL.')
  if (url.protocol === 'file:' && url.hostname) throw new Error('url must be a file URL on this Mac, like file:///Users/me/page.html.')
  const size = (k: 'width' | 'height') => {
    const [min, max, fallback] = SIZE[k]
    if (a[k] === undefined) return fallback
    if (!Number.isInteger(a[k]) || (a[k] as number) < min || (a[k] as number) > max) throw new Error(`${k} must be a whole number of CSS px from ${min} to ${max}.`)
    return a[k] as number
  }
  for (const k of ['share', 'private'] as const) if (a[k] !== undefined && typeof a[k] !== 'boolean') throw new Error(`${k} must be true or false.`)
  if (a.title !== undefined && (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 200)) throw new Error('title must be 1 to 200 characters.')
  if (!Array.isArray(a.steps) || !a.steps.length || a.steps.length > MAX_STEPS) throw new Error(`steps must be a list of 1 to ${MAX_STEPS} steps.`)
  const steps = a.steps.map((raw, i): Step => {
    const n = `Step ${i + 1}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${n} must be an object, like {"click": "#save"}.`)
    const s = raw as Record<string, unknown>
    const did = ACTIONS.filter((k) => s[k] !== undefined)
    if (did.length !== 1) throw new Error(`${n} must have exactly one of ${ACTIONS.join(', ')}; it has ${did.join(' and ') || 'none'}.`)
    const act = did[0]
    for (const k of Object.keys(s)) if (k !== act && k !== 'say' && !(act === 'type' && k === 'into')) throw new Error(`${n} has “${k}”, which ${act} does not take.`)
    if (s.say !== undefined && (typeof s.say !== 'string' || !s.say.trim() || s.say.length > 80)) throw new Error(`${n}: say must be 1 to 80 characters.`)
    const say = (s.say as string | undefined)?.trim()
    const named = <T extends object>(step: T, label: string) => ({ ...step, label: say ?? label, ...(say ? { say } : {}) })
    if (act === 'type') {
      if (typeof s.type !== 'string' || !s.type || s.type.length > 500) throw new Error(`${n}: type must be 1 to 500 characters of text.`)
      const into = s.into === undefined ? undefined : parseSelector(s.into, `${n}: into`)
      return named({ do: 'type' as const, text: s.type, ...(into ? { into } : {}) }, `type “${s.type}”${into ? ` into ${quote(into)}` : ''}`)
    }
    if (act === 'press') return named({ do: 'press' as const, key: parseKey(s.press) }, `press ${s.press}`)
    if (act === 'wait' && typeof s.wait === 'number') {
      if (!Number.isInteger(s.wait) || s.wait < 0 || s.wait > MAX_WAIT_MS) throw new Error(`${n}: wait must be a selector, or a whole number of ms up to ${MAX_WAIT_MS}.`)
      return named({ do: 'wait' as const, ms: s.wait }, `wait ${s.wait} ms`)
    }
    const target = parseSelector(s[act], `${n}: ${act}`)
    return named({ do: act, target }, `${act} ${quote(target)}`) as Step
  })
  return { url: url.href, steps, width: size('width'), height: size('height'), title: (a.title as string | undefined)?.trim(), share: a.share === true, private: a.private === true }
}

/** The share link's chapters: each said step at its start, in output seconds, never two at one time. */
export function chapters(said: Array<{ t: number; title: string }>): Array<{ t: number; title: string }> {
  const out: Array<{ t: number; title: string }> = []
  for (const c of said) {
    const t = Math.max(Math.round(c.t * 100) / 100, out.length ? out[out.length - 1].t + 0.01 : 0)
    out.push({ t: Math.round(t * 100) / 100, title: c.title })
  }
  return out
}

const TARGET = { type: 'string', minLength: 1, maxLength: 500, description: 'A CSS selector (its first visible match), or text=Deploy for the innermost element whose text holds “Deploy” in any case, or text="Deploy" for the one whose text is exactly that.' }
const SAY = { type: 'string', minLength: 1, maxLength: 80, description: 'What the step shows, in a few words: its label, and a chapter of the share link.' }
const step = (act: string, schema: object, description: string, extra: object = {}) => ({ type: 'object', description, properties: { [act]: schema, ...extra, say: SAY }, required: [act], additionalProperties: false })

/** record_demo's arguments, as parseDemo reads them. */
export const DEMO_INPUT = {
  type: 'object' as const,
  properties: {
    url: { type: 'string', minLength: 1, description: 'The page: an http, https, or file URL, like http://localhost:5173/settings.' },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_STEPS,
      description: 'What happens, in order. Each step has one action, and say when it marks a moment worth a chapter.',
      items: {
        anyOf: [
          step('click', TARGET, 'Move the pointer to the element, scrolling it into view first, and click it.'),
          step('hover', TARGET, 'Move the pointer onto the element and rest there.'),
          step('type', { type: 'string', minLength: 1, maxLength: 500, description: 'The text, typed at a person’s pace; \\n presses Return.' }, 'Type text into the element in focus, or into `into` after clicking it.', { into: TARGET }),
          step('press', { type: 'string', minLength: 1, description: 'A key, like Enter, Escape, Tab, Backspace, ArrowDown, PageDown, a, or F5, with modifiers before it, like Meta+K or Shift+Tab. Meta+A selects all and Meta+Z undoes; Meta+C, Meta+X, and Meta+V reach only the page’s own key handlers, as a demo never touches the clipboard.' }, 'Press a key.'),
          step('scroll', TARGET, 'Scroll with the wheel until the element is in the middle of the view.'),
          step('wait', { anyOf: [TARGET, { type: 'integer', minimum: 0, maximum: MAX_WAIT_MS, description: 'Milliseconds.' }] }, 'Wait until the element shows (up to 10 s), or for a number of milliseconds.'),
        ],
      },
    },
    width: { type: 'integer', minimum: SIZE.width[0], maximum: SIZE.width[1], description: `The page’s width in CSS px; the video has twice as many pixels, as a Retina screen. Default: ${SIZE.width[2]}.` },
    height: { type: 'integer', minimum: SIZE.height[0], maximum: SIZE.height[1], description: `The page’s height in CSS px. Default: ${SIZE.height[2]}.` },
    title: { type: 'string', minLength: 1, maxLength: 200, description: 'The project’s name, and the link’s title (a new version renames its link). Default: Demo and the date and time.' },
    share: { type: 'boolean', description: 'Also upload the MP4 and its GIF and answer with its share link on bestboy.dev, with a chapter at each step that has say. Needs Grip signed in to a Bestboy account. Default: false.' },
    private: { type: 'boolean', description: 'With share: only the user’s team, and people sent this exact link, can watch. A new version keeps its link’s privacy. Default: false.' },
    link: { type: 'string', minLength: 1, description: 'The share link of an earlier demo, like https://bestboy.dev/v/x7Kq2mP9aB3c, or its 12-character id: the new video becomes its next version, so every place the link was posted (a pull request, a chat) shows the fix once it is up. Implies share, and counts as an upload like any other.' },
  },
  required: ['url', 'steps'],
}
