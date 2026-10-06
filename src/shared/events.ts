// Input event stream recorded beside the screen: `sources/events.jsonl`, one JSON object per line.
// Written by native/src/input.rs, read by src/engine (cursor, clicks, keystrokes, drawings, auto-zoom).
// t = source time in seconds (shared master clock, pauses removed).
// x, y = position in screen.mp4 pixels, origin top-left (the native side converts from global points).

export type MouseButton = 'left' | 'right' | 'other'

export type InputEvent =
  | { t: number; type: 'move'; x: number; y: number }
  | { t: number; type: 'down' | 'up'; x: number; y: number; button: MouseButton }
  // dx, dy = pixel-precise scroll deltas as macOS reports them (natural scrolling applied), in screen.mp4 pixels.
  | { t: number; type: 'scroll'; x: number; y: number; dx: number; dy: number }
  // key: label through the active layout ("a", "Ж", "↩", "F5", "Space"); mods in macOS order.
  | { t: number; type: 'key'; down: boolean; key: string; code: number; mods: Modifier[] }
  // Cursor image changed (also while the mouse is still). PNG at sources/cursors/<id>.png,
  // hotspot and size in image pixels; scale = image pixels per screen.mp4 pixel.
  // kind: the standard system cursor this image is, when known (lets the built-in cursor set replace it).
  | { t: number; type: 'cursor'; id: string; hotX: number; hotY: number; w: number; h: number; scale: number; kind?: 'arrow' | 'pointer' | 'ibeam' }
  // Secure input (password field) started/ended: no key events in between.
  | { t: number; type: 'secure'; on: boolean }
  // Ink drawn on screen while recording. A stroke is start, moves, end; a torn file may lack the end.
  // start carries color (CSS hex) and width (screen.mp4 pixels).
  | { t: number; type: 'draw'; phase: 'start' | 'move' | 'end'; x: number; y: number; color?: string; width?: number }

export type Modifier = '⌃' | '⌥' | '⇧' | '⌘' | 'fn'

/** Seconds around a stroke whose mouse down/up are the pen's, not clicks. */
const PEN_SLACK = 0.2

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
  out.sort((a, b) => a.t - b.t)
  // Source time spans of the strokes, sorted, so their ends are sorted too.
  const strokes: Array<[number, number]> = []
  let open = false
  for (const e of out) {
    if (e.type !== 'draw') continue
    if (e.phase === 'start' || !open) strokes.push([e.t, e.t])
    else strokes[strokes.length - 1][1] = e.t
    open = e.phase !== 'end'
  }
  if (!strokes.length) return out
  // The event tap records the pen's own mouse down/up; dropped here, they never become click effects,
  // click sounds, or auto zooms. Moves stay, so the cursor follows the pen.
  let i = 0
  return out.filter((e) => {
    if (e.type !== 'down' && e.type !== 'up') return true
    while (i < strokes.length && strokes[i][1] + PEN_SLACK < e.t) i++
    return !(i < strokes.length && e.t >= strokes[i][0] - PEN_SLACK)
  })
}
