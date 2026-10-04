// The timeline canvas: geometry, drawing, and hit testing. One canvas draws the ruler, every lane,
// waveforms, and overlays; only blocks in view are visited (binary search) and sub-pixel blocks are
// merged, so a frame costs the same for a 2-minute and a 2-hour project.

import type { CameraLayout, Clip, Mask, Zoom } from '../../../shared/project.ts'
import * as M from './model.ts'
import type { Waveforms } from './waveform.ts'

export const PAD = 16 // px before output time 0 and after the end
export const RULER = 38 // playhead knob on top, labels, tick dots
const TOP = RULER + 4
const GAP = 6
const BOTTOM = 16
const HEIGHTS: Record<M.TrackId, number> = { clips: 52, zooms: 36, layouts: 26, masks: 26, keys: 20, captions: 20 }
const EDGE = 8 // px of a block's end that grabs the edge

export interface Row {
  id: M.TrackId
  y: number
  h: number
}

export function rows(ids: M.TrackId[]): { rows: Row[]; height: number } {
  let y = TOP
  const out = ids.map((id) => {
    const r = { id, y, h: HEIGHTS[id] }
    y += r.h + GAP
    return r
  })
  return { rows: out, height: y - GAP + BOTTOM }
}

export interface View {
  W: number
  H: number
  dpr: number
  x0: number // output seconds at x = PAD
  pps: number // px per output second
  duration: number // output seconds
  shift: { at: number; by: number } | null // left-edge clip trim: times >= at drawn `by` seconds later
  rows: Row[]
}

const shiftOf = (v: View, t: number) => (v.shift && t >= v.shift.at - 1e-9 ? v.shift.by : 0)
export const xOf = (v: View, t: number) => PAD + (t + shiftOf(v, t) - v.x0) * v.pps
export const timeOf = (v: View, x: number) => v.x0 + (x - PAD) / v.pps
/** A block's screen span; one shift for the whole block (pieces never straddle the trim pivot). */
export function xs(v: View, b: M.Block): [number, number] {
  const off = shiftOf(v, b.a)
  return [PAD + (b.a + off - v.x0) * v.pps, PAD + (b.b + off - v.x0) * v.pps]
}

/** Scrollbar thumb, or null when everything fits. */
export function thumb(v: View): { x: number; w: number } | null {
  const track = v.W - 2 * PAD
  const vis = track / v.pps
  if (vis >= v.duration - 1e-6) return null
  const w = Math.max(28, (track * vis) / v.duration)
  return { x: PAD + (track - w) * Math.min(1, Math.max(0, v.x0 / (v.duration - vis))), w }
}

// ---- Hit testing ----

export type Hit =
  | { kind: 'ruler' }
  | { kind: 'cut'; cut: M.Cut }
  | { kind: 'scrollbar' }
  | { kind: 'block'; track: M.TrackId; block: M.Block; edge: 'start' | 'end' | null }
  | { kind: 'lane'; track: M.TrackId }
  | { kind: 'none' }

let pills: Array<{ x0: number; x1: number; cut: M.Cut }> = [] // cut markers as last drawn

export function hit(v: View, m: M.Model, x: number, y: number): Hit {
  if (y < RULER) {
    const p = y >= RULER - 16 && pills.find((p) => x >= p.x0 && x <= p.x1)
    return p ? { kind: 'cut', cut: p.cut } : { kind: 'ruler' }
  }
  const th = thumb(v)
  if (th && y >= v.H - BOTTOM + 4 && x >= th.x - 4 && x <= th.x + th.w + 4) return { kind: 'scrollbar' }
  const row = v.rows.find((r) => y >= r.y - GAP / 2 && y < r.y + r.h + GAP / 2)
  if (!row) return { kind: 'none' }
  const b = M.blockAt(m[row.id], timeOf(v, x), 4 / v.pps)
  if (!b) return { kind: 'lane', track: row.id }
  let edge: 'start' | 'end' | null = null
  if (row.id !== 'keys' && row.id !== 'captions') {
    const [xa, xb] = xs(v, b)
    const ez = Math.min(EDGE, (xb - xa) / 3)
    if (b.head && x >= xa - 4 && x <= xa + ez) edge = 'start'
    else if (b.tail && x >= xb - ez && x <= xb + 4) edge = 'end'
  }
  return { kind: 'block', track: row.id, block: b, edge }
}

// ---- Drawing ----

export interface Audio {
  url: string
  gain: number
}

export interface Scene {
  view: View
  model: M.Model
  time: number // playhead, output seconds
  sel: Set<string>
  hover: Hit | null
  pointer: { x: number; y: number } | null
  armed: boolean // split tool
  dragging: boolean
  ghost: { track: M.ItemTrack; a: number; b: number } | null // where a click would add an item
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
  mic: Audio | null
  system: Audio | null
  waves: Waveforms
}

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
const F_RULER = `500 10px ${FONT}`
const F_TITLE = `600 11px ${FONT}`
const F_META = `500 10.5px ${FONT}`
const F_SMALL = `500 10px ${FONT}`

const C = {
  rulerText: '#85858f',
  major: 'rgba(255,255,255,0.32)',
  minor: 'rgba(255,255,255,0.14)',
  grid: 'rgba(255,255,255,0.035)',
  lane: 'rgba(255,255,255,0.03)',
  hint: 'rgba(255,255,255,0.3)',
  clip: '#7a581d',
  clipEdge: 'rgba(255,214,128,0.22)',
  clipSel: '#ffc94f',
  clipCap: 'rgba(255,224,150,0.5)',
  clipText: 'rgba(255,246,228,0.97)',
  clipMeta: 'rgba(255,236,204,0.72)',
  pill: 'rgba(255,255,255,0.16)',
  wave: 'rgba(255,224,160,0.34)',
  waveSys: 'rgba(255,224,160,0.15)',
  zooms: ['#5946e8', '#7768ff'],
  zoomOff: ['#34333d', '#46454f'],
  layouts: ['#16785f', '#22a07f'],
  masks: ['#9c3a5c', '#c4527a'],
  capHot: 'rgba(255,255,255,0.55)',
  text: '#ffffff',
  textOff: 'rgba(255,255,255,0.45)',
  meta: 'rgba(255,255,255,0.72)',
  sel: 'rgba(255,255,255,0.92)',
  chip: '#2b2b31',
  chipEdge: 'rgba(255,255,255,0.08)',
  chipText: '#d6d6dc',
  chipDim: '#202024',
  chipDimText: '#7c7c85',
  word: '#29292f',
  filler: 'rgba(255,95,87,0.16)', // filler words: the ones worth cutting
  playhead: '#8d80ff',
  ghost: 'rgba(255,255,255,0.22)',
  split: '#ff5f57',
  cut: '#f2b33d',
  cutHot: '#ffcc66',
  cutText: '#3b2904',
  marquee: 'rgba(141,128,255,0.12)',
  marqueeEdge: 'rgba(141,128,255,0.75)',
  scroll: 'rgba(255,255,255,0.16)',
  scrollHot: 'rgba(255,255,255,0.32)',
}

const HINTS: Record<M.ItemTrack, string> = {
  zooms: 'Click or drag to add a zoom',
  layouts: 'Click or drag to add a camera layout',
  masks: 'Click or drag to add a mask or highlight',
}
const LAYOUT_NAMES: Record<CameraLayout['kind'], [string, string]> = {
  pip: ['Picture in picture', 'PiP'],
  fullscreen: ['Fullscreen camera', 'Full'],
  split: ['Split screen', 'Split'],
  hidden: ['Camera hidden', 'Hidden'],
}
const MASK_NAMES: Record<Mask['kind'], string> = { blur: 'Blur', pixelate: 'Pixelate', highlight: 'Highlight' }

/** Draw times of recent frames, for the lab's frame-time measurements. */
export const stats = { ms: new Float32Array(600), n: 0 }

const widths = new Map<string, number>()
function measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = font + '\n' + text
  let w = widths.get(key)
  if (w === undefined) {
    ctx.font = font
    w = ctx.measureText(text).width
    if (widths.size > 50000) widths.clear()
    widths.set(key, w)
  }
  return w
}

export function draw(ctx: CanvasRenderingContext2D, s: Scene) {
  const t0 = performance.now()
  const v = s.view
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0)
  ctx.clearRect(0, 0, v.W, v.H)
  const slack = v.shift ? Math.abs(v.shift.by) : 0
  const tA = timeOf(v, 0) - slack
  const tB = timeOf(v, v.W) + slack
  const last = v.rows[v.rows.length - 1]
  const bottom = last ? last.y + last.h : RULER

  ruler(ctx, s, bottom)
  for (const row of v.rows) {
    if (row.id === 'clips') clipLane(ctx, s, row, tA, tB)
    else if (row.id === 'keys' || row.id === 'captions') chipLane(ctx, s, row, tA, tB)
    else itemLane(ctx, s, row, row.id, tA, tB)
  }
  cutMarks(ctx, s, tA, tB)
  overlays(ctx, s, bottom)

  stats.ms[stats.n++ % stats.ms.length] = performance.now() - t0
}

function ruler(ctx: CanvasRenderingContext2D, s: Scene, bottom: number) {
  const v = s.view
  const { major, minor } = M.ticks(v.pps)
  const hours = v.duration >= 3600
  const k0 = Math.max(0, Math.ceil(timeOf(v, 0) / minor))
  const k1 = Math.floor(Math.min(timeOf(v, v.W), v.duration) / minor)
  ctx.font = F_RULER
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  for (let k = k0; k <= k1; k++) {
    const t = k * minor
    const x = snap(v, PAD + (t - v.x0) * v.pps)
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6
    if (isMajor) {
      ctx.fillStyle = C.rulerText
      const text = M.label(t, major, hours)
      const half = measure(ctx, F_RULER, text) / 2 + 2
      ctx.font = F_RULER
      ctx.fillText(text, M.clamp(x, half, v.W - half), 24) // the first and last labels stay whole
      ctx.fillStyle = C.major
      dot(ctx, x, 31, 1.25)
      ctx.fillStyle = C.grid
      ctx.fillRect(x, RULER, 1, bottom - RULER)
    } else {
      ctx.fillStyle = C.minor
      dot(ctx, x, 31, 1)
    }
  }
}

function clipLane(ctx: CanvasRenderingContext2D, s: Scene, row: Row, tA: number, tB: number) {
  const v = s.view
  const l = s.model.clips
  const [from, to] = M.visible(l, tA, tB)
  const run = merger(ctx, C.clip, row)
  for (let k = from; k < to; k++) {
    const b = l.blocks[k]
    if (b.b < tA) continue
    const [ba, bb] = xs(v, b)
    const xa = ba + 1
    const xb = bb - 1 // 2 px gutter between abutting clips
    if (xb - xa < 4) run.add(xa, xb)
    else {
      run.flush()
      clipBlock(ctx, s, row, l.items[b.i], b, xa, xb)
    }
  }
  run.flush()
}

function clipBlock(ctx: CanvasRenderingContext2D, s: Scene, row: Row, c: Clip, b: M.Block, xa: number, xb: number) {
  const v = s.view
  const { y, h } = row
  xa = snap(v, xa)
  xb = snap(v, xb)
  const w = xb - xa
  const sel = s.sel.has(c.id)
  ctx.beginPath()
  ctx.roundRect(xa, y, w, h, Math.min(8, w / 2))
  ctx.fillStyle = C.clip
  ctx.fill()
  if (w > 6 && (s.mic || s.system)) {
    ctx.save()
    ctx.clip()
    wave(ctx, s, c, b, xa, xb, y, h)
    ctx.restore()
  }
  const hv = s.hover?.kind === 'block' && s.hover.block === b && !s.armed ? s.hover.edge : null
  if (hv) cap(ctx, hv === 'start' ? xa : xb - 4, y + 6, 4, h - 12, C.clipCap)
  ctx.beginPath()
  ctx.roundRect(xa + 0.5, y + 0.5, w - 1, h - 1, Math.min(7.5, w / 2))
  ctx.lineWidth = 1
  ctx.strokeStyle = C.clipEdge
  ctx.stroke()
  if (sel) {
    ctx.beginPath()
    ctx.roundRect(xa + 1, y + 1, w - 2, h - 2, Math.min(7, w / 2))
    ctx.lineWidth = 2
    ctx.strokeStyle = C.clipSel
    ctx.stroke()
  }

  // Labels stay centered in the visible part of a long clip.
  const cx = sticky(v, xa, xb)
  const len = (c.end - c.start) / c.speed
  const meta: Seg[] = [{ text: M.span(len), font: F_META, color: C.clipMeta }]
  meta.push({ icon: gauge, text: `${c.speed}×`, font: F_META, color: c.speed === 1 ? C.clipMeta : C.clipText, pill: c.speed === 1 ? undefined : C.pill })
  if (c.muted || c.volume !== 1) {
    meta.push({ icon: c.muted || c.volume === 0 ? mute : speaker, text: c.muted ? '' : `${Math.round(c.volume * 100)}%`, font: F_META, color: C.clipText, pill: C.pill })
  }
  const title: Seg[] = [{ icon: film, text: 'Clip', font: F_TITLE, color: C.clipText }]
  if (w > 20) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(xa + 4, y, w - 8, h)
    ctx.clip()
    if (fitsRow(ctx, title, w - 16) && fitsRow(ctx, meta, w - 16)) {
      row1(ctx, title, cx, y + 18)
      row1(ctx, meta, cx, y + 33)
    } else {
      const compact = c.speed === 1 ? [meta[0]] : [meta[1]]
      if (fitsRow(ctx, compact, w - 8)) row1(ctx, compact, cx, y + 22)
    }
    ctx.restore()
    if (w > 200) {
      ctx.font = F_SMALL
      ctx.fillStyle = C.clipMeta
      ctx.textAlign = 'left'
      if (xa > -40) ctx.fillText(M.label(c.start, 1, false), xa + 9, y + 15) // source in and out, above the waveform
      ctx.textAlign = 'right'
      if (xb < v.W + 40) ctx.fillText(M.label(c.end, 1, false), xb - 9, y + 15)
    }
  }
}

function wave(ctx: CanvasRenderingContext2D, s: Scene, c: Clip, b: M.Block, xa: number, xb: number, y: number, h: number) {
  const v = s.view
  const off = shiftOf(v, b.a)
  const perPx = c.speed / v.pps // source seconds per px
  const level = s.waves.level(perPx)
  const base = y + h - 1
  const max = h * 0.42 // stays under the labels
  const x0 = Math.max(Math.floor(xa), 0)
  const x1 = Math.min(Math.ceil(xb), v.W)
  for (const [src, color] of [[s.system, C.waveSys], [s.mic, C.wave]] as const) {
    const gain = src ? src.gain * (c.muted ? 0 : c.volume) : 0
    if (!src || gain <= 0) continue
    ctx.beginPath()
    ctx.moveTo(x0, base)
    for (let x = x0; x <= x1; x++) {
      const s0 = c.start + (timeOf(v, x) - off - b.a) * c.speed
      const p = s0 < c.start || s0 >= c.end ? 0 : s.waves.peak(src.url, level, s0, s0 + perPx)
      ctx.lineTo(x, base - (p > 0 ? Math.min(1, Math.sqrt(p * gain)) * max : 0))
    }
    ctx.lineTo(x1, base)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }
}

function itemLane(ctx: CanvasRenderingContext2D, s: Scene, row: Row, track: M.ItemTrack, tA: number, tB: number) {
  const v = s.view
  const l = s.model[track]
  const la = Math.max(xOf(v, 0), -8)
  const lb = Math.min(xOf(v, s.model.map.duration), v.W + 8)
  if (lb > la) {
    ctx.beginPath()
    ctx.roundRect(la, row.y, lb - la, row.h, 7)
    ctx.fillStyle = C.lane
    ctx.fill()
  }
  if (!l.items.length && lb - la > 160) {
    ctx.font = F_META
    ctx.textAlign = 'center'
    ctx.fillStyle = C.hint
    ctx.fillText(HINTS[track], (la + lb) / 2, row.y + row.h / 2 + 4)
  }
  const [from, to] = M.visible(l, tA, tB)
  const run = merger(ctx, C[track][0], row)
  for (let k = from; k < to; k++) {
    const b = l.blocks[k]
    if (b.b < tA) continue
    const [xa, xb] = xs(v, b)
    if (xb - xa < 3) run.add(xa, xb)
    else {
      run.flush()
      itemBlock(ctx, s, row, track, l.items[b.i] as M.Item, b, xa, xb)
    }
  }
  run.flush()
}

function itemBlock(ctx: CanvasRenderingContext2D, s: Scene, row: Row, track: M.ItemTrack, it: M.Item, b: M.Block, xa: number, xb: number) {
  const v = s.view
  const { y, h } = row
  xa = snap(v, xa)
  xb = snap(v, xb)
  const w = xb - xa
  const zoom = track === 'zooms' ? (it as Zoom) : null
  const [fill, capColor] = zoom ? (zoom.enabled ? C.zooms : C.zoomOff) : C[track as 'layouts' | 'masks']
  const r = Math.min(track === 'zooms' ? 8 : 6, w / 2)
  const radii = [b.head ? r : 1.5, b.tail ? r : 1.5, b.tail ? r : 1.5, b.head ? r : 1.5] // cut pieces get square inner ends
  ctx.beginPath()
  ctx.roundRect(xa, y, w, h, radii)
  ctx.fillStyle = fill
  ctx.fill()
  const hv = s.hover?.kind === 'block' && s.hover.block === b ? s.hover.edge : null
  const cw = Math.min(6, w / 4)
  if (b.head || b.tail) {
    ctx.save()
    ctx.clip()
    if (b.head) cap(ctx, xa, y, cw, h, hv === 'start' ? C.capHot : capColor)
    if (b.tail) cap(ctx, xb - cw, y, cw, h, hv === 'end' ? C.capHot : capColor)
    ctx.restore()
  }
  if (s.sel.has(it.id)) {
    ctx.beginPath()
    ctx.roundRect(xa + 1, y + 1, w - 2, h - 2, radii.map((x) => Math.max(0, x - 1)))
    ctx.lineWidth = 2
    ctx.strokeStyle = C.sel
    ctx.stroke()
  }
  if (w < 18) return
  const cx = sticky(v, xa + cw, xb - cw)
  const room = w - 2 * cw - 8
  ctx.save()
  ctx.beginPath()
  ctx.rect(xa + cw, y, w - 2 * cw, h)
  ctx.clip()
  if (zoom) {
    const on = zoom.enabled
    const how = zoom.mode === 'loupe' ? 'Loupe' : zoom.target.kind === 'point' ? 'Manual' : 'Auto'
    const title: Seg[] = [{ icon: magnifier, text: on ? 'Zoom' : 'Zoom off', font: F_TITLE, color: on ? C.text : C.textOff }]
    const meta: Seg[] = [
      { text: `${zoom.level}×`, font: F_META, color: on ? C.meta : C.textOff },
      { icon: zoom.target.kind === 'point' ? target : arrow, text: how, font: F_META, color: on ? C.meta : C.textOff },
    ]
    if (fitsRow(ctx, title, room) && fitsRow(ctx, meta, room)) {
      row1(ctx, title, cx, y + 15)
      row1(ctx, meta, cx, y + 28)
    } else if (fitsRow(ctx, [meta[0]], room)) row1(ctx, [meta[0]], cx, y + h / 2 + 4)
  } else {
    const [long, short] = track === 'layouts' ? LAYOUT_NAMES[(it as CameraLayout).kind] : [MASK_NAMES[(it as Mask).kind], MASK_NAMES[(it as Mask).kind]]
    const icon = track === 'layouts' ? camera : maskIcon
    const full: Seg[] = [{ icon, text: long, font: F_TITLE, color: C.text }]
    const brief: Seg[] = [{ text: short, font: F_TITLE, color: C.text }]
    const pick = fitsRow(ctx, full, room) ? full : fitsRow(ctx, brief, room) ? brief : null
    if (pick) row1(ctx, pick, cx, y + h / 2 + 4)
  }
  ctx.restore()
}

function chipLane(ctx: CanvasRenderingContext2D, s: Scene, row: Row, tA: number, tB: number) {
  const v = s.view
  const l = s.model[row.id as M.ChipTrack]
  const keys = row.id === 'keys'
  const [from, to] = M.visible(l, tA, tB)
  const run = merger(ctx, keys ? C.chip : C.word, row)
  ctx.textAlign = 'center'
  for (let k = from; k < to; k++) {
    const b = l.blocks[k]
    if (b.b < tA) continue
    const chip = l.items[b.i]
    let [xa, xb] = xs(v, b)
    const tw = measure(ctx, F_SMALL, chip.label)
    if (keys && !chip.dim && xb - xa >= 3) xb = Math.max(xb, xa + tw + 12) // keycaps show their label
    if (xb - xa < 3) {
      run.add(xa, xb)
      continue
    }
    run.flush()
    const w = xb - xa - 1
    ctx.beginPath()
    ctx.roundRect(snap(v, xa), row.y + (keys ? 0 : 2), w, row.h - (keys ? 0 : 4), Math.min(keys ? 5 : 4, w / 2))
    ctx.fillStyle = keys ? (chip.dim ? C.chipDim : C.chip) : chip.dim ? C.filler : C.word
    ctx.fill()
    if (keys && !chip.dim) {
      ctx.strokeStyle = C.chipEdge
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (tw + 8 <= w) {
      ctx.font = F_SMALL
      ctx.fillStyle = chip.dim ? C.chipDimText : C.chipText
      ctx.fillText(chip.label, (xa + xb) / 2, row.y + row.h / 2 + 3.5)
    }
  }
  run.flush()
}

function cutMarks(ctx: CanvasRenderingContext2D, s: Scene, tA: number, tB: number) {
  const v = s.view
  const clips = v.rows.find((r) => r.id === 'clips')
  pills = []
  if (!clips) return
  const cuts = s.model.cuts.filter((c) => c.t >= tA && c.t <= tB)
  const at = cuts.map((c) => snap(v, xOf(v, c.t)))
  let notch = -Infinity
  let right = -Infinity
  ctx.textAlign = 'left'
  cuts.forEach((c, k) => {
    const x = at[k]
    if (x - notch >= 4) {
      ctx.fillStyle = C.cut
      ctx.fillRect(x - 1, clips.y - 3, 2, 3) // every cut gets a notch, spaced at least 4 px
      notch = x
    }
    // A pill only where the cut has room on both sides: dense cuts would bury the ruler.
    const text = M.span(c.removed)
    const w = 26 + measure(ctx, F_SMALL, text)
    const l = M.clamp(x - w / 2, 2, v.W - w - 2) // the pill stays whole, its pointer stays on the cut
    if (x - (at[k - 1] ?? -Infinity) < w + 12 || (at[k + 1] ?? Infinity) - x < w + 12 || l < right + 4) return
    right = l + w
    pills.push({ x0: l, x1: l + w, cut: c })
    const hot = s.hover?.kind === 'cut' && s.hover.cut === c
    const y = RULER - 15
    ctx.fillStyle = hot ? C.cutHot : C.cut
    ctx.beginPath()
    ctx.roundRect(l, y, w, 15, 7.5)
    ctx.moveTo(x - 4, y + 14)
    ctx.lineTo(x, y + 19)
    ctx.lineTo(x + 4, y + 14)
    ctx.fill()
    ctx.strokeStyle = C.cutText
    ctx.fillStyle = C.cutText
    scissors(ctx, l + 6, y + 3, 9)
    ctx.font = F_SMALL
    ctx.fillText(text, l + 19, y + 11)
  })
}

function overlays(ctx: CanvasRenderingContext2D, s: Scene, bottom: number) {
  const v = s.view
  if (s.ghost) {
    const row = v.rows.find((r) => r.id === s.ghost!.track)!
    const xa = snap(v, xOf(v, s.ghost.a))
    const xb = snap(v, xOf(v, s.ghost.b))
    ctx.beginPath()
    ctx.roundRect(xa + 0.5, row.y + 0.5, xb - xa - 1, row.h - 1, 7)
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fill()
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
    if (xb - xa > 20) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      plus(ctx, (xa + xb) / 2, row.y + row.h / 2, 4)
    }
  }
  if (s.marquee) {
    const { x0, y0, x1, y1 } = s.marquee
    ctx.fillStyle = C.marquee
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
    ctx.strokeStyle = C.marqueeEdge
    ctx.lineWidth = 1
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0))
  }
  const p = s.pointer
  if (p && !s.dragging && p.y < bottom + 4) {
    const x = snap(v, p.x)
    if (s.armed) {
      ctx.fillStyle = C.split
      ctx.fillRect(x - 0.75, 4, 1.5, bottom - 4)
      dot(ctx, x, 8, 4)
    } else if (timeOf(v, p.x) >= 0 && timeOf(v, p.x) <= v.duration) {
      ctx.fillStyle = C.ghost
      ctx.fillRect(x - 0.5, RULER - 4, 1, bottom - RULER + 4)
      dot(ctx, x, 8, 3.5)
    }
  }
  const x = snap(v, PAD + (s.time - v.x0) * v.pps) // unshifted: the playhead stays put while trimming
  if (x > -8 && x < v.W + 8) {
    ctx.fillStyle = C.playhead
    ctx.fillRect(x - 0.75, 8, 1.5, bottom - 8 + 4)
    dot(ctx, x, 8, 5.5)
    ctx.fillStyle = '#fff'
    dot(ctx, x, 8, 2)
  }
  const th = thumb(v)
  if (th) {
    const hot = s.hover?.kind === 'scrollbar'
    ctx.fillStyle = hot ? C.scrollHot : C.scroll
    ctx.beginPath()
    ctx.roundRect(th.x, v.H - 8, th.w, hot ? 6 : 4, 3)
    ctx.fill()
  }
}

// ---- Primitives ----

const snap = (v: View, x: number) => Math.round(x * v.dpr) / v.dpr
const sticky = (v: View, xa: number, xb: number) => (Math.max(xa, 0) + Math.min(xb, v.W)) / 2

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function cap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

/** Blocks narrower than a few px merge into runs: at most one rect per pixel column per lane. */
function merger(ctx: CanvasRenderingContext2D, color: string, row: Row) {
  let a = 0
  let b = -Infinity
  const flush = () => {
    if (b > -Infinity) {
      ctx.fillStyle = color
      ctx.fillRect(a, row.y + 2, Math.max(1, b - a), row.h - 4)
    }
    b = -Infinity
  }
  return {
    add(xa: number, xb: number) {
      if (xa > b + 1) {
        flush()
        a = xa
      }
      b = Math.max(b, xb)
    },
    flush,
  }
}

type Icon = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void
interface Seg {
  icon?: Icon
  text: string
  font: string
  color: string
  pill?: string
}

function segWidth(ctx: CanvasRenderingContext2D, g: Seg) {
  return (g.icon ? 11 + (g.text ? 4 : 0) : 0) + (g.text ? measure(ctx, g.font, g.text) : 0) + (g.pill ? 10 : 0)
}
function rowWidth(ctx: CanvasRenderingContext2D, segs: Seg[]) {
  return segs.reduce((w, g, i) => w + segWidth(ctx, g) + (i ? 6 : 0), 0)
}
const fitsRow = (ctx: CanvasRenderingContext2D, segs: Seg[], room: number) => rowWidth(ctx, segs) <= room

/** Draw segments centered on cx, text baseline at y. */
function row1(ctx: CanvasRenderingContext2D, segs: Seg[], cx: number, y: number) {
  let x = cx - rowWidth(ctx, segs) / 2
  ctx.textAlign = 'left'
  for (const g of segs) {
    const w = segWidth(ctx, g)
    if (g.pill) {
      ctx.fillStyle = g.pill
      ctx.beginPath()
      ctx.roundRect(x, y - 11, w, 15, 4)
      ctx.fill()
      x += 5
    }
    ctx.fillStyle = g.color
    ctx.strokeStyle = g.color
    if (g.icon) {
      g.icon(ctx, x, y - 9, 11)
      x += 11 + (g.text ? 4 : 0)
    }
    if (g.text) {
      ctx.font = g.font
      ctx.fillText(g.text, x, y)
      x += measure(ctx, g.font, g.text)
    }
    x += (g.pill ? 5 : 0) + 6
  }
}

// Icons: our own line drawings on an s x s box, stroked in the current color.
function line(ctx: CanvasRenderingContext2D, draw: () => void, width = 1.2) {
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  draw()
  ctx.stroke()
}
const film: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.roundRect(x + 0.5, y + 1.5, s - 1, s - 3, 1.5)
    ctx.moveTo(x + s * 0.3, y + 1.5)
    ctx.lineTo(x + s * 0.3, y + s - 1.5)
    ctx.moveTo(x + s * 0.7, y + 1.5)
    ctx.lineTo(x + s * 0.7, y + s - 1.5)
  })
const gauge: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.arc(x + s / 2, y + s / 2 + 0.5, s / 2 - 0.5, Math.PI * 0.8, Math.PI * 2.2)
    ctx.moveTo(x + s / 2, y + s / 2 + 0.5)
    ctx.lineTo(x + s * 0.78, y + s * 0.25)
  })
const speaker: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.moveTo(x + 1, y + s * 0.38)
    ctx.lineTo(x + s * 0.3, y + s * 0.38)
    ctx.lineTo(x + s * 0.55, y + s * 0.12)
    ctx.lineTo(x + s * 0.55, y + s * 0.88)
    ctx.lineTo(x + s * 0.3, y + s * 0.62)
    ctx.lineTo(x + 1, y + s * 0.62)
    ctx.closePath()
    ctx.moveTo(x + s * 0.75, y + s * 0.32)
    ctx.quadraticCurveTo(x + s * 0.88, y + s * 0.5, x + s * 0.75, y + s * 0.68)
  })
const mute: Icon = (ctx, x, y, s) => {
  speaker(ctx, x - 1, y, s * 0.9)
  line(ctx, () => {
    ctx.moveTo(x + s * 0.7, y + s * 0.35)
    ctx.lineTo(x + s, y + s * 0.65)
    ctx.moveTo(x + s, y + s * 0.35)
    ctx.lineTo(x + s * 0.7, y + s * 0.65)
  })
}
const magnifier: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.arc(x + s * 0.42, y + s * 0.42, s * 0.32, 0, Math.PI * 2)
    ctx.moveTo(x + s * 0.66, y + s * 0.66)
    ctx.lineTo(x + s * 0.92, y + s * 0.92)
  }, 1.4)
const arrow: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.moveTo(x + s * 0.22, y + s * 0.08)
    ctx.lineTo(x + s * 0.22, y + s * 0.86)
    ctx.lineTo(x + s * 0.42, y + s * 0.66)
    ctx.lineTo(x + s * 0.58, y + s * 0.95)
    ctx.lineTo(x + s * 0.7, y + s * 0.89)
    ctx.lineTo(x + s * 0.55, y + s * 0.6)
    ctx.lineTo(x + s * 0.82, y + s * 0.6)
    ctx.closePath()
  })
const target: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.arc(x + s / 2, y + s / 2, s * 0.3, 0, Math.PI * 2)
    ctx.moveTo(x + s / 2, y)
    ctx.lineTo(x + s / 2, y + s * 0.2)
    ctx.moveTo(x + s / 2, y + s * 0.8)
    ctx.lineTo(x + s / 2, y + s)
    ctx.moveTo(x, y + s / 2)
    ctx.lineTo(x + s * 0.2, y + s / 2)
    ctx.moveTo(x + s * 0.8, y + s / 2)
    ctx.lineTo(x + s, y + s / 2)
  })
const camera: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.roundRect(x + 0.5, y + s * 0.25, s * 0.65, s * 0.5, 1.5)
    ctx.moveTo(x + s * 0.68, y + s * 0.45)
    ctx.lineTo(x + s - 0.5, y + s * 0.28)
    ctx.lineTo(x + s - 0.5, y + s * 0.72)
    ctx.lineTo(x + s * 0.68, y + s * 0.55)
  })
const maskIcon: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.roundRect(x + 0.5, y + 1.5, s - 1, s - 3, 2)
    ctx.moveTo(x + s * 0.25, y + s - 1.5)
    ctx.lineTo(x + s - 1, y + s * 0.3)
    ctx.moveTo(x + 1, y + s * 0.55)
    ctx.lineTo(x + s * 0.55, y + 1.5)
  })
function scissors(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  line(ctx, () => {
    ctx.moveTo(x + s * 0.22, y)
    ctx.lineTo(x + s * 0.72, y + s * 0.62)
    ctx.moveTo(x + s * 0.78, y)
    ctx.lineTo(x + s * 0.28, y + s * 0.62)
    ctx.moveTo(x + s * 0.4, y + s * 0.8)
    ctx.arc(x + s * 0.22, y + s * 0.8, s * 0.18, 0, Math.PI * 2)
    ctx.moveTo(x + s * 0.96, y + s * 0.8)
    ctx.arc(x + s * 0.78, y + s * 0.8, s * 0.18, 0, Math.PI * 2)
  }, 1.3)
}
function plus(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  line(ctx, () => {
    ctx.moveTo(x - r, y)
    ctx.lineTo(x + r, y)
    ctx.moveTo(x, y - r)
    ctx.lineTo(x, y + r)
  }, 1.5)
}
