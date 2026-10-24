// Submenu hover for in-app menus, like a macOS menu. Moving onto a row with a submenu opens it at once and any
// other row closes it, except while the pointer heads for the open submenu: then the rows it crosses wait until
// it turns away (leaves the triangle from where it left its row to the submenu's near edge) or rests for 300 ms.
// So a diagonal move into a submenu never needs aim. While the pointer aims, the menu carries [data-aiming] and
// its CSS keeps the crossed rows from lighting up.
//
//   const aim = submenuAim(() => openKey, (k) => (openKey = k))
//   <div role="menu" onpointermove={(e) => aim.move(e, keyOfRowUnder(e), openSubmenuElement)}>

type Point = { x: number; y: number }
type Box = { left: number; right: number; top: number; bottom: number }

const REST_MS = 300

/** Is `p` inside the triangle from `from` to the near edge of the submenu box `r`? */
export function toward(p: Point, from: Point, r: Box): boolean {
  const right = r.left >= from.x // the submenu hangs to the right of where the pointer left its row
  const x = right ? r.left : r.right
  const a = { x: from.x + (right ? -4 : 4), y: from.y } // 4 px behind: the first step may be near vertical
  const side = (b: Point, c: Point) => Math.sign((c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x))
  const s = [side(a, { x, y: r.top }), side({ x, y: r.top }, { x, y: r.bottom }), side({ x, y: r.bottom }, a)]
  return !(s.includes(1) && s.includes(-1))
}

/** `current()`: the open submenu's key, '' for none. `open(key)`: the row under the pointer takes over. */
export function submenuAim(current: () => string, open: (key: string) => void) {
  let from: Point | null = null // the last point on the open submenu's row, or inside the submenu
  let timer: ReturnType<typeof setTimeout> | undefined
  let menu: Element | undefined
  const stop = () => {
    clearTimeout(timer)
    menu?.removeAttribute('data-aiming')
  }
  return {
    /** On the menu's pointermove. `key`: the submenu row under the pointer, '' for anywhere else in the menu. */
    move(e: PointerEvent, key: string, submenu: Element | null | undefined) {
      stop()
      menu = e.currentTarget as Element
      const p = { x: e.clientX, y: e.clientY }
      if (key === current()) return void (from = p)
      const r = submenu?.getBoundingClientRect()
      const take = () => {
        stop()
        from = null
        open(key)
      }
      if (!from || !r || !current() || !toward(p, from, r)) return take()
      menu.setAttribute('data-aiming', '')
      timer = setTimeout(take, REST_MS)
    },
    /** The keyboard took over: drop a pending takeover. */
    stop,
  }
}
