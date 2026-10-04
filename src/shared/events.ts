// Input event stream recorded beside the screen: `sources/events.jsonl`, one JSON object per line.
// Written by native/src/input.rs, read by src/engine (cursor, clicks, keystrokes, auto-zoom).
// t = source time in seconds (shared master clock, pauses removed).
// x, y = position in screen.mp4 pixels, origin top-left (the native side converts from global points).

export type MouseButton = 'left' | 'right' | 'other'

export type InputEvent =
  | { t: number; type: 'move'; x: number; y: number }
  | { t: number; type: 'down' | 'up'; x: number; y: number; button: MouseButton }
  | { t: number; type: 'scroll'; x: number; y: number; dx: number; dy: number }
  // key: label through the active layout ("a", "Ж", "↩", "F5", "Space"); mods in macOS order.
  | { t: number; type: 'key'; down: boolean; key: string; code: number; mods: Modifier[] }
  // Cursor image changed (also while the mouse is still). PNG at sources/cursors/<id>.png,
  // hotspot and size in image pixels; scale = image pixels per screen.mp4 pixel.
  | { t: number; type: 'cursor'; id: string; hotX: number; hotY: number; w: number; h: number; scale: number }
  // Secure input (password field) started/ended: no key events in between.
  | { t: number; type: 'secure'; on: boolean }

export type Modifier = '⌃' | '⌥' | '⇧' | '⌘' | 'fn'

export function parseEvents(jsonl: string): InputEvent[] {
  const out: InputEvent[] = []
  for (const line of jsonl.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // A crash can leave a torn last line; everything before it is still valid.
    }
  }
  return out.sort((a, b) => a.t - b.t)
}
