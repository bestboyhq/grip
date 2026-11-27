<!-- Picking overlay, one transparent window per display (#/area?display=<id>). The display shows
     frozen as it was when the picker opened, until a countdown starts.
     Display mode: highlight the hovered display. Window mode: highlight the window under the mouse
     (a click keeps it), with preset sizes. Either records (↩) or copies a screenshot (⌘C), the window
     alone with clear corners, as macOS takes it. Area mode: drag out a rectangle, resize it by its handles, type its size, lock
     an aspect; the last area shows as an outline, and a click picks it again. Then record it (↩, a 3-2-1 countdown over the region), or
     take a screenshot of it: ⌘C copies it at once, a tool from the strip beside it (or its key)
     freezes it to draw on first (a drawn shape drags to another place), then ⌘C copies or ⌘S
     saves it to the Desktop.
     While an area records, the overlays stay as a click-through backdrop that dims everything around
     it; with the pen on (shell:draw), the recorded display's overlay takes the mouse and every stroke
     goes into the recording, fading out on screen like it will in the video. -->
<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { Tween } from 'svelte/motion'
  import logoDot from '../../../build/Grip.icon/Assets/dot.svg'
  import { invoke, on } from '../../lib/ipc.ts'
  import Icon from '../recorder/Icon.svelte'
  import ZoomHint from '../recorder/ZoomHint.svelte'
  import Countdown, { burst, pop } from './Countdown.svelte'
  import UiIcon from '../../ui/Icon.svelte'
  import { paintStroke, visibleStrokes, type Stroke } from '../../engine/overlays/drawings.ts'
  import { fromEngine, shell, startRequest, toEngine, windowList, type Rect, type Settings, type StartRequest, type WindowSource } from '../recorder/shell.svelte.ts'
  import { ASPECTS, clamp, constrainIn, formAt, presetFrame, presetSize, PRESETS, resizeIn, toolsAt, type Handle } from './geometry.ts'
  import { COLORS, FONT, FONT_FAMILY, moved, P3, paintShapes, shapeAt, tiny, TOOLS, type P, type Shape, type Tool } from './annotate.ts'
  import { beyond, type Pixels } from './beyond.ts'
  import { easeGlide, easeOut, still as calm } from '../../ui/motion.ts'
  import { mix } from '../../engine/motion/spring.ts'
  import { lensIn, lensOut, LOUPE_FLAT, LOUPE_GLASS, LOUPE_TOP } from '../../engine/zoom/index.ts'
  import { loupe, type Loupe } from './loupe.ts'
  import { measure, type Edges, type Measure } from './measure.ts'

  let { params }: { params: URLSearchParams } = $props()

  interface DisplayInfo {
    id: number
    label: string
    bounds: Rect
    workArea: Rect
    scaleFactor: number
    toolbarTop: number // the recording toolbar's top edge, local points
  }
  let display = $state<DisplayInfo | null>(null)
  let windows = $state<WindowSource[]>([])
  let mouse = $state<{ x: number; y: number } | null>(null) // local points
  let locked = $state<WindowSource | null>(null) // keeps the window while the mouse is on its card
  let picked = $state<WindowSource | null>(null) // the window clicked: kept until a click elsewhere
  let choice = $state({ id: 0, preset: 'current' }) // preset size picked for window `id`
  let target = $state<Rect | null>(null) // region being counted down, local points
  let count = $state(0)
  let drag = $state<{ kind: 'new' | 'move' | Handle; x: number; y: number; orig: Rect; moved?: boolean } | null>(null)
  let formW = $state(0)
  let formH = $state(0)

  const W = $derived(display?.bounds.width ?? innerWidth)
  const H = $derived(display?.bounds.height ?? innerHeight)
  const floor = $derived(display?.toolbarTop ?? H) // cards stay above the toolbar
  const scale = $derived(display?.scaleFactor ?? 2)
  const px = (pt: number) => Math.round(pt * scale)
  const toLocal = (r: Rect): Rect => ({ ...r, x: r.x - (display?.bounds.x ?? 0), y: r.y - (display?.bounds.y ?? 0) })
  const toGlobal = (r: Rect): Rect => ({ ...r, x: r.x + (display?.bounds.x ?? 0), y: r.y + (display?.bounds.y ?? 0) })
  const inside = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

  /** The display as it was when the picker opened, shown under everything while picking; screenshots
   *  are cut from it. Raw pixels: nothing to decode. */
  let still = $state<ImageData | null>(null)
  const pixels = (s: { width: number; height: number; data: Uint8Array<ArrayBuffer> } | null) =>
    s && new ImageData(new Uint8ClampedArray(s.data.buffer, s.data.byteOffset, s.data.byteLength), s.width, s.height, { colorSpace: 'display-p3' })
  const paint = (canvas: HTMLCanvasElement) => void (still && canvas.getContext('2d', P3)!.putImageData(still, 0, 0))
  /** On screen: shell:ready returns once the main process has handed this overlay the mouse and keys (it
   *  showed before, while its display froze, unless it was still loading). Loaded ahead, it paints while
   *  hidden, so an animation started on mount would play unseen. */
  let shown = $state(false)
  // A countdown or a recording shows the screen live from then on.
  $effect(() => {
    if (!still || !(target || shell.counting || shell.status !== 'idle')) return
    still = null
  })

  onMount(() => {
    const id = Number(params.get('display'))
    // Loaded ahead, it lays itself out while it waits for a pick: it shows at once over the live screen,
    // which looks the same, and takes the mouse and keys (shell:ready) once it has painted the still under
    // its UI. Its display again then: the work area may have moved.
    invoke('shell:display', id).then((d) => (display = d))
    invoke('shell:still', id)
      .then(pixels)
      .catch(() => null)
      .then(async (s) => {
        display = await invoke('shell:display', id)
        still = s
        await tick()
        await invoke('shell:ready')
        shown = true
      })
    const offs = [
      on('shell:escape', () => {
        target = null
        count = 0
      }),
    ]
    return () => offs.forEach((off) => off())
  })

  // ---- Past the screen's edge: pressed against it, the screen steps back, and the area may go past it ----

  const STEP = 0.84 // the screen's scale, stepped back: room for an area past its edges
  const DWELL = 450 // ms held against the edge before it steps back...
  const SHOVE = 40 // ...or points pushed past it
  /** The screen as it shows: 1, or stepping back toward STEP around its center. */
  const z = new Tween(1, { duration: 280, easing: easeOut })
  let back = $state(false) // stepped back, or on its way: a drag may take the area past the edges
  const density = $derived(still ? still.width / W : scale) // still pixels per point
  const OX = $derived(still ? Math.round((still.width * (1 / STEP - 1)) / 2) : 0) // still pixels past each side
  const OY = $derived(still ? Math.round((still.height * (1 / STEP - 1)) / 2) : 0)
  const screenRect = $derived({ x: 0, y: 0, width: W, height: H })
  /** Where an area may go once the screen steps back: the display and what fills the screen around it. */
  const wide = $derived({ x: -OX / density, y: -OY / density, width: W + (2 * OX) / density, height: H + (2 * OY) / density })
  const roomRect = $derived(back ? wide : screenRect)
  const toWorld = (q: P): P => ({ x: W / 2 + (q.x - W / 2) / z.current, y: H / 2 + (q.y - H / 2) / z.current })
  /** Where `r` (display points) shows on the screen as it steps back. */
  const toScreen = (r: Rect): Rect => ({ x: W / 2 + (r.x - W / 2) * z.current, y: H / 2 + (r.y - H / 2) * z.current, width: r.width * z.current, height: r.height * z.current })
  const outside = (r: Rect | null) => !!r && (r.x < -0.01 || r.y < -0.01 || r.x + r.width > W + 0.01 || r.y + r.height > H + 0.01)
  function stepBack(on: boolean) {
    if (on === back) return
    back = on
    z.set(on ? STEP : 1, { duration: calm() ? 0 : 280 })
  }

  /** The desktop picture alone, asked for once an area pick opens; null if it failed: past the edges is
   *  transparent then. */
  let wall = $state.raw<Pixels | null>(null)
  let walled = false
  /** The still with what lies past its edges (beyond.ts), made once an area first presses past them. */
  let room = $state.raw<ImageData | null>(null)
  const fill = (s: ImageData) => (room = new ImageData(beyond(s, wall, OX, OY, density), s.width + 2 * OX, s.height + 2 * OY, { colorSpace: 'display-p3' }))
  const paintRoom = (canvas: HTMLCanvasElement) => void (room && canvas.getContext('2d', P3)!.putImageData(room, 0, 0))
  $effect(() => {
    if (shell.mode !== 'area' || !still || !display || walled) return
    walled = true
    invoke('shell:wallpaper', display.id)
      .catch(() => null)
      .then((w: Pixels | null) => {
        wall = w
        if (room && still) fill(still)
      })
  })

  // Window mode: the engine's window list (front to back), minus our own windows.
  $effect(() => {
    if (shell.mode === 'window') windowList().then((list) => (windows = list))
  })
  /** The frontmost window at `p`: what shows there. */
  const windowAt = (p: { x: number; y: number }) => windows.find((w) => inside(toLocal(fromEngine(w.frame)), p)) ?? null
  const hovered = $derived(locked ?? picked ?? (mouse && display ? windowAt(mouse) : null))
  const preset = $derived(hovered && choice.id === hovered.id ? choice.preset : 'current')
  const frame = $derived(hovered && display ? toLocal(presetFrame(fromEngine(hovered.frame), preset, display.workArea)) : null)

  // Area mode: the area picked (shell.selection) belongs to one display; picking on another clears it
  // here. Local edits override it until they are saved back. A pick opens with none: the last area
  // (settings) is only an outline, which a click picks again.
  const remembered = $derived(shell.settings?.area)
  // The area is in display points, and may reach past the display (into `wide`) once the screen steps back.
  const here = (a: Settings['area'] | undefined, room: Rect) => (a && display && a.display === display.id ? constrainIn(a.rect, null, room) : null)
  let sel = $derived<Rect | null>(here(shell.selection, wide))
  const last = $derived(here(remembered, screenRect))
  const view = $derived(sel && toScreen(sel)) // where the area shows
  let aspect = $derived(shell.selection?.aspect ?? remembered?.aspect ?? 'free')
  const save = () => invoke('shell:select', sel && display ? { display: display.id, rect: $state.snapshot(sel), aspect } : null)

  let client: P = { x: 0, y: 0 } // the pointer, held inside the display as macOS holds the cursor
  const track = (e: PointerEvent) => (client = { x: clamp(e.clientX, 0, W - 1), y: clamp(e.clientY, 0, H - 1) })
  /** The cursor stops on the display's last point: there, it means the edge itself. */
  const stick = (q: P): P => ({ x: q.x >= W - 1 ? W : q.x, y: q.y >= H - 1 ? H : q.y })
  let samples: { t: number; x: number; y: number }[] = [] // the pointer's last moves, for its speed

  function down(e: PointerEvent, kind: 'new' | 'move' | Handle) {
    // Window mode: a click picks the window under it (recording waits for Start or ↩); off any window, it lets go.
    if (shell.mode === 'window' && !target && e.button === 0) picked = windowAt({ x: e.clientX, y: e.clientY })
    if (shell.mode !== 'area' || target || shot || e.button !== 0) return
    e.stopPropagation()
    ;(document.body as Element).setPointerCapture(e.pointerId)
    track(e)
    const p = toWorld(stick(client))
    drag = { kind, x: p.x, y: p.y, orig: kind === 'new' ? { ...p, width: 0, height: 0 } : sel! }
    samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }]
  }
  /** A drag (new area, move, or resize) on its way: a new area only once the pointer moves. */
  const dragging = $derived(!!drag && (drag.kind !== 'new' || !!drag.moved))
  // The body holds the pointer while it drags, and the cursor turns into the body's arrow: the drag's own
  // goes on every element instead. Sizing the area, a crosshair, its center on the pixel the lens magnifies.
  $effect(() => {
    if (!drag) return
    const root = document.documentElement
    root.dataset.drag = drag.kind === 'move' ? 'move' : 'aim'
    return () => delete root.dataset.drag
  })
  function move(e: PointerEvent) {
    mouse = { x: e.clientX, y: e.clientY }
    track(e)
    if (!drag) return
    for (const c of e.getCoalescedEvents?.() ?? [e]) samples.push({ t: c.timeStamp, x: c.clientX, y: c.clientY })
    if (press) shove += Math.max(0, e.movementX * press.x + e.movementY * press.y) // the cursor stopped, the hand did not
    applyDrag()
  }
  function applyDrag() {
    if (!drag) return
    const { kind, orig } = drag
    const p = toWorld(stick(client))
    if (kind === 'new' && !drag.moved) {
      if (Math.hypot(p.x - drag.x, p.y - drag.y) * z.current < 4) return // a click so far
      drag.moved = true
    }
    const r = roomRect
    if (kind === 'move') sel = { ...orig, x: clamp(orig.x + p.x - drag.x, r.x, r.x + r.width - orig.width), y: clamp(orig.y + p.y - drag.y, r.y, r.y + r.height - orig.height) }
    else sel = resizeIn(orig, kind, p.x, p.y, ASPECTS[aspect], r)
  }

  // ---- Measure lines: from the sides a drag moves in to the first content, with their length in pixels ----

  /** Where the frozen screen's pixels change (measure.ts): in the still, or in the room around it once
   *  there is one (its pixels `dx`, `dy` past the still's top left). Made off the main thread. */
  let edgeMap = $state.raw<{ e: Edges; dx: number; dy: number } | null>(null)
  /** Area `r` (points) in the edge map's pixels, its edges rounded as the screenshot cuts them. */
  const inMap = (r: Rect, m: { dx: number; dy: number }) =>
    [r.x, r.y, r.x + r.width, r.y + r.height].map((v, i) => Math.round(v * density) + (i % 2 ? m.dy : m.dx)) as [number, number, number, number]
  let edgeWorker: Worker | null = null
  let asked = 0
  $effect(() => {
    const src = room ?? still
    if (shell.mode !== 'area' || !shown || !src) return
    const at = room ? { dx: OX, dy: OY } : { dx: 0, dy: 0 }
    const id = ++asked
    edgeWorker ??= new Worker(new URL('./edges.worker.ts', import.meta.url), { type: 'module' })
    edgeWorker.onmessage = ({ data }: MessageEvent<{ id: number; edges: Edges }>) => void (data.id === asked && (edgeMap = { e: data.edges, ...at }))
    edgeWorker.postMessage({ id, px: { width: src.width, height: src.height, data: src.data } })
  })
  onMount(() => () => edgeWorker?.terminate())
  /** While a drag fits the area, the sides it moves, where the user looks: the dragged handle's (a new
   *  area's, the pointer's corner), all four moving the area. Each has its measure line in the edge map's
   *  pixels and in screen points, as near the pointer as the content allows, and its length in pixels.
   *  A resized side measures only the stretch of it the lens shows (picked up, its flat top clear of the
   *  rim), lens up or not: a line far along the side lands outside the glass, where the user never looks. */
  const rules = $derived.by(() => {
    const m = edgeMap
    if (!dragging || !drag || !sel || !m) return []
    const k = drag.kind
    const p = toWorld(stick(client)) // a new sel each pointer move brings this along
    const [x0, y0, x1, y1] = inMap(sel, m)
    const [nx, ny] = [Math.round(p.x * density) + m.dx, Math.round(p.y * density) + m.dy]
    type S = keyof Measure
    const moved = (handle: RegExp, q: number, lo: number, size: number, a: S, b: S): S[] =>
      k === 'move' ? [a, b] : k === 'new' || handle.test(k) ? [Math.abs(q - lo) < Math.abs(q - lo - size) ? a : b] : []
    const sides = [...moved(/[ew]/, p.x, sel.x, sel.width, 'left', 'right'), ...moved(/[ns]/, p.y, sel.y, sel.height, 'top', 'bottom')]
    let band: number[] | undefined
    if (k !== 'move') {
      const { c, r, mag } = lensFrame(1)
      const s = density / (mag * z.current) // edge map px per point in the lens
      const [cx, cy, R] = [nx + (c.x - client.x) * s, ny + (c.y - client.y) * s, (LOUPE_TOP * r - 16) * s]
      const half = (o: number) => Math.sqrt(Math.max(0, R * R - o * o)) // of the chord o off the middle
      const [hx, hy] = [half((sides.includes('bottom') ? y1 : y0) - cy), half((sides.includes('right') ? x1 : x0) - cx)]
      band = [cx - hx, cy - hy, cx + hx, cy + hy]
    }
    const measured = measure(m.e, [x0, y0, x1, y1], [nx, ny], band)
    const onScreen = (x: number, y: number) => ({ x: W / 2 + ((x - m.dx) / density - W / 2) * z.current, y: H / 2 + ((y - m.dy) / density - H / 2) * z.current })
    return sides.flatMap((side) => {
      const s = measured[side]
      if (!s?.d) return [] // flush with the content, or none to measure to
      const h = side === 'left' || side === 'right'
      const from = { left: x0, right: x1, top: y0, bottom: y1 }[side]
      const to = from + (side === 'left' || side === 'top' ? s.d : -s.d)
      const at = Math.round(s.at) // on a pixel edge: crisp at true size
      const line: [number, number, number, number] = h ? [from, at, to, at] : [at, from, at, to]
      return [{ side, d: s.d, h, line, a: onScreen(line[0], line[1]), b: onScreen(line[2], line[3]) }]
    })
  })

  let press: P | null = null // the way the drag presses past the display's edge (-1, 0, or 1 on each axis)
  let pressSince = 0
  let pressAt: P = { x: 0, y: 0 }
  let shove = 0 // points the pointer pushed on past the edge
  let pushing = $state<{ fill: number; x: number; y: number } | null>(null)
  let pushW = $state(0)
  let pushH = $state(0)
  /** Which way the drag presses past the display's edge, and how far: moving the area, it asks for a
   *  place past the edge; resizing it, the pointer holds on the edge, where the cursor stops. */
  function pressing(): { d: P; over: number } | null {
    if (!drag || !dragging || !sel || back || !still || shot) return null
    const side = (lo: boolean, hi: boolean) => (lo ? -1 : hi ? 1 : 0)
    if (drag.kind === 'move') {
      const p = toWorld(stick(client))
      const x = drag.orig.x + p.x - drag.x
      const y = drag.orig.y + p.y - drag.y
      const d = { x: side(x < 0, x + sel.width > W), y: side(y < 0, y + sel.height > H) }
      return d.x || d.y ? { d, over: Math.max(-x, x + sel.width - W, -y, y + sel.height - H) } : null
    }
    const ax = drag.kind === 'new' || /[ew]/.test(drag.kind)
    const ay = drag.kind === 'new' || /[ns]/.test(drag.kind)
    const d = { x: ax ? side(client.x <= 0, client.x >= W - 1) : 0, y: ay ? side(client.y <= 0, client.y >= H - 1) : 0 }
    return d.x || d.y ? { d, over: shove } : null
  }
  /** The push pill: on the pressed edge, beside the pointer, clear of the toolbar. */
  const pushAt = (d: P) => ({
    x: d.x < 0 ? 18 : d.x > 0 ? W - 18 - pushW : clamp(client.x - pushW / 2, 12, W - pushW - 12),
    y: d.y < 0 ? 18 : d.y > 0 ? floor - 18 - pushH : clamp(client.y - pushH / 2 - (d.x ? 40 : 0), 12, floor - pushH - 12),
  })

  // ---- The loupe: a resize that slows down picks up the editor's glass lens, in place under the pointer ----

  const SLOW = 70 // pt/s: slower than this for SETTLE ms, the loupe comes
  const SETTLE = 140
  const FAST = 320 // pt/s: faster, it goes
  const RADIUS = 300 // points: too big costs nothing, too small hides what the user aims at
  const MAG = 6 // a still pixel shows 3 points wide on a Retina display
  const LEAN = 0.3 // of the radius: the lens leans in toward the area's middle, where what the user frames lies
  let lens = $state<HTMLCanvasElement>()
  let gpu = $state.raw<Loupe | null>(null)
  let lensOn = $state(false)
  /** How far it is picked up off the screen, on the glide curve, as the editor's loupe (zoom/index.ts). */
  const lift = new Tween(0, { easing: easeGlide })
  const lensShown = $derived(lensOn || lift.current > 0)
  /** The lens as it last drew, in screen points: its center, the pointer, the point it magnifies there
   *  (the pointer, on the edge where it stops), its radius, and its magnification. The measure lines'
   *  lengths show through it. */
  let lensAt = $state.raw<{ x: number; y: number; px: number; py: number; sx: number; sy: number; r: number; mag: number } | null>(null)
  let liftSince = 0 // when it set off up: its glass shows over LOUPE_GLASS
  let slowSince = 0
  let checker: number[][] = []

  $effect(() => {
    const canvas = lens
    if (!canvas) return
    let gone = false
    loupe(canvas).then((l) => (gone ? l?.destroy() : (gpu = l)))
    return () => {
      gone = true
      gpu?.destroy()
      gpu = null
    }
  })
  $effect(() => gpu?.source(room ?? still))

  /** A theme color as the canvas's P3, 0 to 1. */
  function p3(name: string, at: Element) {
    const g = new OffscreenCanvas(1, 1).getContext('2d', P3)!
    g.fillStyle = getComputedStyle(at).getPropertyValue(name)
    g.fillRect(0, 0, 1, 1)
    return [...g.getImageData(0, 0, 1, 1).data.subarray(0, 3)].map((v) => v / 255)
  }

  /** The lens picked up `p` of the way: its center in toward the area's middle, never past it, its
   *  radius, and its magnification. The pointer stays on the pixel it magnifies. */
  function lensFrame(p: number) {
    const r = RADIUS * mix(LOUPE_FLAT, 1, p)
    const v = view ? { x: view.x + view.width / 2 - client.x, y: view.y + view.height / 2 - client.y } : { x: 0, y: 0 }
    const lean = Math.min(1, (LEAN * r) / (Math.hypot(v.x, v.y) || 1))
    return { c: { x: client.x + v.x * lean, y: client.y + v.y * lean }, r, mag: MAG ** p }
  }
  /** The lens over the pointer, picked up `lift` of the way, with the area's edges, the dim around it,
   *  and the measure lines. */
  function drawLens(now: number) {
    if (!gpu || !lens || !still) return
    const p = lift.current
    const pt = devicePixelRatio
    const [dx, dy] = room ? [OX, OY] : [0, 0]
    const stuck = stick(client)
    const w = toWorld(stuck)
    const at = (v: number, d: number) => Math.round(v * density) + d // the pixel corner an edge here lands on
    if (!checker.length) checker = [p3('--surface-100', lens), p3('--surface-150', lens), p3('--brand', lens)] // .room.clear, .ruler
    const { c, r, mag } = lensFrame(p)
    lensAt = { x: c.x, y: c.y, px: client.x, py: client.y, sx: stuck.x, sy: stuck.y, r, mag }
    const [ex, ey] = edgeMap ? [dx - edgeMap.dx, dy - edgeMap.dy] : [0, 0] // the edge map may still be the still's
    const toPx = density / z.current / mag // still px per screen point, magnified
    gpu.draw({
      x: c.x * pt,
      y: c.y * pt,
      radius: r * pt,
      mag,
      glass: lensOn ? Math.min((now - liftSince) / (1000 * LOUPE_GLASS), 1) : p,
      lift: p,
      pt,
      at: { x: w.x * density + dx + (c.x - client.x) * toPx, y: w.y * density + dy + (c.y - client.y) * toPx },
      perPx: density / (pt * z.current),
      cell: 8 * density,
      area: sel && [at(sel.x, dx), at(sel.y, dy), at(sel.x + sel.width, dx), at(sel.y + sel.height, dy)],
      screen: room && back ? [dx, dy, dx + still.width, dy + still.height] : null,
      even: checker[0],
      odd: checker[1],
      rules: rules.map((l) => [l.line[0] + ex, l.line[1] + ey, l.line[2] + ex, l.line[3] + ey]),
      brand: checker[2],
    })
  }
  /** Where the length of a measure line from screen point `a` to `b` shows, and how long the line shows
   *  there: on its middle; with the lens up, on the middle of what its flat top shows of it, magnified,
   *  or nowhere: the user looks into the glass, and a length outside it reads as some other line's. */
  function label(a: P, b: P): (P & { len: number }) | null {
    const l = lensAt
    if (!l) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, len: Math.hypot(b.x - a.x, b.y - a.y) }
    // The line magnified, from A along d, cut to the flat top: a circle about the lens's center.
    const A = { x: l.px + (a.x - l.sx) * l.mag, y: l.py + (a.y - l.sy) * l.mag }
    const d = { x: (b.x - a.x) * l.mag, y: (b.y - a.y) * l.mag }
    const f = { x: A.x - l.x, y: A.y - l.y }
    const [qa, qb, qc] = [d.x * d.x + d.y * d.y, f.x * d.x + f.y * d.y, f.x * f.x + f.y * f.y - (LOUPE_TOP * l.r) ** 2]
    const root = Math.sqrt(Math.max(0, qb * qb - qa * qc))
    const [t0, t1] = [Math.max(0, (-qb - root) / qa), Math.min(1, (-qb + root) / qa)]
    return qa && qb * qb > qa * qc && t1 > t0 ? { x: A.x + (d.x * (t0 + t1)) / 2, y: A.y + (d.y * (t0 + t1)) / 2, len: (t1 - t0) * Math.sqrt(qa) } : null
  }
  const gaps = $derived(
    rules.flatMap((l) => {
      const at = label(l.a, l.b)
      return at ? [{ ...l, at, beside: at.len < (l.h ? 16 + 7 * String(l.d).length : 25) }] : [] // the label and a tick each side
    }),
  )

  /** Each frame of a drag: the press past the edge, the screen stepping, and the loupe. */
  function onFrame(now: number) {
    if (z.current !== z.target) applyDrag() // the dragged edge stays under the pointer while the screen steps
    const p = pressing()
    press = p?.d ?? null
    if (p) {
      if (!room && still) fill(still) // ahead of the step back, so what lies past the edge shows at once
      // The dwell counts while the pointer holds still; sliding along the edge starts it again.
      if (!pressSince || Math.hypot(client.x - pressAt.x, client.y - pressAt.y) > 6) [pressSince, pressAt] = [now, client]
      const full = Math.max((now - pressSince) / DWELL, p.over / SHOVE)
      if (full >= 1) {
        stepBack(true)
        ;[press, pressSince, shove, pushing] = [null, 0, 0, null]
      } else pushing = now - pressSince > 120 || p.over > 4 ? { fill: full, ...pushAt(p.d) } : null
    } else [pressSince, shove, pushing] = [0, 0, null]

    samples = samples.filter((s) => now - s.t < 120)
    let dist = 0
    for (let i = 1; i < samples.length; i++) dist += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y)
    const speed = dist / 0.12 // points per second
    // Pressed on the edge, the area is the edge itself: nothing to calibrate.
    if (!dragging || drag?.kind === 'move' || p || !still || speed > FAST) [lensOn, slowSince] = [false, 0]
    else if (speed < SLOW) {
      slowSince ||= now
      if (now - slowSince > SETTLE) lensOn = true
    }
    if (lensOn !== (lift.target === 1)) {
      if (lensOn) liftSince = now
      lift.set(lensOn ? 1 : 0, { duration: calm() ? 0 : 1000 * (lensOn ? lensIn(MAG) : lensOut(MAG)) })
    }
    if (lensShown) drawLens(now)
    else if (lensAt) lensAt = null
  }
  $effect(() => {
    if (!drag && !lensShown) return // a lens let go of goes back down
    let id = requestAnimationFrame(function tick(now) {
      onFrame(now)
      id = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(id)
      ;[press, pressSince, shove, pushing, lensOn, slowSince, lensAt] = [null, 0, 0, null, false, 0, null]
    }
  })
  // Back to true size once there is no area to take past the edge.
  $effect(() => {
    if (shell.mode !== 'area' || (!sel && !drag)) stepBack(false)
  })
  /** Picking a display or window, the keys (↩, ⌘C) go to the display the pointer is on. An area keeps
   *  the keyboard on its own display. */
  const takeKeys = () => (shell.mode === 'display' || shell.mode === 'window') && !target && invoke('shell:focus')
  function up() {
    if (!drag) return
    const { kind, x, y, moved } = drag
    drag = null
    // A click lets go of the area, or picks the last one again on its outline. A tiny new area is a click too.
    if (kind === 'new' && !moved) sel = !sel && last && inside(last, { x, y }) ? last : null
    else if (kind === 'new' && sel && (sel.width < 32 || sel.height < 32)) sel = null
    if (!outside(sel)) stepBack(false) // back to true size once the area is all on the screen
    save()
  }

  function setSize(axis: 'width' | 'height', input: HTMLInputElement) {
    if (!sel) return
    const value = +input.value
    if (Number.isFinite(value) && value > 0 && value !== px(sel[axis])) {
      const ratio = ASPECTS[aspect]
      const pt = value / scale
      const next = { ...sel, [axis]: pt }
      if (ratio) axis === 'width' ? (next.height = pt / ratio) : (next.width = pt * ratio)
      sel = constrainIn(next, ratio, roomRect)
      save()
    }
    input.value = String(px(sel[axis])) // the size it really is: clamped to the display, or the entry undone
  }
  function setAspect(a: string) {
    aspect = a
    if (sel) sel = constrainIn(sel, ASPECTS[a], roomRect)
    if (!outside(sel)) stepBack(false)
    save()
  }

  const form = $derived(view && formAt(view, formW, formH, W, floor))
  let toolsW = $state(0)
  let toolsH = $state(0)
  const tools = $derived(view && form && toolsAt(view, toolsW, toolsH, W, H, { ...form, width: formW, height: formH }))

  // ---- Screenshot: the area frozen into an image, drawn on, then copied or saved ----

  type Shot = { image: ImageBitmap; png?: Uint8Array; rect: Rect }
  let shot = $state<Shot | null>(null) // frozen to draw on
  let tool = $state<Tool | null>(null)
  let color = $state(COLORS[0].value)
  let shapes = $state<Shape[]>([])
  let past = $state.raw<Shape[][]>([]) // the shapes before each change, for undo
  let draft = $state<Shape | null>(null)
  let typing = $state<{ at: P; text: string } | null>(null)
  let capturing: Promise<Shot | null> | null = null
  let finishing = false // a copy or save is on its way: ⌘C spam makes one screenshot

  /** The selected area or the display under the mouse: cut from the still, else as it is now (without
   *  Grip's own windows). The window: alone, with nothing in front of it and clear corners, as macOS
   *  takes them; at its preset size, if one is picked. */
  function capture(): Promise<Shot | null> {
    if (shot) return Promise.resolve(shot)
    if (!display) return Promise.resolve(null)
    const win = shell.mode === 'window' && hovered && frame ? { id: hovered.id, frame: preset === 'current' ? null : toEngine(toGlobal(frame)) } : null
    const rect = shell.mode === 'area' ? sel && $state.snapshot(sel) : shell.mode === 'display' ? mouse && { x: 0, y: 0, width: W, height: H } : win && frame
    if (!rect) return Promise.resolve(null)
    const id = display.id
    const from = still
    return (capturing ??= (async () => {
      try {
        if (from && !win) {
          const k = from.width / W // still px per point
          const [x, y, w, h] = [rect.x, rect.y, rect.width, rect.height].map((v) => Math.round(v * k))
          if (outside(rect)) return { image: await createImageBitmap(room ?? fill(from), x + OX, y + OY, w, h), rect }
          return { image: await createImageBitmap(from, x, y, w, h), rect }
        }
        const png: Uint8Array = win ? await invoke('recording:windowScreenshot', win.id, win.frame) : await invoke('recording:screenshot', id, toEngine(rect))
        const image = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
        // A window's size is what the app made it: its pixel density is the display's.
        return { image, png, rect: win ? { ...rect, width: image.width / scale, height: image.height / scale } : rect }
      } catch (e) {
        invoke('shell:fail', e instanceof Error ? e.message : String(e), 'Grip couldn’t take the screenshot.')
        return null
      } finally {
        capturing = null
      }
    })())
  }

  /** Freeze the area to draw on it. */
  async function pickTool(t: Tool) {
    const s = await capture()
    if (!s) return
    shot = s
    tool = t
  }

  const remember = () => (past = [...past, $state.snapshot(shapes)])
  function undo() {
    if (typing) typing = null
    else if (past.length) {
      shapes = past.at(-1)!
      past = past.slice(0, -1)
    }
  }

  function commitText() {
    if (typing && !tiny({ kind: 'text', color, ...typing })) {
      remember()
      shapes.push({ kind: 'text', color, at: typing.at, text: typing.text })
    }
    typing = null
  }

  /** Copy (or save) the screenshot: the area as it was frozen, with its drawings. */
  async function finishShot(save: boolean) {
    if (finishing) return
    finishing = true
    commitText()
    const s = await capture()
    if (!s) return void (finishing = false)
    const { image } = s
    let png = s.png
    if (shapes.length || !png) {
      const c = new OffscreenCanvas(image.width, image.height)
      const ctx = c.getContext('2d', P3)!
      ctx.drawImage(image, 0, 0)
      paintShapes(ctx, $state.snapshot(shapes), image, image.width / s.rect.width)
      png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    }
    invoke('shell:shot', png, image.width / s.rect.width, save).catch(() => (finishing = false))
  }

  /** The drawing board over the frozen area: the image and every shape, painted with the code that
   *  makes the copied PNG. Repaints whenever a shape changes. */
  function board(canvas: HTMLCanvasElement) {
    if (!shot) return
    const k = devicePixelRatio
    const w = Math.round(shot.rect.width * k)
    const h = Math.round(shot.rect.height * k)
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h] // a resize reallocates: only once
    const ctx = canvas.getContext('2d', P3)!
    ctx.drawImage(shot.image, 0, 0, w, h)
    paintShapes(ctx, draft ? [...shapes, draft] : shapes, shot.image, k)
  }

  /** Where `e` is on the board, in its points (it shows at z); `on`: the event the board got (coalesced events have no target). */
  const at = (e: PointerEvent, on = e): P => {
    const r = (on.currentTarget as Element).getBoundingClientRect()
    return { x: (e.clientX - r.left) / z.current, y: (e.clientY - r.top) / z.current }
  }
  /** A pen point, with a stylus's pressure; a mouse's ink goes by its speed (paintStroke). */
  const inkAt = (e: PointerEvent, on = e) => ({ ...at(e, on), ...(e.pointerType === 'pen' && { p: e.pressure }) })
  const measurer = new OffscreenCanvas(1, 1).getContext('2d')!
  measurer.font = `600 ${FONT}px ${FONT_FAMILY}`
  const shapeUnder = (p: P) => shapeAt(shapes, p, (line) => measurer.measureText(line).width)
  let over = $state(false) // the pointer is on a shape: a drag moves it
  let moving: { i: number; from: P; orig: Shape; moved: boolean } | null = null

  function boardDown(e: PointerEvent) {
    e.stopPropagation()
    e.preventDefault() // keeps the focus where it goes (the text input), not on the page
    if (e.button !== 0 || !tool) return
    const p = at(e)
    commitText()
    const i = shapeUnder(p)
    if (i >= 0) moving = { i, from: p, orig: $state.snapshot(shapes[i]), moved: false }
    else if (tool === 'text') return void (typing = { at: p, text: '' })
    else draft = tool === 'pen' ? { kind: 'pen', color, points: [inkAt(e)] } : { kind: tool, color, a: p, b: p }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function boardMove(e: PointerEvent) {
    const p = at(e)
    if (moving) {
      if (!moving.moved) remember()
      moving.moved = true
      shapes[moving.i] = moved(moving.orig, p.x - moving.from.x, p.y - moving.from.y)
    } else if (!draft) over = shapeUnder(p) >= 0
    else if (draft.kind === 'pen') for (const c of e.getCoalescedEvents?.() ?? [e]) draft.points.push(inkAt(c, e))
    else if (draft.kind !== 'text') draft.b = p
  }
  function boardUp() {
    moving = null
    if (draft && !tiny(draft)) {
      remember()
      shapes.push(draft)
    }
    draft = null
  }

  const ICONS = { arrow: 'arrow', rect: 'rect', pen: 'pen', text: 'text', blur: 'pixelate' } as const

  // ---- The pen while recording: ink in local points, on this overlay's own clock ----

  const PEN = { color: '#ff3b30', width: 5 } // width in points
  const pen = $derived(!!display && shell.status !== 'idle' && shell.inkDisplay === display.id)
  let ink: Stroke[] = []
  let stroke: Stroke | null = null
  let inkCanvas = $state<HTMLCanvasElement>()
  let inkFrame = 0
  const now = () => performance.now() / 1000

  function paintInk() {
    inkFrame = 0
    const c = inkCanvas
    if (!c) return
    const k = devicePixelRatio
    if (c.width !== Math.round(W * k)) {
      c.width = Math.round(W * k)
      c.height = Math.round(H * k)
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const shown = visibleStrokes(ink, now())
    for (const s of shown) paintStroke(ctx, s.points, s.color, s.width, s.opacity)
    if (shown.length || stroke) inkFrame = requestAnimationFrame(paintInk)
    else ink = []
  }
  const repaint = () => (inkFrame ||= requestAnimationFrame(paintInk))

  function inkPoint(phase: 'start' | 'move' | 'end', e: PointerEvent) {
    if (!stroke || !display) return
    const t = now()
    stroke.points.push({ t, x: e.clientX, y: e.clientY })
    stroke.end = t
    const first = phase === 'start'
    invoke('recording:draw', phase, e.clientX + display.bounds.x, e.clientY + display.bounds.y, first ? PEN.color : undefined, first ? PEN.width : undefined)
  }
  function penDown(e: PointerEvent) {
    if (!shell.drawing || e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const t = now()
    ink.push((stroke = { start: t, end: t, color: PEN.color, width: PEN.width, points: [] }))
    inkPoint('start', e)
    repaint()
  }
  function penMove(e: PointerEvent) {
    if (stroke) for (const c of e.getCoalescedEvents?.() ?? [e]) inkPoint('move', c)
  }
  function penUp(e: PointerEvent) {
    inkPoint('end', e)
    stroke = null
  }
  // The pen went off mid-stroke (Esc with the button down): end the stroke there.
  $effect(() => {
    if (!shell.drawing && stroke) {
      invoke('recording:draw', 'end', stroke.points.at(-1)!.x + (display?.bounds.x ?? 0), stroke.points.at(-1)!.y + (display?.bounds.y ?? 0))
      stroke = null
    }
  })

  let takes = 0 // countdowns started; a newer one (Esc, then start again) ends the older loop
  async function begin(req: StartRequest, region: Rect) {
    if (target) return
    const take = ++takes
    target = region
    invoke('shell:countdown', true)
    if (shell.settings?.countdown) {
      for (count = 3; count > 0; count--) {
        await new Promise((r) => setTimeout(r, 1000))
        if (!target || take !== takes) return // Esc, or a newer countdown owns `count`
      }
    }
    count = 0
    invoke('shell:start', req)
  }
  function startDisplay() {
    if (display) begin(startRequest({ kind: 'display', displayId: display.id }), { x: 0, y: 0, width: W, height: H })
  }
  function startWindow() {
    if (!hovered || !frame) return
    locked = hovered
    begin(startRequest({ kind: 'window', windowId: hovered.id, ...(preset === 'current' ? {} : { frame: toEngine(toGlobal(frame)) }) }), frame)
  }
  function startArea() {
    // The engine takes an area relative to its display, which is exactly the overlay's space. Past its
    // edges, it is a screenshot only: a recording stays on the screen, and the editor adds room around it.
    if (sel && display && !outside(sel)) begin(startRequest({ kind: 'area', displayId: display.id, rect: toEngine(sel) }), sel)
  }
  function key(e: KeyboardEvent) {
    if (target || ['INPUT', 'TEXTAREA'].includes((e.target as Element).tagName)) return
    // Shortcuts by letter, on any layout: the typed Latin letter, else the key's place (QWERTY).
    const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.replace(/^Key/, '').toLowerCase()
    const cmd = e.metaKey && !e.ctrlKey && !e.altKey
    if (shell.mode === 'area' && sel) {
      const shortcut = { c: () => finishShot(false), s: () => finishShot(true), z: undo }[k]
      if (cmd && shortcut) {
        e.preventDefault()
        return shortcut()
      }
      const t = TOOLS.find((t) => t.key === k)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && t) return pickTool(t.id)
      if (e.key === 'Enter' && shot) return finishShot(false)
    } else if (cmd && k === 'c') {
      // The display or the window: straight onto the clipboard, no drawing.
      e.preventDefault()
      return finishShot(false)
    }
    if (e.key !== 'Enter') return
    if (shell.mode === 'area') startArea()
    else if (shell.mode === 'window') startWindow()
    else if (shell.mode === 'display' && mouse) startDisplay()
  }
  const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
</script>

<svelte:window onkeydown={key} />

{#if still}
  <!-- The frozen screen and, once an area presses past its edge, what lies past it (a checkerboard where
       nothing does): both step back together. -->
  <div class="screen" style:scale={z.current}>
    {#if room}
      <canvas
        class="room"
        class:clear={!wall}
        width={room.width}
        height={room.height}
        style:left="{wide.x}px"
        style:top="{wide.y}px"
        style:width="{wide.width}px"
        style:height="{wide.height}px"
        {@attach paintRoom}
      ></canvas>
    {/if}
    <canvas class="still" width={still.width} height={still.height} {@attach paint}></canvas>
  </div>
{/if}
<svelte:body onpointerenter={takeKeys} onpointermove={move} onpointerup={up} onpointerleave={() => drag || (mouse = null)} />

<!-- The dim around a region: four solid layers, edges on device pixels so they meet without seams.
     The GPU draws a solid layer at any size without rasterizing it, so a resize repaints only the
     region's edges; a 100vmax box-shadow repainted the whole screen on every frame. -->
{#snippet shade(r: Rect)}
  {@const [x0, y0, x1, y1] = [r.x, r.y, r.x + r.width, r.y + r.height].map((v) => px(v) / scale)}
  {#each [[0, 0, W, y0], [0, y1, W, H - y1], [0, y0, x0, y1 - y0], [x1, y0, W - x1, y1 - y0]] as [x, y, w, h], i (i)}
    <div class="shade" style:left="{x}px" style:top="{y}px" style:width="{w}px" style:height="{h}px"></div>
  {/each}
{/snippet}

<!-- A display or window card's actions, like the area's: a screenshot onto the clipboard, or record it. -->
{#snippet actions(record: () => void)}
  <div class="actions">
    <button class="action" onclick={() => finishShot(false)}><UiIcon name="copy" size={16} />Screenshot<kbd>⌘C</kbd></button>
    <button class="start" onclick={record}><span class="dot" style:background-image="url({logoDot})"></span>Record<kbd>↩</kbd></button>
  </div>
{/snippet}

<main class:area={shell.mode === 'area' && !target} class:shown onpointerdown={(e) => down(e, 'new')}>
  {#if shell.area && display}
    <!-- Recording an area: everything else stays dim, every display (click-through, main process). -->
    {@const r = shell.area.display === display.id ? fromEngine(shell.area.rect) : null}
    {#if r}
      {@render shade(r)}
      <div class="target" style:left="{r.x}px" style:top="{r.y}px" style:width="{r.width}px" style:height="{r.height}px"></div>
    {:else}
      <div class="dim"></div>
    {/if}
  {:else if target}
    {@render shade(target)}
    <div class="target" style:left="{target.x}px" style:top="{target.y}px" style:width="{target.width}px" style:height="{target.height}px"></div>
  {:else if shell.counting}
    <!-- Another display is counting down. -->
  {:else if shell.mode === 'display'}
    <div class="display" role="presentation" onpointerenter={(e) => (mouse = { x: e.clientX, y: e.clientY })}>
      {#if mouse}
        <div class="card">
          <Icon name="display" width={34} height={26} stroke={1.4} />
          <div class="title">{display?.label || 'Display'}</div>
          <div class="sub">{px(W)} × {px(H)}</div>
          {@render actions(startDisplay)}
        </div>
      {:else}
        <div class="hint">Move the pointer onto a display to capture it · Esc to cancel</div>
      {/if}
    </div>
  {:else if shell.mode === 'window'}
    {#if hovered && frame}
      <div class="frame" style:left="{frame.x}px" style:top="{frame.y}px" style:width="{frame.width}px" style:height="{frame.height}px"></div>
      <div
        class="card window-card"
        role="group"
        aria-label={hovered.app}
        style:left="{Math.min(Math.max(frame.x + frame.width / 2, 170), W - 170)}px"
        style:top="{Math.min(Math.max(frame.y + frame.height / 2, 120), floor - 120)}px"
        onpointerenter={() => (locked = hovered)}
        onpointerleave={() => (locked = null)}
        onpointerdown={(e) => e.stopPropagation()}
      >
        <div class="title">{hovered.app}</div>
        {#if hovered.title}<div class="sub ellipsis">{hovered.title}</div>{/if}
        <div class="segmented" role="radiogroup" aria-label="Window size">
          {#each ['current', ...PRESETS.map((p) => p.id)] as id (id)}
            {@const disabled = id !== 'current' && !(display && presetSize(id, display.workArea))}
            <button role="radio" aria-checked={preset === id} class:on={preset === id} {disabled} onclick={() => hovered && (choice = { id: hovered.id, preset: id })}>{id === 'current' ? 'Current' : id}</button>
          {/each}
        </div>
        <div class="sub">{px(frame.width)} × {px(frame.height)}</div>
        {@render actions(startWindow)}
      </div>
    {:else}
      <div class="hint">Move the pointer over a window to capture it · Esc to cancel</div>
    {/if}
  {:else if shell.mode === 'area'}
    {#if sel && view}
      {@render shade(view)}
      {#if z.current < 0.999}
        <!-- The screen's real edge, once it steps back: dashed as the last area is. -->
        {@const e = toScreen(screenRect)}
        <div class="edge" style:left="{e.x}px" style:top="{e.y}px" style:width="{e.width}px" style:height="{e.height}px" style:opacity={(1 - z.current) / (1 - STEP)}></div>
      {/if}
      <!-- From each side in to the first content, under the handles; with the lens up, only in it (loupe.wgsl). -->
      {#each lensAt ? [] : rules as l (l.side)}
        {@const [x, y] = [Math.min(l.a.x, l.b.x), Math.min(l.a.y, l.b.y)]}
        <div class="ruler" class:h={l.h} style:left="{x}px" style:top="{y}px" style:width={l.h ? `${Math.abs(l.b.x - l.a.x)}px` : null} style:height={l.h ? null : `${Math.abs(l.b.y - l.a.y)}px`}></div>
      {/each}
      <div class="sel" class:frozen={!!shot} style:left="{view.x}px" style:top="{view.y}px" style:width="{view.width}px" style:height="{view.height}px" role="presentation" onpointerdown={(e) => down(e, 'move')}>
        {#if shot}
          <!-- In the area's own points, shown at the screen's scale. -->
          <div class="paper" style:width="{sel.width}px" style:height="{sel.height}px" style:scale={z.current}>
            <canvas class="board" class:pointing={!!tool && tool !== 'text'} class:typing={tool === 'text'} class:over {@attach board} onpointerdown={boardDown} onpointermove={boardMove} onpointerup={boardUp}></canvas>
            {#if typing}
              <!-- Enter places the text, ⇧↩ starts a new line. -->
              <textarea
                class="type"
                style:left="{typing.at.x}px"
                style:top="{typing.at.y}px"
                style:color
                style:font="600 {FONT}px/{FONT * 1.25}px {FONT_FAMILY}"
                rows={typing.text.split('\n').length}
                spellcheck="false"
                aria-label="Text"
                bind:value={typing.text}
                {@attach (el) => el.focus()}
                onpointerdown={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return
                  e.preventDefault()
                  commitText()
                }}
              ></textarea>
            {/if}
          </div>
        {:else}
          {#if dragging && drag?.kind !== 'move'}
            {#each [1, 2] as k (k)}
              <span class="third v" style:left="calc({k} * 100% / 3)"></span>
              <span class="third h" style:top="calc({k} * 100% / 3)"></span>
            {/each}
          {/if}
          {#each HANDLES as h (h)}
            <span class="handle {h}" role="presentation" onpointerdown={(e) => down(e, h)}><i></i></span>
          {/each}
        {/if}
      </div>
      {#if form}
        <div class="form" style:left="{form.x}px" style:top="{form.y}px" bind:offsetWidth={formW} bind:offsetHeight={formH} role="group" aria-label="Area" onpointerdown={(e) => e.stopPropagation()}>
          {#if shot}
            <span class="readout">{px(sel.width)} × {px(sel.height)}</span>
            <button class="action" onclick={() => finishShot(true)}><UiIcon name="download" size={16} />Save<kbd>⌘S</kbd></button>
            <button class="start" onclick={() => finishShot(false)}><UiIcon name="copy" size={16} />Copy<kbd>⌘C</kbd></button>
          {:else}
            <label class="size"
              ><input
                type="number"
                min="64"
                aria-label="Width in pixels"
                value={px(sel.width)}
                onchange={(e) => setSize('width', e.currentTarget)}
                onblur={(e) => setSize('width', e.currentTarget)}
              /><span>×</span><input
                type="number"
                min="64"
                aria-label="Height in pixels"
                value={px(sel.height)}
                onchange={(e) => setSize('height', e.currentTarget)}
                onblur={(e) => setSize('height', e.currentTarget)}
              /></label
            >
            <div class="segmented" role="radiogroup" aria-label="Aspect ratio">
              {#each Object.keys(ASPECTS) as a (a)}
                <button role="radio" aria-checked={aspect === a} class:on={aspect === a} onclick={() => setAspect(a)}>{a === 'free' ? 'Free' : a}</button>
              {/each}
            </div>
            <button class="action" onclick={() => finishShot(false)}><UiIcon name="copy" size={16} />Screenshot<kbd>⌘C</kbd></button>
            <button class="start" onclick={startArea} disabled={outside(sel)} title={outside(sel) ? 'A recording stays on the screen. The editor adds room around it.' : undefined}
              ><span class="dot" style:background-image="url({logoDot})"></span>Record<kbd>↩</kbd></button
            >
          {/if}
        </div>
      {/if}
      {#if tools && !dragging}
        <div
          class="tools"
          role="toolbar"
          tabindex="-1"
          aria-label="Draw on the screenshot"
          aria-orientation="vertical"
          style:left="{tools.x}px"
          style:top="{tools.y}px"
          bind:offsetWidth={toolsW}
          bind:offsetHeight={toolsH}
          onpointerdown={(e) => e.stopPropagation()}
        >
          {#each TOOLS as t (t.id)}
            <button class="tool" class:on={tool === t.id} aria-pressed={tool === t.id} aria-label={t.label} title="{t.label} ({t.key.toUpperCase()})" onclick={() => pickTool(t.id)}><UiIcon name={ICONS[t.id]} /></button>
          {/each}
          <span class="rule"></span>
          <div class="swatches" role="radiogroup" aria-label="Color">
            {#each COLORS as c (c.value)}
              <button class="swatch" role="radio" aria-checked={color === c.value} aria-label={c.name} title={c.name} style:--c={c.value} onclick={() => (color = c.value)}></button>
            {/each}
          </div>
          <span class="rule"></span>
          <button class="tool" aria-label="Undo" title="Undo (⌘Z)" disabled={!past.length && !typing} onclick={undo}><UiIcon name="undo" /></button>
        </div>
      {/if}
    {:else}
      {#if last}
        {@const l = toScreen(last)}
        {@const [x0, y0, x1, y1] = [l.x, l.y, l.x + l.width, l.y + l.height].map((v) => px(v) / scale)}
        <div class="last" style:left="{x0}px" style:top="{y0}px" style:width="{x1 - x0}px" style:height="{y1 - y0}px"><span class="tag">Last area</span></div>
      {/if}
      <div class="hint">Drag over what you want to capture · Esc to cancel</div>
    {/if}
    {#if pushing}
      <div class="push" role="status" style:left="{pushing.x}px" style:top="{pushing.y}px" bind:offsetWidth={pushW} bind:offsetHeight={pushH}>
        Keep pushing to go past the screen<i style:width="{pushing.fill * 100}%"></i>
      </div>
    {/if}
    <canvas class="lens" class:on={lensShown} width={Math.round(W * devicePixelRatio)} height={Math.round(H * devicePixelRatio)} aria-hidden="true" bind:this={lens}></canvas>
    {#each gaps as g (g.side)}
      <span class="gap" class:h={g.h} class:beside={g.beside} style:left="{g.at.x}px" style:top="{g.at.y}px">{g.d}</span>
    {/each}
  {/if}
  <!-- Outside the branches above, so it bursts away even as the recording's backdrop replaces them. -->
  {#if count > 0 && target}
    <div class="countdown" style:left="{target.x + target.width / 2}px" style:top="{target.y + target.height / 2}px" in:pop out:burst={{ fade: !target }}>
      <Countdown {count} />
      <div class="zoom"><ZoomHint /></div>
    </div>
  {/if}
  {#if pen && display}
    <canvas class="ink" class:live={shell.drawing} bind:this={inkCanvas} onpointerdown={penDown} onpointermove={penMove} onpointerup={penUp}></canvas>
    {#if shell.drawing}
      <div class="pen-hint" role="status" style:top="{display.workArea.y - display.bounds.y + 10}px"><UiIcon name="pen" size={16} />Drawing on screen<kbd>esc</kbd></div>
    {/if}
  {/if}
</main>

<style>
  :global(body) {
    background: transparent;
  }
  .screen {
    position: fixed;
    inset: 0;
    pointer-events: none;
    user-select: none;
  }
  .still {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .room {
    position: absolute;
  }
  .room.clear {
    background: repeating-conic-gradient(var(--surface-150) 0 25%, var(--surface-100) 0 50%) 0 0 / 16px 16px;
  }
  main {
    position: fixed;
    inset: 0;
    cursor: default;
  }
  main.area {
    cursor: crosshair;
    background: rgb(0 0 0 / 0.28);
  }
  main.area:has(.sel) {
    background: none;
  }
  /* A drag's cursor wherever it goes (data-drag, set while it drags): over the body that holds the
     pointer, the handle it dragged, and the lens. */
  :global(html[data-drag='aim']),
  :global(html[data-drag='aim'] *) {
    cursor: crosshair !important;
  }
  :global(html[data-drag='move']),
  :global(html[data-drag='move'] *) {
    cursor: move !important;
  }
  .display {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .display:has(.card) {
    background: color-mix(in oklab, var(--brand) 5%, transparent);
    box-shadow: inset 0 0 0 3px color-mix(in oklab, var(--brand) 90%, transparent);
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 220px;
    padding: 20px 22px 18px;
    border-radius: var(--radius-xl);
    background: var(--surface-root);
    box-shadow: var(--shadow-pop);
    color: var(--fg-default);
  }
  .window-card {
    position: absolute;
    transform: translate(-50%, -50%);
    max-width: 340px;
  }
  .title {
    margin-top: 4px;
    font-size: 15px;
    font-weight: 600;
  }
  .sub {
    font-size: 12px;
    color: var(--fg-secondary);
    font-variant-numeric: tabular-nums;
  }
  .ellipsis {
    max-width: 296px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .start {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 16px 0 13px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface-inverse);
    color: var(--fg-inverse);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .start:hover:not(:disabled) {
    background: var(--surface-inverse-hover);
  }
  .start:disabled {
    opacity: 0.35;
  }
  .start:focus-visible,
  .segmented button:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  /* The logo's record dot, cropped out of its 1024 icon canvas (r 129 around the center). */
  .dot {
    width: 12px;
    height: 12px;
    background: center / 397% no-repeat;
  }
  .frame {
    position: absolute;
    border-radius: 10px;
    background: color-mix(in oklab, var(--brand) 5%, transparent);
    box-shadow: inset 0 0 0 3px color-mix(in oklab, var(--brand) 90%, transparent);
    transition:
      left 120ms var(--ease-out),
      top 120ms var(--ease-out),
      width 120ms var(--ease-out),
      height 120ms var(--ease-out);
    pointer-events: none;
  }
  .segmented {
    display: flex;
    margin-top: 8px;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius);
    background: var(--control-track);
    box-shadow: var(--hairline);
  }
  .segmented button {
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg-secondary);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  .segmented button:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--fg-default);
  }
  .segmented button:disabled {
    opacity: 0.35;
  }
  .segmented button.on {
    background: var(--surface-150);
    color: var(--fg-default);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3), var(--hairline);
  }
  .hint {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 9px 16px;
    border-radius: var(--radius-lg);
    /* The text is the top layer: gray, with the logo dot's colors (widget/dot.ts) in the middle third,
       which passes through it once, left to right, as the hint comes on screen. The pill is the bottom one. */
    background:
      linear-gradient(90deg, var(--fg-secondary) 33.3%, #1957fa, #8b67a8, #e44730, #f04600, #fb8600, var(--fg-secondary) 66.7%) 0 0 / 300% 100%,
      var(--surface-root);
    background-clip: text, padding-box;
    color: transparent;
    /* A strong hairline inside and a dark one outside: the edge reads on any wallpaper. */
    box-shadow:
      0 0 0 0.5px rgb(0 0 0 / 0.6),
      0 4px 12px rgb(0 0 0 / 0.3),
      inset 0 0 0 0.5px var(--border-default);
    font-size: 13px;
    pointer-events: none;
  }
  .shown .hint {
    animation: sweep 2.5s ease-in-out; /* slow enough to read the colors as they pass */
    animation-delay: 150ms;
  }
  @keyframes sweep {
    from {
      background-position: 100% 0;
    }
  }
  /* The region to record: clear, with a hairline, and everything around it dim (shade). */
  .sel,
  .target {
    position: absolute;
    box-shadow: 0 0 0 1px rgb(255 255 255 / 0.95);
  }
  .shade {
    position: absolute;
    background: rgb(0 0 0 / 0.42);
    pointer-events: none; /* a click on the dim draws a new area */
    will-change: transform; /* its own layer: resizing it repaints nothing else */
  }
  .sel {
    cursor: move;
  }
  /* The last area: half as dim as the screen around it, with a tag, and dashes where the selection's
     hairline would be, on device pixels, white on dark so they read on any content. Under the pointer
     it clears, as when it is picked: a click picks it. */
  .last {
    position: absolute;
    background: rgb(0 0 0 / 0.14);
    box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.28); /* the dim around it, painted once: it never resizes */
  }
  /* The screen's real edge, once it steps back. */
  .edge {
    position: absolute;
    pointer-events: none;
  }
  .last::before,
  .edge::before {
    --dash: #fff 0 6px, rgb(0 0 0 / 0.45) 0 10px;
    content: '';
    position: absolute;
    inset: -1px;
    background:
      repeating-linear-gradient(90deg, var(--dash)) top / 100% 1px no-repeat,
      repeating-linear-gradient(90deg, var(--dash)) bottom / 100% 1px no-repeat,
      repeating-linear-gradient(var(--dash)) left / 1px 100% no-repeat,
      repeating-linear-gradient(var(--dash)) right / 1px 100% no-repeat;
  }
  main.area:has(.last) {
    background: none;
  }
  .last:hover {
    background: none;
  }
  .tag {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 4px 9px;
    border-radius: var(--radius);
    background: var(--surface-root);
    box-shadow: /* the hint's edges: it reads on any content */
      0 0 0 0.5px rgb(0 0 0 / 0.6),
      0 2px 6px rgb(0 0 0 / 0.25),
      inset 0 0 0 0.5px var(--border-default);
    color: var(--fg-default);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: rgb(0 0 0 / 0.42);
  }
  /* Thirds while resizing: faint dashes to compose by, found when looked for and easy to ignore.
     The soft dark edge keeps them visible over white content. Each is a 1 px strip, so a resize
     repaints four hairlines, not the region. */
  .third {
    --dash: rgb(255 255 255 / 0.35) 0 4px, transparent 0 8px;
    position: absolute;
    filter: drop-shadow(0 0 0.5px rgb(0 0 0 / 0.28));
    pointer-events: none;
    animation: third-in 200ms var(--ease-out);
  }
  .third.v {
    top: 0;
    bottom: 0;
    width: 1px;
    margin-left: -0.5px;
    background: repeating-linear-gradient(var(--dash));
  }
  .third.h {
    left: 0;
    right: 0;
    height: 1px;
    margin-top: -0.5px;
    background: repeating-linear-gradient(90deg, var(--dash));
  }
  @keyframes third-in {
    from { opacity: 0; }
  }
  /* Crop handles: the hairline thickens into brackets at the corners and bars mid-edge, centered
     on the hairline so they reach as far inside the region as outside it. Each is its own layer,
     painted once: a resize only moves it. The shadow sits on the bars (i) so it is painted into
     that layer; a filter on the layer itself the GPU redraws every frame. */
  .handle {
    --t: 4px; /* thickness */
    --o: calc(var(--t) / -2 - 0.5px); /* centers it on the 1 px hairline just outside the box */
    position: absolute;
    will-change: transform;
  }
  .handle i {
    position: absolute;
    inset: 0;
    background: #fff;
    border-radius: calc(var(--t) / 2);
    filter: drop-shadow(0 0 0.5px rgb(0 0 0 / 0.6)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.3));
  }
  .handle::before {
    content: '';
    position: absolute;
    inset: -7px; /* a bigger target than it looks */
  }
  /* A corner is two rounded bars: i runs along the top or bottom edge, its ::after down the side. */
  .nw, .ne, .se, .sw { width: 20px; height: var(--t); }
  .nw i::after, .ne i::after, .se i::after, .sw i::after {
    content: '';
    position: absolute;
    width: var(--t);
    height: 20px;
    background: inherit;
    border-radius: inherit;
  }
  .nw, .ne { top: var(--o); }
  .nw::before, .ne::before { bottom: calc(var(--t) - 27px); }
  .nw i::after, .ne i::after { top: 0; }
  .sw, .se { bottom: var(--o); }
  .sw::before, .se::before { top: calc(var(--t) - 27px); }
  .sw i::after, .se i::after { bottom: 0; }
  .nw, .sw { left: var(--o); }
  .nw i::after, .sw i::after { left: 0; }
  .ne, .se { right: var(--o); }
  .ne i::after, .se i::after { right: 0; }
  .n, .s { left: 50%; width: 24px; height: var(--t); margin-left: -12px; }
  .e, .w { top: 50%; width: var(--t); height: 24px; margin-top: -12px; }
  .n { top: var(--o); }
  .s { bottom: var(--o); }
  .e { right: var(--o); }
  .w { left: var(--o); }
  .nw, .se { cursor: nwse-resize; }
  .ne, .sw { cursor: nesw-resize; }
  .n, .s { cursor: ns-resize; }
  .e, .w { cursor: ew-resize; }
  .form {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 12px;
    border-radius: var(--radius-xl); /* concentric: 8 px controls inside 8 px padding */
    background: var(--surface-root);
    box-shadow: var(--shadow-pop);
    color: var(--fg-default);
    cursor: default;
  }
  .form .segmented {
    margin-top: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .size {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-faint);
    font-size: 12px;
  }
  .size input {
    width: 62px;
    height: 26px;
    padding: 0 7px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    color: var(--fg-default);
    font: 13px var(--font);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .size input:focus {
    outline: 2px solid var(--brand);
  }
  .size input::-webkit-inner-spin-button {
    display: none;
  }
  /* The circle sits on the region's center; the auto zoom hint hangs under it. */
  .countdown {
    position: absolute;
    translate: -50% -50%;
    pointer-events: none;
  }
  .zoom {
    position: absolute;
    top: calc(100% + 16px);
    left: 50%;
    translate: -50% 0;
  }
  /* Pressed against the screen's edge: a pill that fills while the press holds; full, the screen steps back. */
  .push {
    position: absolute;
    padding: 8px 13px 9px;
    border-radius: var(--radius-lg);
    background: var(--surface-root);
    box-shadow: var(--shadow-pop);
    color: var(--fg-default);
    font-size: 13px;
    white-space: nowrap;
    pointer-events: none;
    overflow: hidden;
    animation: come var(--come) var(--ease-out);
  }
  .push i {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--brand);
  }
  /* The loupe: the editor's glass lens in place under the pointer, its shadow around it (loupe.wgsl). */
  .lens {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    visibility: hidden;
  }
  .lens.on {
    visibility: visible;
  }
  /* Measure lines while a drag fits the area: from the sides it moves in to the first content, a point
     wide with a tick across each end (loupe.wgsl draws them the same through the lens). */
  .ruler {
    position: absolute;
    background: var(--brand);
    pointer-events: none;
  }
  .ruler.h { height: 1px; margin-top: -0.5px; }
  .ruler:not(.h) { width: 1px; margin-left: -0.5px; }
  .ruler::before,
  .ruler::after {
    content: '';
    position: absolute;
    background: inherit;
  }
  .ruler.h::before, .ruler.h::after { top: -3px; width: 1px; height: 7px; }
  .ruler.h::before { left: -0.5px; }
  .ruler.h::after { right: -0.5px; }
  .ruler:not(.h)::before, .ruler:not(.h)::after { left: -3px; width: 7px; height: 1px; }
  .ruler:not(.h)::before { top: -0.5px; }
  .ruler:not(.h)::after { bottom: -0.5px; }
  /* A measure line's length in pixels: on its middle, or beside a line too short to hold it. Over the
     lens, on the line where its flat top shows it magnified. */
  .gap {
    position: absolute;
    translate: -50% -50%;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    background: var(--brand);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
    color: #fff;
    font-size: 11px;
    font-weight: 500;
    line-height: 17px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .gap.beside.h { translate: -50% calc(-100% - 6px); }
  .gap.beside:not(.h) { translate: 6px -50%; }
  @media (prefers-reduced-motion: reduce) {
    .third { animation: none; }
    .frame { transition: none; }
    .push { animation: none; }
  }
  /* Secondary action beside the accent one: same height, a control on the panel. */
  .action {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 12px 0 11px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface-100);
    box-shadow: var(--hairline);
    color: var(--fg-default);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  .action:hover {
    background: var(--surface-hover);
  }
  .action:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
  kbd {
    margin-left: 1px;
    font: 500 11.5px var(--font);
    opacity: 0.55;
  }
  .readout {
    padding: 0 6px 0 2px;
    color: var(--fg-secondary);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
  }
  .sel.frozen {
    cursor: default;
  }
  .paper {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }
  .board {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .board.pointing {
    cursor: crosshair;
  }
  .board.typing {
    cursor: text;
  }
  .board.over {
    cursor: move;
  }
  .type {
    position: absolute;
    min-width: 40px;
    margin: 0;
    padding: 0;
    border: 0;
    outline: 1px dashed rgb(255 255 255 / 0.7);
    outline-offset: 3px;
    background: none;
    resize: none;
    overflow: hidden;
    field-sizing: content;
    text-shadow: 0 0.5px 3px rgb(0 0 0 / 0.3);
    caret-color: currentColor;
  }
  /* Drawing tools beside the area: a column of tools, colors, and undo. */
  .tools {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px;
    border-radius: var(--radius-lg); /* concentric: 6 px buttons inside 6 px padding */
    background: var(--surface-root);
    box-shadow: var(--shadow-pop);
    cursor: default;
  }
  .tool {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg-secondary);
  }
  .tool:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--fg-default);
  }
  .tool.on {
    background: var(--surface-150);
    box-shadow: var(--hairline);
    color: var(--fg-default);
  }
  .tool:disabled {
    opacity: 0.35;
  }
  .tool:focus-visible,
  .swatch:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: -2px;
  }
  .rule {
    width: 20px;
    height: 0.5px;
    margin: 4px 0;
    background: var(--border-default);
  }
  /* One column under the tools, each color centered on the tools' axis. */
  .swatches {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
  }
  .swatch {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--c);
    box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.25);
  }
  /* The dark swatch needs a lighter rim to show on the dark strip. */
  .swatch[aria-label='Black'] {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.4);
  }
  .swatch[aria-checked='true'] {
    box-shadow:
      inset 0 0 0 0.5px rgb(255 255 255 / 0.25),
      0 0 0 2px var(--surface-root),
      0 0 0 3.5px var(--fg-default);
  }
  /* The pen while recording: ink everywhere, the mouse only while it is on. A dot in the ink's color
     is the cursor, so the recorded cursor reads as the pen's tip. */
  .ink {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .ink.live {
    pointer-events: auto;
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ccircle cx='8' cy='8' r='4' fill='%23ff3b30' stroke='white' stroke-width='1.5'/%3E%3C/svg%3E") 8 8, crosshair;
  }
  .pen-hint {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px 7px 10px;
    border-radius: var(--radius-lg);
    background: var(--surface-root);
    box-shadow: var(--shadow-pop);
    color: var(--fg-default);
    font-size: 13px;
    pointer-events: none;
  }
  .pen-hint :global(svg) {
    color: var(--record);
  }
</style>
