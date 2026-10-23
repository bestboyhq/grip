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

// `--ease-out` in theme.css, for motion run from script.
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'

export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// One coordinate of a cubic Bézier from (0, 0) to (1, 1) through control points at a and b.
const bezier = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3

// `EASE_OUT` for Svelte's transitions, which ease in script rather than CSS. The curve's x(s) rises steadily, so
// halving finds the s for a time t, and y(s) is the eased progress.
export function easeOut(t: number): number {
  if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2
    if (bezier(0.22, 0.36, s) < t) lo = s
    else hi = s
  }
  return bezier(1, 1, (lo + hi) / 2)
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
