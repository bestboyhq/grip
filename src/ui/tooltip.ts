// Tooltip attachment: `<button {@attach tooltip('Undo', '⌘Z')}>`. One shared bubble in the top layer,
// anchored with CSS anchor positioning (styles: .tooltip in theme.css). Shows after a hover delay,
// instantly while moving between tooltipped controls, and on keyboard focus. It also labels icon-only
// buttons for screen readers when they have no aria-label of their own.
import type { Attachment } from 'svelte/attachments'

let bubble: HTMLElement | undefined
let owner: HTMLElement | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let hiddenAt = 0

type Side = 'bottom' | 'left'

function show(node: HTMLElement, text: string, shortcut?: string, side: Side = 'bottom') {
  hide()
  if (!node.isConnected) return
  if (!bubble) {
    bubble = Object.assign(document.createElement('div'), { className: 'tooltip', popover: 'manual', role: 'tooltip' })
    document.body.append(bubble)
  }
  bubble.textContent = text
  bubble.dataset.side = side
  if (shortcut) bubble.append(Object.assign(document.createElement('kbd'), { textContent: shortcut }))
  owner = node
  node.style.setProperty('anchor-name', '--tooltip')
  bubble.showPopover()
}

function hide() {
  clearTimeout(timer)
  if (!owner) return
  owner.style.removeProperty('anchor-name')
  owner = undefined
  hiddenAt = performance.now()
  if (bubble?.matches(':popover-open')) bubble.hidePopover()
}

export function tooltip(text: string, shortcut?: string, side?: Side): Attachment<HTMLElement> {
  return (node) => {
    if (!node.hasAttribute('aria-label') && !node.textContent?.trim()) node.setAttribute('aria-label', text)
    const enter = () => {
      clearTimeout(timer)
      timer = setTimeout(() => show(node, text, shortcut, side), performance.now() - hiddenAt < 300 ? 0 : 600)
    }
    const focus = () => node.matches(':focus-visible') && show(node, text, shortcut, side)
    const leave = () => (owner === node ? hide() : clearTimeout(timer))
    node.addEventListener('pointerenter', enter)
    node.addEventListener('pointerleave', leave)
    node.addEventListener('pointerdown', leave)
    node.addEventListener('focus', focus)
    node.addEventListener('blur', leave)
    return () => {
      node.removeEventListener('pointerenter', enter)
      node.removeEventListener('pointerleave', leave)
      node.removeEventListener('pointerdown', leave)
      node.removeEventListener('focus', focus)
      node.removeEventListener('blur', leave)
      leave()
    }
  }
}
