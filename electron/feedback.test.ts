import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// feedback.ts runs in Electron's main process: stand in for Electron, the account, and the share list.
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`
const modules = {
  electron: stub('export const nativeImage = {}'),
  './account.ts': stub(`export const SERVER = 'https://platform', accountToken = () => '', forget = () => {}`),
  './share.ts': stub('export const sharedFrom = () => undefined'),
}
register(
  stub(`export async function resolve(specifier, context, next) {
    const to = ${JSON.stringify(modules)}[specifier]
    return to ? { url: to, shortCircuit: true } : next(specifier, context)
  }`),
)
const { parseLink, threads, THREADS } = await import('./feedback.ts')
type Comment = Parameters<typeof threads>[0][number]

const c = (id: string, o: Partial<Comment> = {}): Comment => ({ id, parent: null, t: 0, x: null, y: null, name: 'Zoë', text: id, at: '2026-11-01T10:00:00.000Z', guest: true, mine: false, reaction: false, resolved: false, ...o })

test('a link, with or without its scheme or key, or a bare id, names the item', () => {
  assert.deepEqual(parseLink('https://bestboy.dev/v/x7Kq2mP9aB3c'), { id: 'x7Kq2mP9aB3c' })
  assert.deepEqual(parseLink(' bestboy.dev/v/x7Kq2mP9aB3c?k=Ab_-0123456789abcdefgh#t=3 '), { id: 'x7Kq2mP9aB3c', key: 'Ab_-0123456789abcdefgh' })
  assert.deepEqual(parseLink('http://localhost:8787/v/x7Kq2mP9aB3c/video.mp4'), { id: 'x7Kq2mP9aB3c' })
  assert.deepEqual(parseLink('x7Kq2mP9aB3c'), { id: 'x7Kq2mP9aB3c' })
  for (const bad of ['x7Kq2mP9aB3', 'https://bestboy.dev/v/x7Kq2mP9aB3cd', 'https://bestboy.dev/', 42]) assert.throws(() => parseLink(bad), /share link/)
})

test('comments become threads: open first, replies in written order however deep, reactions counted', () => {
  const page = threads([
    c('late', { t: 30, x: 0.5, y: 0.25, at: '2026-11-01T09:00:00.000Z', take: 2 }),
    c('done', { t: 5, resolved: true }),
    c('early', { t: 12.5 }),
    c('r2', { parent: 'r1', at: '2026-11-01T12:00:00.000Z', guest: false, mine: true, name: 'Simon' }),
    c('r1', { parent: 'late', at: '2026-11-01T11:00:00.000Z' }),
    c('like', { reaction: true, text: '👍', t: 3 }),
  ])
  assert.deepEqual(
    page.threads.map((t) => t.id),
    ['early', 'late', 'done'],
  )
  const late = page.threads[1]
  assert.deepEqual([late.time, late.x, late.y, late.take], ['0:30', 0.5, 0.25, 2])
  assert.deepEqual([page.threads[0].x, page.threads[0].take], [undefined, undefined]) // a platform before takes sends none
  assert.deepEqual(late.replies, [
    { id: 'r1', author: 'Zoë', guest: true, text: 'r1', at: '2026-11-01T11:00:00.000Z' },
    { id: 'r2', parent: 'r1', author: 'Simon', guest: false, mine: true, text: 'r2', at: '2026-11-01T12:00:00.000Z' },
  ])
  assert.deepEqual([page.open, page.resolved, page.reactions, page.next], [2, 1, 1, undefined])
})

test('pages move on by time, even past more threads than a page at one moment', () => {
  const many = [...Array.from({ length: THREADS + 5 }, (_, i) => c(`zero${i}`)), c('one', { t: 1 }), c('two', { t: 2 })]
  const first = threads(many)
  assert.equal(first.threads.length, THREADS + 5) // one moment: all of it
  assert.equal(first.next, 1)
  const second = threads(many, first.next)
  assert.deepEqual([second.threads.map((t) => t.id), second.next], [['one', 'two'], undefined])
  const spread = Array.from({ length: THREADS + 1 }, (_, i) => c(`t${i}`, { t: i }))
  assert.deepEqual([threads(spread).threads.length, threads(spread).next], [THREADS, THREADS])
})
