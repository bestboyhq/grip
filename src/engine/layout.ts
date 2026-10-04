// Owner: compositor. Where each layer sits at output time t, in output px (unzoomed space):
// the screen (padding, aspect fit, device mockup), the camera per CameraLayout item (pip,
// fullscreen, hidden, split) with spring transitions in output time, face-follow crop, hide when
// silent, and masks locked to the screen. Pure: prepareLayout precomputes, layoutAt evaluates.
// The screen's viewport is where the zoom view shows it: the whole output, or in split layouts the
// screen's own panel, so a zoom magnifies inside the panel and the split stays a split.

import type { CameraLayoutKind, Mask, Rect, Style, Word } from '../shared/project.ts'
import { mapRange, toSource, type TimeMap } from '../shared/timemap.ts'
import { springDuration, springProgress, type SpringConfig } from './motion/spring.ts'
import type { CameraLayer, FaceSample, MaskLayer, ScreenLayer, SceneInput } from './scene.ts'

const SPRING: SpringConfig = { stiffness: 170, damping: 26, mass: 1 }
const SETTLE = springDuration(SPRING)
/** Masks fade OUTSIDE their range, so covered content never shows through a half-faded mask. */
const MASK_FADE = 0.2
/** Hide when silent: a gap of this many seconds without words hides the camera. */
const SILENCE = 2
const SPEECH_LEAD = 0.6 // show the camera before the first word, so it is in place when speech starts
const SPEECH_TAIL = 0.8
const FACE_SIGMA = 0.5 // seconds; smooths face detections so the crop glides instead of jittering
/** Picture-in-picture size while the view is zoomed in (2x or more): the camera steps back so it
 *  covers less of the magnified content, and grows back as the view zooms out. */
const ZOOMED_CAMERA = 0.7

type Kind = CameraLayoutKind
const KINDS: Kind[] = ['pip', 'fullscreen', 'hidden', 'split']

interface State {
  screen: Rect
  screenRadius: number
  viewport: Rect
  viewportRadius: number
  camera: Rect
  cameraRadius: number
  cameraOpacity: number
  cameraShadow: number
  pip: number // 1 = a corner camera (pip, hidden), 0 = fullscreen or split; mixed in transitions
}

export function prepareLayout(input: SceneInput, map: TimeMap, unit: number) {
  const targets = Object.fromEntries(KINDS.map((k) => [k, target(input, unit, k)])) as Record<Kind, State>
  // No camera, or the camera turned off: no layout makes room for it.
  const changes = input.project.sources.camera && input.project.style.camera.visible !== false ? kindChanges(input, map) : [{ t: -Infinity, kind: 'pip' as Kind }]
  return { input, map, unit, targets, changes, faces: input.faces ? validFaces(input.faces) : [], masks: maskIndex(input.project.masks, map) }
}

/** The face track's valid samples in time order, once per track (2 hours of it is 72k samples). */
const faceTracks = new WeakMap<FaceSample[], FaceSample[]>()
function validFaces(faces: FaceSample[]): FaceSample[] {
  let v = faceTracks.get(faces)
  if (!v) faceTracks.set(faces, (v = faces.filter((f) => f && [f.t, f.x, f.y, f.w, f.h].every(Number.isFinite)).sort((a, b) => a.t - b.t)))
  return v
}

export type PreparedLayout = ReturnType<typeof prepareLayout>

/** Where the screen sits at t, the same as layoutAt(l, t).screen, without the camera and masks:
 *  the zoom camera, the cursor, and click effects ask at every 120 Hz step of a 2-hour project. */
export function screenAt(l: PreparedLayout, t: number): ScreenPlace | null {
  return l.input.project.sources.screen ? stateAt(l, t, lastChange(l.changes, t)) : null
}
export type ScreenPlace = Pick<State, 'screen' | 'screenRadius' | 'viewport'>

/** `zoom`: how far the view is zoomed in past its rest framing at t (zoomAmount), 0..1. */
export function layoutAt(l: PreparedLayout, t: number, zoom = 0): { screen: ScreenLayer | null; camera: CameraLayer | null; masks: MaskLayer[] } {
  const { project } = l.input
  const st = project.style
  const s = stateAt(l, t, lastChange(l.changes, t))
  const screen: ScreenLayer | null = project.sources.screen
    ? { rect: s.screen, inset: insetPx(st, l.unit), radius: s.screenRadius, shadow: st.shadow, device: st.device, viewport: s.viewport, viewportRadius: s.viewportRadius }
    : null
  const cs = project.sources.camera
  let camera: CameraLayer | null = null
  if (cs && st.camera.visible !== false && s.cameraOpacity > 1e-3) {
    const src = toSource(l.map, t)
    const { rect, k } = steppedBack(st, s, zoom)
    camera = {
      rect,
      radius: s.cameraRadius * k,
      shadow: s.cameraShadow,
      mirror: st.camera.mirror,
      opacity: Math.min(s.cameraOpacity, 1),
      src,
      crop: cameraCrop(rect, cs.width, cs.height, st.camera.followFace ? faceAt(l.faces, src) : null),
      removeBackground: st.camera.removeBackground && !!cs.matte,
      lut: st.camera.lut,
    }
  }
  return { screen, camera, masks: screen ? masksAt(l, t, screen.rect) : [] }
}

/** The camera's rect at t while it shows as picture-in-picture (settled in its corner and mostly
 *  opaque), else null: hidden, fading, fullscreen, split, or mid-transition between them. The zoom
 *  keeps the cursor and clicked elements out from under it. Cheaper than layoutAt (no crop, no masks). */
export function pipCameraAt(l: PreparedLayout, t: number, zoom = 0): Rect | null {
  const { project } = l.input
  if (!project.sources.camera || project.style.camera.visible === false) return null
  const s = stateAt(l, t, lastChange(l.changes, t))
  return s.pip > 0.99 && s.cameraOpacity > 0.5 ? steppedBack(project.style, s, zoom).rect : null
}

/** A corner camera shrinks toward its corner (by k) while zoomed in. */
function steppedBack(st: Style, s: State, zoom: number): { rect: Rect; k: number } {
  const k = 1 - (1 - ZOOMED_CAMERA) * Math.min(Math.max(zoom, 0), 1) * s.pip
  const r = s.camera
  const ax = st.camera.position.endsWith('left') ? r.x : r.x + r.w
  const ay = st.camera.position.startsWith('top') ? r.y : r.y + r.h
  return { rect: k < 1 ? { x: ax + (r.x - ax) * k, y: ay + (r.y - ay) * k, w: r.w * k, h: r.h * k } : r, k }
}

// ---- Layout targets: the settled state of each camera layout kind. ----

const insetPx = (st: Style, unit: number) => Math.max(0, (st.inset ?? 0) * unit)

function target(input: SceneInput, unit: number, kind: Kind): State {
  const { project, width: W, height: H } = input
  const st = project.style
  const c = st.camera
  const src = project.sources.screen ?? { width: 16, height: 9 }
  const pad = Math.max(0, st.padding * unit)
  const area = { x: pad, y: pad, w: Math.max(1, W - 2 * pad), h: Math.max(1, H - 2 * pad) }
  const inset = insetPx(st, unit)
  // Corners belong to the frame around the recording.
  const radius = (r: Rect) => {
    const f = grow(r, inset)
    return st.device === 'none' ? Math.min(st.radius * unit, f.w / 2, f.h / 2) : deviceGeometry(st.device, f)!.displayRadius
  }

  if (kind === 'split' && project.sources.camera) {
    const b = deviceBounds(st.device, { x: 0, y: 0, w: src.width, h: src.height })
    const aspect = b.w / b.h
    const gap = Math.max(pad / 2, 16 * unit)
    let screenBox: Rect, cam: Rect
    if (W >= H) {
      // Side by side: a portrait camera tile as tall as the screen, on the camera position's side.
      const first = c.position.endsWith('left')
      const camAspect = 0.75
      const h = Math.min(area.h, (area.w - gap) / (aspect + camAspect))
      const sw = h * aspect, cw = h * camAspect
      const x = area.x + (area.w - sw - gap - cw) / 2, y = area.y + (area.h - h) / 2
      screenBox = { x: first ? x + cw + gap : x, y, w: sw, h }
      cam = { x: first ? x : x + sw + gap, y, w: cw, h }
    } else {
      // Stacked for vertical output: the camera fills the space under (or over) the screen.
      const first = c.position.startsWith('top')
      const camAspect = 0.8
      const w = Math.min(area.w, (area.h - gap) / (1 / aspect + 1 / camAspect))
      const sh = w / aspect, ch = w / camAspect
      const x = area.x + (area.w - w) / 2, y = area.y + (area.h - sh - gap - ch) / 2
      screenBox = { x, y: first ? y + ch + gap : y, w, h: sh }
      cam = { x, y: first ? y : y + sh + gap, w, h: ch }
    }
    const screen = fitScreen(screenBox, src.width, src.height, st.device, inset)
    return {
      screen,
      screenRadius: radius(screen),
      viewport: grow(screen, inset), // the frame: zooms stay inside it
      viewportRadius: radius(screen),
      camera: cam,
      cameraRadius: c.shape === 'square' ? 0 : Math.min(Math.max(st.radius, 12) * unit, cam.w / 2, cam.h / 2),
      cameraOpacity: 1,
      cameraShadow: c.shadow,
      pip: 0,
    }
  }

  const screen = fitScreen(area, src.width, src.height, st.device, inset)
  const base = { screen, screenRadius: radius(screen), viewport: { x: 0, y: 0, w: W, h: H }, viewportRadius: 0 }
  const cw = Math.max(1, c.size * unit)
  const ch = cw / Math.max(c.aspect, 0.05)
  const edge = c.inset * unit
  const pip = { x: c.position.endsWith('left') ? edge : W - edge - cw, y: c.position.startsWith('top') ? edge : H - edge - ch, w: cw, h: ch }
  const pipRadius = c.shape === 'circle' ? Math.min(cw, ch) / 2 : c.shape === 'rounded' ? Math.min(c.radius * unit, cw / 2, ch / 2) : 0
  if (kind === 'fullscreen') return { ...base, camera: { x: 0, y: 0, w: W, h: H }, cameraRadius: 0, cameraOpacity: 1, cameraShadow: 0, pip: 0 }
  const corner: State = { ...base, camera: pip, cameraRadius: pipRadius, cameraOpacity: 1, cameraShadow: c.shadow, pip: 1 }
  return kind === 'hidden' ? { ...corner, ...hiddenCamera(corner) } : corner
}

/** Largest recording rect whose frame (the recording plus `inset` px on every side) fits centered
 *  in `box` together with its device mockup. */
export function fitScreen(box: Rect, srcW: number, srcH: number, device: Style['device'], inset = 0): Rect {
  const bounds = (k: number) => deviceBounds(device, grow({ x: 0, y: 0, w: srcW * k, h: srcH * k }, inset))
  const fits = (k: number) => {
    const b = bounds(k)
    return b.w <= box.w + 1e-9 && b.h <= box.h + 1e-9
  }
  // The bounds grow with the scale k: bisect for the largest k that fits (exact when nothing is
  // around the recording).
  let lo = 0
  let hi = Math.min(box.w / srcW, box.h / srcH)
  if (fits(hi)) lo = hi
  else for (let i = 0; i < 48; i++) fits((lo + hi) / 2) ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2)
  const b = bounds(lo)
  return { x: box.x + (box.w - b.w) / 2 - b.x, y: box.y + (box.h - b.h) / 2 - b.y, w: srcW * lo, h: srcH * lo }
}

// ---- Camera layout timeline: which kind is active, and spring transitions between kinds. ----

/** Change points in output time. The first is at -Infinity: the state at t = 0 is already settled. */
// ponytail: O(boundaries x items) scan; an interval tree if projects reach thousands of layout items.
function kindChanges(input: SceneInput, map: TimeMap): Array<{ t: number; kind: Kind }> {
  const { project, transcript, speech } = input
  const items = project.layouts.flatMap((l) => mapRange(map, l.start, l.end).map(([s, e]) => ({ s, e, kind: l.kind, order: l.start })))
  // Words when the recording is transcribed, else speech heard in the mic's levels.
  const spoken = transcript?.words ?? speech?.map(([start, end]) => ({ start, end }))
  const silent = project.style.camera.hideWhenSilent && spoken ? silentRanges(spoken, map) : []
  const cuts = [...new Set([0, map.duration, ...items.flatMap((i) => [i.s, i.e]), ...silent.flat()])].sort((a, b) => a - b)
  const out: Array<{ t: number; kind: Kind }> = []
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1]
    if (b - a < 1e-9) continue
    const m = (a + b) / 2
    let best: (typeof items)[number] | null = null
    for (const it of items) if (it.s <= m && m < it.e && (!best || it.order >= best.order)) best = it
    let kind: Kind = best?.kind ?? 'pip'
    if (kind === 'pip' && silent.some(([s, e]) => s <= m && m < e)) kind = 'hidden'
    if (kind !== out.at(-1)?.kind) out.push({ t: out.length ? a : -Infinity, kind })
  }
  return out.length ? out : [{ t: -Infinity, kind: 'pip' }]
}

/** Output ranges with no speech for at least SILENCE seconds (speech padded by lead and tail). */
export function silentRanges(words: Array<Pick<Word, 'start' | 'end'>>, map: TimeMap): Array<[number, number]> {
  const speech = words.flatMap((w) => mapRange(map, w.start, w.end)).sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  let from = 0
  for (const [s, e] of speech) {
    if (s - SPEECH_LEAD - from >= SILENCE) out.push([from, s - SPEECH_LEAD])
    from = Math.max(from, e + SPEECH_TAIL)
  }
  if (map.duration - from >= SILENCE) out.push([from, map.duration])
  return out
}

/** Speech in a mic track from its levels, for hide when silent without a transcript: source-second
 *  runs where the peaks stand clear of the noise floor for at least 150 ms (a key click or a cough
 *  is shorter). `peaks` are [min, max] pairs of equal buckets over [0, duration), about 50 ms each. */
export function voiceRanges(peaks: Float32Array, duration: number): Array<[number, number]> {
  const n = Math.floor(peaks.length / 2)
  if (!n || !(duration > 0)) return []
  const dt = duration / n
  const db = Array.from({ length: n }, (_, i) => 20 * Math.log10(Math.max(Math.abs(peaks[2 * i]), Math.abs(peaks[2 * i + 1]), 1e-6)))
  const sorted = [...db].sort((a, b) => a - b)
  const floor = sorted[Math.floor(0.2 * (n - 1))]
  const loud = sorted[Math.floor(0.95 * (n - 1))]
  if (loud < -50) return [] // nothing but room tone
  if (loud - floor < 10) return [[0, duration]] // talking all the way through
  const threshold = Math.max(floor + 10, loud - 30)
  const out: Array<[number, number]> = []
  const MIN_RUN = Math.max(1, Math.round(0.15 / dt))
  for (let i = 0; i < n; ) {
    if (db[i] <= threshold) {
      i++
      continue
    }
    let j = i
    while (j < n && db[j] > threshold) j++
    if (j - i >= MIN_RUN) out.push([i * dt, j * dt])
    i = j
  }
  return out
}

function lastChange(changes: Array<{ t: number }>, t: number): number {
  let lo = 0, hi = changes.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (changes[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** State at t given the last change i. A transition interrupted by the next change blends from
 *  wherever it was, so rapid changes and cuts never jump. */
function stateAt(l: PreparedLayout, t: number, i: number, depth = 0): State {
  const c = l.changes[i]
  let to = l.targets[c.kind]
  const dt = t - c.t
  if (i === 0 || dt >= SETTLE || depth > 8) return to
  let from = stateAt(l, c.t, i - 1, depth + 1)
  // The camera hides and appears in place, whatever layout it leaves or enters: a fullscreen or split
  // camera fades where it is instead of flying to the corner as a ghost.
  if (c.kind === 'hidden') to = { ...to, ...hiddenCamera(from) }
  else if (l.changes[i - 1].kind === 'hidden' && from.cameraOpacity < 1e-3) from = { ...from, ...hiddenCamera(to) }
  const p = springProgress(dt, SPRING)
  const mix = (a: number, b: number) => a + (b - a) * p
  const rect = (a: Rect, b: Rect) => ({ x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) })
  return {
    screen: rect(from.screen, to.screen),
    screenRadius: mix(from.screenRadius, to.screenRadius),
    viewport: rect(from.viewport, to.viewport),
    viewportRadius: mix(from.viewportRadius, to.viewportRadius),
    camera: rect(from.camera, to.camera),
    cameraRadius: Math.max(0, mix(from.cameraRadius, to.cameraRadius)),
    cameraOpacity: Math.max(0, mix(from.cameraOpacity, to.cameraOpacity)),
    cameraShadow: Math.max(0, mix(from.cameraShadow, to.cameraShadow)),
    pip: mix(from.pip, to.pip),
  }
}

/** The camera of `s` stepped back to 60% around its center and faded out. */
function hiddenCamera(s: State): Pick<State, 'camera' | 'cameraRadius' | 'cameraOpacity' | 'cameraShadow' | 'pip'> {
  const k = 0.6
  const r = s.camera
  return {
    camera: { x: r.x + (r.w * (1 - k)) / 2, y: r.y + (r.h * (1 - k)) / 2, w: r.w * k, h: r.h * k },
    cameraRadius: s.cameraRadius * k,
    cameraOpacity: 0,
    cameraShadow: s.cameraShadow,
    pip: s.pip,
  }
}

// ---- Camera crop and face follow. ----

/** Normalized camera region shown in `rect`: the largest crop with the rect's aspect, or, with a
 *  face, a closer crop that keeps the face centered (slightly high, like a framed portrait). */
export function cameraCrop(rect: Rect, camW: number, camH: number, face: Omit<FaceSample, 't'> | null): Rect {
  const target = rect.w / Math.max(rect.h, 1e-6)
  const frame = camW / camH
  let w = 1, h = 1
  if (target < frame) w = target / frame
  else h = frame / target
  let cx = 0.5, cy = 0.5
  if (face) {
    const z = Math.min(Math.max((face.h * 3) / h, 0.35), 1)
    w *= z
    h *= z
    cx = face.x + face.w / 2
    cy = face.y + face.h / 2 + h * 0.08
  }
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), Math.max(hi, 0))
  return { x: clamp(cx - w / 2, 1 - w), y: clamp(cy - h / 2, 1 - h), w, h }
}

/** Face box at camera source time t, Gaussian-smoothed over FACE_SIGMA; holds the nearest
 *  detection through gaps. */
export function faceAt(faces: FaceSample[], t: number): Omit<FaceSample, 't'> | null {
  if (!faces.length) return null
  const r = 3 * FACE_SIGMA
  let lo = 0, hi = faces.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (faces[mid].t < t - r) lo = mid + 1
    else hi = mid
  }
  let sum = 0, x = 0, y = 0, w = 0, h = 0
  for (let i = lo; i < faces.length && faces[i].t <= t + r; i++) {
    const f = faces[i]
    const k = Math.exp(-((f.t - t) ** 2) / (2 * FACE_SIGMA ** 2))
    sum += k
    x += (f.x + f.w / 2) * k
    y += (f.y + f.h / 2) * k
    w += f.w * k
    h += f.h * k
  }
  if (sum < 1e-6) {
    const f = faces[Math.min(lo, faces.length - 1)]
    const g = lo > 0 && Math.abs(faces[lo - 1].t - t) < Math.abs(f.t - t) ? faces[lo - 1] : f
    return { x: g.x, y: g.y, w: g.w, h: g.h }
  }
  w /= sum
  h /= sum
  return { x: x / sum - w / 2, y: y / sum - h / 2, w, h }
}

// ---- Masks. ----

/** Masks with their output pieces, sorted by the start of their fade window, with a running max of
 *  window ends: masksAt visits only the masks around t. The zoom camera and the cursor ask for the
 *  layout at every 120 Hz step of a 2-hour project, so a scan over every mask per call adds up. */
function maskIndex(masks: Mask[], map: TimeMap) {
  const list = masks
    .map((m, i) => ({ m, i, ranges: mapRange(map, m.start, m.end) }))
    .filter((x) => x.ranges.length)
    .map((x) => ({ ...x, lo: x.ranges[0][0] - MASK_FADE, hi: x.ranges.at(-1)![1] + MASK_FADE }))
    .sort((a, b) => a.lo - b.lo)
  const maxHi: number[] = []
  list.forEach((x, k) => maxHi.push(Math.max(k ? maxHi[k - 1] : -Infinity, x.hi)))
  return { list, maxHi }
}

function masksAt(l: PreparedLayout, t: number, screen: Rect): MaskLayer[] {
  const out: MaskLayer[] = []
  const { list, maxHi } = l.masks
  let lo = 0
  let hi = list.length // first window starting after t
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].lo <= t) lo = mid + 1
    else hi = mid
  }
  const near: typeof list = []
  for (let k = lo - 1; k >= 0 && maxHi[k] >= t; k--) if (list[k].hi >= t) near.push(list[k])
  for (const { m, ranges } of near.sort((a, b) => a.i - b.i)) {
    let opacity = 0
    for (const [a, b] of ranges) opacity = Math.max(opacity, 1 - Math.max(a - t, t - b, 0) / MASK_FADE)
    if (opacity <= 0) continue
    const r = m.rect
    out.push({ kind: m.kind, opacity: Math.min(opacity, 1), rect: { x: screen.x + r.x * screen.w, y: screen.y + r.y * screen.h, w: r.w * screen.w, h: r.h * screen.h } })
  }
  return out
}

// ---- Device mockups. Our own designs, drawn by the GPU compositor as stacked rounded rects. ----

export type RGBA = [number, number, number, number]
export interface DevicePart {
  rect: Rect
  radii: [number, number, number, number] // tl, tr, br, bl
  top: RGBA // vertical gradient, sRGB 0..1
  bottom: RGBA
  over?: boolean // drawn above the screen content (Dynamic Island)
}
export interface Device {
  parts: DevicePart[]
  shadow: Array<{ rect: Rect; radius: number }> // shadow casters
  displayRadius: number // corner radius of the screen content
}

const hex = (h: string, a = 1): RGBA => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, a]
const grow = (r: Rect, l: number, t = l, rr = l, b = t): Rect => ({ x: r.x - l, y: r.y - t, w: r.w + l + rr, h: r.h + t + b })
const all = (r: number): DevicePart['radii'] => [r, r, r, r]
const dot = (cx: number, cy: number, r: number, c: RGBA): DevicePart => ({ rect: { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, radii: all(r), top: c, bottom: c })

/** Mockup geometry around a screen (display) rect. Every size is proportional to the screen, so
 *  layout fits the whole device and the renderer draws the same shapes at any scale.
 *  Orientation follows the screen: wider than tall is landscape. */
export function deviceGeometry(device: Style['device'], s: Rect): Device | null {
  if (device === 'macbook') {
    const d = Math.max(s.w, s.h)
    const side = 0.021 * d, top = 0.025 * d, chin = 0.036 * d, rim = 0.0026 * d
    const lid = grow(s, side, top, side, chin)
    const shell = grow(lid, rim, rim, rim, 0)
    const baseW = shell.w * 1.14, baseH = 0.024 * d
    const base = { x: s.x + s.w / 2 - baseW / 2, y: lid.y + lid.h, w: baseW, h: baseH }
    const lidR = 0.032 * d
    return {
      displayRadius: 0.011 * d,
      shadow: [{ rect: shell, radius: lidR }, { rect: base, radius: baseH / 2 }],
      parts: [
        { rect: shell, radii: [lidR, lidR, 0, 0], top: hex('#c9ccd2'), bottom: hex('#8e9198') },
        { rect: lid, radii: [lidR - rim, lidR - rim, 0, 0], top: hex('#141518'), bottom: hex('#0b0b0d') },
        dot(s.x + s.w / 2, s.y - top / 2, 0.0038 * d, hex('#23262d')),
        dot(s.x + s.w / 2, s.y - top / 2, 0.0016 * d, hex('#3b4252')),
        { rect: base, radii: [0.003 * d, 0.003 * d, baseH * 0.6, baseH * 0.6], top: hex('#e4e6ea'), bottom: hex('#9a9da5') },
        { rect: { ...base, h: 0.0035 * d }, radii: [0.003 * d, 0.003 * d, 0, 0], top: hex('#f6f7f9'), bottom: hex('#d2d5da') },
        { rect: { x: s.x + s.w / 2 - 0.075 * shell.w, y: base.y, w: 0.15 * shell.w, h: baseH * 0.42 }, radii: [0, 0, baseH * 0.3, baseH * 0.3], top: hex('#a4a7ae'), bottom: hex('#bcbfc5') },
      ],
    }
  }
  if (device === 'iphone' || device === 'ipad') {
    const k = Math.min(s.w, s.h)
    const land = s.w > s.h
    const phone = device === 'iphone'
    const bezel = (phone ? 0.034 : 0.05) * k, band = (phone ? 0.016 : 0.01) * k
    const displayRadius = (phone ? 0.14 : 0.036) * k
    const glass = grow(s, bezel)
    const frame = grow(s, bezel + band)
    const r0 = displayRadius + bezel
    const metal: [RGBA, RGBA, RGBA, RGBA] = phone
      ? [hex('#5a5b61'), hex('#2c2d31'), hex('#8a8b91'), hex('#3d3e43')] // titanium
      : [hex('#8c9097'), hex('#5f636a'), hex('#b4b7bd'), hex('#74777e')] // space gray aluminum
    const parts: DevicePart[] = []
    if (phone) {
      // Side buttons stick out of the frame: action, volume up/down on one side, power on the other.
      const t = 0.009 * k, L = Math.max(s.w, s.h)
      const along = land ? s.x : s.y
      const btn = (side: 0 | 1, at: number, len: number) => {
        const a = along + at * L
        const r = land
          ? { x: a, y: side ? frame.y + frame.h - band : frame.y - t, w: len * L, h: t + band }
          : { x: side ? frame.x + frame.w - band : frame.x - t, y: a, w: t + band, h: len * L }
        parts.push({ rect: r, radii: all(t * 0.8), top: metal[0], bottom: metal[1] })
      }
      // Landscape is portrait turned 90 degrees counterclockwise: the island ends up on the left.
      btn(land ? 1 : 0, 0.2, 0.05)
      btn(land ? 1 : 0, 0.29, 0.09)
      btn(land ? 1 : 0, 0.41, 0.09)
      btn(land ? 0 : 1, 0.33, 0.14)
    }
    parts.push(
      { rect: frame, radii: all(r0 + band), top: metal[0], bottom: metal[1] },
      { rect: grow(s, bezel + band * 0.45), radii: all(r0 + band * 0.45), top: metal[2], bottom: metal[3] },
      { rect: glass, radii: all(r0), top: hex('#0a0a0c'), bottom: hex('#050506') },
    )
    if (phone) {
      const w = 0.32 * k, h = 0.094 * k, off = 0.03 * k
      const rect = land ? { x: s.x + off, y: s.y + s.h / 2 - w / 2, w: h, h: w } : { x: s.x + s.w / 2 - w / 2, y: s.y + off, w, h }
      parts.push({ rect, radii: all(h / 2), top: hex('#000000'), bottom: hex('#000000'), over: true })
    } else {
      // The front camera sits on the long edge (landscape top, portrait right).
      const r = 0.0075 * k
      parts.push(land ? dot(s.x + s.w / 2, s.y - bezel / 2, r, hex('#1c1f26')) : dot(s.x + s.w + bezel / 2, s.y + s.h / 2, r, hex('#1c1f26')))
    }
    return { displayRadius, shadow: [{ rect: frame, radius: r0 + band }], parts }
  }
  return null
}

/** Bounding box of the screen plus its mockup. */
export function deviceBounds(device: Style['device'], s: Rect): Rect {
  const d = deviceGeometry(device, s)
  if (!d) return s
  let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h
  for (const p of d.parts) {
    x0 = Math.min(x0, p.rect.x)
    y0 = Math.min(y0, p.rect.y)
    x1 = Math.max(x1, p.rect.x + p.rect.w)
    y1 = Math.max(y1, p.rect.y + p.rect.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
