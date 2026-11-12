// The timeline canvas: geometry, drawing, and hit testing. One canvas draws the ruler, every lane,
// waveforms, and overlays; only blocks in view are visited (binary search) and sub-pixel blocks are
// merged, so a frame costs the same for a 2-minute and a 2-hour project.

import type { CameraLayout, Clip, Mask, Voiceover, Zoom } from '../../../shared/project.ts'
import type { TimeMap } from '../../../shared/timemap.ts'
import { pieces, type Piece } from '../../../shared/voiceover.ts'
import * as M from './model.ts'
import { formatTime } from '../helpers.ts'
import type { Waveforms } from './waveform.ts'
import type { Frames } from './frames.ts'

export const PAD = 16 // px before output time 0 and after the end
export const RULER = 38 // playhead knob on top, labels, tick dots
const TOP = RULER + 4
const GAP = 6
const BOTTOM = 16
const HEIGHTS: Record<M.TrackId, number> = { clips: 64, voiceovers: 36, zooms: 36, layouts: 26, masks: 26, keys: 20, captions: 20 }
const BAND_INSET = 5 // px a band where zooms overlap sits in from the layer under it, top and bottom
const MAX_STACK = 4 // the zoom track grows a step per zoom stacked at once, up to this many
const EDGE = 12 // px of a block's end that grabs the edge
// A clip is its frames set into its blue body, a rim around them, and its waveform on the band below.
const RIM = 3
const STRIP = 38 // px: the frames
const BAND = HEIGHTS.clips - STRIP - 2 * RIM // px: the waveform
const LIFT = 6 // px a clip rises while dragged to a new place

export interface Row {
  id: M.TrackId
  y: number
  h: number
}

/** Tracks top to bottom. The zoom track grows with `stack`, the most zooms on at once, so the band
 *  where they all overlap keeps a single zoom's height. */
export function rows(ids: M.TrackId[], stack = 1): { rows: Row[]; height: number } {
  let y = TOP
  const out = ids.map((id) => {
    const r = { id, y, h: HEIGHTS[id] + (id === 'zooms' ? inset(stack) * 2 : 0) }
    y += r.h + GAP
    return r
  })
  return { rows: out, height: y - GAP + BOTTOM }
}

/** How far the band where k zooms overlap sits in from the zoom track's top and bottom. */
const inset = (k: number) => BAND_INSET * (Math.min(k, MAX_STACK) - 1)

export interface View {
  W: number
  H: number
  dpr: number
  x0: number // output seconds at x = PAD
  pps: number // px per output second
  duration: number // output seconds
  /** Output stretches [a, b), in order, drawn `by` seconds later: from a clip's start edge being trimmed
   *  on (b = Infinity), or clips gliding to a new order and the one dragged there. */
  shift: Shift[] | null
  rows: Row[]
}
export type Shift = { a: number; b: number; by: number }

/** How far output time t is drawn from its place: by the stretch holding it, or the stretch it ends (`end`). */
function shiftOf(v: View, t: number, end = false) {
  const s = v.shift
  if (!s) return 0
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (end ? s[mid].a < t - 1e-9 : s[mid].a <= t + 1e-9) lo = mid + 1
    else hi = mid
  }
  const p = s[lo - 1]
  return p && (end ? t <= p.b + 1e-9 : t < p.b - 1e-9) ? p.by : 0
}
/** x of output time t in its place, ignoring every shift. */
const xAt = (v: View, t: number) => PAD + (t - v.x0) * v.pps
export const xOf = (v: View, t: number, end = false) => xAt(v, t + shiftOf(v, t, end))
export const timeOf = (v: View, x: number) => v.x0 + (x - PAD) / v.pps
/** A block's screen span. A block over clips drawn apart (an item over a split, while clips glide)
 *  stretches between them. */
export const xs = (v: View, b: M.Block): [number, number] => [xOf(v, b.a), xOf(v, b.b, true)]

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
  const under = M.blocksAt(m[row.id], timeOf(v, x), 4 / v.pps)
  if (!under.length) return { kind: 'lane', track: row.id }
  // Any end under the pointer trims its item, also inside a stretch where zooms overlap; else the top one moves.
  if (row.id !== 'keys' && row.id !== 'captions') {
    for (const b of under) {
      const [xa, xb] = xs(v, b)
      const ez = Math.min(EDGE, (xb - xa) / 3)
      if (b.head && x >= xa - 4 && x <= xa + ez) return { kind: 'block', track: row.id, block: b, edge: 'start' }
      if (b.tail && x >= xb - ez && x <= xb + 4) return { kind: 'block', track: row.id, block: b, edge: 'end' }
    }
  }
  return { kind: 'block', track: row.id, block: under[0], edge: null }
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
  marquee: { x0: number; y0: number; x1: number; y1: number } | null
  mic: Audio | null
  system: Audio | null
  /** Per voiceover item: its take's number and the audio it plays (null while muted). */
  voices: Map<string, { n: number; audio: Audio | null }>
  /** The take recording now, from output `from` to the playhead: its take second 0 played at output
   *  `zero`, and `levels` is what the mic heard so far ([take second, linear peak], in order). */
  take: { from: number; n: number; zero: number; levels: Array<[number, number]> } | null
  hidden: string | null // the item a take records again, from its countdown on
  taking: boolean // a take counts down or records, so the empty voiceover lane drops its hint
  waves: Waveforms
  film: { frames: Frames; aspect: number } | null // the recording's frames for the clips, and its width over height
  lifted: string | null // the clip dragged to a new place: drawn raised over everything, following the pointer
  slot: [number, number] | null // where it lands, output seconds
}

const FONT = '"Inter Variable", -apple-system, BlinkMacSystemFont, system-ui, sans-serif' // --font in theme.css
const F_RULER = `500 10px ${FONT}`
const F_TITLE = `600 11px ${FONT}`
const F_META = `500 10.5px ${FONT}`
const F_SMALL = `500 10px ${FONT}`

const C = {
  // Neutral chrome takes theme.css values: text tokens for labels, surfaces for chips.
  rulerText: '#636362', // --fg-faint
  major: '#636362',
  minor: '#343433', // --surface-200
  grid: 'rgba(255,255,255,0.035)',
  lane: 'rgba(0,0,0,0.2)', // wells sunk into the timeline panel (theme.css --control-track over --surface-root)
  hint: '#636362',
  // Colours follow the logo's gradient: blue clips, violet zooms, mauve layouts, red masks, orange cuts.
  // The clips are the one solid colour that anchors the timeline; items are greys tinted a fifth of the way
  // to their colour, which their grips carry in full.
  clip: '#2e49b4',
  clipTop: '#3754cc', // lit from above: the fill fades from this to clipBottom
  clipBottom: '#263d9c',
  clipGrid: 'rgba(220,228,255,0.08)',
  clipEdge: 'rgba(196,212,255,0.6)',
  strip: '#111110', // --panel: the frames' well while they decode
  tile: 'rgba(0,0,0,0.5)', // between frames
  veil: 'rgba(24,24,23,0.82)', // --surface-root: the label's chip over the frames
  veilEdge: 'rgba(255,255,255,0.1)', // --ring-faint
  slot: 'rgba(255,255,255,0.03)', // where a dragged clip lands
  slotEdge: 'rgba(255,255,255,0.22)',
  lift: 'rgba(0,0,0,0.6)', // a dragged clip's shadow
  clipSel: 'rgba(205,216,255,0.95)', // selected: a hairline ring and a glow
  clipGlow: 'rgba(72,104,255,0.6)',
  clipCap: 'rgba(214,224,255,0.55)',
  clipText: 'rgba(255,255,255,0.97)',
  clipMeta: 'rgba(232,238,255,0.9)',
  pill: 'rgba(255,255,255,0.16)',
  wave: 'rgba(214,224,255,0.28)', // mic
  waveEdge: 'rgba(232,238,255,0.72)',
  waveSys: 'rgba(249,120,0,0.5)', // system audio, in front of the mic and warm against the clip
  waveSysEdge: 'rgba(255,154,64,0.95)',
  // Fill, grips, top edge; selected: fill, hairline ring, glow.
  zooms: ['#35334a', '#8f80f5', 'rgba(255,255,255,0.12)', '#433d6b', 'rgba(186,175,255,0.95)', 'rgba(143,128,245,0.55)'],
  zoomOff: ['#292928', '#545453', 'rgba(255,255,255,0.08)', '#343433', 'rgba(205,205,215,0.75)', 'rgba(170,170,180,0.3)'],
  layouts: ['#3b3039', '#cf72bf', 'rgba(255,255,255,0.12)', '#4b3a48', 'rgba(238,165,224,0.95)', 'rgba(207,114,191,0.55)'],
  masks: ['#3c302e', '#e8604c', 'rgba(255,255,255,0.12)', '#4d3934', 'rgba(255,165,145,0.95)', 'rgba(232,96,76,0.55)'],
  voiceovers: ['#3b3228', '#ee9e10', 'rgba(255,255,255,0.12)', '#4b3d2c', 'rgba(245,192,118,0.95)', 'rgba(238,158,16,0.55)'], // amber: a voice, warm like system audio
  voice: 'rgba(238,158,16,0.36)', // a take's waveform on its item
  voiceEdge: 'rgba(250,198,110,0.9)',
  ducked: 'rgba(214,224,255,0.09)', // the mic where a voiceover mutes it: a ghost of its waveform
  duckedEdge: 'rgba(232,238,255,0.24)',
  // Where zooms overlap: a hairline outline per layer, brighter the more zooms it holds; the + between them.
  bands: ['rgba(143,128,245,0.55)', 'rgba(169,156,255,0.75)', 'rgba(196,188,255,0.92)'],
  plus: 'rgba(255,255,255,0.5)',
  capHot: 'rgba(255,255,255,0.55)',
  text: '#ffffff',
  textOff: 'rgba(255,255,255,0.45)',
  meta: 'rgba(255,255,255,0.72)',
  chip: '#292928', // --surface-150: keycaps and caption words rise out of the lane
  chipEdge: 'rgba(255,255,255,0.14)', // a top highlight
  chipText: '#a0a09e', // --fg-secondary
  chipDim: '#20201f', // --surface-100
  chipDimText: '#636362',
  word: '#292928',
  filler: 'rgba(255,95,87,0.16)', // filler words: the ones worth cutting
  playhead: '#f4f4f3', // --fg-default
  record: '#f04600', // --record: the playhead while a take records
  ghost: 'rgba(255,255,255,0.22)',
  split: '#ff5f57',
  cut: '#f47a1c',
  cutHot: '#ff9a4a',
  cutGuide: 'rgba(244,122,28,0.45)',
  cutText: '#3a1600',
  marquee: 'rgba(255,255,255,0.08)',
  marqueeEdge: 'rgba(255,255,255,0.6)',
  scroll: 'rgba(255,255,255,0.12)', // the CSS scrollbar thumb
  scrollHot: 'rgba(255,255,255,0.22)',
}

const HINTS: Record<M.ItemTrack, string> = {
  zooms: 'Click or drag to add a zoom',
  layouts: 'Click or drag to add a camera layout',
  masks: 'Click or drag to add a blur or highlight',
  voiceovers: 'Press V to record a voiceover from the playhead',
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
  const slack = v.shift ? Math.max(...v.shift.map((p) => Math.abs(p.by))) : 0
  want = []
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
  const row = s.lifted ? v.rows.find((r) => r.id === 'clips') : null
  const i = row ? s.model.clips.items.findIndex((c) => c.id === s.lifted) : -1
  if (row && i >= 0) {
    const [xa, xb] = xs(v, s.model.clips.blocks[i])
    clipBlock(ctx, s, { ...row, y: row.y - LIFT }, s.model.clips.items[i], s.model.clips.blocks[i], xa + 1, xb - 1, true)
  }
  overlays(ctx, s, bottom)
  if (s.film) s.film.frames.request(want, Math.round(STRIP * s.film.aspect * v.dpr), Math.round(STRIP * v.dpr))

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
      const text = formatTime(t, major < 1 ? 1 : 0, hours)
      const half = measure(ctx, F_RULER, text) / 2 + 2
      ctx.font = F_RULER
      ctx.fillText(text, M.clamp(x, half, v.W - half), 23) // the first and last labels stay whole
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
    if (b.b < tA || l.items[b.i].id === s.lifted) continue // the dragged clip draws last, raised (draw)
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
  if (s.slot) {
    // Where the dragged clip lands: a hollow outline the other clips make room for. Its glide is in `slot`;
    // the dragged clip's own shift would draw it under the clip.
    const xa = snap(v, xAt(v, s.slot[0]) + 1)
    const w = snap(v, xAt(v, s.slot[1]) - 1) - xa
    if (w > 2) {
      ctx.beginPath()
      ctx.roundRect(xa, row.y, w, row.h, Math.min(8, w / 2))
      ctx.fillStyle = C.slot
      ctx.fill()
      ring1(ctx, xa, row.y, w, row.h, Array(4).fill(Math.min(8, w / 2)), C.slotEdge)
    }
  }
}

let want: number[] = [] // source times of the frames this draw showed, decoded next (Frames.request)

function clipBlock(ctx: CanvasRenderingContext2D, s: Scene, row: Row, c: Clip, b: M.Block, xa: number, xb: number, lifted = false) {
  const v = s.view
  const { y, h } = row
  xa = snap(v, xa)
  xb = snap(v, xb)
  const w = xb - xa
  const r = Math.min(8, w / 2)
  const sel = lifted || s.sel.has(c.id)
  ctx.beginPath()
  ctx.roundRect(xa, y, w, h, r)
  const fill = ctx.createLinearGradient(0, y, 0, y + h)
  fill.addColorStop(0, C.clipTop)
  fill.addColorStop(1, C.clipBottom)
  ctx.fillStyle = fill
  ctx.save()
  if (lifted) {
    // Raised: a long shadow under it, then the selection's glow.
    ctx.shadowColor = C.lift
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 12 * v.dpr // shadow offsets ignore the transform
    ctx.fill()
    ctx.shadowOffsetY = 0
  }
  if (sel) {
    ctx.shadowColor = C.clipGlow
    ctx.shadowBlur = 12
  }
  ctx.fill()
  ctx.restore()
  if (w > 6) {
    ctx.save()
    ctx.clip()
    // The ruler's major grid runs through the band, so its seconds read against the waveform.
    const { major } = M.ticks(v.pps)
    ctx.fillStyle = C.clipGrid
    for (let t = Math.ceil(Math.max(timeOf(v, Math.max(xa, 0)), 0) / major) * major; PAD + (t - v.x0) * v.pps < Math.min(xb, v.W); t += major) {
      const x = snap(v, PAD + (t - v.x0) * v.pps)
      if (x > xa + 2 && x < xb - 2) ctx.fillRect(x, y + h - BAND, 1, BAND)
    }
    if (s.mic || s.system) wave(ctx, s, c, b, xa, xb, y + h - BAND, BAND)
    ctx.restore()
  }
  if (w > 2 * RIM + 4) strip(ctx, s, c, b, xa + RIM, xb - RIM, y + RIM)
  const hv = s.hover?.kind === 'block' && s.hover.block === b && !s.armed ? s.hover.edge : null
  if (hv) cap(ctx, hv === 'start' ? xa : xb - 4, y + 6, 4, h - 12, C.clipCap)
  topEdge(ctx, v, xa, y, w, h, r, C.clipEdge)
  if (sel) ring1(ctx, xa, y, w, h, Array(4).fill(r), C.clipSel)

  // The label: a chip over the frames at the left of the clip's visible part.
  const len = (c.end - c.start) / c.speed
  const meta: Seg[] = [{ text: M.span(len), font: F_META, color: C.clipMeta }]
  meta.push({ icon: gauge, text: `${c.speed}×`, font: F_META, color: c.speed === 1 ? C.clipMeta : C.clipText, pill: c.speed === 1 ? undefined : C.pill })
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const sys = c.systemVolume ?? 1
  if (c.muted) meta.push({ icon: mute, text: '', font: F_META, color: C.clipText, pill: C.pill })
  else {
    if (s.mic && c.volume !== 1) meta.push({ icon: c.volume === 0 ? mute : speaker, text: pct(c.volume), font: F_META, color: C.clipText, pill: C.pill })
    if (s.system && sys !== 1) meta.push({ icon: monitor, text: pct(sys), font: F_META, color: C.clipText, pill: C.pill })
  }
  if (c.rawCursor) meta.push({ icon: arrow, text: 'Raw', font: F_META, color: C.clipText, pill: C.pill })
  if (c.hideCursor) meta.push({ icon: noArrow, text: '', font: F_META, color: C.clipText, pill: C.pill })
  const x = Math.max(xa, 0) + RIM + 5
  const room = Math.min(xb, v.W) - RIM - 5 - x
  const pick = [meta, c.speed === 1 ? [meta[0]] : [meta[1]]].find((segs) => rowWidth(ctx, segs) + 14 <= room)
  if (!pick) return
  const cw = rowWidth(ctx, pick) + 14
  const cy = y + RIM + 5
  ctx.beginPath()
  ctx.roundRect(x, cy, cw, 18, 6)
  ctx.fillStyle = C.veil
  ctx.fill()
  ring1(ctx, x, cy, cw, 18, [6, 6, 6, 6], C.veilEdge)
  row1(ctx, pick, x + cw / 2, cy + 12.5)
}

/** The clip's frames between x0 and x1, from the top at y: one tile a power of two source seconds long,
 *  pinned to the recording, so zooming reuses decoded frames and tiles ride with the clip as it moves.
 *  A tile still decoding shows the one before it. */
function strip(ctx: CanvasRenderingContext2D, s: Scene, c: Clip, b: M.Block, x0: number, x1: number, y: number) {
  const v = s.view
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x0, y, x1 - x0, STRIP, Math.min(5, (x1 - x0) / 2))
  ctx.fillStyle = C.strip
  ctx.fill()
  ctx.clip()
  const f = s.film
  if (f) {
    const tw = STRIP * f.aspect // px: a whole frame at the strip's height
    const T = 2 ** Math.floor(Math.log2((tw / v.pps) * c.speed)) // source seconds per tile: tw / 2 to tw wide
    const bx = xs(v, b)[0]
    const X = (src: number) => bx + ((src - c.start) / c.speed) * v.pps
    const left = c.start + ((Math.max(x0, 0) - bx) / v.pps) * c.speed // source at the strip's visible left
    let prev: ImageBitmap | null = null
    for (let n = Math.floor(Math.max(left, c.start) / T); n * T < c.end && X(n * T) < Math.min(x1, v.W); n++) {
      const t = n * T
      want.push(t)
      const bmp: ImageBitmap | null = f.frames.get(t) ?? prev
      const a = X(t)
      const tp = X(t + T) - a
      if (bmp) {
        const sw = bmp.width * Math.min(1, tp / tw) // the middle of the frame, cropped to the tile
        ctx.drawImage(bmp, (bmp.width - sw) / 2, 0, sw, bmp.height, a, y, tp, STRIP)
      }
      ctx.fillStyle = C.tile
      ctx.fillRect(a + tp - 0.5, y, 0.5, STRIP)
      prev = bmp
    }
  }
  ctx.restore()
}

/** The clip's mic and system audio in its band, y to y + h. */
function wave(ctx: CanvasRenderingContext2D, s: Scene, c: Clip, b: M.Block, xa: number, xb: number, y: number, h: number) {
  const v = s.view
  const off = shiftOf(v, b.a)
  const perPx = c.speed / v.pps // source seconds per px
  const level = s.waves.level(perPx)
  const base = y + h + 1 // silence sits just under the clip's edge, so its contour does not show
  const max = h - 3 // peaks stay clear of the frames
  const x0 = Math.max(Math.floor(xa), 0)
  const x1 = Math.min(Math.ceil(xb), v.W)
  const ducks = s.mic ? ducked(s, b.a, b.b) : []
  // Mic behind, system audio in front.
  for (const [src, volume, color, edge] of [[s.mic, c.volume, C.wave, C.waveEdge], [s.system, c.systemVolume ?? 1, C.waveSys, C.waveSysEdge]] as const) {
    const gain = src ? src.gain * (c.muted ? 0 : volume) : 0
    if (!src || gain <= 0) continue
    const w = contour(x0, x1, base, max, gain, (x) => {
      const s0 = c.start + (timeOf(v, x) - off - b.a) * c.speed
      return s0 < c.start || s0 >= c.end ? 0 : s.waves.peak(src.url, level, s0, s0 + perPx)
    })
    if (src !== s.mic || !ducks.length) paint(ctx, w, color, edge)
    else {
      // Where a voiceover mutes the mic, its waveform stays as a ghost: what the voiceover covers.
      for (const under of [false, true]) {
        ctx.save()
        ctx.beginPath()
        let x = x0
        for (const [a, e] of ducks) {
          const [xa, xe] = [xOf(v, a), xOf(v, e)]
          if (under) ctx.rect(xa, y, xe - xa, h + 4)
          else if (xa > x) ctx.rect(x, y, xa - x, h + 4)
          x = Math.max(x, xe)
        }
        if (!under && x < x1) ctx.rect(x, y, x1 - x, h + 4)
        ctx.clip()
        paint(ctx, w, under ? C.ducked : color, under ? C.duckedEdge : edge)
        ctx.restore()
      }
    }
  }
}

/** Output stretches over [t0, t1] where a voiceover mutes the mic (and the take being recorded does),
 *  merged, in order. */
function ducked(s: Scene, t0: number, t1: number): Array<[number, number]> {
  const l = s.model.voiceovers
  const [from, to] = M.visible(l, t0, t1)
  const all: Array<[number, number]> = []
  for (let k = from; k < to; k++) {
    const b = l.blocks[k]
    const it = l.items[b.i]
    if (b.b > t0 && it.duck && !it.muted && it.id !== s.hidden) all.push([b.a, b.b])
  }
  if (s.take) all.push([s.take.from, s.time])
  const out: Array<[number, number]> = []
  for (const [a, e] of all.sort((p, q) => p[0] - q[0])) {
    const last = out.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([a, e])
  }
  return out
}

/** A waveform from the loudest moment `at(x)` of each pixel column (0..1; below 0 while loading), on
 *  a square-root scale: a body to fill and the edge over it. */
function contour(x0: number, x1: number, base: number, max: number, gain: number, at: (x: number) => number) {
  const top = new Path2D()
  for (let x = x0; x <= x1; x++) {
    const p = at(x)
    const yy = base - (p > 0 ? Math.min(1, Math.sqrt(p * gain)) * max : 0)
    if (x === x0) top.moveTo(x, yy)
    else top.lineTo(x, yy)
  }
  const body = new Path2D(top)
  body.lineTo(x1, base + 1)
  body.lineTo(x0, base + 1)
  body.closePath()
  return { top, body }
}

/** A translucent body under a crisp edge. */
function paint(ctx: CanvasRenderingContext2D, w: { top: Path2D; body: Path2D }, color: string, edge: string) {
  ctx.fillStyle = color
  ctx.fill(w.body)
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'
  ctx.strokeStyle = edge
  ctx.stroke(w.top)
}

const played = new WeakMap<Voiceover, { map: TimeMap; pieces: Piece[] }>()
/** A voiceover's take as it plays, between its grips: the loudest moment per pixel. */
function voiceWave(ctx: CanvasRenderingContext2D, s: Scene, it: Voiceover, b: M.Block, x0: number, x1: number, y: number, h: number) {
  const a = s.voices.get(it.id)?.audio
  const v = s.view
  x0 = Math.max(Math.floor(x0), 0)
  x1 = Math.min(Math.ceil(x1), v.W)
  if (!a || a.gain <= 0 || x1 <= x0) return
  let got = played.get(it)
  if (got?.map !== s.model.map) played.set(it, (got = { map: s.model.map, pieces: pieces(s.model.map, it) }))
  const ps = got.pieces
  const off = shiftOf(v, b.a)
  let k = 0
  const w = contour(x0, x1, y + h + 1, h - 20, a.gain, (x) => {
    const t = timeOf(v, x) - off
    while (k < ps.length - 1 && ps[k].o1 <= t) k++
    const p = ps[k]
    if (!p || t < p.o0 || t >= p.o1) return 0 // recorded through a cut since cut back in: plays nothing
    const f = p.f0 + (t - p.o0) * p.rate
    const per = p.rate / v.pps
    return s.waves.peak(a.url, s.waves.level(per), f, f + per)
  })
  paint(ctx, w, C.voice, C.voiceEdge)
}

function itemLane(ctx: CanvasRenderingContext2D, s: Scene, row: Row, track: M.ItemTrack, tA: number, tB: number) {
  const v = s.view
  const l = s.model[track]
  // The well holds the timeline and follows a clip's start edge trimmed out past either end.
  const d = s.model.map.duration
  const la = Math.max(Math.min(xOf(v, 0), xAt(v, 0)), -8)
  const lb = Math.min(Math.max(xOf(v, d, true), xAt(v, d)), v.W + 8)
  if (lb > la) {
    ctx.beginPath()
    ctx.roundRect(la, row.y, lb - la, row.h, 7)
    ctx.fillStyle = C.lane
    ctx.fill()
  }
  const live = track === 'voiceovers' ? s.take : null
  if (!l.items.length && !(track === 'voiceovers' && s.taking) && lb - la > 160) {
    ctx.font = F_META
    ctx.textAlign = 'center'
    ctx.fillStyle = C.hint
    ctx.fillText(HINTS[track], (la + lb) / 2, row.y + row.h / 2 + 4)
  }
  const [from, to] = M.visible(l, tA, tB)
  const shown: Array<[M.Block, number, number]> = []
  const run = merger(ctx, C[track][1], row) // slivers are all ends, so they take the grip colour, not the grey
  if (live) {
    // The take punches in as it records: what it records over shows only outside it.
    ctx.save()
    ctx.beginPath()
    ctx.rect(-8, row.y - 16, xOf(v, live.from) + 8, row.h + 32)
    ctx.rect(xOf(v, s.time), row.y - 16, v.W + 8, row.h + 32)
    ctx.clip()
  }
  for (let k = from; k < to; k++) {
    const b = l.blocks[k]
    if (b.b < tA || (l.items[b.i] as M.Item).id === s.hidden) continue
    const [xa, xb] = xs(v, b)
    if (xb - xa < 3) run.add(xa, xb)
    else {
      run.flush()
      shown.push([b, xa, xb])
    }
  }
  run.flush()
  // Zooms may overlap. Their bodies draw bottom up (a selected one last, lit along its whole length),
  // then an outline over each stretch where they overlap names what combines there, then every
  // block's ends, label (outside the outlines), and selection ring.
  const lit = (b: M.Block) => (s.sel.has((l.items[b.i] as M.Item).id) ? 1 : 0)
  shown.sort((p, q) => lit(p[0]) - lit(q[0]) || l.rank[p[0].i] - l.rank[q[0].i])
  for (const [b, xa, xb] of shown) itemBlock(ctx, s, row, track, l.items[b.i] as M.Item, b, xa, xb, 'body')
  const bands = l.overlaps.filter((o) => o.b >= tA && o.a <= tB)
  overlapBands(ctx, s, row, l as M.Lane<Zoom>, bands)
  for (const [b, xa, xb] of shown) itemBlock(ctx, s, row, track, l.items[b.i] as M.Item, b, xa, xb, 'top', labelSpan(l, b, bands))
  if (live) {
    ctx.restore()
    liveTake(ctx, s, row, live)
  }
}

/** The take being recorded: an item growing from where it started to the playhead, its end open. */
function liveTake(ctx: CanvasRenderingContext2D, s: Scene, row: Row, take: NonNullable<Scene['take']>) {
  const v = s.view
  const { y, h } = row
  const xa = snap(v, xOf(v, take.from))
  const xb = snap(v, xOf(v, Math.max(s.time, take.from)))
  const w = xb - xa
  if (w < 1) return
  const [fill, capColor, edge] = C.voiceovers
  const r = Math.min(8, w / 2)
  const cw = Math.min(9, w / 4)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(xa, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.clip()
  liveWave(ctx, s, take, xa + cw + 1, xb, y, h)
  ;(cw < 5 ? cap : grip)(ctx, xa, y, cw, h, capColor)
  ctx.restore()
  topEdge(ctx, v, xa, y, w, h, r, edge)
  const title: Seg[] = [{ icon: micIcon, text: `Voiceover ${take.n}`, font: F_TITLE, color: C.text }]
  const meta: Seg[] = [{ text: M.span(s.time - take.from), font: F_META, color: C.meta }]
  const room = Math.min(xb, v.W) - Math.max(xa + cw, 0) - 8
  const pick = [[...title, ...meta], title].find((segs) => fitsRow(ctx, segs, room))
  if (!pick) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(xa + cw, y, w - cw, h)
  ctx.clip()
  row1(ctx, pick, sticky(v, xa + cw, xb), y + 14)
  ctx.restore()
}

/** What the mic heard so far in the take being recorded, drawn where it plays (output zero + take second). */
function liveWave(ctx: CanvasRenderingContext2D, s: Scene, take: NonNullable<Scene['take']>, x0: number, x1: number, y: number, h: number) {
  const v = s.view
  const lv = take.levels
  x0 = Math.max(Math.floor(x0), 0)
  x1 = Math.min(Math.ceil(x1), v.W)
  if (!lv.length || x1 <= x0) return
  let k = 0
  const w = contour(x0, x1, y + h + 1, h - 20, 1, (x) => {
    const f0 = timeOf(v, x) - take.zero
    const f1 = f0 + 1 / v.pps
    while (k < lv.length - 1 && lv[k + 1][0] <= f0) k++
    let p = 0
    for (let j = k; j < lv.length && lv[j][0] < f1; j++) if (lv[j][0] + 0.04 > f0) p = Math.max(p, lv[j][1]) // ~33 ms each
    return p
  })
  paint(ctx, w, C.voice, C.voiceEdge)
}

/** The longest stretch of block b no other block covers: none above it, and no band it is under. */
function labelSpan(l: M.Lane, b: M.Block, bands: M.Overlap[]): [number, number] {
  const over: Array<[number, number]> = bands.filter((o) => o.items.includes(b.i)).map((o) => [o.a, o.b])
  if (l.overlaps.length || bands.length) {
    const [from, to] = M.visible(l, b.a, b.b)
    for (let k = from; k < to; k++) if (l.rank[l.blocks[k].i] > l.rank[b.i]) over.push([l.blocks[k].a, l.blocks[k].b])
  }
  let best: [number, number] = [b.a, b.a]
  let at = b.a
  for (const [a, e] of over.sort((x, y) => x[0] - y[0])) {
    if (Math.min(a, b.b) - at > best[1] - best[0]) best = [at, Math.min(a, b.b)]
    at = Math.max(at, e)
  }
  if (b.b - at > best[1] - best[0]) best = [at, b.b]
  return best
}

/** Where zooms overlap and combine: an outline over them, and inside it a narrower one wherever more
 *  of them overlap, each stretch naming its zooms, top first, as a full zoom or a loupe and its level.
 *  Outlines only: the zooms under them show through. */
function overlapBands(ctx: CanvasRenderingContext2D, s: Scene, row: Row, l: M.Lane<Zoom>, bands: M.Overlap[]) {
  const v = s.view
  const deepest = Math.min(MAX_STACK, Math.max(1, ...bands.map((o) => o.items.length)))
  for (let k = 2; k <= deepest; k++) {
    // One rounded band per run of touching stretches holding k zooms or more.
    for (let i = 0; i < bands.length; i++) {
      if (bands[i].items.length < k) continue
      let j = i
      while (j + 1 < bands.length && bands[j + 1].items.length >= k && bands[j + 1].a - bands[j].b < 1e-9) j++
      const xa = snap(v, xOf(v, bands[i].a))
      const xb = snap(v, xOf(v, bands[j].b))
      const y = row.y + inset(k)
      const h = row.h - 2 * inset(k)
      const r = Math.min(5, (xb - xa) / 2)
      i = j
      if (xb - xa < 2) continue
      ring1(ctx, xa, y, xb - xa, h, [r, r, r, r], C.bands[k - 2])
    }
  }
  const plus: Seg = { text: '+', font: F_META, color: C.plus }
  for (const o of bands) {
    const xa = snap(v, xOf(v, o.a))
    const xb = snap(v, xOf(v, o.b))
    const zs = o.items.map((i) => l.items[i]).reverse()
    const each = (full: boolean) => zs.flatMap((z, k): Seg[] => [...(k ? [plus] : []), { ...(full ? { icon: z.mode === 'loupe' ? lens : magnifier } : {}), text: `${z.level}×`, font: F_META, color: C.text }])
    const room = Math.min(xb, v.W) - Math.max(xa, 0) - 2 * EDGE
    const label = [each(true), each(false)].find((segs) => fitsRow(ctx, segs, room))
    if (!label) continue
    const y = row.y + inset(o.items.length)
    const h = row.h - 2 * inset(o.items.length)
    ctx.save()
    ctx.beginPath()
    ctx.rect(xa, y, xb - xa, h)
    ctx.clip()
    row1(ctx, label, sticky(v, xa, xb), y + h / 2 + 4)
    ctx.restore()
  }
}

/** A one-device-pixel highlight along a block's top, as if lit from above; the rounded corners trim it. */
function topEdge(ctx: CanvasRenderingContext2D, v: View, x: number, y: number, w: number, h: number, r: number | number[], color: string) {
  if (w <= 2) return
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.clip()
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, 1 / v.dpr)
  ctx.restore()
}

/** An item's body (fill, top edge, a glow when selected), or what goes on top of it: its ends, its
 *  label centered in `span` (output seconds), and its selection ring. */
function itemBlock(ctx: CanvasRenderingContext2D, s: Scene, row: Row, track: M.ItemTrack, it: M.Item, b: M.Block, xa: number, xb: number, pass: 'body' | 'top', span: [number, number] = [b.a, b.b]) {
  const v = s.view
  const { y, h } = row
  xa = snap(v, xa)
  xb = snap(v, xb)
  const w = xb - xa
  const zoom = track === 'zooms' ? (it as Zoom) : null
  const [fill, capColor, edge, selFill, ring, glow] = zoom ? (zoom.enabled ? C.zooms : C.zoomOff) : C[track as 'layouts' | 'masks' | 'voiceovers']
  const sel = s.sel.has(it.id)
  const r = Math.min(track === 'zooms' || track === 'voiceovers' ? 8 : 6, w / 2)
  const radii = [b.head ? r : 1.5, b.tail ? r : 1.5, b.tail ? r : 1.5, b.head ? r : 1.5] // cut pieces get square inner ends
  const cw = Math.min(9, w / 4)
  ctx.beginPath()
  ctx.roundRect(xa, y, w, h, radii)
  if (pass === 'body') {
    // Selected, it lifts and glows in its colour.
    ctx.save()
    if (sel) {
      ctx.shadowColor = glow
      ctx.shadowBlur = 12
    }
    ctx.fillStyle = sel ? selFill : fill
    ctx.fill()
    ctx.restore()
    if (track === 'voiceovers' && !(it as Voiceover).muted) {
      ctx.save()
      ctx.clip()
      voiceWave(ctx, s, it as Voiceover, b, xa + (b.head ? cw + 1 : 0), xb - (b.tail ? cw + 1 : 0), y, h)
      ctx.restore()
    }
    return topEdge(ctx, v, xa, y, w, h, radii, edge)
  }
  const hv = s.hover?.kind === 'block' && s.hover.block === b ? s.hover.edge : null
  if (b.head || b.tail) {
    ctx.save()
    ctx.clip()
    const end = cw < 5 ? cap : grip // a narrow block has no room for grips: its ends fill with the colour
    if (b.head) end(ctx, xa, y, cw, h, hv === 'start' ? C.capHot : capColor)
    if (b.tail) end(ctx, xb - cw, y, cw, h, hv === 'end' ? C.capHot : capColor)
    ctx.restore()
  }
  if (sel) ring1(ctx, xa, y, w, h, radii, ring)
  const la = Math.max(xa + cw, snap(v, xOf(v, span[0])) + (span[0] > b.a ? 4 : 0)) // clear of a band's edge
  const lb = Math.min(xb - cw, snap(v, xOf(v, span[1])) - (span[1] < b.b ? 4 : 0))
  if (lb - la < 10) return
  const cx = sticky(v, la, lb)
  const room = Math.min(lb, v.W) - Math.max(la, 0) - 8 // the visible part the labels are centered in
  ctx.save()
  ctx.beginPath()
  ctx.rect(la, y, lb - la, h)
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
      row1(ctx, title, cx, y + h / 2 - 3)
      row1(ctx, meta, cx, y + h / 2 + 10)
    } else if (fitsRow(ctx, [meta[0]], room)) row1(ctx, [meta[0]], cx, y + h / 2 + 4)
  } else if (track === 'voiceovers') {
    // The name over the take's waveform; muted, it dims and says so.
    const vo = it as Voiceover
    const color = vo.muted ? C.textOff : C.text
    const title: Seg[] = [{ icon: micIcon, text: `Voiceover ${s.voices.get(vo.id)?.n ?? ''}`.trim(), font: F_TITLE, color }]
    const meta: Seg[] = vo.muted ? [{ icon: mute, text: '', font: F_META, color, pill: C.pill }] : [{ text: M.span(b.b - b.a), font: F_META, color: C.meta }]
    const pick = [[...title, ...meta], title].find((segs) => fitsRow(ctx, segs, room))
    if (pick) row1(ctx, pick, cx, y + 14)
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
    const [cx, cy, ch, cr] = [snap(v, xa), row.y + (keys ? 0 : 2), row.h - (keys ? 0 : 4), Math.min(keys ? 5 : 4, w / 2)]
    ctx.beginPath()
    ctx.roundRect(cx, cy, w, ch, cr)
    ctx.fillStyle = keys ? (chip.dim ? C.chipDim : C.chip) : chip.dim ? C.filler : C.word
    ctx.fill()
    if (!chip.dim) topEdge(ctx, v, cx, cy, w, ch, cr, C.chipEdge)
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
    if (clips.y - 3 > TOP) {
      // Lanes above the video: a guide carries the pointer down to the clip's notch.
      ctx.fillStyle = hot ? C.cutHot : C.cutGuide
      ctx.fillRect(x - 0.5, TOP, 1, clips.y - 3 - TOP)
    }
    const y = RULER - 14 // clear of the ruler labels above
    ctx.fillStyle = hot ? C.cutHot : C.cut
    ctx.beginPath()
    ctx.roundRect(l, y, w, 14, 7)
    ctx.moveTo(x + 4, y + 13) // clockwise like the pill: an opposite winding would punch a hole where they overlap
    ctx.lineTo(x, y + 18)
    ctx.lineTo(x - 4, y + 13)
    ctx.fill()
    ctx.strokeStyle = C.cutText
    ctx.fillStyle = C.cutText
    scissors(ctx, l + 6, y + 2.5, 9)
    ctx.font = F_SMALL
    ctx.fillText(text, l + 19, y + 10.5)
  })
}

function overlays(ctx: CanvasRenderingContext2D, s: Scene, bottom: number) {
  const v = s.view
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
    ctx.fillStyle = s.take ? C.record : C.playhead
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

/** A pill centred in a block's end, where dragging trims it. */
function grip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  const ph = Math.min(h - 14, 22)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(x + (w - 3) / 2, y + (h - ph) / 2, 3, ph, 1.5)
  ctx.fill()
}

/** A hairline ring just inside a block's edge. */
function ring1(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii: number[], color: string) {
  ctx.beginPath()
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radii.map((r) => Math.max(0, r - 0.5)))
  ctx.lineWidth = 1
  ctx.strokeStyle = color
  ctx.stroke()
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
const monitor: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.roundRect(x + 0.5, y + s * 0.12, s - 1, s * 0.6, 1.5)
    ctx.moveTo(x + s * 0.3, y + s * 0.92)
    ctx.lineTo(x + s * 0.7, y + s * 0.92)
  })
const magnifier: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.arc(x + s * 0.42, y + s * 0.42, s * 0.32, 0, Math.PI * 2)
    ctx.moveTo(x + s * 0.66, y + s * 0.66)
    ctx.lineTo(x + s * 0.92, y + s * 0.92)
  }, 1.4)
/** A loupe: a glass ring with a glint. */
const lens: Icon = (ctx, x, y, s) => {
  line(ctx, () => ctx.arc(x + s / 2, y + s / 2, s * 0.4, 0, Math.PI * 2), 1.3)
  line(ctx, () => ctx.arc(x + s / 2, y + s / 2, s * 0.2, Math.PI * 1.05, Math.PI * 1.6), 1.1)
}
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
const noArrow: Icon = (ctx, x, y, s) => {
  arrow(ctx, x, y, s)
  line(ctx, () => {
    ctx.moveTo(x + s * 0.02, y + s * 0.12)
    ctx.lineTo(x + s * 0.98, y + s * 0.92)
  }, 1.4)
}
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
const micIcon: Icon = (ctx, x, y, s) =>
  line(ctx, () => {
    ctx.roundRect(x + s * 0.34, y + 0.5, s * 0.32, s * 0.58, s * 0.16)
    ctx.moveTo(x + s * 0.18, y + s * 0.46)
    ctx.quadraticCurveTo(x + s * 0.18, y + s * 0.8, x + s / 2, y + s * 0.8)
    ctx.quadraticCurveTo(x + s * 0.82, y + s * 0.8, x + s * 0.82, y + s * 0.46)
    ctx.moveTo(x + s / 2, y + s * 0.8)
    ctx.lineTo(x + s / 2, y + s)
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
