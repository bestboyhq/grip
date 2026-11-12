// Usage counts: what happened (a recording finished, an export, a share), never what it shows.
// Each count goes to the platform's POST /api/events (bestboy.dev docs/api.md, "Usage counts"), which relays it to
// Logdash. Signed in, it carries the account's token, so the count joins that account's days (Logdash keeps a hash);
// signed out, it adds to a daily count of people that follows no one. No names, no paths, no content.
// On until it is turned off in Settings; onboarding's shortcut step says so in its description. Turning it off sends
// one last count, with no account, so the numbers know how many people they leave out. DO_NOT_TRACK sends nothing.
// Dev runs send only to a local platform (STUDIO_SHARE_URL).
//
// The journey (first open, each onboarding step, first recording, first export, coming back) is one marker each,
// sent once: a marker waits in <userData>/usage.json until the platform takes it, and is retried at each launch.
// Every marker carries `cohort` (the local day of the first open) and `days` since it, so only a fresh install has
// a journey. `grip_day` counts each active local day, and `grip_month` sums the last month's active days.
import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SERVER, USER_AGENT, accountToken } from './account.ts'
import { settings, settingsListeners } from './shell/settings.ts'

type Props = Record<string, string | number | boolean>

/** The onboarding pages (src/windows/onboarding/Onboarding.svelte), in order: each sends `grip_setup_<page>`. */
const SETUP = ['welcome', 'permissions', 'shortcut']
/** Counts whose first one is a journey marker. */
const FIRSTS: Record<string, string> = { recorded: 'first_recording', exported: 'first_export', onboarded: 'setup_finished' }

interface State {
  /** Local day of the first open; null for an install older than the journey, which then has none. */
  first: string | null
  /** When onboarding showed its first page (ms). */
  setupAt: number | null
  /** Journey markers waiting for the platform, with their props as of when they happened. */
  due: Record<string, Props>
  sent: string[]
  /** The last day and month the platform took `grip_day` and `grip_month` for. */
  day: string | null
  month: string | null
  /** Local days with activity, from the last unreported month on. */
  days: string[]
}

let state: State | null = null
const file = () => join(app.getPath('userData'), 'usage.json')
const on = () => settings().usageCounts !== false
/** Atomic, and never throws: a full disk only means a marker is sent again. */
function save() {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(file() + '.tmp', JSON.stringify(state))
    renameSync(file() + '.tmp', file())
  } catch {}
}

/** Load the journey before anything writes settings.json: a fresh install has none yet. Call once userData is set. */
export function registerUsage() {
  load()
  ipcMain.handle('usage:setup', (_e, page: unknown) => {
    if (settings().onboarded || typeof page !== 'string' || !SETUP.includes(page)) return
    const s = load()
    if (s.setupAt === null) ((s.setupAt = Date.now()), save())
    journey(`setup_${page}`, setupSeconds())
    daily()
  })
}

function load(): State {
  if (state) return state
  try {
    state = JSON.parse(readFileSync(file(), 'utf8')) as State
  } catch {
    const fresh = !existsSync(join(app.getPath('userData'), 'settings.json'))
    state = { first: fresh ? today() : null, setupAt: null, due: {}, sent: [], day: null, month: null, days: [] }
    if (fresh) state.due.first_open = { cohort: state.first!, days: 0 }
    save()
  }
  return state
}

/** Count one `grip_<name>` event. Never throws and never waits. */
export function count(name: string, props?: Props) {
  if (FIRSTS[name]) journey(FIRSTS[name], name === 'onboarded' ? setupSeconds() : {})
  if (on()) void send(name, props, accountToken())
  daily()
}

settingsListeners.push((s, prev) => {
  if (s.usageCounts === false && prev.usageCounts !== false) void send('stats_off')
  if (s.usageCounts !== false && prev.usageCounts === false) daily()
})

function journey(marker: string, extra: Props = {}) {
  const s = load()
  if (!s.first || s.sent.includes(marker) || s.due[marker]) return
  s.due[marker] = { cohort: s.first, days: daysBetween(s.first, today()), ...extra }
  save()
}

function setupSeconds(): Props {
  const at = load().setupAt
  return at === null ? {} : { setup_seconds: Math.max(0, Math.round((Date.now() - at) / 1000)) }
}

const sending = new Set<string>()
/** Send once: `done` runs only after the platform took it, and a send in flight is never doubled. */
function once(key: string, name: string, props: Props, done: () => void) {
  if (sending.has(key)) return
  sending.add(key)
  void send(name, props, accountToken())
    .then((ok) => ok && (done(), save()))
    .finally(() => sending.delete(key))
}

/** The day's and month's counts, the return markers, and every journey marker still due. */
function daily() {
  const s = load()
  const day = today()
  if (!s.days.includes(day)) (s.days.push(day), save())
  if (s.first) {
    const d = daysBetween(s.first, day)
    if (d >= 1 && d <= 7) journey('returned_week_1')
    if (d >= 8 && d <= 30) journey('returned_month_1')
  }
  if (!on()) return
  for (const [marker, props] of Object.entries(s.due)) once(marker, marker, props, () => (delete s.due[marker], s.sent.push(marker)))
  const current = day.slice(0, 7)
  const earlier = s.days.filter((d) => d.slice(0, 7) < current).sort()
  const month = earlier.at(-1)?.slice(0, 7)
  if (month && s.month !== month) {
    const active = earlier.filter((d) => d.startsWith(month)).length
    once('month', 'month', { month, active_days: active }, () => ((s.month = month), (s.days = s.days.filter((d) => d.slice(0, 7) >= current))))
  }
  if (s.day !== day) {
    const props = {
      week_first: !s.day || weekStart(s.day) !== weekStart(day) ? 'yes' : 'no',
      month_first: !s.day || s.day.slice(0, 7) !== current ? 'yes' : 'no',
      // ponytail: an install older than the journey has no first open and reads as later.
      age: s.first ? age(daysBetween(s.first, day)) : 'later',
    }
    once('day', 'day', props, () => (s.day = day))
  }
}

/** Local YYYY-MM-DD. */
const today = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5)
const age = (days: number) => (days < 1 ? 'day_1' : days < 7 ? 'week_1' : days < 30 ? 'month_1' : 'later')
/** The Monday of a day's ISO week. */
function weekStart(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** True once the platform took it. */
async function send(name: string, props?: Props, token = ''): Promise<boolean> {
  if (process.env.DO_NOT_TRACK && process.env.DO_NOT_TRACK !== '0') return false
  if (!app.isPackaged && !process.env.STUDIO_SHARE_URL) return false
  // ponytail: a plain count made offline is dropped; only journey, day, and month counts wait for the next launch.
  return fetch(`${SERVER}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ app: 'grip', version: app.getVersion(), events: [{ name: `grip_${name}`, props }] }),
    signal: AbortSignal.timeout(10e3),
  }).then(
    (r) => r.ok,
    () => false,
  )
}
