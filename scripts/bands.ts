// Finds stepped ramps in an export: a shadow, glow, or gradient that came out as rings. A ramp is stepped
// where a scan line crosses three or more flat bands in a row, each a level or two from the last, all going
// the same way, each at least 1/45 of the frame's height (and 24 px) thick both along the line and across it, and dark
// enough that one level is a step an eye sees (2% or more in light, so at level 106 or under).
// A smooth ramp steps a level every few px, so its bands stay far thinner than that.
// Run: node scripts/bands.ts <image or video> [seconds into the video]. Exits 1 when it finds one. Needs ffmpeg.
import { execFileSync } from 'node:child_process'

type Stairs = { x: number; y: number; along: 'row' | 'column'; bands: number[] }
const B = 8 // the frame is read as means of B x B px, so an encoder's noise at a band's edge does not split it
const FLAT = 0.3 // levels a band's means stay within
const SEEN = 106 // the brightest level whose next one is a step of 2% in light: 2.4 / (level + 14) in sRGB

/** The longest staircase in a w x h frame of 8-bit values, or null: where it starts, its direction, and its bands' widths in px. */
export function staircase(px: Uint8Array, w: number, h: number): Stairs | null {
  const [gw, gh, min] = [Math.floor(w / B), Math.floor(h / B), Math.max(3, Math.round(h / 45 / B))]
  const g = new Float32Array(gw * gh)
  for (let y = 0; y < gh * B; y++) for (let x = 0; x < gw * B; x++) g[Math.floor(y / B) * gw + Math.floor(x / B)] += px[y * w + x] / (B * B)
  let worst: Stairs | null = null
  // One scan line of n cells, cell i at index at(i), with cells across it `across` apart in g.
  const scan = (n: number, at: (i: number) => number, across: number, limit: number, found: (start: number, bands: number[]) => Stairs) => {
    let chain: Array<{ level: number; start: number; cells: number }> = []
    let dir = 0
    let gap = 0 // cells since the last band: the step itself, or text and edges that end the staircase
    for (let a = 0, b = 1; a < n; a = b++) {
      const level = g[at(a)]
      while (b < n && Math.abs(g[at(b)] - level) <= FLAT) b++
      // Thick across the line too: a line along a soft edge crosses long runs that are a few px thick.
      const mid = at((a + b) >> 1)
      let thick = 1
      for (const d of [-across, across]) for (let k = mid + d, i = 1; i < min && k >= 0 && k < limit && Math.abs(g[k] - level) <= FLAT; k += d, i++) thick++
      if (b - a < min || thick < min || level > SEEN) {
        gap += b - a
        continue
      }
      const step = chain.length ? level - chain.at(-1)!.level : 0
      const next = gap <= min && Math.abs(step) >= 0.7 && Math.abs(step) <= 2.3 && (!dir || Math.sign(step) === dir)
      chain = next ? [...chain, { level, start: a, cells: b - a }] : [{ level, start: a, cells: b - a }]
      dir = next ? Math.sign(step) : 0
      gap = 0
      if (chain.length >= 3 && chain.length > (worst?.bands.length ?? 0)) worst = found(chain[0].start * B, chain.map((r) => r.cells * B))
    }
  }
  for (let y = 0; y < gh; y++) scan(gw, (i) => y * gw + i, gw, gw * gh, (x, bands) => ({ x, y: y * B, along: 'row', bands }))
  // Across a column the neighbors are in the same row, so the walk must not wrap: columns scan a transposed grid.
  const t = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) t[x * gh + y] = g[y * gw + x]
  g.set(t)
  for (let x = 0; x < gw; x++) scan(gh, (i) => x * gh + i, gh, gw * gh, (y, bands) => ({ x: x * B, y, along: 'column', bands }))
  return worst
}

if (import.meta.main) {
  const [file, at = '0'] = process.argv.slice(2)
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number)
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', at, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 })
  const found = staircase(px, w, h)
  console.log(found ? `Stepped: ${found.bands.length} flat bands of ${found.bands.join(', ')} px along the ${found.along} from (${found.x}, ${found.y})` : 'Smooth: no stepped ramp')
  process.exit(found ? 1 : 0)
}
