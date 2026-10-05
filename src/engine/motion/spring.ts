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
