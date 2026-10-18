// The README captions demo: a raw take of a launch checklist ticked off item by item while a voice
// narrates each one, so word-by-word captions carry the story. Each check lands on its spoken "done".
import type { Demo } from '../make.ts'
import { click, glide, pointer, type Pt } from '../input.ts'

const DURATION = 11.4
// Where the voice's words start in mic.m4a (silencedetect): "Okay" 0.41, "Changelog" 2.44,
// "done" 3.33, "Demo" 4.38, "done" 5.45, "Pricing" 6.50, "done" 7.67, "And…" 8.71-9.04,
// "we're" 9.61, "live" 9.80, silent from 10.06.
const VOICE = '[[slnc 500]] Okay, launch day. [[slnc 400]] Changelog, done. [[slnc 450]] Demo video, done. [[slnc 450]] Pricing page, done. [[slnc 450]] And... [[slnc 350]] we\'re live.'
// Clicks on Changelog, Demo video, Pricing page (each on its "done"), and Go live between "And…" and
// "we're"; the status turns Live on "live".
const SCRIPT = { checks: [3.33, 5.45, 7.67, 9.42], press: 0.1, live: 9.8, hover: [] as number[][] }

const BOX = 421 // checkbox center x; row i's center y is rowY(i), rows 2-5 get checked
const rowY = (i: number) => 459 + 36 * i
const START: Pt = [1014, 314]
const box = (i: number): [number, number] => [BOX, rowY(i)]
const at = glide([
  [0, ...START], [0.9, ...START], [2.2, ...box(2)],
  [3.75, ...box(2)], [4.15, ...box(3)],
  [5.85, ...box(3)], [6.25, ...box(4)],
  [8.1, ...box(4)], [8.5, ...box(5)],
  [10.2, ...box(5)], [10.9, ...START], [DURATION, ...START],
])

/** The checklist row under p (-1 for none), and whether p is on its checkbox. */
function under([x, y]: Pt): [number, boolean] {
  const row = Math.round((y - rowY(0)) / 36)
  if (row < 0 || row > 5 || x < 360 || x > 1117) return [-1, false]
  return [row, Math.abs(x - BOX) <= 12 && Math.abs(y - rowY(row)) <= 12]
}
// The scene's hover states follow the same pointer: [t, row, on checkbox] at each change.
for (let k = 0; k <= DURATION * 120; k++) {
  const t = +(k / 120).toFixed(4)
  const [row, on] = under(at(t))
  const last = SCRIPT.hover.at(-1)
  if (!last || last[1] !== row || last[2] !== +on) SCRIPT.hover.push([t, row, +on])
}

export default {
  name: 'Launch checklist',
  width: 1280,
  height: 800,
  duration: DURATION,
  script: SCRIPT,
  voice: VOICE,
  events: () => [
    // A hand on checkboxes, an I-beam over the editable rows, an arrow elsewhere.
    ...pointer(at, DURATION, (p) => {
      const [row, on] = under(p)
      return on ? 'pointer' : row >= 0 && p[0] > BOX + 12 ? 'ibeam' : 'arrow'
    }),
    ...SCRIPT.checks.flatMap((t) => click(t, at(t), SCRIPT.press)),
  ],
  // The GIF's edits: a dark frame, big bold word-by-word captions, and one zoom onto the checklist
  // while it gets ticked off. Captions show once the voice is transcribed in the app.
  edit(p) {
    Object.assign(p.style, { background: { kind: 'wallpaper', id: 'midnight-obsidian' }, padding: 32, radius: 18, shadow: 0.4 })
    p.style.cursor.size = 2
    Object.assign(p.style.captions, { visible: true, mode: 'word', size: 84, animation: 'slide' })
    p.zooms = [{ id: 'checklist', start: 2.3, end: 10.2, level: 1.6, target: { kind: 'point', x: 0.53, y: 0.617 }, enabled: true }]
    p.autoZoomed = true
    // Caption fixes by word index of the transcript the app makes ("Change log," "And we're live."):
    // one word for the changelog, and a held breath before going live.
    p.captionEdits = { 3: 'Changelog,', 4: '', 12: 'And…' }
  },
} satisfies Demo
