<!-- The editor timeline: transport and tools, one canvas for every lane, the right-click menu, and the
     ⌘K menu with the editor's shortcuts. Mounted by Editor.svelte.
     Shows OUTPUT time; items live in source time (see model.ts). Scrolling, zooming, and dragging touch
     only plain variables and redraw the canvas in the next frame: no reactive churn per frame. -->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { AudioSource } from '../../../shared/project.ts'
  import { timeMap, toSource, type TimeMap } from '../../../shared/timemap.ts'
  import { doc, edit, selection } from '../../../lib/doc.svelte.ts'
  import { player, scrub, seek, toggle } from '../../../lib/player.svelte.ts'
  import { peaks as enginePeaks } from '../../../engine/audio/index.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import CommandMenu from '../commands/CommandMenu.svelte'
  import { consumesKey, registerCommands, run } from '../commands/registry.ts'
  import * as M from './model.ts'
  import * as A from './actions.svelte.ts'
  import { PAD, RULER, draw, hit, rows as layoutRows, thumb, timeOf, xOf, type Audio, type Hit, type View } from './draw.ts'
  import { Waveforms, type PeaksFn } from './waveform.ts'
  import Menu, { type Target } from './Menu.svelte'

  let { peaks = enginePeaks }: { peaks?: PeaksFn } = $props()

  const MAX_PPS = 1000 // px per second: a 30 fps frame is 33 px wide
  const SCISSORS = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><g fill='none' stroke-linecap='round'><g stroke='black' stroke-width='3.6'><path d='M7 3l10 13M17 3L7 16'/><circle cx='6.5' cy='18.5' r='3'/><circle cx='17.5' cy='18.5' r='3'/></g><g stroke='white' stroke-width='1.6'><path d='M7 3l10 13M17 3L7 16'/><circle cx='6.5' cy='18.5' r='3'/><circle cx='17.5' cy='18.5' r='3'/></g></g></svg>`,
  )}") 12 10, crosshair`

  type Gesture =
    | { kind: 'scrub' }
    | { kind: 'scroll'; x: number; x0: number }
    | { kind: 'trim'; i: number; side: 'start' | 'end'; lim: { lo: number; hi: number }; off: number }
    | { kind: 'move'; track: M.ItemTrack; ids: Set<string>; grab: number }
    | { kind: 'resize'; track: M.ItemTrack; id: string; side: 'start' | 'end'; off: number }
    | { kind: 'create'; track: M.ItemTrack; t0: number }
    | { kind: 'marquee'; t: number; y: number; keep: string[] }
    | { kind: 'cut'; cut: M.Cut }
  type Drag = Gesture & { sx: number; sy: number; moved: boolean; map: TimeMap; select?: string }

  // Render state, read by the canvas. Plain variables on purpose.
  let canvas: HTMLCanvasElement | undefined
  let ctx: CanvasRenderingContext2D | null = null
  const view: View = { W: 0, H: 0, dpr: 1, x0: 0, pps: 1, duration: 0, shift: null, rows: [] }
  let target = 0 // px per second the zoom animation heads to
  let anchor: { t: number; x: number; to: number } | null = null // playhead time, its screen x, where it settles
  let base: M.Parts | null = null // committed project data (plain)
  let draft: Partial<M.Parts> | null = null // the drag in progress, drawn instead of base
  let camera = false
  let keys: M.Chip[] = []
  let words: M.Chip[] = []
  let model: M.Model | null = null
  let sel = new Set<string>()
  let hover: Hit | null = null
  let pointer: { x: number; y: number } | null = null
  let drag: Drag | null = null
  let ghost: { track: M.ItemTrack; a: number; b: number } | null = null
  let mic: Audio | null = null
  let system: Audio | null = null
  let fitted = ''
  let raf = 0
  let last = 0

  // DOM state.
  let height = $state(0)
  let duration = $state(0)
  let zoomValue = $state(0)
  let splitTool = $state(false)
  let alt = $state(false)
  let cursor = $state('default')
  let menu: { x: number; y: number; t: number; target: Target } | null = $state(null)

  const waves = $derived(new Waveforms(peaks, requestDraw))
  const armed = () => splitTool || alt
  const isItem = (t: M.TrackId): t is M.ItemTrack => t === 'zooms' || t === 'layouts' || t === 'masks'

  // ---- Inputs from the document ----

  $effect(() => {
    const p = doc.project
    void doc.rev
    untrack(() => {
      if (!p) {
        base = model = null
        return requestDraw()
      }
      base = {
        clips: $state.snapshot(p.clips),
        zooms: $state.snapshot(p.zooms),
        layouts: $state.snapshot(p.layouts),
        masks: $state.snapshot(p.masks),
        duration: p.sources.duration,
      }
      camera = !!p.sources.camera
      const audio = (s: AudioSource | undefined, mix: { volume: number; muted: boolean }) =>
        s && doc.path ? { url: fileUrl(`${doc.path}/${s.file}`), gain: mix.muted ? 0 : mix.volume } : null
      mic = audio(p.sources.mic, p.audio.mic)
      system = audio(p.sources.system, p.audio.system)
      rebuild()
    })
  })

  $effect(() => {
    const events = doc.events
    untrack(() => {
      keys = M.keyChips($state.snapshot(events))
      rebuild()
    })
  })

  $effect(() => {
    const t = doc.transcript
    const edits: Record<number, string> = doc.project ? JSON.parse(JSON.stringify(doc.project.captionEdits)) : {}
    untrack(() => {
      words = M.wordChips(t ? $state.snapshot(t) : null, edits)
      rebuild()
    })
  })

  $effect(() => {
    sel = new Set(selection.ids)
    untrack(requestDraw)
  })

  $effect(() => {
    const t = player.time
    const playing = player.playing
    untrack(() => {
      reveal(t, playing)
      requestDraw()
    })
  })

  $effect(() =>
    registerCommands(
      A.timelineCommands({
        zoom: (f) => zoomTo((target || view.pps) * f),
        fit: () => zoomTo(minPps()),
        split: () => {
          splitTool = !splitTool
          hovered()
        },
      }),
    ),
  )

  // ---- Model and view ----

  function rebuild() {
    if (!base) {
      model = null
      return requestDraw()
    }
    model = M.buildModel(draft ? { ...base, ...draft } : base, keys, words, model ?? undefined)
    if (draft) return requestDraw() // lanes and fit stay as they were while dragging
    const ids: M.TrackId[] = ['clips', 'zooms']
    if (camera) ids.push('layouts')
    ids.push('masks')
    if (keys.length) ids.push('keys')
    if (words.length) ids.push('captions')
    const r = layoutRows(ids)
    view.rows = r.rows
    height = r.height
    const fit = isFit()
    view.duration = duration = model.map.duration
    if (fit) view.pps = target = minPps() // a fitted timeline stays fitted when edits change its length
    const key = `${doc.path}|${doc.project?.createdAt}`
    if (key !== fitted && view.W) {
      fitted = key
      view.pps = target = minPps()
      view.x0 = 0
    }
    clampView()
    hovered()
    requestDraw()
  }

  const minPps = () => (view.W - 2 * PAD) / Math.max(view.duration, 0.5)
  const isFit = () => view.W > 0 && !anchor && view.pps <= minPps() * 1.0001
  const sliderOf = (pps: number) => Math.round((1000 * Math.log(pps / minPps())) / Math.log(MAX_PPS / minPps()))

  function clampView() {
    if (!view.W) return
    const lo = minPps()
    if (view.pps < lo) view.pps = lo
    if (target < lo) target = lo
    view.x0 = M.clamp(view.x0, 0, Math.max(0, view.duration - (view.W - 2 * PAD) / view.pps))
    zoomValue = sliderOf(view.pps)
  }

  /** Animate the timeline zoom, anchored on the playhead (brought to the middle when off screen). */
  function zoomTo(pps: number) {
    if (!model || !view.W) return
    target = M.clamp(pps, minPps(), MAX_PPS)
    const x = PAD + (player.time - view.x0) * view.pps
    anchor = { t: player.time, x, to: x >= PAD && x <= view.W - PAD ? x : view.W / 2 }
    requestDraw()
  }

  function reveal(t: number, playing: boolean) {
    if (!model || !view.W || drag) return
    const x = PAD + (t - view.x0) * view.pps
    if (x >= PAD && x <= view.W - PAD) return
    view.x0 = t - (playing ? 32 : view.W / 2 - PAD) / view.pps // pages along while playing, centers on jumps
    clampView()
  }

  // ---- Frames ----

  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(frame)
  }

  function frame(now: number) {
    raf = 0
    const dt = now - last < 100 ? now - last : 16.7
    last = now
    if (devicePixelRatio !== view.dpr && canvas) resize(canvas)
    let again = false
    if (anchor) {
      const k = 1 - Math.exp(-dt / 70)
      const done = Math.abs(Math.log(target / view.pps)) < 2e-3
      view.pps = done ? target : Math.exp(Math.log(view.pps) + Math.log(target / view.pps) * k)
      anchor.x = done ? anchor.to : anchor.x + (anchor.to - anchor.x) * k
      view.x0 = anchor.t - (anchor.x - PAD) / view.pps
      clampView()
      if (done) anchor = null
      again = !done
    }
    if (drag?.moved && pointer && drag.kind !== 'scroll' && drag.kind !== 'cut') {
      // Dragging past an edge scrolls, faster the further out.
      const over = pointer.x < PAD + 24 ? pointer.x - PAD - 24 : pointer.x > view.W - PAD - 24 ? pointer.x - view.W + PAD + 24 : 0
      const x0 = view.x0
      if (over) {
        view.x0 += (over * 0.6 * (dt / 16.7)) / view.pps
        clampView()
      }
      if (view.x0 !== x0) {
        dragTo(pointer)
        again = true
      }
    }
    if (ctx && view.W) {
      if (model) {
        draw(ctx, { view, model, time: player.time, sel, hover, pointer, armed: armed(), dragging: !!drag, ghost, marquee: marqueeRect(), mic, system, waves })
      } else ctx.clearRect(0, 0, canvas!.width, canvas!.height)
    }
    if (again) requestDraw()
  }

  function resize(el: HTMLCanvasElement) {
    const r = el.getBoundingClientRect()
    const fit = isFit()
    view.W = r.width
    if (fit) view.pps = target = minPps() // and when the window resizes
    view.H = r.height
    view.dpr = devicePixelRatio
    el.width = Math.round(r.width * view.dpr)
    el.height = Math.round(r.height * view.dpr)
    rebuild()
  }

  function setup(el: HTMLCanvasElement) {
    canvas = el
    ctx = el.getContext('2d')
    const ro = new ResizeObserver(() => {
      resize(el)
      cancelAnimationFrame(raf)
      frame(performance.now()) // resizing clears the canvas: repaint now, not next frame
    })
    ro.observe(el)
    el.addEventListener('wheel', onwheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onwheel)
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  // ---- Input ----

  function onwheel(e: WheelEvent) {
    if (!model) return
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.W : 1
    if (e.ctrlKey || e.metaKey) {
      // Pinch arrives as ctrl+wheel; ⌘-scroll steps more coarsely.
      zoomTo((target || view.pps) * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.003)))
    } else {
      const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit
      if (anchor) {
        anchor.x -= d // mid-zoom: the anchor moves with the content, the zoom carries on
        anchor.to -= d
      } else view.x0 += d / view.pps
      clampView()
      if (pointer) hovered()
      requestDraw()
    }
  }

  const local = (e: MouseEvent) => {
    const r = canvas!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const outTime = (x: number) => M.clamp(timeOf(view, x), 0, view.duration)
  const idOf = (track: M.TrackId, b: M.Block) => (model![track].items[b.i] as M.Item).id

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || !model || !base) return
    menu = null
    if (e.altKey) syncAlt(true) // ⌥ pressed while another app had focus; release comes as keyup or blur
    const p = local(e)
    const h = hit(view, model, p.x, p.y)
    const t = outTime(p.x)
    const add = e.shiftKey || e.metaKey
    const map = model.map
    let g: Gesture | null = null
    let select: string | undefined
    const marquee = (): Gesture => ({ kind: 'marquee', t: timeOf(view, p.x), y: p.y, keep: add ? [...selection.ids] : [] })

    if (armed() && (h.kind === 'block' || h.kind === 'lane') && h.track === 'clips') return A.cut(t)
    if (h.kind === 'ruler') {
      seek(t)
      g = { kind: 'scrub' }
    } else if (h.kind === 'cut') g = { kind: 'cut', cut: h.cut }
    else if (h.kind === 'scrollbar') g = { kind: 'scroll', x: p.x, x0: view.x0 }
    else if (h.kind === 'none') g = marquee()
    else if (h.kind === 'lane') {
      if (add && h.track !== 'keys' && h.track !== 'captions') g = marquee()
      else if (isItem(h.track)) g = { kind: 'create', track: h.track, t0: t }
      else {
        seek(t)
        g = { kind: 'scrub' }
      }
    } else if (h.track === 'keys' || h.track === 'captions') {
      seek(h.block.a)
      g = { kind: 'scrub' }
    } else {
      const id = idOf(h.track, h.block)
      if (h.edge) {
        select = id
        const off = (h.edge === 'start' ? h.block.a : h.block.b) - timeOf(view, p.x) // the edge keeps its distance to the pointer
        g = h.track === 'clips'
          ? { kind: 'trim', i: h.block.i, side: h.edge, lim: M.clipLimits(base.clips, h.block.i, base.duration), off }
          : { kind: 'resize', track: h.track, id, side: h.edge, off }
      } else {
        if (add) selection.ids = selection.ids.includes(id) ? selection.ids.filter((x) => x !== id) : [...selection.ids, id]
        else if (!selection.ids.includes(id)) selection.ids = [id]
        else select = id // plain click inside a multi-selection narrows it on release; a drag moves them all
        if (h.track === 'clips') {
          seek(t)
          g = { kind: 'scrub' }
        } else if (selection.ids.includes(id)) {
          const mine = new Set((base[h.track] as M.Item[]).map((x) => x.id))
          g = { kind: 'move', track: h.track, ids: new Set(selection.ids.filter((x) => mine.has(x))), grab: toSource(map, t) }
        }
      }
    }
    if (!g) return
    drag = { ...g, sx: p.x, sy: p.y, moved: false, map, select }
    try {
      canvas!.setPointerCapture(e.pointerId)
    } catch {
      // synthetic pointers (lab benchmarks) cannot be captured
    }
    pointer = p
    ghost = null
    cursor = dragCursor(drag)
    requestDraw()
  }

  function onpointermove(e: PointerEvent) {
    if (!model) return
    pointer = local(e)
    if (e.altKey) syncAlt(true) // ⌥ pressed while another app had focus; release comes as keyup or blur
    if (drag) {
      if (!drag.moved && drag.kind !== 'scrub' && Math.hypot(pointer.x - drag.sx, pointer.y - drag.sy) < 3) return
      drag.moved = true
      dragTo(pointer)
    } else hovered()
    requestDraw()
  }

  function onpointerup() {
    const d = drag
    if (!d || !base) return
    drag = null
    if (d.moved) commit(d)
    else click(d)
    draft = null
    view.shift = null
    rebuild()
    hovered()
  }

  function onpointerleave() {
    if (drag) return
    pointer = hover = ghost = null
    requestDraw()
  }

  function dragTo(p: { x: number; y: number }) {
    const d = drag!
    const b = base!
    const t = outTime(p.x)
    if (d.kind === 'scrub') return scrub(t) // with a grain of audio at each step
    if (d.kind === 'scroll') {
      const th = thumb(view)
      if (!th) return
      const vis = (view.W - 2 * PAD) / view.pps
      view.x0 = d.x0 + ((p.x - d.x) / (view.W - 2 * PAD - th.w)) * (view.duration - vis)
      return clampView()
    }
    if (d.kind === 'trim') {
      const c = b.clips[d.i]
      // Edges follow the pointer exactly at any speed. A start edge is drawn where the pointer is and
      // the rest of the timeline stays put until release, when the gap closes (ripple).
      const clips = M.trimClip(b.clips, d.i, d.side, M.edgeSource(d.map, d.i, timeOf(view, p.x) + d.off), d.lim)
      draft = { clips }
      view.shift = d.side === 'start' ? { at: d.map.outStarts[d.i], by: (clips[d.i].start - c.start) / c.speed } : null
    } else if (d.kind === 'move') {
      draft = { [d.track]: M.moveItems(b[d.track] as M.Item[], d.ids, toSource(d.map, t) - d.grab, b.duration) }
    } else if (d.kind === 'resize') {
      draft = { [d.track]: M.resizeItem(b[d.track] as M.Item[], d.id, d.side, toSource(d.map, timeOf(view, p.x) + d.off), b.duration) }
    } else if (d.kind === 'create') {
      const r = M.fit(b[d.track], toSource(d.map, Math.min(d.t0, t)), toSource(d.map, Math.max(d.t0, t)), b.duration)
      draft = r ? { [d.track]: [...b[d.track], A.make(d.track, r[0], r[1])] } : null
    } else if (d.kind === 'marquee') {
      selection.ids = [...new Set([...d.keep, ...marqueeHits()])]
      return
    } else return
    rebuild()
  }

  function commit(d: Drag) {
    const key = d.kind === 'trim' ? 'clips' : d.kind === 'move' || d.kind === 'resize' || d.kind === 'create' ? d.track : null
    if (!key || !draft?.[key] || JSON.stringify(draft[key]) === JSON.stringify(base![key])) return
    const next = draft[key]
    edit((p) => void Object.assign(p, { [key]: next }))
    if (d.kind === 'create') selection.ids = [(next as M.Item[]).at(-1)!.id]
    else if (d.select && d.kind !== 'move') selection.ids = [d.select] // a moved multi-selection stays selected
  }

  function click(d: Drag) {
    if (d.kind === 'cut') A.restore(d.cut.after)
    else if (d.kind === 'create') A.add(d.track, d.t0)
    else if (d.select) selection.ids = [d.select]
  }

  function cancel() {
    drag = null
    draft = null
    view.shift = null
    rebuild()
    hovered()
  }

  function marqueeRect() {
    if (drag?.kind !== 'marquee' || !drag.moved || !pointer) return null
    return { x0: xOf(view, drag.t), y0: drag.y, x1: pointer.x, y1: pointer.y }
  }

  function marqueeHits(): string[] {
    const r = marqueeRect()
    if (!r || !model) return []
    const [t0, t1] = [timeOf(view, Math.min(r.x0, r.x1)), timeOf(view, Math.max(r.x0, r.x1))]
    const [y0, y1] = [Math.min(r.y0, r.y1), Math.max(r.y0, r.y1)]
    const out: string[] = []
    for (const row of view.rows) {
      if (row.y > y1 || row.y + row.h < y0 || (row.id !== 'clips' && !isItem(row.id))) continue
      const l = model[row.id]
      const [from, to] = M.visible(l, t0, t1)
      for (let k = from; k < to; k++) if (l.blocks[k].b >= t0) out.push(idOf(row.id, l.blocks[k]))
    }
    return out
  }

  /** Hover state, cursor, and the add-item preview for the pointer's position. */
  function hovered() {
    if (!model || !pointer || drag) return
    hover = hit(view, model, pointer.x, pointer.y)
    ghost = null
    if (hover.kind === 'lane' && isItem(hover.track) && !armed()) {
      const t = outTime(pointer.x)
      const r = M.fit(model[hover.track].items, toSource(model.map, t), toSource(model.map, Math.min(t + 3, view.duration)), base!.duration)
      if (r) {
        const pieces = M.lane(model.map, [{ start: r[0], end: r[1] }]).blocks
        if (pieces.length) ghost = { track: hover.track, a: pieces[0].a, b: pieces.at(-1)!.b }
      }
    }
    cursor = hoverCursor(hover)
    requestDraw()
  }

  function hoverCursor(h: Hit): string {
    if (armed() && (h.kind === 'block' || h.kind === 'lane') && h.track === 'clips') return SCISSORS
    if (h.kind === 'block') return h.edge ? 'ew-resize' : isItem(h.track) ? 'grab' : 'default'
    if (h.kind === 'lane') return isItem(h.track) ? 'copy' : 'default'
    return h.kind === 'cut' || h.kind === 'ruler' ? 'pointer' : 'default'
  }
  const dragCursor = (d: Drag) => (d.kind === 'move' ? 'grabbing' : d.kind === 'trim' || d.kind === 'resize' ? 'ew-resize' : cursor)

  function syncAlt(down: boolean) {
    if (down === alt) return
    alt = down
    hovered()
  }

  function onkeydowncapture(e: KeyboardEvent) {
    if (e.key === 'Escape' && drag) {
      e.preventDefault()
      e.stopPropagation()
      return cancel()
    }
    if (e.key === 'Escape' && splitTool) splitTool = false
    if (e.key === 'Alt' && !consumesKey(e.target, e.key)) syncAlt(true)
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault()
    if (!model || drag) return
    const p = local(e)
    const h = hit(view, model, p.x, p.y)
    let t: Target = { kind: 'empty' }
    if (h.kind === 'block' && (h.track === 'clips' || isItem(h.track))) {
      const id = idOf(h.track, h.block)
      if (!selection.ids.includes(id)) selection.ids = [id]
      t = { kind: h.track }
    } else if (h.kind === 'lane' && isItem(h.track)) t = { kind: 'lane', track: h.track }
    menu = { x: e.clientX, y: e.clientY, t: outTime(p.x), target: t }
  }

  function closeMenu() {
    menu = null
    canvas?.focus()
  }
</script>

<svelte:window {onkeydowncapture} onkeyup={(e) => e.key === 'Alt' && syncAlt(false)} onblur={() => syncAlt(false)} />

<section class="timeline" aria-label="Timeline">
  <div class="bar" role="toolbar" aria-label="Timeline tools">
    <div class="left">
      <button class="commands" title="Command menu (⌘K)" onclick={() => run('menu.toggle')}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L16.5 16.5" /></svg>
        <span>Commands</span>
        <kbd>⌘K</kbd>
      </button>
    </div>
    <div class="center">
      <span class="time now">{M.clock(player.time)}</span>
      <button class="icon" title="Go to start" aria-label="Go to start" onclick={() => seek(0)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4.5v11" /><path class="fill" d="M15.5 4.8v10.4L8 10z" /></svg>
      </button>
      <button class="icon play" title="Play / pause (Space)" aria-label={player.playing ? 'Pause' : 'Play'} onclick={toggle}>
        {#if player.playing}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path class="fill" d="M6 4.5h2.6v11H6zM11.4 4.5H14v11h-2.6z" /></svg>
        {:else}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path class="fill" d="M7 4.3v11.4L15.6 10z" /></svg>
        {/if}
      </button>
      <button class="icon" title="Go to end" aria-label="Go to end" onclick={() => seek(duration)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 4.5v11" /><path class="fill" d="M4.5 4.8v10.4L12 10z" /></svg>
      </button>
      <span class="time">{M.clock(duration)}</span>
    </div>
    <div class="right">
      <button
        class={['icon', { armed: splitTool || alt }]}
        title="Split tool (S, or hold ⌥)"
        aria-label="Split tool"
        aria-pressed={splitTool}
        onclick={() => (splitTool = !splitTool)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5l8.5 10M14 3.5l-8.5 10" /><circle cx="5.2" cy="15.3" r="2.3" /><circle cx="14.8" cy="15.3" r="2.3" /></svg>
      </button>
      <button class="icon" title="Fit timeline (⌘0)" aria-label="Fit timeline" onclick={() => zoomTo(minPps())}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3" /></svg>
      </button>
      <input
        type="range"
        min="0"
        max="1000"
        value={zoomValue}
        aria-label="Timeline zoom"
        oninput={(e) => zoomTo(minPps() * (MAX_PPS / minPps()) ** (+e.currentTarget.value / 1000))}
      />
    </div>
  </div>
  <canvas
    {@attach setup}
    style:height="{height}px"
    style:cursor
    tabindex="0"
    aria-label="Timeline tracks. Every action is in the command menu, ⌘K."
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={cancel}
    {onpointerleave}
    {oncontextmenu}
  ></canvas>
</section>

{#if menu}
  <Menu x={menu.x} y={menu.y} t={menu.t} target={menu.target} onclose={closeMenu} />
{/if}
<CommandMenu />

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    background: #151517;
    border-top: 1px solid rgb(255 255 255 / 0.06);
  }
  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 44px;
    padding: 0 12px;
  }
  .left {
    justify-self: start;
  }
  .center {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .right {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .time {
    min-width: 76px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    opacity: 0.7;
  }
  .time.now {
    text-align: right;
    color: var(--text);
    opacity: 0.85;
  }
  button {
    border: 0;
    background: none;
    cursor: default;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    border-radius: 7px;
    color: #c8c8ce;
  }
  .icon:hover {
    background: rgb(255 255 255 / 0.07);
    color: #fff;
  }
  .icon.play {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.08);
    color: #fff;
  }
  .icon.play:hover {
    background: rgb(255 255 255 / 0.14);
  }
  .icon.armed {
    background: var(--danger);
    color: #fff;
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  svg .fill {
    fill: currentColor;
    stroke: none;
  }
  .commands {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 7px;
    border-radius: 7px;
    color: var(--text-dim);
  }
  .commands:hover {
    background: rgb(255 255 255 / 0.07);
    color: var(--text);
  }
  .commands svg {
    width: 15px;
    height: 15px;
  }
  kbd {
    padding: 0 5px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.07);
    font: 11px/17px var(--font);
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  input[type='range'] {
    width: 110px;
    height: 20px;
    margin: 0 4px 0 6px;
    background: none;
    appearance: none;
  }
  input[type='range']::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.12);
  }
  input[type='range']::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border-radius: 50%;
    background: #d8d8de;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
    appearance: none;
  }
  canvas {
    display: block;
    width: 100%;
    outline: none;
    touch-action: none;
  }
</style>
