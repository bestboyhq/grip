// .cube 3D LUT parser (Adobe/Resolve format) and built-in grades for camera color grading. Pure; the
// renderer uploads the result as a 3D texture and samples it with hardware trilinear filtering.

export interface Lut {
  size: number
  min: [number, number, number] // DOMAIN_MIN / DOMAIN_MAX: input range mapped onto the cube
  max: [number, number, number]
  data: Float32Array // size^3 RGBA texels, red fastest, then green, then blue
}

export function parseCube(text: string): Lut {
  let size = 0
  let min: number[] = [0, 0, 0]
  let max: number[] = [1, 1, 1]
  const rgb: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const [key, ...rest] = line.split(/\s+/)
    if (key === 'LUT_3D_SIZE') size = Number(rest[0])
    else if (key === 'LUT_1D_SIZE') throw new Error('This LUT is 1D; only 3D .cube LUTs are supported.')
    else if (key === 'DOMAIN_MIN') min = rest.map(Number)
    else if (key === 'DOMAIN_MAX') max = rest.map(Number)
    else if (/^[-+.\d]/.test(key)) rgb.push(Number(key), Number(rest[0]), Number(rest[1]))
    // TITLE, LUT_3D_INPUT_RANGE and other keywords carry nothing we need.
  }
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error('This .cube file has no valid LUT_3D_SIZE.')
  if (rgb.length !== size ** 3 * 3) throw new Error(`This .cube file should have ${size ** 3} colors but has ${Math.floor(rgb.length / 3)}.`)
  if (rgb.some((v) => !Number.isFinite(v)) || min.length !== 3 || max.length !== 3 || min.some((v, i) => !(max[i] > v))) {
    throw new Error('This .cube file has unreadable values.')
  }
  const data = new Float32Array(size ** 3 * 4)
  for (let i = 0; i < size ** 3; i++) {
    data.set([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 1], i * 4)
  }
  return { size, min: min as Lut['min'], max: max as Lut['max'], data }
}

// ---- Built-in grades: style.camera.lut = 'grade:<id>' instead of a .cube in the bundle. ----

type RGB = [number, number, number]
const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const saturate = (c: RGB, k: number): RGB => c.map((v) => luma(c) + (v - luma(c)) * k) as RGB
/** S-curve around mid gray that keeps black and white in place: k > 1 adds contrast. */
const contrast = (v: number, k: number) => 0.5 + (v - 0.5) * k - (k - 1) * 4 * (v - 0.5) ** 3

/** Looks for the camera, on sRGB-encoded color. Gentle, so skin stays skin. */
export const GRADES: Record<string, { label: string; fn: (c: RGB) => RGB }> = {
  warm: { label: 'Warm', fn: ([r, g, b]) => [r * 1.05 + 0.015, g * 1.01, b * 0.9] },
  cool: { label: 'Cool', fn: ([r, g, b]) => [r * 0.93, g + 0.005, b * 1.06 + 0.02] },
  vivid: { label: 'Vivid', fn: (c) => saturate(c.map((v) => contrast(v, 1.12)) as RGB, 1.3) },
  film: { label: 'Film', fn: (c) => saturate(c.map((v) => 0.05 + 0.9 * contrast(v, 1.08)) as RGB, 0.85).map((v, i) => v + [0.012, 0, -0.012][i]) as RGB },
  mono: { label: 'Black & white', fn: (c) => [0, 0, 0].map(() => contrast(luma(c), 1.1)) as RGB },
}

export const GRADE = 'grade:'

/** The LUT of a built-in grade ('grade:<id>'), or null for anything else. */
export function gradeLut(lut: string): Lut | null {
  const g = lut.startsWith(GRADE) ? GRADES[lut.slice(GRADE.length)] : undefined
  if (!g) return null
  const size = 33
  const data = new Float32Array(size ** 3 * 4)
  for (let b = 0, i = 0; b < size; b++) {
    for (let gr = 0; gr < size; gr++) {
      for (let r = 0; r < size; r++, i += 4) {
        const out = g.fn([r / (size - 1), gr / (size - 1), b / (size - 1)]).map((v) => Math.min(Math.max(v, 0), 1))
        data.set([...out, 1], i)
      }
    }
  }
  return { size, min: [0, 0, 0], max: [1, 1, 1], data }
}
