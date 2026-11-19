// Closed-form damped spring: value at time t after a step from `from` to `to`.
// Pure in t, so any frame can be evaluated in isolation (pure render invariant).

export interface SpringConfig {
  stiffness: number
  damping: number
  mass: number
}

export const SPRING_DEFAULT: SpringConfig = { stiffness: 170, damping: 26, mass: 1 }

/** Progress 0 -> 1 of a unit step response after `t` seconds (with initial velocity v0 in units/s). */
export function springProgress(t: number, c: SpringConfig = SPRING_DEFAULT, v0 = 0): number {
  if (t <= 0) return 0
  const m = Math.max(c.mass, 1e-4)
  const k = Math.max(c.stiffness, 1e-4)
  const w0 = Math.sqrt(k / m)
  const zeta = Math.max(c.damping, 0) / (2 * Math.sqrt(k * m))
  // x(t) = displacement from target, x(0) = -1, x'(0) = v0
  const x0 = -1
  let x: number
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    x = Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t))
  } else if (zeta === 1) {
    x = Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t)
  } else {
    const s = w0 * Math.sqrt(zeta * zeta - 1)
    const r1 = -zeta * w0 + s
    const r2 = -zeta * w0 - s
    const b = (v0 - r1 * x0) / (r2 - r1)
    x = (x0 - b) * Math.exp(r1 * t) + b * Math.exp(r2 * t)
  }
  return 1 + x
}

/** Seconds until the spring is visually at rest (both displacement and velocity tiny). */
export function springDuration(c: SpringConfig = SPRING_DEFAULT, eps = 1e-3): number {
  const dt = 1 / 240
  for (let t = 0; t < 10; t += dt) {
    const p = springProgress(t, c)
    const v = (springProgress(t + dt, c) - p) / dt
    if (Math.abs(1 - p) < eps && Math.abs(v) < eps * 10) return t
  }
  return 10
}

export const mix = (a: number, b: number, p: number) => a + (b - a) * p

/** CSS `cubic-bezier(x1, y1, x2, y2)`: progress 0 -> 1 at u of a move's duration (clamped). Its x(s) rises
 *  steadily, so halving finds the s at u, and y(s) is the progress. */
const cubic = (x1: number, y1: number, x2: number, y2: number) => (u: number): number => {
  if (!(u > 0)) return 0
  if (u >= 1) return 1
  const at = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2
    if (at(x1, x2, s) < u) lo = s
    else hi = s
  }
  return at(y1, y2, (lo + hi) / 2)
}

/** CSS `ease-out`, cubic-bezier(0, 0, 0.58, 1). Every timed move and fade the renderer draws runs on it, so
 *  the camera, cursor, overlays, and layout move as one: it sets off at 1.72 times the mean speed, is 90%
 *  there at 0.74, and lands with no speed left. Springs stay only on what follows something moving (the
 *  camera and a loupe on the cursor, the tilt). */
export const easeOut = cubic(0, 0, 0.58, 1)

/** `--ease-glide` of the app's windows, cubic-bezier(0.32, 0.72, 0, 1): a loupe picked up off the screen and
 *  put back down. It is two thirds there at a fifth of the move, then lands long and soft, as a hand lifts glass. */
export const easeGlide = cubic(0.32, 0.72, 0, 1)
