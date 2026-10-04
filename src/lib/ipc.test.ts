import { test } from 'node:test'
import assert from 'node:assert/strict'

test('module-scope listeners survive hot reloads: one per channel, never another', async () => {
  const live = new Map<string, Set<() => void>>()
  const studio = {
    on(channel: string, cb: () => void) {
      const set = live.get(channel) ?? live.set(channel, new Set()).get(channel)!
      set.add(cb)
      return () => set.delete(cb)
    },
  }
  Object.assign(globalThis, { window: { studio } })
  // A hot reload runs the module again: each import with a new query is a fresh module instance,
  // the way Vite re-imports an updated module (ipc.ts itself included).
  const load = (run: number): Promise<typeof import('./ipc.ts')> => import(`./ipc.ts?run=${run}`)
  const first = await load(1)
  const second = await load(2)
  const a = () => {}
  const b = () => {}
  first.listen('transcript:progress', a)
  first.listen('settings:changed', a)
  second.listen('transcript:progress', b)
  second.listen('transcript:progress', b)
  assert.deepEqual([...live.get('transcript:progress')!], [b])
  assert.deepEqual([...live.get('settings:changed')!], [a])
})
