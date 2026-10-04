import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandFor, commands, consumesKey, keyOf, registerCommands, run, search, type Command } from './registry.ts'

const ev = (key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}, repeat = false) =>
  ({ key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta, repeat, isComposing: false, target: null }) as unknown as KeyboardEvent

test('shortcut strings follow the typed character, falling back to the physical key', () => {
  assert.equal(keyOf(ev('z', 'KeyZ', { meta: true })), '⌘Z')
  assert.equal(keyOf(ev('Z', 'KeyZ', { meta: true, shift: true })), '⇧⌘Z')
  assert.equal(keyOf(ev('z', 'KeyW', { meta: true })), '⌘Z') // AZERTY: the key labeled Z
  assert.equal(keyOf(ev('я', 'KeyZ', { meta: true })), '⌘Z') // Russian: physical key
  assert.equal(keyOf(ev('ç', 'KeyC', { alt: true })), '⌥C') // ⌥ changes the character
  assert.equal(keyOf(ev('&', 'Digit1')), '1') // AZERTY digit row
  assert.equal(keyOf(ev('ArrowLeft', 'ArrowLeft', { shift: true })), '⇧←')
  assert.equal(keyOf(ev(' ', 'Space')), 'Space')
  assert.equal(keyOf(ev('Backspace', 'Backspace')), '⌫')
  assert.equal(keyOf(ev('ю', 'Period', { meta: true })), '⌘.') // Russian: physical punctuation key
  assert.equal(keyOf(ev('', 'Equal', { meta: true })), '⌘=')
})

test('registry: replace by id, unregister, enabled, repeat', () => {
  let n = 0
  const off = registerCommands([
    { id: 'a', title: 'Cut at playhead', group: 'Clip', keys: ['C'], run: () => n++ },
    { id: 'b', title: 'Step forward', group: 'Playback', keys: ['→'], repeat: true, run: () => (n += 10) },
    { id: 'c', title: 'Disabled', group: 'X', keys: ['D'], enabled: () => false, run: () => (n += 100) },
  ])
  assert.equal(commandFor(ev('c', 'KeyC'))?.id, 'a')
  assert.equal(commandFor(ev('c', 'KeyC', {}, true)), undefined, 'one-shot edits ignore key repeat')
  assert.equal(commandFor(ev('ArrowRight', 'ArrowRight', {}, true))?.id, 'b')
  assert.equal(commandFor(ev('d', 'KeyD')), undefined)
  assert.equal(run('c'), false)
  assert.equal(run('a'), true)
  assert.equal(n, 1)
  const off2 = registerCommands([{ id: 'a', title: 'Other', group: 'Clip', run: () => {} }])
  assert.equal(commands().filter((c) => c.id === 'a').length, 1)
  off()
  off2()
  assert.equal(commands().length, 0)
})

test('shortcuts stay off in text fields; other controls keep their keys only when keyboard-focused', () => {
  const el = (tagName: string, attrs: { type?: string; role?: string; keyboard?: boolean; editable?: boolean } = {}) =>
    ({ tagName, type: attrs.type, isContentEditable: !!attrs.editable, getAttribute: (n: string) => (n === 'role' ? (attrs.role ?? null) : null), matches: () => !!attrs.keyboard }) as unknown as EventTarget
  const text = el('INPUT', { type: 'text' })
  for (const key of [' ', 'z', 'ArrowLeft', 'Backspace']) assert.ok(consumesKey(text, key), `text field takes ${key}`)
  assert.ok(consumesKey(el('DIV', { editable: true }), 'c'))
  assert.ok(consumesKey(el('TEXTAREA'), ' '))
  // The transcript: Delete cuts selected words there, never the clip under the playhead.
  assert.ok(consumesKey(el('DIV', { role: 'textbox' }), 'Delete'))
  assert.ok(!consumesKey(el('DIV', { role: 'textbox' }), ' '))
  // Clicked controls: Space plays, arrows step.
  assert.ok(!consumesKey(el('BUTTON'), ' '))
  assert.ok(!consumesKey(el('INPUT', { type: 'radio' }), 'ArrowRight'))
  assert.ok(!consumesKey(el('INPUT', { type: 'range' }), 'ArrowLeft'))
  assert.ok(!consumesKey(el('SELECT'), ' '))
  // Keyboard-focused controls keep their own keys, and only those.
  assert.ok(consumesKey(el('BUTTON', { keyboard: true }), ' '))
  assert.ok(!consumesKey(el('BUTTON', { keyboard: true }), 'ArrowLeft'))
  assert.ok(consumesKey(el('INPUT', { type: 'radio', keyboard: true }), 'ArrowRight'))
  assert.ok(consumesKey(el('INPUT', { type: 'range', keyboard: true }), 'ArrowLeft'))
  assert.ok(consumesKey(el('INPUT', { type: 'checkbox', keyboard: true }), ' '))
  assert.ok(!consumesKey(el('INPUT', { type: 'checkbox', keyboard: true }), 'c'))
  assert.ok(!consumesKey(el('CANVAS', { keyboard: true }), ' '))
  assert.equal(commandFor({ ...ev('z', 'KeyZ', { meta: true }), target: text } as KeyboardEvent), undefined)
})

test('search ranks title prefixes, then word starts, then anywhere', () => {
  const c = (title: string, group = 'G'): Command => ({ id: title, title, group, run: () => {} })
  const list = [c('Paste'), c('Set speed 2×', 'Clip'), c('Speed up typing'), c('Apply speed to all clips')]
  assert.deepEqual(search(list, 'speed').map((x) => x.title), ['Speed up typing', 'Set speed 2×', 'Apply speed to all clips'])
  assert.deepEqual(search(list, 'clip 2').map((x) => x.title), ['Set speed 2×'])
  assert.equal(search(list, '').length, 4)
  assert.equal(search(list, 'zzz').length, 0)
})
