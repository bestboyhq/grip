// Anonymous usage counts: what happened (a recording finished, an export, a share), never who did it or what it shows.
// Each count goes to the platform's POST /api/events (bestboy.dev docs/api.md, "Usage counts"), which relays it to
// Logdash without an account, so it adds to a daily count of people that changes every day and follows no one.
// No ID, no names, no paths, no content. Off until the user says yes: onboarding asks, once (main.ts asks whoever
// onboarded before it did), and Settings changes it. Dev runs send only to a local platform (STUDIO_SHARE_URL).
import { app } from 'electron'
import { SERVER, USER_AGENT } from './account.ts'
import { settings } from './shell/settings.ts'

type Props = Record<string, string | number | boolean>

/** Count one `grip_<name>` event. Never throws and never waits. */
export function count(name: string, props?: Props) {
  if (settings().usageCounts !== true || (!app.isPackaged && !process.env.STUDIO_SHARE_URL)) return
  // ponytail: a count made offline is dropped; queue them on disk if gaps ever skew the numbers.
  fetch(`${SERVER}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ app: 'grip', version: app.getVersion(), events: [{ name: `grip_${name}`, props }] }),
    signal: AbortSignal.timeout(10e3),
  }).catch(() => {})
}
