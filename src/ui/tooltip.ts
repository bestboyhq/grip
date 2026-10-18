// Tooltip attachment: `<button {@attach tooltip('Undo', '⌘Z')}>`. One shared bubble in the top layer
// (styles: .tooltip in theme.css), ported from malini's hyper-ui tooltip. Opens after a hover delay; while it
// is open, moving to the next control glides the bubble there and morphs its text instead of reopening.
// Shows instantly on keyboard focus. It also labels icon-only buttons for screen readers when they have no
// aria-label of their own.
import type { Attachment } from 'svelte/attachments'

type Side = 'bottom' | 'right'
type Request = { text: string; shortcut?: string; side: Side }

const OPEN_DELAY = 420
const CLOSE_DELAY = 80 // bridges the gap between two adjacent controls
const COOL_DELAY = 320 // after closing, the next hover opens without the delay
const GAP = 6
const EDGE = 8
const MORPH_MS = 240
const SLIDE = 10

let root: HTMLElement | undefined // zero-size point at the anchor edge; its transform glides between anchors
let bubble: HTMLElement
let view: HTMLElement
let content: HTMLElement
let ghost: HTMLElement | undefined
let anchor: HTMLElement | undefined
let side: Side = 'bottom'
let key = ''
let open = false
let warm = false
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let coolTimer: ReturnType<typeof setTimeout> | undefined
let morphTimer: ReturnType<typeof setTimeout> | undefined
let morphW = 0
let morphH = 0

const span = (className: string) => Object.assign(document.createElement('span'), { className })
const keyOf = (r: Request) => `${r.text}\0${r.shortcut ?? ''}`
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
const size = (el: HTMLElement) => el.getBoundingClientRect()

function ensure() {
  if (root) return
  root = Object.assign(document.createElement('div'), { className: 'tooltip snap', popover: 'manual' })
  bubble = Object.assign(span('tooltip-bubble'), { role: 'tooltip' })
  view = span('tooltip-view')
  content = span('tooltip-text')
  view.append(content)
  bubble.append(view)
  root.append(bubble)
  document.body.append(root)
  document.addEventListener('keydown', (e) => e.key === 'Escape' && anchor && hide(anchor, true))
  addEventListener('scroll', () => open && reposition(true), true)
  addEventListener('resize', () => open && reposition(true))
}

function fill(el: HTMLElement, r: Request) {
  el.textContent = r.text
  if (r.shortcut) el.append(Object.assign(document.createElement('kbd'), { textContent: r.shortcut }))
}

function endMorph() {
  clearTimeout(morphTimer)
  morphW = morphH = 0
  ghost?.remove()
  ghost = undefined
  bubble.classList.remove('morph')
  bubble.style.width = bubble.style.height = content.style.width = ''
  content.classList.remove('enter')
}

function setContent(r: Request) {
  if (key === keyOf(r)) return
  endMorph()
  key = keyOf(r)
  fill(content, r)
}

/** Crossfades the old text out and the new one in, sliding by (dx, dy), while the bubble resizes. */
function morph(r: Request, dx: number, dy: number) {
  if (key === keyOf(r)) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setContent(r)
  endMorph()
  const from = size(bubble)
  ghost = content
  const g = size(ghost)
  Object.assign(ghost.style, { width: `${Math.ceil(g.width)}px`, height: `${Math.ceil(g.height)}px` })
  ghost.className = 'tooltip-text tooltip-ghost'
  key = keyOf(r)
  content = span('tooltip-text')
  fill(content, r)
  view.append(content)
  const to = size(bubble)
  morphW = Math.ceil(to.width)
  morphH = Math.ceil(to.height)
  content.style.width = `${Math.ceil(size(content).width)}px`
  content.classList.add('enter')
  bubble.style.setProperty('--dx', `${dx}px`)
  bubble.style.setProperty('--dy', `${dy}px`)
  Object.assign(bubble.style, { width: `${Math.ceil(from.width)}px`, height: `${Math.ceil(from.height)}px` })
  void bubble.offsetWidth
  bubble.classList.add('morph')
  Object.assign(bubble.style, { width: `${morphW}px`, height: `${morphH}px` })
  morphTimer = setTimeout(endMorph, MORPH_MS)
}

function place(x: number, y: number, snap: boolean) {
  if (!root) return
  if (snap) root.classList.add('snap')
  root.style.transform = `translate(${x}px, ${y}px)`
  if (snap) requestAnimationFrame(() => root?.classList.remove('snap'))
}

/** Bottom flips above, right flips left, when the preferred side has no room. */
function reposition(snap: boolean) {
  if (!root || !anchor?.isConnected) return
  const a = anchor.getBoundingClientRect()
  const w = morphW || bubble.offsetWidth
  const h = morphH || bubble.offsetHeight
  if (side === 'right') {
    const left = a.right + GAP + w > innerWidth - EDGE && a.left - GAP - w >= EDGE
    root.classList.remove('below')
    root.classList.toggle('left', left)
    root.classList.toggle('right', !left)
    return place(left ? a.left - GAP : a.right + GAP, clamp(a.top + a.height / 2, EDGE + h / 2, innerHeight - EDGE - h / 2), snap)
  }
  const below = a.bottom + GAP + h <= innerHeight - EDGE || a.top - GAP - h < EDGE
  root.classList.remove('left', 'right')
  root.classList.toggle('below', below)
  place(clamp(a.left + a.width / 2, w / 2 + EDGE, innerWidth - w / 2 - EDGE), below ? a.bottom + GAP : a.top - GAP, snap)
}

function commit(snap: boolean) {
  if (!root || !anchor?.isConnected) return
  if (!open) {
    // Re-enter the top layer so the bubble stacks above dialogs and popovers opened since, then flush the
    // closed style so adding `.open` transitions in.
    if (root.matches(':popover-open')) root.hidePopover()
    root.showPopover()
    void root.offsetWidth
  }
  open = warm = true
  root.classList.add('open')
  reposition(snap)
}

function show(node: HTMLElement, r: Request, immediate = false) {
  ensure()
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  clearTimeout(coolTimer)
  const previous = anchor
  anchor = node
  side = r.side
  if (open) {
    let dx = 0
    let dy = 0
    if (previous && previous !== node && previous.isConnected) {
      const from = previous.getBoundingClientRect()
      const to = node.getBoundingClientRect()
      const sx = to.left + to.width / 2 - (from.left + from.width / 2)
      const sy = to.top + to.height / 2 - (from.top + from.height / 2)
      if (Math.abs(sx) > 1) dx = Math.sign(sx) * SLIDE
      else if (Math.abs(sy) > 1) dy = Math.sign(sy) * SLIDE
    }
    morph(r, dx, dx || dy ? dy : 4)
    return commit(false)
  }
  setContent(r)
  if (warm || immediate) return commit(true)
  openTimer = setTimeout(() => commit(true), OPEN_DELAY)
}

function close() {
  open = false
  root?.classList.remove('open')
  clearTimeout(coolTimer)
  coolTimer = setTimeout(() => (warm = false), COOL_DELAY)
}

function hide(node: HTMLElement, immediate = false) {
  if (anchor !== node) return
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  if (open && !immediate) closeTimer = setTimeout(close, CLOSE_DELAY)
  else close()
}

export function tooltip(text: string, shortcut?: string, side: Side = 'bottom'): Attachment<HTMLElement> {
  return (node) => {
    if (!node.hasAttribute('aria-label') && !node.textContent?.trim()) node.setAttribute('aria-label', text)
    const r: Request = { text, shortcut, side }
    const enter = (e: PointerEvent) => e.pointerType !== 'touch' && show(node, r)
    const focus = () => node.matches(':focus-visible') && show(node, r, true)
    const leave = () => hide(node)
    const press = () => hide(node, true)
    node.addEventListener('pointerenter', enter)
    node.addEventListener('pointerleave', leave)
    node.addEventListener('pointerdown', press)
    node.addEventListener('focus', focus)
    node.addEventListener('blur', leave)
    if (anchor === node && open) show(node, r) // re-run for a new label while shown: morph to it
    return () => {
      node.removeEventListener('pointerenter', enter)
      node.removeEventListener('pointerleave', leave)
      node.removeEventListener('pointerdown', press)
      node.removeEventListener('focus', focus)
      node.removeEventListener('blur', leave)
      hide(node) // after the close delay, unless a re-run with a new label takes over
    }
  }
}
