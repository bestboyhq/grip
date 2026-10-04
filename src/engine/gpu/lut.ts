// .cube 3D LUT parser (Adobe/Resolve format) for camera color grading. Pure; the renderer uploads
// the result as a 3D texture and samples it with hardware trilinear filtering.

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
