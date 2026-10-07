import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceleratorOf, symbols } from './shortcut.ts'

const press = (code: string, mods = '') => ({ code, metaKey: mods.includes('⌘'), altKey: mods.includes('⌥'), shiftKey: mods.includes('⇧'), ctrlKey: mods.includes('⌃') })

test('a key press becomes a global shortcut, by the key’s place, in macOS notation', () => {
  assert.equal(acceleratorOf(press('Enter', '⌥⌘')), 'Alt+Command+Return')
  assert.equal(acceleratorOf(press('Digit4', '⇧⌘')), 'Shift+Command+4')
  assert.equal(acceleratorOf(press('KeyA', '⌃⌥⇧⌘')), 'Control+Alt+Shift+Command+A') // ⌥ types "ą": the place counts
  assert.equal(acceleratorOf(press('F5')), 'F5')
  assert.equal(acceleratorOf(press('ShiftLeft', '⇧')), '') // still holding modifiers
  assert.equal(acceleratorOf(press('KeyC', '⌘')), null) // every app's Copy
  assert.equal(acceleratorOf(press('KeyA', '⌥')), null) // types "ą"
  assert.equal(acceleratorOf(press('KeyA', '⇧⌥')), null)
  assert.equal(acceleratorOf(press('KeyC', '⌃')), null)
  for (const [code, mods, shown] of [['Enter', '⌥⌘', '⌥⌘↩'], ['Digit4', '⇧⌘', '⇧⌘4'], ['Backspace', '⌃⌥', '⌃⌥⌫'], ['Slash', '⇧⌘', '⇧⌘/'], ['F12', '', 'F12']]) {
    assert.equal(symbols(acceleratorOf(press(code, mods))!), shown)
  }
})

test('only accelerators Grip makes pass', () => {
  assert.equal(symbols('Command+Alt+Return'), '⌥⌘↩') // any order, shown in macOS order
  for (const bad of ['Command+C', 'Alt+A', 'Command+Command+K', 'Super+Alt+K', 'Alt+Command+', 'Alt+Command+Enter', 'Alt+Command+ą', '']) assert.equal(symbols(bad), null, bad)
})
