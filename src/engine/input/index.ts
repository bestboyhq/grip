// Owner: input-events. Segments derived from the event stream, in SOURCE time, and helpers for
// showing keystrokes. Pure functions over parseEvents() output (sorted by t).

import type { InputEvent } from '../../shared/events.ts'

export interface Segment {
  start: number
  end: number
}

type KeyEvent = Extract<InputEvent, { type: 'key' }>
type Point = { x: number; y: number }

/** Pointer moves this close (screen.mp4 px) to where the cursor rests are noise, not motion. */
const JITTER_PX = 4
const TYPING_GAP = 1.5 // longest pause, in seconds, inside one stretch of typing
const TYPING_MIN_KEYS = 4

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Names printed on Apple keycaps under the symbol. */
export const KEY_NAMES: Record<string, string> = {
  '⌘': 'command',
  '⇧': 'shift',
  '⌥': 'option',
  '⌃': 'control',
  '⇪': 'caps lock',
  '↩': 'return',
  '⌤': 'enter',
  '⇥': 'tab',
  '⌫': 'delete',
  '⌦': 'delete',
  '⎋': 'esc',
  '⌧': 'clear',
  '↖': 'home',
  '↘': 'end',
  '⇞': 'page up',
  '⇟': 'page down',
}
const MODIFIERS = ['fn', '⌃', '⌥', '⇧', '⌘', '⇪'] // macOS order
const SPECIAL = new Set([...Object.keys(KEY_NAMES), ...MODIFIERS, '←', '→', '↑', '↓', 'Space', 'Help'])

/** A keystroke that edits text: not a modifier on its own, not a ⌘ or ⌃ shortcut. */
export function isTyping(e: KeyEvent): boolean {
  return !MODIFIERS.includes(e.key) && !e.mods.includes('⌘') && !e.mods.includes('⌃')
}

/** Keycaps to show for a key event, in order: ['⇧', '⌘', 'P'], ['⇧', '⇥'], ['ą'] (⇧ and ⌥
 *  already shaped a typed character, so they are not shown again), ['⌥', '⌘'] for modifiers alone. */
export function keyCaps(e: KeyEvent): string[] {
  if (MODIFIERS.includes(e.key)) return MODIFIERS.filter((m) => m === e.key || (e.mods as string[]).includes(m))
  const typed = isTyping(e) && !SPECIAL.has(e.key) && [...e.key].length === 1
  return [...e.mods.filter((m) => !(typed && (m === '⇧' || m === '⌥'))), e.key]
}

/** Stretches of continuous typing (candidates to speed up and to zoom in on). Shortcuts and
 *  modifiers do not count, and a click ends the stretch. */
export function typingSegments(events: InputEvent[]): Segment[] {
  const out: Segment[] = []
  let cur: { start: number; end: number; last: number; keys: number } | null = null
  const close = (s: typeof cur) => {
    if (s && s.keys >= TYPING_MIN_KEYS) out.push({ start: s.start, end: s.end })
    return null
  }
  for (const e of events) {
    if (e.type === 'down') cur = close(cur)
    if (e.type !== 'key' || !isTyping(e)) continue
    if (e.down) {
      if (cur && e.t - cur.last > TYPING_GAP) cur = close(cur)
      cur ??= { start: e.t, end: e.t, last: e.t, keys: 0 }
      cur.keys++
      cur.last = e.t
    }
    if (cur) cur.end = Math.max(cur.end, e.t) // the last key's release ends the stretch
  }
  close(cur)
  return out
}

/** Stretches where the cursor does not move (candidates to hide the cursor), from the recording
 *  start to `duration` when given. Clicks and scrolls are activity; jitter is not. */
export function idleSegments(events: InputEvent[], minSeconds = 2, duration?: number): Segment[] {
  const out: Segment[] = []
  let since = 0
  let rest: Point | null = null
  const active = (t: number) => {
    if (t - since >= minSeconds) out.push({ start: since, end: t })
    since = t
  }
  for (const e of events) {
    if (e.type === 'move') {
      if (!rest) rest = e // the first sample is where the cursor starts, not a move
      if (dist(e, rest) <= JITTER_PX) continue
    } else if (e.type !== 'down' && e.type !== 'up' && e.type !== 'scroll') continue
    active(e.t)
    rest = e
  }
  if (duration !== undefined) active(duration)
  return out
}

/** Drop synthetic jitter (accessibility tools nudging the cursor) from mouse moves: excursions
 *  that never leave JITTER_PX of where the cursor rests. The lead-in of a real move (distance
 *  growing until it leaves the radius or reaches a click) is kept, so slow precise motion survives. */
export function removeJitter(events: InputEvent[]): InputEvent[] {
  const drop = new Set<InputEvent>()
  let rest: Point | null = null
  let pending: Array<{ e: InputEvent; d: number }> = []
  // The cursor arrives at `to`: keep the pending moves that head straight for it, drop the rest.
  const arrive = (to: Point & InputEvent, d: number) => {
    let i = pending.length
    while (i > 0 && pending[i - 1].d <= (i < pending.length ? pending[i].d : d)) i--
    pending.slice(0, i).forEach((p) => drop.add(p.e))
    pending = []
    rest = to
  }
  for (const e of events) {
    if (e.type !== 'move' && e.type !== 'down' && e.type !== 'up' && e.type !== 'scroll') continue
    if (!rest) {
      rest = e
      continue
    }
    const d = dist(e, rest)
    if (e.type === 'move' && d <= JITTER_PX) pending.push({ e, d })
    else arrive(e, d)
  }
  pending.forEach((p) => drop.add(p.e)) // came to rest inside the radius
  return drop.size ? events.filter((e) => !drop.has(e)) : events
}
