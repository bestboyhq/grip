<!-- The editor timeline: transport and tools, one canvas for every lane, the right-click menu, and the
     ⌘K menu with the editor's shortcuts. Mounted by Editor.svelte.
     Shows OUTPUT time; items live in source time (see model.ts). Scrolling, zooming, and dragging touch
     only plain variables and redraw the canvas in the next frame: no reactive churn per frame. -->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { AudioSource, Clip } from '../../../shared/project.ts'
  import { timeMap, toSource, type TimeMap } from '../../../shared/timemap.ts'
  import { doc, edit, selection } from '../../../lib/doc.svelte.ts'
  import { pause, player, previewTime, scrub, seek, showEdge, toggle } from '../../../lib/player.svelte.ts'
  import { peaks as enginePeaks } from '../../../engine/audio/index.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import CommandMenu from '../commands/CommandMenu.svelte'
  import { consumesKey, registerCommands, run } from '../commands/registry.ts'
  import * as M from './model.ts'
  import * as A from './actions.svelte.ts'
  import { formatTime } from '../helpers.ts'
  import { tooltip } from '../../../ui/tooltip.ts'
  import { PAD, RULER, draw, hit, rows as layoutRows, thumb, timeOf, xOf, type Audio, type Hit, type View } from './draw.ts'
  import { Waveforms, type PeaksFn } from './waveform.ts'
  import Menu, { type Target } from './Menu.svelte'
  import Lens, { LENS, type LensVideo } from './Lens.svelte'

  let { peaks = enginePeaks }: { peaks?: PeaksFn } = $props()

  const MAX_PPS = 1000 // px per second: a 30 fps frame is 33 px wide
  const SETTLE = 250 // ms: a released start edge closes its gap
  const SCISSORS = `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><g fill='none' stroke-linecap='round'><g stroke='black' stroke-width='3.6'><path d='M7 3l10 13M17 3L7 16'/><circle cx='6.5' cy='18.5' r='3'/><circle cx='17.5' cy='18.5' r='3'/></g><g stroke='white' stroke-width='1.6'><path d='M7 3l10 13M17 3L7 16'/><circle cx='6.5' cy='18.5' r='3'/><circle cx='17.5' cy='18.5' r='3'/></g></g></svg>`,
  )}") 12 10, crosshair`

  type Gesture =
    | { kind: 'scrub' }
    | { kind: 'scroll'; x: number; x0: number }
    | { kind: 'trim'; i: number; side: 'start' | 'end'; lim: { lo: number; hi: number }; off: number; full: Clip[]; fine: { src: number; x: number } | null }
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
  let refit = false // the zoom animation is a fitted timeline gliding to its new length
  let closing: { at: number; by: number; t0: number } | null = null // view.shift easing to 0 after a start edge trim
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
  let mic: Audio | null = null
  let system: Audio | null = null
  let video: LensVideo | null = null // the recording the trim lens shows
  let lens: Lens | undefined
  let lensOn = false
  let shown = new Set<M.ItemTrack>() // item lanes shown so far, for the project in `lanesFor`
  let lanesFor = ''
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
  let menu: { x: number; y: number; t: number; target: Target; from?: HTMLElement } | null = $state(null) // from: the button that opened it

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
      const audio = (s: AudioSource | undefined, mix: { volume: number; muted: boolean }, voice: boolean) =>
        s && doc.path ? { url: fileUrl(`${doc.path}/${s.file}`), gain: mix.muted ? 0 : mix.volume, voice } : null
      mic = audio(p.sources.mic, p.audio.mic, p.audio.mic.enhance) // the voice as it plays: processed when enhanced
      system = audio(p.sources.system, p.audio.system, false)
      const v = p.sources.screen ?? p.sources.camera
      video = v && doc.path ? { url: fileUrl(`${doc.path}/${v.file}`), width: v.width, height: v.height, fps: v.fps } : null
      rebuild()
    })
  })

  $effect(() => {
    const events = doc.events
    untrack(() => {
      keys = M.keyChips(events) // raw state: plain already
      rebuild()
    })
  })

  $effect(() => {
    const t = doc.transcript
    const edits: Record<number, string> = doc.project ? JSON.parse(JSON.stringify(doc.project.captionEdits)) : {}
    untrack(() => {
      words = M.wordChips(t, edits)
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
    const relayout = (ids: M.TrackId[]) => {
      const r = layoutRows(ids, model!.zooms.stack)
      view.rows = r.rows
      height = r.height
    }
    if (draft) {
      // Lanes and fit stay as they were while dragging; the zoom track grows with zooms dragged onto others.
      relayout(view.rows.map((r) => r.id))
      return requestDraw()
    }
    const key = `${doc.path}|${doc.project?.createdAt}`
    if (key !== lanesFor) {
      lanesFor = key
      shown = new Set()
    }
    relayout(M.tracks(model, camera, shown))
    const fit = isFit()
    view.duration = duration = model.map.duration
    if (fit && view.pps !== minPps()) {
      // A fitted timeline stays fitted when edits change its length, gliding there instead of jumping.
      target = minPps()
      anchor = { t: 0, x: PAD, to: PAD }
      refit = true
    }
    if (key !== fitted && view.W) {
      fitted = key
      view.pps = target = minPps()
      view.x0 = 0
      anchor = null
      refit = false
    }
    clampView()
    hovered()
    requestDraw()
  }

  const minPps = () => (view.W - 2 * PAD) / Math.max(view.duration, 0.5)
  const isFit = () => view.W > 0 && (refit || (!anchor && view.pps <= minPps() * 1.0001))
  const sliderOf = (pps: number) => Math.round((1000 * Math.log(pps / minPps())) / Math.log(MAX_PPS / minPps()))

  function clampView() {
    if (!view.W) return
    const lo = minPps()
    if (view.pps < lo && !refit) view.pps = lo // a refit grows into a shorter timeline from below
    if (target < lo) target = lo
    view.x0 = M.clamp(view.x0, 0, Math.max(0, view.duration - (view.W - 2 * PAD) / view.pps))
    zoomValue = sliderOf(view.pps)
  }

  /** Animate the timeline zoom, anchored on the playhead (brought to the middle when off screen). */
  function zoomTo(pps: number) {
    if (!model || !view.W) return
    target = M.clamp(pps, minPps(), MAX_PPS)
    refit = false
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
      if (done) refit = false
      again = !done
    }
    if (closing) {
      const u = Math.min(1, (now - closing.t0) / SETTLE)
      view.shift = u < 1 ? { at: closing.at, by: closing.by * (1 - u) ** 3 } : null
      if (u < 1) again = true
      else closing = null
    }
    if (drag?.moved && pointer && drag.kind !== 'scroll' && drag.kind !== 'cut' && !(drag.kind === 'trim' && drag.fine)) {
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
        draw(ctx, { view, model, time: player.time, sel, hover, pointer, armed: armed(), dragging: !!drag, marquee: marqueeRect(), mic, system, waves })
      } else ctx.clearRect(0, 0, canvas!.width, canvas!.height)
    }
    if (drag?.kind === 'trim') showLens(drag)
    else if (lensOn) {
      lens?.hide()
      lensOn = false
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
    if (!model || lanesScroll(e)) return
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

  /** In a window too short for every lane, the editor scrolls the timeline: a vertical scroll then
   *  moves the lanes, and panning is a horizontal swipe or ⇧-scroll. */
  function lanesScroll(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return false
    for (let box = canvas?.parentElement; box; box = box.parentElement)
      if (box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(box).overflowY)) return true
    return false
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
    if (closing) {
      closing = null // a gap still closing closes now, so the press lands on what it shows
      view.shift = null
    }
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
        if (h.track === 'clips') {
          const lim = M.clipLimits(base.clips, h.block.i, base.duration)
          const full = M.trimClip(base.clips, h.block.i, h.edge, h.edge === 'start' ? lim.lo : lim.hi, lim) // the edge as far out as it goes, for the preview
          g = { kind: 'trim', i: h.block.i, side: h.edge, lim, off, full, fine: null }
        } else g = { kind: 'resize', track: h.track, id, side: h.edge, off }
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
    if (drag.kind === 'trim') {
      pause() // the preview shows the edge, not playback
      trimPreview(drag, base.clips)
    } else player.hover = null // a drag shows what it edits: the playhead's frame
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
      if (drag.kind === 'trim') lensZone(drag, pointer)
      dragTo(pointer)
    } else hovered()
    requestDraw()
  }

  function onpointerup() {
    const d = drag
    if (!d || !base) return
    drag = null
    showEdge(null)
    if (d.moved) commit(d)
    else click(d)
    draft = null
    // A start edge's gap closes in one glide rather than a jump; the timeline refits alongside (rebuild).
    closing = d.kind === 'trim' && view.shift?.by ? { ...view.shift, t0: performance.now() } : null
    if (!closing) view.shift = null
    rebuild()
    hovered()
  }

  function onpointerleave() {
    if (drag) return
    pointer = hover = player.hover = null
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
      // the rest of the timeline stays put until release, when the gap closes (ripple). In the lens the
      // pointer moves the edge at the lens's scale instead, from where it entered.
      const src = d.fine ? d.fine.src + (p.x - d.fine.x) / LENS.k : M.edgeSource(d.map, d.i, timeOf(view, p.x) + d.off)
      const clips = M.trimClip(b.clips, d.i, d.side, src, d.lim)
      draft = { clips }
      view.shift = d.side === 'start' ? { at: d.map.outStarts[d.i], by: (clips[d.i].start - c.start) / c.speed } : null
      trimPreview(d, clips)
    } else if (d.kind === 'move') {
      draft = { [d.track]: M.moveItems(b[d.track] as M.Item[], d.ids, toSource(d.map, t) - d.grab, b.duration, M.overlaps(d.track)) }
    } else if (d.kind === 'resize') {
      draft = { [d.track]: M.resizeItem(b[d.track] as M.Item[], d.id, d.side, toSource(d.map, timeOf(view, p.x) + d.off), b.duration, M.overlaps(d.track)) }
    } else if (d.kind === 'create') {
      const r = M.fit(b[d.track], toSource(d.map, Math.min(d.t0, t)), toSource(d.map, Math.max(d.t0, t)), b.duration, M.MIN_LEN, M.overlaps(d.track))
      draft = r ? { [d.track]: [...b[d.track], A.make(d.track, r[0], r[1])] } : null
    } else if (d.kind === 'marquee') {
      selection.ids = [...new Set([...d.keep, ...marqueeHits()])]
      return
    } else return
    rebuild()
  }

  /** A trim shows the moment at its edge in the preview, the one the clip now ends or starts on, so the user
   *  sees what they cut; the time readout shows where that edge sits. */
  function trimPreview(d: Extract<Drag, { kind: 'trim' }>, clips: Clip[]) {
    const src = clips[d.i][d.side]
    player.hover = M.edgeOutput(d.map, d.map.clips, d.i, src)
    showEdge({ clips: d.full, t: M.edgeOutput(d.map, d.full, d.i, src) })
  }

  /** Where the lens's bottom sits, in canvas px: just above the clip track. */
  const lensBottom = () => (view.rows.find((r) => r.id === 'clips')?.y ?? RULER) - 10

  /** Moving up into the lens trades reach for precision, and back down returns; the edge stays put either way. */
  function lensZone(d: Extract<Drag, { kind: 'trim' }>, p: { x: number; y: number }) {
    const y = lensBottom()
    const src = (draft?.clips ?? base!.clips)[d.i][d.side]
    if (!d.fine && p.y < y - 4) d.fine = { src, x: p.x }
    else if (d.fine && p.y > y + 14) {
      d.off = M.edgeOutput(d.map, d.map.clips, d.i, src) - timeOf(view, p.x)
      d.fine = null
    }
  }

  function showLens(d: Extract<Drag, { kind: 'trim' }>) {
    if (!lens || !model || !base || !canvas) return
    const c = (draft?.clips ?? base.clips)[d.i]
    const m = model.map
    const out = d.side === 'start' ? m.outStarts[d.i] : m.outStarts[d.i] + (c.end - c.start) / c.speed
    const r = canvas.getBoundingClientRect()
    const scene = { side: d.side, clip: c, was: base.clips[d.i], lim: d.lim, duration: base.duration, fine: !!d.fine, video, mic, system, waves, words }
    lens.show(scene, r.left + xOf(view, out), r.top + lensBottom(), r.left, r.right)
    lensOn = true
  }

  function commit(d: Drag) {
    const key = d.kind === 'trim' ? 'clips' : d.kind === 'move' || d.kind === 'resize' || d.kind === 'create' ? d.track : null
    if (!key || !draft?.[key] || JSON.stringify(draft[key]) === JSON.stringify(base![key])) return
    const next = draft[key]
    edit((p) => void Object.assign(p, { [key]: next }))
    if (d.kind === 'trim' && !player.playing) seek(player.time) // the playhead stays put; the saved source moment follows what it shows (pausing saves it while playing)
    if (d.kind === 'create') selection.ids = [(next as M.Item[]).at(-1)!.id]
    else if (d.select && d.kind !== 'move') selection.ids = [d.select] // a moved multi-selection stays selected
  }

  function click(d: Drag) {
    if (d.kind === 'cut') A.restore(d.cut.after)
    else if (d.kind === 'marquee') selection.ids = d.keep // a plain click on empty space deselects
    else if (d.select) selection.ids = [d.select]
    if (d.kind === 'create') seek(d.t0) // a click on an item lane or item moves the playhead; dragging makes a new item
    else if (d.kind === 'move') seek(outTime(d.sx))
  }

  function cancel() {
    drag = null
    showEdge(null)
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
    if (hover.kind === 'block' && hover.track === 'clips' && hover.edge) lens?.warm(video) // its frames are ready when the trim starts
    // Hover scrub: the preview shows the moment under the pointer while paused; the playhead stays put.
    player.hover = player.playing || hover.kind === 'scrollbar' || hover.kind === 'none' ? null : outTime(pointer.x)
    cursor = hoverCursor(hover)
    requestDraw()
  }

  function hoverCursor(h: Hit): string {
    if (armed() && (h.kind === 'block' || h.kind === 'lane') && h.track === 'clips') return SCISSORS
    if (h.kind === 'block') return h.edge ? 'ew-resize' : isItem(h.track) ? 'grab' : 'default'
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
    const back = menu?.from ?? canvas
    menu = null
    back?.focus()
  }

  /** The add menu, under its button; a second click closes it. */
  function openAdd(e: MouseEvent) {
    if (menu?.target.kind === 'add') return closeMenu()
    const from = e.currentTarget as HTMLElement
    const r = from.getBoundingClientRect()
    menu = { x: r.left, y: r.bottom + 4, t: player.time, target: { kind: 'add' }, from }
  }
</script>

<svelte:window {onkeydowncapture} onkeyup={(e) => e.key === 'Alt' && syncAlt(false)} onblur={() => syncAlt(false)} />

<section class="timeline" aria-label="Timeline">
  <div class="bar" role="toolbar" aria-label="Timeline tools">
    <div class="left">
      <button class="labeled" onclick={() => run('menu.toggle')}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="M12.5 12.5L16.5 16.5" /></svg>
        <span>Commands</span>
        <kbd>⌘K</kbd>
      </button>
      <button class="labeled" aria-haspopup="menu" aria-expanded={menu?.target.kind === 'add'} onclick={openAdd} {@attach tooltip('Add a zoom, camera layout, or blur at the playhead')}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" /></svg>
        <span>Add</span>
      </button>
      <button class="labeled" onclick={() => run('timeline.cut')} {@attach tooltip('Cut at playhead', 'C')}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="6.5" width="5" height="7" rx="1.5" /><rect x="12.5" y="6.5" width="5" height="7" rx="1.5" /><path d="M10 3v14" /></svg>
        <span>Cut</span>
        <kbd>⌘B</kbd>
      </button>
    </div>
    <div class="center">
      <span class="time now">{formatTime(previewTime())}</span>
      <button class="icon" {@attach tooltip('Go to start')} aria-label="Go to start" onclick={() => seek(0)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4.5v11" /><path class="fill" d="M15.5 4.8v10.4L8 10z" /></svg>
      </button>
      <button class="icon play" {@attach tooltip(player.playing ? 'Pause' : 'Play', 'Space')} aria-label={player.playing ? 'Pause' : 'Play'} onclick={toggle}>
        {#if player.playing}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path class="fill" d="M6 4.5h2.6v11H6zM11.4 4.5H14v11h-2.6z" /></svg>
        {:else}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path class="fill" d="M7 4.3v11.4L15.6 10z" /></svg>
        {/if}
      </button>
      <button class="icon" {@attach tooltip('Go to end')} aria-label="Go to end" onclick={() => seek(duration)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 4.5v11" /><path class="fill" d="M4.5 4.8v10.4L12 10z" /></svg>
      </button>
      <span class="time">{formatTime(duration)}</span>
    </div>
    <div class="right">
      <button
        class={['icon', { armed: splitTool || alt }]}
        aria-label="Split tool"
        aria-pressed={splitTool}
        onclick={() => (splitTool = !splitTool)}
        {@attach tooltip('Split tool, or hold ⌥', 'S')}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5l8.5 10M14 3.5l-8.5 10" /><circle cx="5.2" cy="15.3" r="2.3" /><circle cx="14.8" cy="15.3" r="2.3" /></svg>
      </button>
      <button class="icon" {@attach tooltip('Fit timeline', '⌘0')} aria-label="Fit timeline" onclick={() => zoomTo(minPps())}>
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
  <Menu x={menu.x} y={menu.y} t={menu.t} target={menu.target} trigger={menu.from} onclose={closeMenu} />
{/if}
<CommandMenu />
<Lens bind:this={lens} redraw={requestDraw} />

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    background: var(--surface-root);
  }
  .bar {
    position: sticky; /* the transport stays put while lanes scroll in a short window */
    top: 0;
    z-index: 1;
    background: inherit;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 44px;
    padding: 0 12px;
  }
  .left {
    justify-self: start;
    display: flex;
    gap: 4px;
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
    color: var(--fg-faint);
  }
  .time.now {
    text-align: right;
    color: var(--fg-default);
  }
  button {
    border: 0;
    background: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--fg-secondary);
  }
  .icon:hover {
    background: var(--surface-hover);
    color: var(--fg-default);
  }
  .icon.play {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--surface-100);
    box-shadow: var(--hairline);
    color: var(--fg-default);
  }
  .icon.play:hover {
    background: var(--surface-hover);
  }
  .icon.armed {
    background: var(--error-content);
    color: var(--color-white);
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
  .labeled {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 7px;
    border-radius: var(--radius-sm);
    color: var(--fg-secondary);
  }
  .labeled:hover,
  .labeled[aria-expanded='true'] {
    background: var(--surface-hover);
    color: var(--fg-default);
  }
  .labeled svg {
    width: 15px;
    height: 15px;
  }
  kbd {
    padding: 0 5px;
    border-radius: var(--radius-xs);
    background: var(--surface-150);
    font: 11px/17px var(--font);
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--brand);
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
    background: var(--surface-200);
  }
  input[type='range']::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border-radius: 50%;
    background: var(--color-white);
    box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.35), 0 1px 3px rgb(0 0 0 / 0.45);
    appearance: none;
  }
  canvas {
    display: block;
    width: 100%;
    outline: none;
    touch-action: none;
  }
</style>
