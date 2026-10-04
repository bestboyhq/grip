import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCube } from './lut.ts'

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
