import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { editorCloser, NO_ANSWER, type Choice } from './closing.ts'

/** Editor windows driven by a fake shell: each `ask` is answered by the window's next queued save
 *  result, each prompt by the next queued choice. */
function setup(timeout = 1000) {
  type Win = { name: string; saves: Array<string | null>; choices: Choice[]; closed?: boolean }
  const log: string[] = []
  let quitting = false
  const closer = editorCloser<Win>(
    {
      ask: (w) => {
        log.push(`ask ${w.name}`)
        const result = w.saves.shift()
        if (result !== null && result !== undefined) setImmediate(() => closer.answered(w, result)) // null: never answers
      },
      prompt: async (w, error) => (log.push(`prompt ${w.name}: ${error}`), w.choices.shift()!),
      close: (w) => {
        log.push(`close ${w.name}`)
        w.closed = closer.closing(w) // the close event that follows
      },
      gone: (w) => !!w.closed,
      quitting: () => quitting,
      quit: () => log.push('quit'),
      stay: () => (log.push('stay'), (quitting = false)),
    },
    timeout,
  )
  const win = (name: string, saves: Array<string | null>, choices: Choice[] = []): Win => ({ name, saves, choices })
  return { closer, log, win, quit: () => (quitting = true) }
}

test('a close waits for the save; a failed one asks and never drops the edits on its own', async () => {
  const { closer, log, win } = setup()
  const a = win('a', [''])
  assert.equal(closer.closing(a), false)
  assert.equal(closer.closing(a), false, 'closing again while it saves asks once')
  await sleep(5)
  assert.deepEqual(log.splice(0), ['ask a', 'close a'])
  assert.ok(a.closed)

  const b = win('b', ['disk full', 'disk full', ''], ['cancel', 'save'])
  closer.closing(b)
  await sleep(5)
  assert.deepEqual(log.splice(0), ['ask b', 'prompt b: disk full'], 'Cancel keeps the window')
  assert.ok(!b.closed)
  closer.closing(b)
  await sleep(5)
  assert.deepEqual(log.splice(0), ['ask b', 'prompt b: disk full', 'ask b', 'close b'], 'Save Again, then it closes')

  const c = win('c', ['disk full'], ['discard'])
  closer.closing(c)
  await sleep(5)
  assert.deepEqual(log.splice(0), ['ask c', 'prompt c: disk full', 'close c'], 'Discard Edits closes')
})

test('no answer in time asks too, and a late answer changes nothing', async () => {
  const { closer, log, win } = setup(10)
  const a = win('a', [null], ['cancel'])
  closer.closing(a)
  await sleep(30)
  closer.answered(a, '')
  await sleep(5)
  assert.deepEqual(log, ['ask a', `prompt a: ${NO_ANSWER}`])
  assert.ok(!a.closed)
})

test('quitting: every editor saves first; Cancel cancels the quit and keeps them all', async () => {
  const { closer, log, win, quit } = setup()
  const a = win('a', ['', ''])
  const b = win('b', ['disk full', ''], ['cancel'])
  quit()
  assert.deepEqual([closer.closing(a), closer.closing(b)], [false, false])
  await sleep(5)
  assert.deepEqual(log.splice(0), ['ask a', 'ask b', 'prompt b: disk full', 'stay'])
  assert.ok(!a.closed && !b.closed)
  // The next quit asks both again (a may have changed since), and resumes once both are saved.
  quit()
  assert.deepEqual([closer.closing(a), closer.closing(b)], [false, false])
  await sleep(5)
  assert.deepEqual(log.splice(0), ['ask a', 'ask b', 'quit'])
  assert.deepEqual([closer.closing(a), closer.closing(b)], [true, true], 'the resumed quit closes them')
})
