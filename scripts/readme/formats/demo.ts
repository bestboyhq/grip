// The README formats demo: one raw take of a team chat, exported three ways (16:9, 1:1, 9:16).
// The user opens a thread, types a reply whose emoji the autocomplete fills in on Tab, sends it
// with ⌘↩, reacts with 🎉 from the picker, closes the thread with esc, and rests where they began.
// The action stays inside the 448 px thread pane, narrow enough for the 9:16 crop that follows the cursor.
import type { Demo } from '../make.ts'
import { click, glide, pointer, press, type, typedAt, type Pt } from '../input.ts'

const DURATION = 9.4
const FPS = 30
const TEXT = 'Safari + iOS look good. Ship it :ro'
const TYPE = { t0: 2.45, cps: 15 }
// Clicks (down), keys, and when the scene reacts: a click acts on release, 0.1 s later.
const T = { replies: 1.35, focus: 2.2, tab: 5.0, send: 5.4, react: 6.5, tada: 7.1, esc: 7.7 }

// Where the pointer goes, in scene CSS px (measured from scene.html).
const P = {
  rest: [500, 690], // over the release candidate message; the 1:1 and 9:16 cameras start and end in one place
  replies: [430, 754], // its "3 replies" link
  reply: [1330, 789], // the thread's reply box, right of the text so 9:16 frames the whole pane
  react: [1335, 121], // add reaction, in the toolbar over the thread's first message
  tada: [1211, 238], // 🎉 in the picker
} satisfies Record<string, Pt>
const at = glide([
  [0, ...P.rest], [0.55, ...P.rest], [1.2, ...P.replies], [1.65, ...P.replies], [2.1, ...P.reply],
  // a resting hand drifts a few px while typing, so the cursor stays up instead of fading as idle
  [3.4, P.reply[0] + 4, P.reply[1] + 1], [4.6, P.reply[0] + 1, P.reply[1] - 2], [5.75, P.reply[0] + 1, P.reply[1] - 2],
  [6.4, ...P.react], [6.7, ...P.react], [7.0, ...P.tada], [7.85, ...P.tada], [8.75, ...P.rest], [DURATION, ...P.rest],
])

// Rects (x0, y0, x1, y1) with a non-arrow cursor, while they are on screen.
const inside = ([x, y]: Pt, [x0, y0, x1, y1]: number[]) => x >= x0 && x <= x1 && y >= y0 && y <= y1
const open = (t: number) => t >= T.replies + 0.1 && t < T.esc
const picking = (t: number) => t >= T.react + 0.1 && t < T.tada + 0.1
const kind = (p: Pt, t: number) =>
  inside(p, [322, 738, 710, 770]) ? 'pointer' // the thread summary row under the message
  : inside(p, [281, 787, open(t) ? 963 : 1411, 831]) ? 'ibeam' // the channel's message box
  : !open(t) ? 'arrow'
  : inside(p, [1002, 767, 1415, 811]) ? 'ibeam' // reply box
  : inside(p, [1216, 105, 1415, 137]) ? 'pointer' // message toolbar
  : picking(t) && inside(p, [1123, 157, 1405, 189]) ? 'ibeam' // picker search
  : picking(t) && inside(p, [1123, 221, 1405, 327]) ? 'pointer' // picker grid
  : 'arrow'

export default {
  name: 'Chat formats',
  width: 1440,
  height: 900,
  duration: DURATION,
  fps: FPS,
  script: {
    fps: FPS,
    ptr: Array.from({ length: Math.round(DURATION * FPS) + 1 }, (_, i) => at(i / FPS).map((v) => Math.round(v * 10) / 10)),
    clicks: [T.replies, T.focus, T.react, T.tada].map((t) => [t, t + 0.1]),
    open: T.replies + 0.1,
    focus: T.focus + 0.1,
    keys: [...TEXT].map((_, i) => +typedAt(TYPE.t0, i, TYPE.cps).toFixed(4)),
    text: TEXT,
    tab: T.tab,
    send: T.send,
    pick: T.react + 0.1,
    tada: T.tada + 0.1,
    esc: T.esc,
  },
  events: () => [
    ...pointer(at, DURATION, kind),
    ...[T.replies, T.focus, T.react, T.tada].flatMap((t) => click(t, at(t))),
    ...type(TYPE.t0, TEXT, TYPE.cps),
    ...press(T.tab, '⇥'),
    ...press(T.send, '↩', ['⌘']),
    ...press(T.esc, '⎋'),
  ],
  // The GIF's edits: a desert wallpaper, and one zoom that follows the cursor from the link to esc.
  edit(p) {
    Object.assign(p.style, { background: { kind: 'wallpaper', id: 'sunset-sahara' }, padding: 64, radius: 14, shadow: 0.4 })
    Object.assign(p.style.cursor, { size: 1.6, loop: true })
    p.zooms = [{ id: 'thread', start: 0.45, end: 7.8, level: 2, target: { kind: 'cursor' }, enabled: true }]
    p.autoZoomed = true
  },
} satisfies Demo
