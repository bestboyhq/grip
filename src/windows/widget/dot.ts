// The recording dot: the logo dot's colors, blue through red to orange, alight the way Tony draws its
// mic head. Cold it is a still gradient; heat sets its middle swirling and blends in colors that rise
// through it, the gradient running back and forth so they never jump. Painted pixel by pixel: the dot
// is a few hundred of them.

const STOPS = [0x1957fa, 0x8b67a8, 0xe44730, 0xf04600, 0xfb8600].map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255])

/** Channel `k` of the still gradient at `x` in 0..1. */
function at(x: number, k: number): number {
  const p = Math.min(Math.max(x, 0), 1) * (STOPS.length - 1)
  const i = Math.min(Math.floor(p), STOPS.length - 2)
  return STOPS[i][k] + (STOPS[i + 1][k] - STOPS[i][k]) * (p - i)
}

/** Paint an n × n dot into `px` (RGBA rows, top down) at `t` seconds with `heat` 0..1. */
export function paintDot(px: Uint8ClampedArray, n: number, t: number, heat: number) {
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u0 = (x + 0.5) / n, v0 = (y + 0.5) / n
      const swirl = 0.14 * heat * Math.sin(Math.PI * u0) * Math.sin(Math.PI * v0) // the middle moves, the rim stays
      const u = u0 + swirl * Math.sin(t * 2.1 + v0 * 6), v = v0 + swirl * Math.cos(t * 1.7 + u0 * 6)
      const rising = 0.3 * u + 0.7 * v + 1.1 * t + 0.2 * Math.sin(t * 2.7 + u * 6 - v * 5)
      const back = Math.abs((((rising % 2) + 2) % 2) - 1) // 0..1..0: back and forth instead of wrapping around
      const i = 4 * (y * n + x)
      for (let k = 0; k < 3; k++) px[i + k] = at((u + v) / 2, k) * (1 - heat) + at(back, k) * heat
      px[i + 3] = 255
    }
  }
}
