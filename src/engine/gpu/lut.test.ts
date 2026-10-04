import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRADE, GRADES, gradeLut, parseCube } from './lut.ts'

const identity = (n: number, header = '') => {
  let s = `# made by hand\nTITLE "id"\n${header}LUT_3D_SIZE ${n}\n`
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) s += `${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}\r\n`
  return s
}

test('parses a 3D .cube with red fastest, comments, CRLF, and a domain', () => {
  const l = parseCube(identity(3, 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n'))
  assert.equal(l.size, 3)
  assert.deepEqual(l.max, [2, 2, 2])
  assert.equal(l.data.length, 27 * 4)
  assert.deepEqual([...l.data.slice(4, 8)], [0.5, 0, 0, 1], 'second texel steps red')
  assert.deepEqual([...l.data.slice(12, 16)], [0, 0.5, 0, 1], 'fourth texel steps green')
})

test('rejects broken LUTs with a plain reason', () => {
  assert.throws(() => parseCube('LUT_1D_SIZE 4\n0 0 0'), /1D/)
  assert.throws(() => parseCube('0 0 0\n'), /LUT_3D_SIZE/)
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n'), /8 colors but has 2/)
  assert.throws(() => parseCube(identity(2).replace(/1 1 1/, '1..2 1 1')), /unreadable/)
})

test('built-in grades: every one builds a full LUT in range, mono is gray, unknown ids are none', () => {
  for (const id of Object.keys(GRADES)) {
    const l = gradeLut(GRADE + id)!
    assert.equal(l.data.length, l.size ** 3 * 4, id)
    assert.ok(l.data.every((v) => v >= 0 && v <= 1), `${id} in range`)
  }
  const mono = gradeLut('grade:mono')!
  const texel = (l: typeof mono, r: number, g: number, b: number) => [...l.data.slice(4 * (r + l.size * (g + l.size * b)), 4 * (r + l.size * (g + l.size * b)) + 3)]
  const [r, g, b] = texel(mono, 32, 0, 0) // pure red
  assert.ok(r === g && g === b && r > 0.1 && r < 0.3, 'red turns into its luminance')
  const warm = gradeLut('grade:warm')!
  const [wr, , wb] = texel(warm, 16, 16, 16)
  assert.ok(wr > wb, 'warm pushes gray toward orange')
  assert.equal(gradeLut('grade:nope'), null)
  assert.equal(gradeLut('assets/look.cube'), null)
})
