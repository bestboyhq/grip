// Owner: sharing. What teammates say on a share link, for agents (get_feedback and reply_feedback in
// electron/agents.ts). The platform (docs/api.md, "Comments") hands out comments flat; here they become threads: a
// comment with every reply under it, however deep it answers, in the order written. Reactions are only counted.
//
//   GET   /api/items/:id, /api/items/:id/comments       the video, and every comment, reply, and reaction
//   POST  /api/items/:id/comments { text, t, parent }   a reply, as the account Grip is signed in to
//   PATCH /api/items/:id/comments/:cid { resolved }     resolve a thread: the link's team or its writer may
// A private link's key rides along as ?k=, as on the link page; the link's team needs none.
import { nativeImage } from 'electron'
import { SERVER, accountToken, forget } from './account.ts'
import { sharedFrom } from './share.ts'
import { api } from './upload.ts'

/** A comment, reply, or reaction, as the platform sends it. */
export interface Comment {
  id: string
  parent: string | null
  t: number
  x: number | null
  y: number | null
  name: string
  text: string
  at: string
  guest: boolean
  mine: boolean
  reaction: boolean
  resolved: boolean
  take?: number // the take it was made on, from a platform with takes
}
type Said = { author: string; guest: boolean; mine?: true; text: string; at: string }
type Reply = { id: string; parent?: string } & Said
export type Thread = { id: string; t: number; time: string; x?: number; y?: number; take?: number } & Said & { resolved: boolean; replies: Reply[]; frame?: number }
type Image = { data: string; mimeType: string }
type Args = Record<string, unknown>
type Result = { text: string; data: Record<string, unknown>; images?: Image[]; failed?: boolean }
/** get_frame: a project's frame, rendered as the export renders it. */
type Frame = (a: Args) => Promise<{ image?: Image }>

export const THREADS = 20 // threads a get_feedback answer lists: each open one brings a frame, the costliest part
export const MAX_REPLIES = 50
const FRAME_HEIGHT = 540
const FRAMES_MS = 30_000 // frames stop by then, so the answer beats the client's limit of about 60 s
export const LINK = { type: 'string', minLength: 1, description: 'The share link, like https://bestboy.dev/v/x7Kq2mP9aB3c, with its ?k= key when it has one, or its 12-character id.' }
const SIGN_IN = 'Sign in from Grip’s menu bar icon (Sign In to Share Links)'

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const rootOf = (byId: Map<string, Comment>, c?: Comment) => {
  while (c?.parent) c = byId.get(c.parent)
  return c
}

/** The item id in a share link (with or without its scheme), and the link's key when it has one; a bare id too. */
export function parseLink(link: unknown): { id: string; key?: string } {
  const s = typeof link === 'string' ? link.trim() : ''
  const id = s.match(/^[A-Za-z0-9]{12}$/)?.[0] ?? s.match(/\/v\/([A-Za-z0-9]{12})(?:[/?#]|$)/)?.[1]
  if (!id) throw new Error('link must be a share link, like https://bestboy.dev/v/x7Kq2mP9aB3c, or its 12-character id.')
  const key = s.match(/[?&]k=([\w-]+)/)?.[1]
  return key ? { id, key } : { id }
}

/** The comments as threads, every reply in the order written under the thread it is in, however deep it answers.
 *  A page holds the THREADS earliest from `from` on, open ones first, each kind by time; `next` starts the next page.
 *  open, resolved, and reactions count the whole link. */
export function threads(comments: Comment[], from = 0) {
  const byId = new Map(comments.map((c) => [c.id, c]))
  const said = (c: Comment): Said => ({ author: c.name, guest: c.guest, ...(c.mine && { mine: true as const }), text: c.text, at: c.at })
  const all = new Map<string, Thread>()
  for (const c of comments) {
    if (!c.parent && !c.reaction) all.set(c.id, { id: c.id, t: c.t, time: clock(c.t), ...(c.x !== null && c.y !== null && { x: c.x, y: c.y }), ...(c.take !== undefined && { take: c.take }), ...said(c), resolved: c.resolved, replies: [] })
  }
  for (const c of [...comments].sort((a, b) => a.at.localeCompare(b.at))) {
    const thread = c.parent ? all.get(rootOf(byId, c)?.id ?? '') : undefined
    thread?.replies.push({ id: c.id, ...(c.parent !== thread.id && { parent: c.parent! }), ...said(c) })
  }
  const list = [...all.values()].filter((x) => x.t >= from)
  const times = list.map((x) => x.t).sort((a, b) => a - b)
  // A page ends before the moment past THREADS; a page that is all one moment takes every thread there, so the
  // next page always moves on.
  let next: number | undefined = times[THREADS]
  if (next !== undefined && next === times[0]) next = times.find((t) => t > times[0])
  const page = list.filter((x) => next === undefined || x.t < next).sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.t - b.t || a.at.localeCompare(b.at))
  const open = [...all.values()].filter((x) => !x.resolved).length
  return { threads: page, open, resolved: all.size - open, reactions: comments.filter((c) => c.reaction).length, ...(next !== undefined && { next }) }
}

/** One call to the platform, its failures in words that say what to do. */
async function call(method: string, path: string, key: string | undefined, body?: unknown): Promise<any> {
  try {
    return await api(SERVER, accountToken(), method, key ? `${path}?k=${encodeURIComponent(key)}` : path, body, AbortSignal.timeout(15_000))
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 401) forget() // revoked: signed out here too, as a failed share does
    throw new Error(
      status === 401 ? `Grip is signed out of its Bestboy account. ${SIGN_IN}, then ask again.`
      : status === 403 ? `${(e as Error).message} ${SIGN_IN} with an account in the link’s team${key ? '' : ', or give the whole link with its ?k= key'}, then ask again.`
      : status === undefined ? `Can’t reach ${new URL(SERVER).host}. Check the connection, then ask again.`
      : (e as Error).message,
    )
  }
}

/** get_feedback: the link's threads, and each open one's frame when this Mac shared its take from a project. */
export async function getFeedback(a: Args, frame: Frame): Promise<Result> {
  const { id, key } = parseLink(a.link)
  if (a.start !== undefined && (typeof a.start !== 'number' || !(a.start >= 0))) throw new Error('start must be a number of seconds, 0 or more.')
  const [item, comments] = await Promise.all([call('GET', `/api/items/${id}`, key), call('GET', `/api/items/${id}/comments`, key)])
  const page = threads(comments, (a.start as number | undefined) ?? 0)
  // Each take of a link is its own recording: a thread's frame comes from the project its take was shared from.
  const open = page.threads.filter((x) => !x.resolved)
  const projectOf = (th: Thread) => sharedFrom(id, th.take)
  const images: Image[] = []
  let missed = open.length && !open.some(projectOf) ? 'No frames: this Mac did not share this link, so Grip has no project to render them from.' : ''
  const until = Date.now() + FRAMES_MS
  for (const th of open) {
    const project = projectOf(th)
    if (!project) continue
    if (Date.now() > until) {
      missed = `Grip stopped rendering frames after ${FRAMES_MS / 1000} s: get_frame shows the rest at their times.`
      break
    }
    try {
      const { image } = await frame({ project, time: th.t, size: FRAME_HEIGHT })
      if (!image) continue
      images.push(th.x === undefined ? image : { ...image, data: ring(Buffer.from(image.data, 'base64'), th.x, th.y!).toString('base64') })
      th.frame = images.length
    } catch (e) {
      missed ||= `No frame at ${th.time}: ${(e as Error).message}` // the project is gone, or shorter than the thread's time now
    }
  }
  const frames = [images.length ? 'Frame n is the nth image: the project the thread’s take was shared from, at the thread’s time, as get_frame renders it, its spot ringed in magenta. It shows the project as it stands now, so an edit since the share that moved times moves what shows.' : '', missed].filter(Boolean).join(' ')
  // The platform hands the key only to the link's team, so a guest keeps the one they gave.
  const url = new URL(item.link ?? `${SERVER}/v/${id}`)
  if (key && !url.searchParams.has('k')) url.searchParams.set('k', key)
  const link = url.href
  const head = `“${item.title}” (${link}): ${count(page.open, 'open thread')}, ${page.resolved} resolved, ${count(page.reactions, 'reaction')}.`
  const who = (s: Said) => `${s.author}${s.guest ? ' (guest)' : ''}${s.mine ? ' (this account)' : ''}, ${s.at.slice(0, 10)}`
  const lines = page.threads.flatMap((th, i) => [
    ...(th.resolved && !page.threads[i - 1]?.resolved ? ['Resolved:'] : []),
    `- ${th.id} at ${th.time} (${th.t} s)${th.take && item.take > 1 ? ` of take ${th.take}` : ''}${th.x === undefined ? '' : `, on the spot ${th.x}, ${th.y}`}${th.frame ? `, frame ${th.frame}` : ''}. ${who(th)}: ${th.text.replaceAll('\n', '\n    ')}`,
    ...th.replies.map((r) => `    - ${r.id}${r.parent ? ` (to ${r.parent})` : ''} ${who(r)}: ${r.text.replaceAll('\n', '\n      ')}`),
  ])
  const more = page.next === undefined ? '' : `More threads from ${clock(page.next)}: get_feedback with start ${page.next} lists them.`
  const message = [head, frames, more].filter(Boolean).join(' ')
  const text = [head, ...lines, frames, more, page.threads.length ? 'reply_feedback answers a thread, or a reply in it, by its id; resolve: true resolves the thread.' : ''].filter(Boolean).join('\n')
  return { text, data: { message, id, title: item.title, link, open: page.open, resolved: page.resolved, reactions: page.reactions, threads: page.threads, ...(page.next !== undefined && { next: page.next }) }, images }
}

/** reply_feedback: each reply under the comment or reply it names, in order, and its thread resolved when asked.
 *  What fails is reported beside what went through. `agent`, the app that asked, goes with each reply, so the
 *  link page can tag it; a platform that predates the tag ignores it. */
export async function replyFeedback(a: Args, agent?: string): Promise<Result> {
  const { id, key } = parseLink(a.link)
  let list = a.replies
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list) // a small model's list, sent as a JSON string
    } catch {
      // the check below says what to send
    }
  }
  if (!Array.isArray(list) || !list.length || list.length > MAX_REPLIES) throw new Error(`replies must be a list of 1 to ${MAX_REPLIES} replies, each { comment, text, resolve? }.`)
  const replies = list.map((r: any, i) => {
    if (!r || typeof r !== 'object' || typeof r.comment !== 'string' || !r.comment || typeof r.text !== 'string' || !r.text.trim() || (r.resolve != null && typeof r.resolve !== 'boolean')) {
      throw new Error(`replies[${i}] must be { comment: the id of a comment or reply, text: what to say, resolve?: true or false }.`)
    }
    return { comment: r.comment as string, text: r.text as string, resolve: r.resolve === true }
  })
  if (!accountToken()) throw new Error(`Grip is signed out, and replies go out as its Bestboy account. ${SIGN_IN}, then ask again.`)
  const comments: Comment[] = await call('GET', `/api/items/${id}/comments`, key)
  const byId = new Map(comments.map((c) => [c.id, c]))
  const results: Array<{ comment: string; reply?: string; resolved?: string; error?: string }> = []
  let stop = '' // signed out midway: the rest would fail the same way
  for (const r of replies) {
    const done: (typeof results)[number] = { comment: r.comment }
    results.push(done)
    const c = byId.get(r.comment)
    const thread = rootOf(byId, c)
    if (stop || !c || c.reaction || !thread) {
      done.error = stop || `No comment or reply “${r.comment}” on this link: get_feedback lists their ids.`
      continue
    }
    try {
      done.reply = (await call('POST', `/api/items/${id}/comments`, key, { text: r.text, t: thread.t, parent: c.id, ...(agent && { agent }) })).id
      if (r.resolve) done.resolved = (await call('PATCH', `/api/items/${id}/comments/${thread.id}`, key, { resolved: true })).id
    } catch (e) {
      done.error = (e as Error).message
      if (!accountToken()) stop = done.error
    }
  }
  const posted = results.filter((x) => x.reply).length
  const resolved = new Set(results.flatMap((x) => (x.resolved ? [x.resolved] : []))).size
  const head = `Posted ${posted} of ${results.length} ${results.length === 1 ? 'reply' : 'replies'}${resolved ? `, and resolved ${count(resolved, 'thread')}` : ''}.`
  const lines = results.map((x) => `- ${x.comment}: ${x.reply ? `replied (${x.reply})${x.resolved ? `, thread ${x.resolved} resolved` : ''}${x.error ? `, but not resolved: ${x.error}` : ''}` : `not posted: ${x.error}`}`)
  return { text: [head, ...lines].join('\n'), data: { message: head, results }, failed: !posted }
}

/** The JPEG with a ring around the spot x, y (0 to 1): magenta edged in white, which shows on any screen, and whose
 *  bytes read the same in BGRA and RGBA. */
function ring(jpeg: Buffer, x: number, y: number): Buffer {
  const img = nativeImage.createFromBuffer(jpeg)
  const { width: w, height: h } = img.getSize()
  const px = img.toBitmap()
  if (px.length !== w * h * 4) return jpeg
  const [cx, cy, r] = [x * w, y * h, h / 20]
  for (let j = Math.max(0, Math.floor(cy - r - 4)); j < Math.min(h, cy + r + 4); j++) {
    for (let i = Math.max(0, Math.floor(cx - r - 4)); i < Math.min(w, cx + r + 4); i++) {
      const d = Math.abs(Math.hypot(i - cx, j - cy) - r)
      if (d <= 4) px.set([255, d > 2 ? 255 : 0, 255, 255], (j * w + i) * 4)
    }
  }
  return nativeImage.createFromBitmap(px, { width: w, height: h }).toJPEG(85)
}
