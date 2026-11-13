// Motion run from script, copied from the Bestboy platform (src/lib/ui/menu.ts and press.ts there) so every Bestboy
// app moves alike; CSS motion reads the same values from theme.css. Its docs/design.md, "Motion", has the rules.
import type { TransitionConfig } from 'svelte/transition'

export const DROP_IN_MS = 200
export const DROP_OUT_MS = 150
const DROP_SCALE = 0.935
const PRESS_SCALE = 0.97
const PRESS_MS = 80
const MIN_HOLD_MS = 90 // a quick click still shows its press
const RELEASE_MS = 150
const COME_MS = 180 // `--come`: things that come and go
const SWITCH_MS = 200 // one content switching to the next, as menus switch
const SLIDE_PX = 20
export const GLIDE_MS = 250 // a thumb or ring gliding from one choice to the next, on `--ease-glide`

// `--ease-out` and `--ease-glide` in theme.css, for motion run from script.
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
export const EASE_GLIDE = 'cubic-bezier(0.32, 0.72, 0, 1)'

export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// One coordinate of a cubic Bézier from (0, 0) to (1, 1) through control points at a and b.
const bezier = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3

// A CSS `cubic-bezier()` for Svelte's transitions and animations, which ease in script rather than CSS. The curve's
// x(s) rises steadily, so halving finds the s for a time t, and y(s) is the eased progress.
const cubic = (x1: number, y1: number, x2: number, y2: number) => (t: number) => {
  if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2
    if (bezier(x1, x2, s) < t) lo = s
    else hi = s
  }
  return bezier(y1, y2, (lo + hi) / 2)
}
export const easeOut = cubic(0.22, 1, 0.36, 1) // `--ease-out`
export const easeGlide = cubic(0.32, 0.72, 0, 1) // `--ease-glide`

// What the user adds or removes comes and goes as theme.css's `come`: it fades while growing from 0.935 of its size.
// `on` false lets it show at once, for things that arrive without the user asking.
export const come = (_node: Element, on = true): TransitionConfig =>
  on && !still() ? { duration: COME_MS, easing: easeOut, css: (t) => `opacity: ${t}; scale: ${DROP_SCALE + (1 - DROP_SCALE) * t}` } : { duration: 0 }

// One content gives way to the next in the same place, as the family's menus switch: the old slides 20px away and
// fades, the new comes in 20px from the side of its name (dir 1: the name is to the right), each blurring 2px at its
// faintest so the two read as one change. Content switched back mid-switch turns around from where it is.
// Returns the old content's animation, so a stand-in for it can be removed once it is gone.
export function slide(from: Element | null | undefined, to: Element, dir: number): Animation | undefined {
  if (still()) return
  const now = (el: Element) => {
    const cs = getComputedStyle(el)
    return { opacity: cs.opacity, translate: cs.translate, filter: cs.filter }
  }
  const away = (side: number) => ({ opacity: 0, translate: `${side * SLIDE_PX}px`, filter: 'blur(2px)' })
  const go = (el: Element, frames: Keyframe[]) => {
    for (const a of el.getAnimations()) a.cancel()
    return el.animate(frames, { duration: SWITCH_MS, easing: EASE_OUT })
  }
  const start = to.getAnimations().length ? now(to) : away(dir)
  const out = from ? go(from, [{ ...now(from), visibility: 'visible' }, { ...away(-dir), visibility: 'visible' }]) : undefined
  go(to, [start, { opacity: 1, translate: '0px', filter: 'blur(0px)' }])
  return out
}

// Svelte calls a transition's returned function with the way it is going, though its types leave that out.
type Drop = TransitionConfig | ((options?: { direction?: 'in' | 'out' }) => TransitionConfig)

// A menu comes and goes out of its control: flat, it fades while growing from 0.935 of its size, from the
// transform-origin its CSS sets on the side facing the control. A menu closed halfway in reverses from where it is,
// and a closing one takes no more clicks.
export const drop: (node?: Element) => Drop = () =>
  still()
    ? { duration: 0 }
    : ({ direction } = {}) => ({
        duration: direction === 'out' ? DROP_OUT_MS : DROP_IN_MS,
        easing: easeOut,
        css: (t) => `opacity: ${t}; transform: scale(${DROP_SCALE + (1 - DROP_SCALE) * t})${direction === 'out' ? '; pointer-events: none' : ''}`,
      })

// A press scales a button to 0.97 over 80 ms and back over 150 ms. One listener serves every `.btn` and
// `.icon-btn` in the window, so no component has to opt in.
export function installPress() {
  let node: HTMLElement | undefined
  let pressedAt = 0
  const to = (el: HTMLElement, scale: number, duration: number, delay = 0) =>
    el.animate({ scale: String(scale) }, { duration, delay, easing: EASE_OUT, fill: 'forwards' })
  const down = (target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('.btn, .icon-btn') : null
    if (!el || still() || el.matches(':disabled, [aria-disabled="true"]')) return
    node = el
    pressedAt = performance.now()
    to(el, PRESS_SCALE, PRESS_MS)
  }
  const release = () => {
    if (!node) return
    to(node, 1, RELEASE_MS, Math.max(0, MIN_HOLD_MS - (performance.now() - pressedAt)))
    node = undefined
  }
  addEventListener('pointerdown', (e) => down(e.target))
  addEventListener('keydown', (e) => !e.repeat && (e.key === 'Enter' || e.key === ' ') && down(e.target))
  for (const type of ['pointerup', 'pointercancel', 'keyup', 'blur']) addEventListener(type, release)
}
