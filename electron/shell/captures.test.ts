import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropped, KEEP, remember, type Capture } from './captures.ts'

test('recent captures: newest first, once per path, KEEP at most, and only Grip’s own files go', () => {
  const own = '/Users/me/Library/Application Support/Grip/Screenshots'
  const shot = (n: number, dir = own): Capture => ({ kind: 'shot', path: `${dir}/Screenshot #${n} ✨ café.png`, at: n })
  const rec: Capture = { kind: 'recording', path: '/Users/me/Movies/Grip/Demo #1 ✨ café.grip', at: 0 }
  const desktop = shot(1, '/Users/me/Desktop')

  let list: Capture[] = []
  for (const c of [rec, desktop, shot(2), shot(3), shot(4)]) list = remember(list, c)
  assert.deepEqual(list.map((c) => c.at), [4, 3, 2, 1, 0])
  assert.equal(list.length, KEEP)

  // The same capture again moves to the top instead of showing twice.
  assert.deepEqual(remember(list, shot(2)).map((c) => c.at), [2, 4, 3, 1, 0])

  // Two more push out the recording and the Desktop screenshot: neither file is Grip's to delete.
  const next = remember(remember(list, shot(5)), shot(6))
  assert.deepEqual(next.map((c) => c.at), [6, 5, 4, 3, 2])
  assert.deepEqual(dropped(list, next, own), [])
  // One more pushes out a screenshot in Grip's folder: that file goes.
  assert.deepEqual(dropped(next, remember(next, shot(7)), own), [shot(2).path])
  // Moved to the Desktop (Save to Desktop): Grip's copy goes, the Desktop file stays listed.
  const moved = next.map((c) => (c.path === shot(6).path ? shot(6, '/Users/me/Desktop') : c))
  assert.deepEqual(dropped(next, moved, own), [shot(6).path])
})
