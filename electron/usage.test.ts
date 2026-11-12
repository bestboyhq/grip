import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// usage.ts runs in Electron's main process: stand in for Electron, the account, settings, and the platform.
const g = globalThis as any
const stub = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`
const modules = {
  electron: stub(`export const app = { getPath: () => globalThis.userData, isPackaged: true, getVersion: () => '1.0.0' }
    export const ipcMain = { handle: (channel, fn) => (globalThis.ipc[channel] = fn) }`),
  './account.ts': stub(`export const SERVER = 'https://platform', USER_AGENT = 'Grip', accountToken = () => ''`),
  './shell/settings.ts': stub(`export const settings = () => globalThis.settings, settingsListeners = []`),
}
register(
  stub(`export async function resolve(specifier, context, next) {
    const to = ${JSON.stringify(modules)}[specifier]
    return to ? { url: to, shortCircuit: true } : next(specifier, context)
  }`),
)

let up = true // whether the platform takes events
let sent: Array<{ name: string; props?: Record<string, unknown> }> = []
g.fetch = async (_url: string, init: { body: string }) => (up && sent.push(...JSON.parse(init.body).events), { ok: up })
const settle = () => new Promise((r) => setImmediate(r))
let launches = 0
/** A launch: a fresh module that reads usage.json, then the `launched` count main.ts makes. */
async function launch(at: string) {
  mock.timers.setTime(new Date(at).getTime())
  sent = []
  g.ipc = {}
  const usage = await import(`./usage.ts?launch=${++launches}`)
  usage.registerUsage()
  usage.count('launched')
  await settle()
  return usage
}
const named = (name: string) => sent.filter((e) => e.name === `grip_${name}`).map((e) => e.props)

test('journey markers go once, after delivery, with cohort and days; days count week and month', async () => {
  g.userData = mkdtempSync(join(tmpdir(), 'grip-usage-'))
  g.settings = { usageCounts: true, onboarded: false }
  mock.timers.enable({ apis: ['Date'] })

  up = false // offline at first open: nothing counts as sent
  await launch('2026-11-09T10:00') // a Monday
  up = true
  let usage = await launch('2026-11-09T11:00')
  assert.deepEqual(named('first_open'), [{ cohort: '2026-11-09', days: 0 }])
  assert.deepEqual(named('day'), [{ week_first: 'yes', month_first: 'yes', age: 'day_1' }])

  sent = []
  g.ipc['usage:setup']({}, 'welcome')
  g.ipc['usage:setup']({}, 'settings') // no step
  mock.timers.setTime(Date.now() + 42e3)
  usage.count('onboarded')
  usage.count('recorded')
  usage.count('recorded')
  await settle()
  assert.deepEqual(named('setup_welcome'), [{ cohort: '2026-11-09', days: 0, setup_seconds: 0 }])
  assert.deepEqual(named('setup_finished'), [{ cohort: '2026-11-09', days: 0, setup_seconds: 42 }])
  assert.deepEqual(named('first_recording'), [{ cohort: '2026-11-09', days: 0 }])
  assert.equal(named('first_open').length + named('day').length + named('setup_settings').length, 0)
  g.settings.onboarded = true

  await launch('2026-11-15T09:00') // Sunday, same ISO week
  assert.deepEqual(named('day'), [{ week_first: 'no', month_first: 'no', age: 'week_1' }])
  assert.deepEqual(named('returned_week_1'), [{ cohort: '2026-11-09', days: 6 }])
  assert.equal(named('first_recording').length, 0)

  await launch('2026-11-16T09:00') // Monday: a new week
  assert.deepEqual(named('day'), [{ week_first: 'yes', month_first: 'no', age: 'month_1' }]) // 7 days: past the first week
  assert.equal(named('returned_week_1').length, 0)

  await launch('2026-12-01T09:00')
  assert.deepEqual(named('month'), [{ month: '2026-11', active_days: 3 }])
  assert.deepEqual(named('day'), [{ week_first: 'yes', month_first: 'yes', age: 'month_1' }])
  assert.deepEqual(named('returned_month_1'), [{ cohort: '2026-11-09', days: 22 }])
  mock.timers.reset()
})

test('an install older than the journey has none', async () => {
  g.userData = mkdtempSync(join(tmpdir(), 'grip-usage-'))
  writeFileSync(join(g.userData, 'settings.json'), '{}')
  g.settings = { usageCounts: true, onboarded: true }
  mock.timers.enable({ apis: ['Date'] })
  const usage = await launch('2026-11-12T09:00')
  usage.count('recorded')
  await settle()
  assert.deepEqual(
    sent.map((e) => e.name),
    ['grip_launched', 'grip_day', 'grip_recorded'],
  )
  mock.timers.reset()
})
