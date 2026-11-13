import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chapters, glide, parseDemo, parseKey, parseSelector, travel } from './demo.ts'

test('selectors: CSS as given, text= by its words in any case, text="…" exactly', () => {
  assert.deepEqual(parseSelector(' #add > button ', 'click'), { css: '#add > button' })
  assert.deepEqual(parseSelector('text=Add  task', 'click'), { text: 'Add task', exact: false })
  assert.deepEqual(parseSelector('text="Add task"', 'click'), { text: 'Add task', exact: true })
  assert.deepEqual(parseSelector('text=Café #1 ✨', 'click'), { text: 'Café #1 ✨', exact: false })
  assert.throws(() => parseSelector('text=  ', 'click'), /no text/)
  assert.throws(() => parseSelector('', 'click'), /CSS selector/)
})

test('keys: the names web tests use, sent as Electron sends them and logged as the recorder logs them', () => {
  assert.deepEqual(parseKey('Enter'), { code: 'Enter', modifiers: [], label: '↩', mods: [], char: '\r' })
  assert.deepEqual(parseKey('Meta+K'), { code: 'K', modifiers: ['meta'], label: 'K', mods: ['⌘'] }) // a shortcut types nothing
  assert.deepEqual(parseKey('Shift+Control+Tab'), { code: 'Tab', modifiers: ['control', 'shift'], label: '⇥', mods: ['⌃', '⇧'] })
  assert.deepEqual(parseKey('Meta++'), { code: '+', modifiers: ['meta'], label: '+', mods: ['⌘'] })
  assert.equal(parseKey('a').char, 'a')
  assert.equal(parseKey('ArrowDown').label, '↓')
  assert.equal(parseKey('F12').code, 'F12')
  // A Mac's editing shortcuts carry their command; the clipboard's do not.
  assert.deepEqual(parseKey('Meta+a').edit, { command: 'selectAll', key: 'a', code: 'KeyA', vk: 65 })
  assert.deepEqual(parseKey('Shift+Meta+ArrowLeft').edit, { command: 'moveToLeftEndOfLineAndModifySelection', key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 })
  assert.equal(parseKey('Meta+V').edit, undefined)
  assert.equal(parseKey('Control+A').edit, undefined)
  for (const bad of ['', 'Hyper+K', 'Meta+Meta+K', 'F21', 'ab', 'é']) assert.throws(() => parseKey(bad), /press must be/)
})

test('the pointer leaves and lands exactly, eased, on a slight arc, and takes longer to go farther', () => {
  const at = glide([[0, 100, 100], [1, 500, 100]])
  assert.deepEqual(at(0), [100, 100])
  assert.deepEqual(at(1), [500, 100])
  assert.ok(at(0.1)[0] - 100 < 400 * 0.1, 'starts slow')
  assert.ok(Math.abs(at(0.5)[1] - 100) > 5, 'bows off the straight line')
  assert.equal(travel(0), 0)
  assert.ok(travel(100) < travel(1000) && travel(1000) < 1.2)
})

test('a demo is checked step by step, and each step gets a label', () => {
  const d = parseDemo({ url: 'file:///tmp/a%20b.html', steps: [{ click: 'text=Add', say: 'Add a task' }, { type: 'Ship it\n', into: '#task' }, { press: 'Meta+K' }, { wait: 500 }, { wait: '.row' }, { scroll: 'footer' }] })
  assert.equal(d.url, 'file:///tmp/a%20b.html')
  assert.deepEqual([d.width, d.height, d.share, d.private], [1440, 900, false, false])
  assert.deepEqual(
    d.steps.map((s) => s.label),
    ['Add a task', 'type “Ship it\n” into #task', 'press Meta+K', 'wait 500 ms', 'wait .row', 'scroll footer'],
  )
  assert.equal(d.steps[0].say, 'Add a task')
  assert.deepEqual(d.steps[4], { do: 'wait', target: { css: '.row' }, label: 'wait .row' })
  const no = (a: Record<string, unknown>, why: RegExp) => assert.throws(() => parseDemo({ url: 'https://example.com', steps: [{ click: 'a' }], ...a }), why)
  no({ url: 'javascript:alert(1)' }, /http, https, or file/)
  no({ url: 'file://server/share/a.html' }, /on this Mac/)
  no({ steps: [] }, /1 to 30/)
  no({ steps: [{ click: 'a', hover: 'b' }] }, /Step 1 must have exactly one of .* it has click and hover/)
  no({ steps: [{ click: 'a', into: 'b' }] }, /“into”, which click does not take/)
  no({ steps: [{ click: 'a', say: 'x'.repeat(81) }] }, /say must be 1 to 80/)
  no({ steps: [{ wait: 1.5 }] }, /whole number of ms/)
  no({ width: 4000 }, /width must be .* 320 to 1920/)
  no({ share: 'yes' }, /share must be true or false/)
})

test('chapters never share a time', () => {
  assert.deepEqual(chapters([{ t: 0.004, title: 'A' }, { t: 0.001, title: 'B' }, { t: 2.345, title: 'C' }]), [
    { t: 0, title: 'A' },
    { t: 0.01, title: 'B' },
    { t: 2.35, title: 'C' },
  ])
})
