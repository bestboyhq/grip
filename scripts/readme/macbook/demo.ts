// The README MacBook demo: a raw 10 s take of a week calendar. The pointer drags out a new event on
// Thursday, names it, adds Maya Chen from the guest suggestions, picks the sage color, and saves.
// The edits put it in a MacBook frame, push in for the editing, and pull back to the whole week.
import type { Demo } from '../make.ts'
import { SCALE, click, glide, pointer, type, typedAt, type Pt } from '../input.ts'

const DURATION = 10.4
// [t, x, y] pointer waypoints (CSS px). The scene replays them too, so the dragged event and the
// hovers follow the very pointer Grip draws.
const PATH: Array<[number, number, number]> = [
  [0, 1032, 805], [0.6, 1032, 805],
  [1.6, 868, 328], [1.85, 868, 328], // Thursday's 11:00 slot
  [2.4, 868, 380], [3.5, 868, 380], // dragged down to 12:00
  [3.8, 861, 375], [4.35, 861, 375], // a nudge of the hand while typing
  [5.0, 540, 399], [5.7, 540, 399], // Add guests
  [6.1, 600, 446], [6.4, 600, 446], // Maya Chen's suggestion
  [6.85, 696, 501], [7.15, 696, 501], // the sage swatch
  [7.5, 712, 558], [7.85, 712, 558], // Save
  [8.55, 698, 652], [DURATION, 698, 652],
]
const SCRIPT = {
  path: PATH,
  drag: { down: 1.75, up: 2.5 },
  pop: 2.62, // the event popover opens
  title: { t0: 2.95, text: 'Design review', cps: 10 },
  guests: { click: 5.1, t0: 5.35, text: 'ma', cps: 8, pick: 6.2 },
  color: 6.95,
  save: 7.6,
}

// Hit areas inside the popover, relative to its top-left (446, 284), as scene.html lays it out.
const POP = { x: 446, y: 284 }
const FIELDS = [[16, 14, 314, 50], [38, 98, 310, 132], [38, 166, 310, 200]] // title, guests, location
const LIST = [38, 134, 310, 294] // guest suggestions
const BUTTONS = [...[224, 250, 276, 302].map((x) => [x - 9, 208, x + 9, 226]), [136, 258, 214, 290], [222, 258, 310, 290]] // swatches, Cancel, Save
const inside = ([x, y]: Pt, [x0, y0, x1, y1]: number[]) => x >= POP.x + x0 && x <= POP.x + x1 && y >= POP.y + y0 && y <= POP.y + y1
const listOpen = (t: number) => t >= typedAt(SCRIPT.guests.t0, 0, SCRIPT.guests.cps) && t < SCRIPT.guests.pick + 0.1

const at = glide(PATH)
const { drag, guests } = SCRIPT
const px = ([x, y]: Pt) => ({ x: x * SCALE, y: y * SCALE })

export default {
  name: 'Calendar',
  width: 1440,
  height: 900,
  duration: DURATION,
  script: SCRIPT,
  events: () => [
    ...pointer(at, DURATION, (p, t) => {
      if (t < SCRIPT.pop || t >= SCRIPT.save + 0.1) return 'arrow'
      if (listOpen(t) && inside(p, LIST)) return 'pointer'
      if (FIELDS.some((r) => inside(p, r))) return 'ibeam'
      return BUTTONS.some((r) => inside(p, r)) ? 'pointer' : 'arrow'
    }),
    { t: drag.down, type: 'down', ...px(at(drag.down)), button: 'left' },
    { t: drag.up, type: 'up', ...px(at(drag.up)), button: 'left' },
    ...type(SCRIPT.title.t0, SCRIPT.title.text, SCRIPT.title.cps),
    ...click(guests.click, at(guests.click)),
    ...type(guests.t0, guests.text, guests.cps),
    ...click(guests.pick, at(guests.pick)),
    ...click(SCRIPT.color, at(SCRIPT.color)),
    ...click(SCRIPT.save, at(SCRIPT.save)),
  ],
  // The GIF's edits: a MacBook on the Haze wallpaper, one push in onto the event editing, pulled back for the week.
  edit(p) {
    Object.assign(p.style, { aspect: '16:9', background: { kind: 'wallpaper', id: 'sand' }, device: 'macbook', padding: 110 })
    Object.assign(p.style.cursor, { size: 1.6, loop: true })
    p.zooms = [{ id: 'event', start: 0.95, end: 8.05, level: 2.5, target: { kind: 'point', x: 0.484, y: 0.49 }, enabled: true }]
    p.autoZoomed = true
  },
} satisfies Demo
