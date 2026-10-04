// The editor's command registry: every action the editor offers, reachable from the ⌘K menu and
// from its keyboard shortcuts. Any part of the editor adds its own:
//
//   $effect(() => registerCommands([{ id: 'export.open', title: 'Export…', group: 'Export', keys: ['⌘E'], run: open }]))
//
// Shortcuts use macOS notation, modifiers in macOS order (⌃⌥⇧⌘) then the key: 'C', '⇧⌘Z', '⌫', '⇧←',
// 'Space', '1'. Letters are matched by the character the layout types when it is Latin, and by the
// physical key otherwise (as macOS does for ⌘ shortcuts on Cyrillic, Greek, ... layouts).
// Shortcuts stay inactive while a text field has focus.

export interface Command {
  id: string
  title: string
  group: string // section in the ⌘K menu
  keys?: string[]
  hint?: string // dim text after the title
  run: () => void
  enabled?: () => boolean // hidden from the menu and shortcut ignored when false
  repeat?: boolean // keeps firing while the key is held (stepping), off for one-shot edits
}

let list: Command[] = []

/** Add commands (replacing ones with the same id). Returns a function that removes them. */
export function registerCommands(cmds: Command[]): () => void {
  const ids = new Set(cmds.map((c) => c.id))
  list = [...list.filter((c) => !ids.has(c.id)), ...cmds]
  return () => (list = list.filter((c) => !cmds.includes(c)))
}

export const commands = () => list
export const isEnabled = (c: Command) => c.enabled?.() ?? true

/** Run a command by id if it exists and is enabled. */
export function run(id: string): boolean {
  const c = list.find((c) => c.id === id)
  if (!c || !isEnabled(c)) return false
  c.run()
  return true
}

const PUNCTUATION: Record<string, string> = {
  Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Backslash: '\\', Backquote: '`',
}
const NAMED: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Backspace: '⌫', Delete: '⌦', Escape: '⎋',
  Enter: '↩', Tab: '⇥', ' ': 'Space', Home: '↖', End: '↘', PageUp: '⇞', PageDown: '⇟',
}

/** The shortcut string a key event produces, e.g. '⇧⌘Z'. */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  let k = NAMED[e.key]
  if (!k) {
    if (/^[a-z0-9=\-[\];',./\\`]$/i.test(e.key)) k = e.key.toUpperCase()
    else if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3)
    else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5)
    else k = PUNCTUATION[e.code] ?? e.key
  }
  return (e.ctrlKey ? '⌃' : '') + (e.altKey ? '⌥' : '') + (e.shiftKey ? '⇧' : '') + (e.metaKey ? '⌘' : '') + k
}

/** Whether the focused element needs this key itself: text fields need every key, buttons Space and
 *  Return, sliders the arrows. */
export function consumesKey(el: EventTarget | null, key: string): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  const activates = key === ' ' || key === 'Enter'
  if (el instanceof HTMLInputElement) {
    if (el.type === 'range') return /^(Arrow|Home|End|Page)/.test(key)
    return ['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(el.type) ? activates : true
  }
  return activates && (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || /^(button|menuitem\w*|option|tab)$/.test(el.getAttribute('role') ?? ''))
}

/** The command a key event triggers, if any. */
export function commandFor(e: KeyboardEvent): Command | undefined {
  if (e.isComposing || consumesKey(e.target, e.key)) return
  const k = keyOf(e)
  return list.find((c) => c.keys?.includes(k) && (!e.repeat || c.repeat) && isEnabled(c))
}

/** Commands matching a query, best first: every word must appear; title prefix, then word starts, rank higher. */
export function search(cmds: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return cmds
  const words = q.split(/\s+/)
  const scored: Array<[number, number, Command]> = []
  cmds.forEach((c, i) => {
    const title = c.title.toLowerCase()
    const hay = `${title} ${c.group.toLowerCase()} ${c.hint?.toLowerCase() ?? ''} ${c.keys?.join(' ').toLowerCase() ?? ''}`
    if (!words.every((w) => hay.includes(w))) return
    const score = title.startsWith(q) ? 0 : words.every((w) => new RegExp(`(^|\\W)${RegExp.escape(w)}`).test(title)) ? 1 : 2
    scored.push([score, i, c])
  })
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((s) => s[2])
}
