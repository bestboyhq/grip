// Usage counts: what happened (a recording finished, an export, a share), never what it shows.
// Each count goes to the platform's POST /api/events (bestboy.dev docs/api.md, "Usage counts"), which relays it to
// Logdash. Signed in, it carries the account's token, so the count joins that account's days (Logdash keeps a hash);
// signed out, it adds to a daily count of people that follows no one. No names, no paths, no content.
// On until Settings turns it off; onboarding's last step says so in one line. Turning it off sends one last count,
// with no account, so the numbers know how many people they leave out. Dev runs send only to a local platform
// (STUDIO_SHARE_URL).
import { app } from 'electron'
import { SERVER, USER_AGENT, accountToken } from './account.ts'
import { settings, settingsListeners } from './shell/settings.ts'

type Props = Record<string, string | number | boolean>

/** Count one `grip_<name>` event. Never throws and never waits. */
export function count(name: string, props?: Props) {
  if (settings().usageCounts !== false) send(name, props, accountToken())
}

settingsListeners.push((s, prev) => {
  if (s.usageCounts === false && prev.usageCounts !== false) send('stats_off')
})

function send(name: string, props?: Props, token = '') {
  if (!app.isPackaged && !process.env.STUDIO_SHARE_URL) return
  // ponytail: a count made offline is dropped; queue them on disk if gaps ever skew the numbers.
  fetch(`${SERVER}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ app: 'grip', version: app.getVersion(), events: [{ name: `grip_${name}`, props }] }),
    signal: AbortSignal.timeout(10e3),
  }).catch(() => {})
}
