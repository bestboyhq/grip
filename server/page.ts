// The link page /v/<id>: one small HTML document with inline CSS and JS. Besides it, the browser fetches only the
// video (Range requests, moov first) and the poster, so playback starts within a few round trips on a phone on 4G.
// Comments arrive inlined in the page; everything user-written is escaped here or set with textContent there.
import type { Comment, Item } from './server.ts'

export interface PageInput {
  item: Item
  base: string // public origin, for absolute Open Graph URLs
  key: string | null // this request's valid ?k=, carried into media and API URLs
  owner: boolean
  views: number | null // owner only
  offset: number // bytes uploaded so far
  comments: Comment[]
  nonce: string
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
const clock = (s: number) => {
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  const x = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`
}
const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`) // decimal, like Finder
const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`

const LOGO = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9d8cff"/><stop offset="1" stop-color="#6a4dff"/></linearGradient></defs><rect width="22" height="22" rx="6.5" fill="url(#lg)"/><circle cx="11" cy="11" r="4.2" fill="#fff"/></svg>`

export function itemPage(p: PageInput): string {
  const { item } = p
  const q = p.key ? `?k=${p.key}` : ''
  const media = (file: string) => `${p.base}/v/${item.id}/${file}${q}`
  const self = `${p.base}/v/${item.id}${q}`
  const date = new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const title = esc(item.title)
  let head = `<meta property="og:site_name" content="Studio"><meta property="og:title" content="${title}"><meta property="og:url" content="${esc(self)}"><meta name="twitter:title" content="${title}">`
  const data = { id: item.id, kind: item.kind, state: item.state, key: p.key, owner: p.owner, size: item.size, offset: p.offset, duration: item.duration ?? 0, comments: p.comments }

  if (item.state !== 'ready') {
    const pct = Math.floor((p.offset / item.size) * 100)
    return doc({
      title: item.title,
      head,
      nonce: p.nonce,
      data,
      body: `<main class="center"><div class="card">
<h1>${title}</h1>
<p class="dim" id="status" role="status">${p.offset >= item.size ? 'Finishing…' : `Uploading… ${pct}%`}</p>
<div class="bar"><div id="bar"></div></div>
<p class="small dim">This page opens the ${item.kind} as soon as the upload is done.</p>
</div></main>`,
      css: `#bar{width:${pct}%}`,
    })
  }

  if (item.kind === 'project') {
    const download = media('project.tar')
    head += `<meta property="og:type" content="website"><meta property="og:description" content="Studio project, ${bytes(item.size)}">`
    return doc({
      title: item.title,
      head,
      nonce: p.nonce,
      data,
      body: `<main class="center"><div class="card">
<div class="glyph" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16 9 4.5 9-4.5"/></svg></div>
<h1>${title}</h1>
<p class="dim">Studio project · ${bytes(item.size)} · ${date}</p>
<div class="actions">
<a class="btn primary" href="studio://open?url=${encodeURIComponent(download)}">Open in Studio</a>
<a class="btn" href="${esc(download)}" download>Download</a>
</div>
<p class="small dim">Opens in Studio on a Mac with every edit intact.</p>
</div></main>`,
    })
  }

  const w = item.width || 16
  const h = item.height || 9
  head +=
    `<meta property="og:type" content="video.other"><meta property="og:description" content="${clock(item.duration ?? 0)} video">` +
    `<meta property="og:video" content="${esc(media('video.mp4'))}"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="${w}"><meta property="og:video:height" content="${h}">` +
    (item.poster ? `<meta property="og:image" content="${esc(media('poster.jpg'))}"><meta property="og:image:alt" content="${title}"><meta name="twitter:card" content="summary_large_image">` : '')
  const meta = [date, clock(item.duration ?? 0), p.views !== null ? plural(p.views, 'view') : ''].filter(Boolean).join(' · ')
  return doc({
    title: item.title,
    head,
    nonce: p.nonce,
    data,
    css: `.frame{aspect-ratio:${w}/${h};width:min(100%,calc((100svh - 190px)*${w}/${h}))}@media (max-width:899px){.frame{width:100%}}`,
    body: `<main class="watch">
<section class="player">
<div class="frame"><video id="video" src="${esc(media('video.mp4'))}"${item.poster ? ` poster="${esc(media('poster.jpg'))}"` : ''} controls playsinline preload="auto"></video></div>
<div class="rail" aria-label="Comments on the timeline"${p.comments.length ? '' : ' hidden'}><div class="track" id="track"><div class="played" id="played"></div></div><div class="pins" id="pins"></div></div>
<div class="info"><h1>${title}</h1><p class="dim">${meta}</p></div>
</section>
<aside class="comments" aria-labelledby="comments-title">
<h2 id="comments-title">Comments <span class="count" id="count"></span></h2>
<ol class="list" id="list"></ol>
<p class="empty dim" id="empty">No comments yet. Pause anywhere and leave the first one.</p>
<form class="compose" id="form">
<input id="name" maxlength="60" autocomplete="name" placeholder="Your name" aria-label="Your name" required>
<textarea id="text" rows="3" maxlength="2000" placeholder="Comment at 0:00" aria-label="Comment" required></textarea>
<div class="row"><span class="small dim hint">⌘↩ to post</span><button class="btn primary" id="post">Comment</button></div>
<p class="error" id="error" role="alert"></p>
</form>
</aside>
</main>`,
  })
}

export function messagePage(title: string, text: string, nonce: string): string {
  return doc({ title, nonce, body: `<main class="center"><div class="card"><h1>${esc(title)}</h1><p class="dim">${esc(text)}</p></div></main>` })
}

function doc(o: { title: string; head?: string; body: string; nonce: string; data?: unknown; css?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0e0e10">
<title>${esc(o.title)}</title>
<link rel="icon" href="data:,">
${o.head ?? ''}
<style nonce="${o.nonce}">${CSS}${o.css ?? ''}</style>
</head>
<body>
<header class="top"><span class="brand">${LOGO}Studio</span></header>
${o.body}
${o.data === undefined ? '' : `<script type="application/json" id="data">${json(o.data)}</script><script nonce="${o.nonce}">${SCRIPT}</script>`}
</body>
</html>`
}

const CSS = String.raw`
:root{--bg:#0e0e10;--panel:#161619;--raised:#1f1f23;--hover:#29292e;--line:rgb(255 255 255/.08);--text:#f2f2f3;--dim:#9a9aa1;--accent:#7c6cff;--danger:#ff6b63;color-scheme:dark}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100svh;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
button,input,textarea{font:inherit;color:inherit}
h1{margin:0;font-size:20px;line-height:1.3;font-weight:650;letter-spacing:-.015em;overflow-wrap:anywhere}
h2{margin:0;font-size:14px;font-weight:600}
p{margin:0}
.dim{color:var(--dim)}
.small{font-size:13px}
.top{display:flex;align-items:center;height:56px;padding:env(safe-area-inset-top) max(24px,env(safe-area-inset-right)) 0 max(24px,env(safe-area-inset-left))}
.brand{display:inline-flex;align-items:center;gap:9px;font-weight:650;font-size:15px;letter-spacing:-.01em}
.btn{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 14px;border-radius:9px;border:1px solid var(--line);background:var(--raised);color:var(--text);font-size:14px;font-weight:550;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--hover)}
.btn.primary{background:var(--accent);border-color:transparent;color:#fff}
.btn.primary:hover{background:#8d7fff}
.btn:disabled{opacity:.5;cursor:default}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.center{display:grid;place-items:center;min-height:calc(100svh - 112px);padding:24px}
.card{width:100%;max-width:440px;display:grid;gap:10px;justify-items:center;text-align:center;padding:32px 28px;border-radius:16px;background:var(--panel);border:1px solid var(--line)}
.card h1{margin-top:2px}
.glyph{display:grid;place-items:center;width:56px;height:56px;border-radius:14px;background:var(--raised);color:var(--accent);margin-bottom:6px}
.actions{display:flex;gap:10px;margin:12px 0 4px}
.bar{width:100%;height:6px;border-radius:3px;background:var(--raised);overflow:hidden;margin:6px 0}
#bar{height:100%;background:var(--accent);border-radius:3px;transition:width .4s ease-out}
.watch{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:28px;max-width:1520px;margin:0 auto;padding:4px 28px 40px;align-items:start}
.frame{margin:0 auto;border-radius:12px;overflow:hidden;background:#000;box-shadow:0 0 0 1px var(--line),0 20px 60px -20px rgb(0 0 0/.6)}
video{display:block;width:100%;height:100%;background:#000}
.rail{position:relative;height:30px;margin:8px 10px 0}
.track{position:absolute;inset:13px 0 auto;height:4px;border-radius:2px;background:var(--raised);cursor:pointer}
.track::before{content:"";position:absolute;inset:-10px 0}
.played{width:0;height:100%;border-radius:2px;background:rgb(124 108 255/.55)}
.pins{position:absolute;inset:0;pointer-events:none}
.pin{position:absolute;top:4px;width:22px;height:22px;margin-left:-11px;padding:0;border-radius:50%;border:2px solid var(--bg);background:hsl(var(--h) 55% 52%);color:#fff;font-size:11px;font-weight:700;line-height:18px;cursor:pointer;pointer-events:auto;transition:transform .15s ease-out}
.pin:hover,.pin:focus-visible{transform:scale(1.15);z-index:2}
@media (hover:hover){.pin::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:max-content;max-width:260px;padding:6px 9px;border-radius:8px;background:#2c2c31;box-shadow:0 6px 20px rgb(0 0 0/.4);color:var(--text);font-size:12.5px;font-weight:450;line-height:1.35;text-align:left;white-space:normal;opacity:0;pointer-events:none;transition:opacity .12s}
.pin.start::after{left:-4px;transform:none}.pin.end::after{left:auto;right:-4px;transform:none}
.pin:hover::after{opacity:1}}
.info{display:grid;gap:4px;padding:6px 4px 0}
.info .dim{font-size:13.5px}
.comments{position:sticky;top:12px;display:flex;flex-direction:column;max-height:calc(100svh - 80px);border-radius:14px;background:var(--panel);border:1px solid var(--line)}
.comments h2{display:flex;align-items:center;gap:8px;padding:16px 18px 10px}
.count{color:var(--dim);font-weight:500}
.list{flex:1;margin:0;padding:0 8px;list-style:none;overflow:auto;min-height:0}
.c{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:10px;border-radius:10px;transition:background .2s}
.c.now,.c.focus{background:var(--raised)}
.avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:hsl(var(--h) 55% 52%);color:#fff;font-size:12px;font-weight:700}
.head{display:flex;align-items:center;gap:7px;min-width:0;font-size:13px}
.head b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ts{flex:none;height:20px;padding:0 6px;border:0;border-radius:5px;background:rgb(124 108 255/.16);color:#b2a8ff;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;cursor:pointer}
.ts:hover{background:rgb(124 108 255/.28)}
.badge{flex:none;padding:0 5px;border-radius:4px;background:var(--hover);color:var(--dim);font-size:11px;font-weight:600;line-height:17px}
.ago{flex:none;color:var(--dim);font-size:12px}
.del{margin-left:auto;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:none;color:var(--dim);font-size:16px;line-height:1;cursor:pointer;opacity:0}
.c:hover .del,.del:focus-visible{opacity:1}
.del:hover{background:var(--hover);color:var(--text)}
@media (hover:none){.del{opacity:1}}
.text{margin-top:3px;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.empty{padding:6px 18px 14px;font-size:13.5px}
.empty[hidden]{display:none}
.compose{display:grid;gap:8px;padding:12px;border-top:1px solid var(--line)}
.compose input,.compose textarea{width:100%;padding:8px 10px;border-radius:9px;border:1px solid var(--line);background:var(--bg);font-size:14px;resize:none}
.compose input:focus,.compose textarea:focus{outline:none;border-color:rgb(124 108 255/.7)}
.compose ::placeholder{color:#6e6e76}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
@media (hover:none){.hint{visibility:hidden}}
.error{color:var(--danger);font-size:13px}
.error:empty{display:none}
@media (max-width:899px){
.top{height:48px}
.watch{grid-template-columns:1fr;gap:12px;padding:0 0 calc(24px + env(safe-area-inset-bottom))}
.frame{border-radius:0;box-shadow:none}
.rail{margin:4px 14px 0}
.info{padding:2px 16px 0}
.comments{position:static;max-height:none;margin:8px 12px 0}
.list{overflow:visible}
}`

// Client script. Plain JS in String.raw (no backticks or dollar-brace inside).
const SCRIPT = String.raw`(() => {
const D = JSON.parse(document.getElementById('data').textContent)
const $ = (id) => document.getElementById(id)
const q = D.key ? '?k=' + D.key : ''
const api = (path, init) => fetch('/api/items/' + D.id + path + q, init)
const clock = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x }

// The app opens /v/<id>#owner=<token>: keep the token as a cookie (the owner's plays are not counted, the owner can
// moderate) and take it out of the address bar before anything else can see it.
const token = /[#&]owner=([\w-]+)/.exec(location.hash)
let ready = Promise.resolve()
if (token) {
  history.replaceState(null, '', location.pathname + location.search)
  ready = fetch('/api/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token[1] }) })
    .then((r) => { if (r.ok && !D.owner) location.reload() }, () => {})
}

if (D.state !== 'ready') {
  const show = (offset) => {
    $('bar').style.width = Math.floor(offset / D.size * 100) + '%'
    $('status').textContent = offset >= D.size ? 'Finishing…' : 'Uploading… ' + Math.floor(offset / D.size * 100) + '%'
  }
  setInterval(async () => {
    const r = await api('').catch(() => null)
    if (!r) return
    if (r.status === 404) return location.reload()
    const it = r.ok && await r.json()
    if (it && it.state === 'ready') location.reload()
    else if (it) show(it.offset)
  }, 2000)
  return
}
if (D.kind !== 'video') return

const v = $('video'), list = $('list'), pins = $('pins'), text = $('text'), name = $('name'), form = $('form'), error = $('error')
let comments = D.comments
const dur = () => (isFinite(v.duration) && v.duration) || D.duration || 1
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 17)
const initial = (s) => ([...s.trim()][0] || '?').toUpperCase()
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e }
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) // the page is English throughout
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]])
    if (s >= n) return rtf.format(-Math.floor(s / n), unit)
  return 'just now'
}

function focusComment(id) {
  for (const li of list.children) li.classList.toggle('focus', li.dataset.id === id)
  const li = [...list.children].find((x) => x.dataset.id === id)
  if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
function seek(c) {
  v.currentTime = c.t
  v.play().catch(() => {})
  focusComment(c.id)
}

function render() {
  list.replaceChildren(...comments.map((c) => {
    const li = el('li', 'c')
    li.dataset.id = c.id
    const avatar = el('span', 'avatar', initial(c.name))
    avatar.style.setProperty('--h', hue(c.name))
    avatar.setAttribute('aria-hidden', 'true')
    const head = el('div', 'head')
    const ts = el('button', 'ts', clock(c.t))
    ts.type = 'button'
    ts.setAttribute('aria-label', 'Play from ' + clock(c.t))
    ts.onclick = () => seek(c)
    head.append(ts, el('b', '', c.name))
    if (c.owner) head.append(el('span', 'badge', 'Author'))
    const at = el('time', 'ago', ago(c.at))
    at.dateTime = c.at
    at.title = new Date(c.at).toLocaleString()
    head.append(at)
    if (D.owner) {
      const del = el('button', 'del', '×')
      del.type = 'button'
      del.title = 'Delete comment'
      del.setAttribute('aria-label', 'Delete comment by ' + c.name)
      del.onclick = async () => {
        if (!confirm('Delete this comment?')) return
        const r = await api('/comments/' + c.id, { method: 'DELETE' }).catch(() => null)
        if (r && r.ok) { comments = comments.filter((x) => x.id !== c.id); render() }
      }
      head.append(del)
    }
    const body = el('div', '')
    body.append(head, el('p', 'text', c.text))
    li.append(avatar, body)
    return li
  }))
  pins.replaceChildren(...comments.map((c) => {
    const f = Math.min(1, c.t / dur())
    const pin = el('button', 'pin' + (f < 0.15 ? ' start' : f > 0.85 ? ' end' : ''), initial(c.name))
    pin.type = 'button'
    pin.style.left = f * 100 + '%'
    pin.style.setProperty('--h', hue(c.name))
    pin.dataset.tip = c.name + ': ' + (c.text.length > 90 ? c.text.slice(0, 89) + '…' : c.text)
    pin.setAttribute('aria-label', clock(c.t) + ', ' + c.name + ': ' + c.text)
    pin.onclick = () => seek(c)
    return pin
  }))
  $('count').textContent = comments.length ? String(comments.length) : ''
  $('empty').hidden = comments.length > 0
  document.querySelector('.rail').hidden = !comments.length
}

v.addEventListener('timeupdate', () => {
  $('played').style.width = Math.min(100, v.currentTime / dur() * 100) + '%'
  text.placeholder = 'Comment at ' + clock(v.currentTime)
  for (const li of list.children) {
    const c = comments.find((x) => x.id === li.dataset.id)
    li.classList.toggle('now', !!c && v.currentTime >= c.t && v.currentTime < c.t + 3)
  }
})
v.addEventListener('loadedmetadata', render)
$('track').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  v.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur()
})
// One view per browser session; the server ignores the owner's.
v.addEventListener('play', () => {
  const k = 'studio.viewed.' + D.id
  try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1') } catch {}
  ready.then(() => api('/views', { method: 'POST' })).catch(() => {})
}, { once: true })

try { name.value = localStorage.getItem('studio.name') || '' } catch {}
if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) document.querySelector('.hint').textContent = 'Ctrl+Enter to post'
text.addEventListener('focus', () => v.pause())
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit() }
})
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  error.textContent = ''
  try { localStorage.setItem('studio.name', name.value.trim()) } catch {}
  $('post').disabled = true
  try {
    const r = await api('/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.value, text: text.value, t: v.currentTime }) })
    const c = await r.json()
    if (!r.ok) throw new Error(c.error || 'Could not post the comment.')
    comments = [...comments, c].sort((a, b) => a.t - b.t)
    text.value = ''
    render()
    focusComment(c.id)
  } catch (x) {
    error.textContent = x instanceof TypeError ? 'You seem to be offline. Try again.' : x.message
  } finally {
    $('post').disabled = false
  }
})
render()
})()`
