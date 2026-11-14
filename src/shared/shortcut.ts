// Global shortcuts the user picks in Settings: Electron accelerators ('Alt+Command+Return'), made
// from a key press and shown in macOS notation ('⌥⌘↩'). Keys go by their place on the keyboard
// (KeyboardEvent.code), as macOS matches global shortcuts, so ⌥ combinations that type another
// character still record.

const MODIFIERS = [
  ['Control', '⌃', 'ctrlKey'],
  ['Alt', '⌥', 'altKey'],
  ['Shift', '⇧', 'shiftKey'],
  ['Command', '⌘', 'metaKey'],
] as const
/** KeyboardEvent.code -> accelerator key and its symbol. Letters, digits, and F keys go by name. */
const KEYS: Record<string, [string, string]> = {
  Enter: ['Return', '↩'], Space: ['Space', 'Space'], Tab: ['Tab', '⇥'], Backspace: ['Backspace', '⌫'], Delete: ['Delete', '⌦'],
  ArrowUp: ['Up', '↑'], ArrowDown: ['Down', '↓'], ArrowLeft: ['Left', '←'], ArrowRight: ['Right', '→'],
  Home: ['Home', '↖'], End: ['End', '↘'], PageUp: ['PageUp', '⇞'], PageDown: ['PageDown', '⇟'],
  Minus: ['-', '-'], Equal: ['=', '='], BracketLeft: ['[', '['], BracketRight: [']', ']'], Backslash: ['\\', '\\'],
  Semicolon: [';', ';'], Quote: ["'", "'"], Comma: [',', ','], Period: ['.', '.'], Slash: ['/', '/'], Backquote: ['`', '`'],
}
const NAMED = Object.fromEntries(Object.values(KEYS))
const isFKey = (key: string) => /^F([1-9]|1\d|20)$/.test(key)

/** Whether a global shortcut leaves typing alone: an F key, or any key with ⌘ or ⌃. ⌥A types "ą",
 *  ⇧A types "A". */
const fair = (mods: string[], key: string) => isFKey(key) || mods.includes('Command') || mods.includes('Control')
/** Whether an accelerator is one key with ⌘ or ⌃ alone (⌘4): keys other apps use themselves, and lose
 *  while Grip has them. The user's to give: the field says what it costs. */
export const takesAppKeys = (accelerator: string) => /^(Command|Control)\+[^+]+$/.test(accelerator)

export type Press = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/** The accelerator key a press is on; '' for a modifier or a key Grip has no name for. */
const keyOf = (c: string) => (/^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : isFKey(c) ? c : (KEYS[c]?.[0] ?? ''))

/** The accelerator a key press makes; '' for a lone modifier or a key Grip has no name for, null
 *  for a combination that would take keys from typing (see `fair`). */
export function acceleratorOf(e: Press): string | null {
  const key = keyOf(e.code)
  if (!key) return ''
  const mods = MODIFIERS.filter((m) => e[m[2]]).map((m) => m[0] as string)
  return fair(mods, key) ? [...mods, key].join('+') : null
}

/** The modifiers a press holds, in macOS notation: '⇧⌘'. */
export const modifiersOf = (e: Press) => MODIFIERS.filter((m) => e[m[2]]).map((m) => m[1]).join('')

/** Every key a press holds, in macOS notation, whether or not it makes a shortcut: '⇧⌘', then '⇧⌘4'. */
export const pressed = (e: Press) => modifiersOf(e) + (NAMED[keyOf(e.code)] ?? keyOf(e.code))

/** An accelerator acceleratorOf makes, in macOS notation: 'Alt+Command+Return' -> '⌥⌘↩'. Null for
 *  anything else, so a bad setting never reaches globalShortcut. */
export function symbols(accelerator: string): string | null {
  const parts = accelerator.split('+')
  const key = parts.pop()!
  const mods = MODIFIERS.filter((m) => parts.includes(m[0]))
  const known = /^[A-Z0-9]$/.test(key) || isFKey(key) || key in NAMED
  if (!known || mods.length !== parts.length || new Set(parts).size !== parts.length || !fair(parts, key)) return null
  return mods.map((m) => m[1]).join('') + (NAMED[key] ?? key)
}
