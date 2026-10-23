import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultStyle, lookOn, sameLook } from './project.ts'

test('sameLook: a preset applied stays the same look until the style changes, whatever its key order or camera corner', () => {
  const look = { ...defaultStyle(), padding: 120, background: { kind: 'wallpaper' as const, id: 'ocean' } }
  const style = { ...defaultStyle(), camera: { ...defaultStyle().camera, position: 'top-left' as const } }
  const applied = lookOn(look, style)
  assert.equal(applied.camera.position, 'top-left') // the recording's corner wins
  assert.ok(sameLook(look, applied))
  const reordered = Object.fromEntries(Object.entries(applied).reverse()) as typeof applied
  assert.ok(sameLook(look, reordered))
  assert.ok(!sameLook(look, { ...applied, padding: 56 }))
  assert.ok(!sameLook(look, { ...applied, cursor: { ...applied.cursor, size: 2 } }))
})
