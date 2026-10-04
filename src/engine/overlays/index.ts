// Owner: compositor (overlays). Click effects, keystroke groups, and caption pages in OUTPUT time,
// plus drawOverlays() which paints them with Canvas 2D (text and keycaps get the platform's
// font rendering) for the GPU compositor to layer on top.
// prepareOverlays maps every item through the one time map once per project revision and output
// size; clicksAt / keystrokesAt / captionAt are pure lookups, so any frame renders alone, in any order.

import { toOutput, type TimeMap } from '../../shared/timemap.ts'
import type { InputEvent, Modifier } from '../../shared/events.ts'
import type { Style } from '../../shared/project.ts'
import { outputSize, type Caption, type Click, type Keystroke, type Scene, type SceneInput } from '../scene.ts'
import { screenAt, type prepareLayout } from '../layout.ts'
import { springProgress } from '../motion/spring.ts'
import { captionCues } from '../transcript/index.ts'

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type Prepared = ReturnType<typeof prepareOverlays>

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3

/** Index of the first item that starts after t (items sorted by start). */
function upper(a: Array<{ start: number }>, t: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m].start <= t) lo = m + 1
    else hi = m
  }
  return lo
}

// ---- Tuning (seconds, and lengths in units: 1 unit = min(w, h) / 1080 px). ----

const CLICK_LIFE: Record<Click['style'], number> = { none: 0, ripple: 0.6, circle: 0.45, shockwave: 0.55 }

const KEY_H = 78 // keycap height incl. its side
const KEY_GAP = 8 // between keycaps of one shortcut
const ROW_GAP = 14 // between stacked shortcuts
const MAX_STACK = 3 // shortcuts visible at once; older ones are pushed out
const LINGER = 1.2 // a shortcut stays this long after its key is released
const KEY_IN = 0.12
const KEY_OUT = 0.3
const KEY_SLIDE = 0.22
const TYPING_GAP = 1 // a bare special key (↩ ⇥ ⌫) this close to typing is part of the typing
const REPEAT_GAP = 2.1 // longest macOS delay until key repeat, at its slowest setting

const CAP_IN = 0.18
const CAP_OUT = 0.16
const WORD_IN = 0.14
const LINE_H = 1.36 // caption line box height, em
const LINE_GAP = 0.1 // em between line boxes
const PAD = 0.42 // em of caption backing beside the text

// ---- Placement shared by captions and keystrokes, so the two never overlap. ----

const portrait = (w: number, h: number) => h > w
/** Distance of the caption block from its edge. Vertical video keeps clear of Reels/TikTok/Shorts UI. */
function captionMargin(w: number, h: number, unit: number, position: Style['captions']['position']): number {
  return portrait(w, h) ? h * (position === 'bottom' ? 0.22 : 0.12) : 56 * unit
}
/** Bottom edge of the newest shortcut; above a two-line caption block when captions sit at the bottom. */
function keystrokeBase(w: number, h: number, unit: number, c: Style['captions']): number {
  if (!c.visible || c.position !== 'bottom') return h - (portrait(w, h) ? h * 0.22 : 56 * unit)
  const em = c.size * unit
  return h - captionMargin(w, h, unit, 'bottom') - (2 * LINE_H + LINE_GAP) * em - 24 * unit
}

// ---- Prepare ----

export function prepareOverlays(input: SceneInput, map: TimeMap, layout: ReturnType<typeof prepareLayout>) {
  const { width, height, project } = input
  const unit = Math.min(width, height) / 1080
  const keys = keyGroups(input.events, map)
  let reach = -Infinity
  const keyReach = keys.map((g) => (reach = Math.max(reach, g.end + LINGER + KEY_OUT)))
  return {
    input,
    map,
    layout,
    unit,
    clicks: clickTimes(input.events, map),
    keys,
    keyReach, // max visible-until over keys[0..i], so lookups can stop scanning back early
    keyBase: keystrokeBase(width, height, unit, project.style.captions),
    pages: captionPages(input, map),
  }
}

// ---- Clicks ----

type Button = Extract<InputEvent, { button: unknown }>
/** Per events array (replaced, never edited in place): what clicks and keystrokes read of it, so a
 *  preparation after an edit does not walk a 2-hour recording's million events again. */
const scanned = new WeakMap<InputEvent[], { downs: Button[]; presses: Press[]; typing: Array<{ start: number }> }>()
function scan(events: InputEvent[]) {
  let s = scanned.get(events)
  if (!s) scanned.set(events, (s = { downs: events.filter((e): e is Button => e.type === 'down'), ...keyPresses(events) }))
  return s
}

function clickTimes(events: InputEvent[], map: TimeMap) {
  const out: Array<{ start: number; x: number; y: number }> = []
  for (const e of scan(events).downs) {
    const start = toOutput(map, e.t)
    if (start !== null) out.push({ start, x: e.x, y: e.y }) // a click inside a cut never shows
  }
  return out.sort((a, b) => a.start - b.start)
}

export function clicksAt(o: Prepared, t: number): Click[] {
  const style = o.input.project.style.cursor.click
  const s = o.input.project.sources.screen
  const hi = upper(o.clicks, t)
  let lo = hi
  while (lo > 0 && t - o.clicks[lo - 1].start < CLICK_LIFE[style]) lo--
  const live = o.clicks.slice(lo, hi)
  const r = live.length && s ? screenAt(o.layout, t)?.screen : null
  if (!r || !s) return []
  const k = r.w / s.width
  return live.map((c) => ({ x: r.x + c.x * k, y: r.y + c.y * k, age: t - c.start, style }))
}

// ---- Keystrokes ----

const MODS: Modifier[] = ['fn', '⌃', '⌥', '⇧', '⌘'] // macOS order
/** Keycap name under the symbol, as printed on a Mac keyboard. Keys listed here (and F-keys) are "special". */
const NAMES: Record<string, string> = {
  fn: '', '⌃': 'control', '⌥': 'option', '⇧': 'shift', '⌘': 'command',
  '↩': 'return', '⌤': 'enter', '⎋': 'esc', '⇥': 'tab', '⌫': 'delete', '⌦': 'delete', '⇪': 'caps lock',
  '⇞': 'page up', '⇟': 'page down', '↖': 'home', '↘': 'end', '←': '', '→': '', '↑': '', '↓': '', Space: 'space',
}
/** Label spellings the recorder may use -> canonical keycap id. */
const ALIAS: Record<string, string> = {
  Return: '↩', Enter: '⌤', Escape: '⎋', Esc: '⎋', Tab: '⇥', Delete: '⌫', Backspace: '⌫', ForwardDelete: '⌦',
  Left: '←', ArrowLeft: '←', Right: '→', ArrowRight: '→', Up: '↑', ArrowUp: '↑', Down: '↓', ArrowDown: '↓',
  PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘', CapsLock: '⇪', ' ': 'Space', '␣': 'Space',
  Command: '⌘', Shift: '⇧', Option: '⌥', Alt: '⌥', Control: '⌃', Ctrl: '⌃', Fn: 'fn', Function: 'fn',
}
const FKEY = /^F\d{1,2}$/
const FN_IMPLIED = /^(F\d{1,2}|[←→↑↓⇞⇟↖↘⌦])$/ // macOS sets the fn flag on these by itself

const keyId = (label: string) => {
  const k = ALIAS[label] ?? label
  return [...k].length === 1 ? k.toUpperCase() : k
}

/** Keycaps for a key press, 'typing' for text (never shown: privacy), null for keys to ignore. */
export function classifyKey(label: string, mods: Modifier[]): { keys: string[]; bare: boolean } | 'typing' | null {
  const k = keyId(label)
  if (!k.trim() || MODS.includes(k as Modifier)) return null // unknown key, or a modifier on its own
  const m = MODS.filter((x) => mods.includes(x) && !(x === 'fn' && FN_IMPLIED.test(k)))
  const command = m.some((x) => x === '⌘' || x === '⌃' || x === 'fn')
  // ⇧ and ⌥ with a character key type text (capitals, ą, é, –); only ⌘ ⌃ fn make it a shortcut.
  if (!command && (k === 'Space' || !(k in NAMES || FKEY.test(k)))) return 'typing'
  return { keys: [...m, k], bare: !command }
}

interface Group {
  keys: string[]
  sig: string
  main: string // the non-modifier key, whose release ends the group
  start: number // output seconds of the first press
  last: number // latest press
  end: number // latest press, release, or key repeat
  count: number
}

type Press = { t: number; id: string; up: boolean; repeat: boolean; keys: string[]; bare: boolean }

/** Key presses to show and the typing around them, in source time. */
function keyPresses(events: InputEvent[]) {
  const presses: Press[] = []
  const typing: Array<{ start: number }> = []
  const held = new Map<string, number>() // key -> latest down while held
  let secure = false
  for (const e of events) {
    if (e.type === 'secure') {
      secure = e.on
      held.clear()
    }
    if (e.type !== 'key' || secure) continue // nothing typed into a password field ever shows
    const id = keyId(e.key)
    if (!e.down) {
      held.delete(id)
      presses.push({ t: e.t, id, up: true, repeat: false, keys: [], bare: false })
      continue
    }
    const c = classifyKey(e.key, e.mods)
    if (c === 'typing') typing.push({ start: e.t })
    // Key repeat = another down while held. A lost key-up (pause, torn file) must not swallow later presses.
    else if (c) presses.push({ t: e.t, id, up: false, repeat: e.t - (held.get(id) ?? -Infinity) < REPEAT_GAP, ...c })
    held.set(id, e.t)
  }
  return { presses, typing }
}

function keyGroups(events: InputEvent[], map: TimeMap): Group[] {
  const { presses, typing } = scan(events)
  const nearTyping = (t: number) => {
    const i = upper(typing, t + TYPING_GAP) - 1
    return i >= 0 && typing[i].start >= t - TYPING_GAP
  }

  const groups: Group[] = []
  for (const p of presses) {
    const out = toOutput(map, p.t)
    if (out === null) continue // inside a cut
    const g = groups.at(-1)
    const live = g && out >= g.last && out <= g.end + LINGER ? g : null
    if (p.up || p.repeat) {
      // Release or key repeat while held: keeps the shortcut on screen, never counts as a press.
      if (live && live.main === p.id) live.end = Math.max(live.end, out)
      continue
    }
    if (p.bare && nearTyping(p.t)) continue
    const sig = p.keys.join(' ')
    if (live && live.sig === sig) {
      live.count++
      live.last = out
      live.end = Math.max(live.end, out)
    } else groups.push({ keys: p.keys, sig, main: p.id, start: out, last: out, end: out, count: 1 })
  }
  return groups.sort((a, b) => a.start - b.start)
}

export function keystrokesAt(o: Prepared, t: number): Keystroke[] {
  const st = o.input.project.style.keystrokes
  if (!st.visible) return []
  const k = o.unit * st.size
  const out: Keystroke[] = []
  let slot = 0 // stack height of newer shortcuts, animated
  for (let i = upper(o.keys, t) - 1; i >= 0 && o.keyReach[i] > t; i--) {
    const g = o.keys[i]
    const leave = clamp01((g.end + LINGER + KEY_OUT - t) / KEY_OUT)
    if (leave <= 0) continue
    const enter = easeOut((t - g.start) / KEY_SLIDE)
    out.unshift({
      keys: g.keys,
      count: g.count,
      age: t - g.last,
      size: st.size,
      opacity: clamp01((t - g.start) / KEY_IN) * leave * clamp01(MAX_STACK - slot),
      y: o.keyBase - slot * (KEY_H + ROW_GAP) * k + (1 - enter) * 0.4 * KEY_H * k,
    })
    slot += enter * leave
  }
  return out
}

// ---- Captions ----
// Which words show when comes from the transcript engine (captionCues), the same cues SRT and VTT
// export, so burned-in captions and subtitle files always agree. Here only layout: pages and lines per cue.

interface Page {
  start: number // output seconds
  end: number
  fadeOut: boolean // false when the next caption replaces this one directly
  words: Array<{ text: string; start: number; line: number }>
}

const chars = (s: string) => [...s].length

/** Line index per word: at most two lines of maxChars, balanced so the top line is not the long one. */
export function breakLines(words: string[], maxChars: number): number[] {
  const n = words.length
  const len = (a: number, b: number) => words.slice(a, b).reduce((sum, w) => sum + chars(w), 0) + Math.max(0, b - a - 1)
  if (len(0, n) <= maxChars) return words.map(() => 0)
  // The split with the shortest longest line; on a tie, the shorter line goes on top.
  const cost = (s: number) => Math.max(len(0, s), len(s, n)) + (len(0, s) > len(s, n) ? 0.5 : 0)
  let best = 1
  for (let s = 2; s < n; s++) if (cost(s) < cost(best)) best = s
  return words.map((_, i) => (i < best ? 0 : 1))
}

/** Characters per caption line for an output size: narrower outputs get shorter lines. */
export function maxLineChars(width: number, height: number, size: number): number {
  const em = (size * Math.min(width, height)) / 1080
  const fit = Math.floor((width * (portrait(width, height) ? 0.84 : 0.62)) / (em * 0.55))
  return Math.max(8, Math.min(portrait(width, height) ? 24 : 42, fit))
}

/** Word ranges [from, to) of a caption's pages. One page when the words fit two lines of maxChars;
 *  else (big text, vertical video) the fewest pages that each do, as even as possible so no word is
 *  left alone, rather than shrinking the text the user chose. */
function paginate(texts: string[], maxChars: number): Array<[number, number]> {
  const fits = (ws: string[]) => {
    const lines = breakLines(ws, maxChars)
    return [0, 1].every((l) => {
      const line = ws.filter((_, j) => lines[j] === l)
      return line.length < 2 || chars(line.join(' ')) <= maxChars // a word too long for any line has one of its own
    })
  }
  if (fits(texts)) return [[0, texts.length]]
  // ponytail: O(words^3) per caption, fine for captions of at most 42 characters.
  const best = [{ pages: 0, widest: 0, from: 0 }]
  for (let i = 1; i <= texts.length; i++) {
    best[i] = { pages: Infinity, widest: Infinity, from: 0 }
    for (let j = 0; j < i; j++) {
      const ws = texts.slice(j, i)
      if (!fits(ws)) continue
      const pages = best[j].pages + 1
      const widest = Math.max(best[j].widest, chars(ws.join(' ')))
      if (pages < best[i].pages || (pages === best[i].pages && widest < best[i].widest)) best[i] = { pages, widest, from: j }
    }
  }
  const out: Array<[number, number]> = []
  for (let i = texts.length; i > 0; i = best[i].from) out.unshift([best[i].from, i])
  return out
}

function captionPages(input: SceneInput, map: TimeMap): Page[] {
  const { project, transcript } = input
  const st = project.style.captions
  if (!st.visible || !transcript) return []
  // Canonical size, so preview and export (different pixel sizes) break lines identically.
  const canon = outputSize(project, 1080)
  const maxChars = maxLineChars(canon.width, canon.height, st.size)
  const cues = captionCues(transcript, map, project.captionEdits)
  const pages: Page[] = []
  cues.forEach((c, i) => {
    const groups = paginate(c.words.map((w) => w.text), maxChars).map(([from, to]) => c.words.slice(from, to))
    groups.forEach((g, k) => {
      const lines = breakLines(g.map((w) => w.text), maxChars)
      const next = groups[k + 1]?.[0].start
      pages.push({
        start: k ? g[0].start : c.start,
        end: next ?? c.end,
        fadeOut: next === undefined && c.end < (cues[i + 1]?.start ?? Infinity),
        words: g.map((w, j) => ({ text: w.text, start: w.start, line: lines[j] })),
      })
    })
  })
  return pages
}

export function captionAt(o: Prepared, t: number): Caption | null {
  const p = o.pages[upper(o.pages, t) - 1]
  if (!p || t >= p.end) return null
  const style = o.input.project.style.captions
  const instant = style.animation === 'appear'
  return {
    words: p.words.map((w, j) => ({
      text: w.text,
      line: w.line,
      active: w.start <= t && t < (p.words[j + 1]?.start ?? p.end),
      progress: style.mode === 'line' ? 1 : instant ? +(t >= w.start) : easeOut((t - w.start) / WORD_IN),
    })),
    progress: instant ? 1 : Math.min(easeOut((t - p.start) / CAP_IN), p.fadeOut ? clamp01((p.end - t) / CAP_OUT) : 1),
    style,
  }
}

// ---- Drawing ----

/** Paint clicks, keystrokes, and the caption for `scene` into a transparent 2D canvas of scene size.
 *  Clicks are drawn in zoomed space (apply scene.view); keystrokes and captions unzoomed. */
export function drawOverlays(ctx: Ctx, scene: Scene): void {
  if (scene.clicks.length) {
    const v = scene.view
    ctx.save()
    ctx.translate(scene.width / 2, scene.height / 2)
    ctx.scale(v.scale, v.scale)
    ctx.translate(-v.center.x, -v.center.y)
    for (const c of scene.clicks) drawClick(ctx, c, scene.unit)
    ctx.restore()
  }
  for (const k of scene.keystrokes) drawKeystroke(ctx, k, scene)
  if (scene.caption) drawCaption(ctx, scene.caption, scene)
}

const TAU = Math.PI * 2
const VIOLET = '134 118 255'

function ring(ctx: Ctx, x: number, y: number, r: number, width: number, color: string) {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(r, 0), 0, TAU)
  ctx.lineWidth = width
  ctx.strokeStyle = color
  ctx.stroke()
}

function drawClick(ctx: Ctx, c: Click, u: number) {
  const p = c.age / CLICK_LIFE[c.style]
  if (p < 0 || p >= 1) return
  const fade = 1 - p
  ctx.save()
  if (c.style === 'ripple') {
    // A tinted disc spreads out under its rim; a second, fainter rim trails it.
    const r = (8 + 40 * easeOut(p)) * u
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, TAU)
    ctx.fillStyle = `rgb(${VIOLET} / ${0.22 * fade})`
    ctx.fill()
    ring(ctx, c.x, c.y, r, 2.5 * u, `rgb(${VIOLET} / ${0.85 * fade})`)
    const q = clamp01((p - 0.22) / 0.78)
    if (q > 0) ring(ctx, c.x, c.y, (8 + 40 * easeOut(q)) * u, 1.5 * u, `rgb(${VIOLET} / ${0.5 * (1 - q)})`)
  } else if (c.style === 'circle') {
    // A puck pressed under the cursor: pops in, then lets go. White rim with a dark hairline reads on any screen.
    const r = 20 * u * (0.7 + 0.3 * easeOut(p * 4))
    const a = clamp01(fade * 1.6)
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, TAU)
    ctx.fillStyle = `rgb(${VIOLET} / ${0.3 * a})`
    ctx.fill()
    ring(ctx, c.x, c.y, r + 1.25 * u, 1 * u, `rgb(0 0 0 / ${0.3 * a})`)
    ring(ctx, c.x, c.y, r, 2.5 * u, `rgb(255 255 255 / ${0.95 * a})`)
  } else if (c.style === 'shockwave') {
    // Two thin rings fly out fast and thin out; a tinted halo keeps them visible on light screens.
    for (const [delay, reach] of [[0, 72], [0.18, 52]]) {
      const q = clamp01((p - delay) / (1 - delay))
      if (q <= 0 || q >= 1) continue
      const r = (6 + (reach - 6) * easeOut(q)) * u
      const w = (5 * (1 - q) + 1) * u
      ring(ctx, c.x, c.y, r, w + 3 * u, `rgb(${VIOLET} / ${0.45 * (1 - q)})`)
      ring(ctx, c.x, c.y, r, w, `rgb(255 255 255 / ${0.95 * (1 - q)})`)
    }
  }
  ctx.restore()
}

const SYSTEM = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif'
const PRESS = { stiffness: 520, damping: 26, mass: 1 }

/** Symbol and name printed on a keycap. */
function face(id: string): [string, string] {
  if (!(id in NAMES)) return [id, '']
  return [id === 'Space' ? '' : id, NAMES[id]]
}

function drawKeystroke(ctx: Ctx, s: Keystroke, scene: Scene) {
  if (s.opacity <= 0) return
  const k = scene.unit * s.size
  const h = KEY_H * k
  const depth = 4.5 * k
  const pad = 16 * k
  const caps = s.keys.map((id) => {
    const [sym, name] = face(id)
    const symFont = `600 ${(name ? 27 : chars(sym) > 1 ? 25 : 33) * k}px ${SYSTEM}`
    const nameFont = `500 ${(sym ? 14 : 17) * k}px ${SYSTEM}`
    ctx.font = symFont
    let w = ctx.measureText(sym).width
    ctx.font = nameFont
    w = Math.max(w, ctx.measureText(name).width)
    return { sym, name, symFont, nameFont, w: Math.max(id === 'Space' ? h * 2.4 : h, Math.ceil(w + 2 * pad)) }
  })
  const badge = s.count > 1 ? `×${s.count}` : ''
  const badgeFont = `600 ${24 * k}px ${SYSTEM}`
  ctx.font = badgeFont
  const badgeW = badge ? ctx.measureText(badge).width + 2 * 13 * k : 0
  const total = caps.reduce((n, c) => n + c.w, 0) + KEY_GAP * k * (caps.length - 1) + (badge ? badgeW + 10 * k : 0)
  const top = s.y - h
  // Pressed in on each press, springs back up.
  const press = depth * (1 - springProgress(s.age, PRESS))
  let x = Math.round(scene.width / 2 - total / 2)

  const r = 13 * k
  ctx.save()
  ctx.globalAlpha = s.opacity
  // Sides of the keys with their drop shadow, all before any face so no shadow falls on a neighbour.
  ctx.save()
  ctx.shadowColor = 'rgb(0 0 0 / 0.38)'
  ctx.shadowBlur = 16 * k
  ctx.shadowOffsetY = 4 * k
  ctx.fillStyle = '#232327'
  ctx.beginPath()
  for (let i = 0, cx = x; i < caps.length; cx += caps[i].w + KEY_GAP * k, i++) ctx.roundRect(cx, top + depth, caps[i].w, h - depth, r)
  ctx.fill()
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const c of caps) {
    // Top face.
    const ft = top + press
    const g = ctx.createLinearGradient(0, ft, 0, ft + h - depth)
    g.addColorStop(0, '#4a4a51')
    g.addColorStop(1, '#36363c')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(x, ft, c.w, h - depth, r)
    ctx.fill()
    ctx.strokeStyle = 'rgb(255 255 255 / 0.13)'
    ctx.lineWidth = Math.max(1, k)
    ctx.beginPath()
    ctx.roundRect(x + 0.5 * k, ft + 0.5 * k, c.w - k, h - depth - k, r)
    ctx.stroke()
    // Legend: symbol over name (modifiers, specials), or one centered label.
    const cx = x + c.w / 2
    const fh = h - depth
    ctx.fillStyle = '#f6f6f8'
    if (c.sym && c.name) {
      ctx.font = c.symFont
      ctx.fillText(c.sym, cx, ft + fh * 0.4)
      ctx.font = c.nameFont
      ctx.fillStyle = 'rgb(255 255 255 / 0.62)'
      ctx.fillText(c.name, cx, ft + fh * 0.76)
    } else {
      ctx.font = c.sym ? c.symFont : c.nameFont
      if (!c.sym) ctx.fillStyle = 'rgb(255 255 255 / 0.75)'
      ctx.fillText(c.sym || c.name, cx, ft + fh / 2)
    }
    x += c.w + KEY_GAP * k
  }
  if (badge) {
    const bh = 36 * k
    const by = top + (h - depth) / 2 - bh / 2
    x += (10 - KEY_GAP) * k
    ctx.fillStyle = 'rgb(24 24 27 / 0.82)'
    ctx.beginPath()
    ctx.roundRect(x, by, badgeW, bh, bh / 2)
    ctx.fill()
    ctx.font = badgeFont
    ctx.fillStyle = '#f6f6f8'
    ctx.fillText(badge, x + badgeW / 2, by + bh / 2)
  }
  ctx.restore()
}

/** CSS font family list for a user-chosen font, with system fallbacks. Any name (quotes, emoji) stays valid. */
function family(f: string): string {
  const generic = /^(-apple-system|system-ui|ui-\w+|sans-serif|serif|monospace|cursive|fantasy)$/.test(f)
  return `${generic ? f : JSON.stringify(f)}, ${SYSTEM}`
}

/** Dark text gets a light backing, light text a dark one; opaque enough that the text on the
 *  screen under a caption does not read through it. */
function backing(color: string): string {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim())
  if (!m) return 'rgb(0 0 0 / 0.88)'
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? 'rgb(255 255 255 / 0.92)' : 'rgb(0 0 0 / 0.88)'
}

function drawCaption(ctx: Ctx, c: Caption, scene: Scene) {
  if (c.progress <= 0 || !c.words.length) return
  const st = c.style
  const { width: W, height: H, unit } = scene
  const maxW = W * (portrait(W, H) ? 0.9 : 0.8)
  let em = st.size * unit
  const measure = () => {
    ctx.font = `600 ${em}px ${family(st.font)}`
    return c.words.map((w) => ctx.measureText(w.text).width)
  }
  let widths = measure()
  const nLines = Math.max(...c.words.map((w) => w.line)) + 1
  const lineWidth = (l: number, ws: number[]) => {
    const idx = c.words.flatMap((w, i) => (w.line === l ? [i] : []))
    return idx.reduce((n, i) => n + ws[i], 0) + (idx.length - 1) * ctx.measureText(' ').width
  }
  const widest = Math.max(...Array.from({ length: nLines }, (_, l) => lineWidth(l, widths)))
  if (widest + 2 * PAD * em > maxW) {
    em *= maxW / (widest + 2 * PAD * em) // a very long word: shrink to fit rather than run off the frame
    widths = measure()
  }
  const space = ctx.measureText(' ').width
  const m = ctx.measureText('Hg')
  const lineH = LINE_H * em
  const blockH = nLines * lineH + (nLines - 1) * LINE_GAP * em
  const bottom = st.position === 'bottom'
  const margin = captionMargin(W, H, unit, st.position)
  const slide = st.animation === 'slide' ? (1 - c.progress) * 0.5 * em * (bottom ? 1 : -1) : 0
  const top0 = (bottom ? H - margin - blockH : margin) + slide
  const padX = PAD * em
  const word = st.mode === 'word'

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (let l = 0; l < nLines; l++) {
    const idx = c.words.flatMap((w, i) => (w.line === l ? [i] : []))
    const lw = lineWidth(l, widths)
    const x0 = W / 2 - lw / 2
    const y = top0 + l * (lineH + LINE_GAP * em)
    // Word mode: the backing grows with the words revealed so far.
    let shown = lw
    if (word) shown = idx.reduce((n, i, j) => n + (widths[i] + (j ? space : 0)) * clamp01(c.words[i].progress), 0)
    if (shown > 0) {
      ctx.globalAlpha = c.progress
      ctx.fillStyle = backing(st.color)
      ctx.beginPath()
      ctx.roundRect(x0 - padX, y, shown + 2 * padX, lineH, 0.28 * em)
      ctx.fill()
    }
    const baseline = y + lineH / 2 + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2
    let x = x0
    ctx.save()
    if (shown < lw) {
      // A word appearing is wiped in with the backing as it grows, never sticking out past it.
      ctx.beginPath()
      ctx.rect(x0 - padX, 0, shown + 1.5 * padX, H)
      ctx.clip()
    }
    ctx.fillStyle = st.color
    for (const i of idx) {
      const w = c.words[i]
      const p = clamp01(w.progress)
      if (p > 0) {
        // The word being spoken reads at full strength, the rest of the caption a step back.
        ctx.globalAlpha = c.progress * p * (w.active ? 1 : 0.72)
        ctx.fillText(w.text, x, baseline + (st.animation === 'slide' ? (1 - p) * 0.3 * em : 0))
      }
      x += widths[i] + space
    }
    ctx.restore()
  }
  ctx.restore()
}
