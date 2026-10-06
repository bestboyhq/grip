// Pure render, part 1: (project, output time t) -> Scene, a plain description of one frame.
// No GPU, no I/O. The GPU compositor (./gpu) draws a Scene; preview and export both go through
// ./compose.ts, so they produce the same pixels (parity invariant).
//
// Coordinates: output pixels, origin top-left, in UNZOOMED space. `view` is the zoom camera:
// an unzoomed point p lands at (p - view.center) * view.scale + (width/2, height/2).
// The view applies to background, screen, cursor, click effects, drawings, and masks (masks and
// drawings stay locked to content), inside the screen's viewport (the whole output except in split
// layouts). Camera, keystrokes, and captions are drawn after it, unzoomed.

import type { Background, Project, Rect, Style, Transcript } from '../shared/project.ts'
import type { InputEvent } from '../shared/events.ts'
import { timeMap, toSource, type TimeMap } from '../shared/timemap.ts'
import { prepareLayout, layoutAt } from './layout.ts'
import { prepareCursor, cursorAt, cursorPath, type CursorPath } from './motion/index.ts'
import { prepareZoom, viewAt, loupeAt, zoomAmount, zoomPath, type ZoomPath } from './zoom/index.ts'
import { prepareOverlays, clicksAt, drawingsAt, keystrokesAt, captionAt } from './overlays/index.ts'

export interface View {
  center: { x: number; y: number }
  scale: number
}

export interface ScreenLayer {
  rect: Rect // where the recording sits; recording px map linearly onto it
  inset: number // px of frame around the recording on every side, filled with the recording's edge color
  radius: number // px, corners of the frame (rect grown by inset)
  shadow: number // 0..1
  device: Style['device']
  /** Output px the zoom view shows the screen through (rounded by viewportRadius): the whole output,
   *  or in split layouts the screen's own frame. Outside it everything is drawn unzoomed. */
  viewport: Rect
  viewportRadius: number
}

export interface CameraLayer {
  rect: Rect
  radius: number // px; rect.w/2 with a square rect = circle
  shadow: number
  mirror: boolean
  opacity: number
  src: number // camera source time (seconds)
  crop: Rect // normalized region of the camera frame to show (face follow, aspect)
  removeBackground: boolean
  lut?: string // bundle-relative .cube color grade
}

export interface CursorLayer {
  x: number // hotspot position, unzoomed output px
  y: number
  image: string // recorded cursor id (sources/cursors/<id>.png) or a BuiltinName from src/assets/cursors.ts
  hotX: number // image px (a built-in's image px are screen points)
  hotY: number
  scale: number // unzoomed output px per cursor image px
  angle: number // radians, tilt on fast moves
  opacity: number
}

export interface Click {
  x: number
  y: number
  age: number // seconds since the click in output time
  style: Style['cursor']['click']
}

/** A stroke drawn on screen while recording, as far as it was drawn by t. */
export interface Drawing {
  points: Array<{ x: number; y: number }> // unzoomed output px
  color: string
  width: number // px
  opacity: number
}

export interface Keystroke {
  keys: string[] // keycaps in macOS order, e.g. ['⇧', '⌘', 'P']; specials as symbols ('↩', '⎋', '←'), 'Space', 'F5'
  opacity: number
  age: number // seconds since the latest press in this group
  count: number // presses merged into this group (⌘Z ⌘Z ⌘Z = 3); key repeat while held does not count
  y: number // bottom edge of the group, unzoomed output px, stacking and entrance applied
  size: number // style.keystrokes.size
}

export interface Caption {
  // active = being spoken now; line = line index in this caption; progress = 0..1 reveal (word mode)
  words: Array<{ text: string; active: boolean; line: number; progress: number }>
  progress: number // 0..1 entrance animation (falls back to 0 when fading out)
  style: Style['captions']
}

/** Glass loupe: magnifies a circle of the screen in place (drawn in zoomed space). */
export interface Loupe {
  x: number // center, unzoomed output px
  y: number
  radius: number // px
  scale: number // magnification
  opacity: number
}

export interface MaskLayer {
  rect: Rect // unzoomed output px
  kind: 'blur' | 'pixelate' | 'highlight'
  opacity: number
}

export interface Scene {
  t: number // output seconds
  src: number // source seconds shown at t
  width: number
  height: number
  unit: number // px per style unit
  background: Background
  backgroundBlur: number
  view: View
  screen: ScreenLayer | null
  camera: CameraLayer | null
  cursor: CursorLayer | null
  clicks: Click[]
  drawings: Drawing[]
  keystrokes: Keystroke[]
  caption: Caption | null
  masks: MaskLayer[]
  loupe: Loupe | null
}

export interface SceneInput {
  project: Project
  events: InputEvent[]
  transcript: Transcript | null
  width: number
  height: number
  /** Parsed sources.camera.faces, for face-follow crop. */
  faces?: FaceSample[]
  /** Source-second runs of speech in the mic (voiceRanges), for hide when silent when there is no
   *  transcript. */
  speech?: Array<[number, number]>
}

/** One face detection: camera source seconds, box normalized to the camera frame. */
export interface FaceSample {
  t: number
  x: number
  y: number
  w: number
  h: number
}

/** Precomputation, done once per project revision and output size. */
export interface Prepared {
  input: SceneInput
  map: TimeMap
  unit: number
  layout: ReturnType<typeof prepareLayout>
  cursor: ReturnType<typeof prepareCursor>
  zoom: ReturnType<typeof prepareZoom>
  overlays: ReturnType<typeof prepareOverlays>
}

/** The heavy part of a preparation as plain data: the cursor path and the zoom camera samples. Each
 *  is reused while its own inputs stay the same. The preview computes them off the main thread
 *  (./paths.worker.ts) and passes them to prepare(); export lets prepare() compute them. */
export interface Paths {
  cursor: CursorPath
  zoom: ZoomPath
}

export function preparePaths(input: SceneInput): Paths {
  const map = timeMap(input.project.clips)
  const layout = prepareLayout(input, map, unitOf(input))
  const cursor = cursorPath(input, map)
  return { cursor, zoom: zoomPath(input, map, layout, prepareCursor(input, map, layout, cursor)) }
}

/** `paths`: preparePaths(input), computed elsewhere (a worker); computed here when absent. */
export function prepare(input: SceneInput, paths?: Paths): Prepared {
  const map = timeMap(input.project.clips)
  const unit = unitOf(input)
  const layout = prepareLayout(input, map, unit)
  const cursor = prepareCursor(input, map, layout, paths?.cursor)
  const zoom = prepareZoom(input, map, layout, cursor, paths?.zoom)
  const overlays = prepareOverlays(input, map, layout)
  return { input, map, unit, layout, cursor, zoom, overlays }
}

const unitOf = (input: SceneInput) => Math.min(input.width, input.height) / 1080

export function sceneAt(p: Prepared, t: number): Scene {
  const { project, width, height } = p.input
  const view = viewAt(p.zoom, t)
  const { screen, camera, masks } = layoutAt(p.layout, t, zoomAmount(p.zoom, t, view))
  return {
    t,
    src: toSource(p.map, t),
    width,
    height,
    unit: p.unit,
    background: project.style.background,
    backgroundBlur: project.style.backgroundBlur,
    view,
    screen,
    camera,
    cursor: cursorAt(p.cursor, t),
    clicks: clicksAt(p.overlays, t),
    drawings: drawingsAt(p.overlays, t),
    keystrokes: keystrokesAt(p.overlays, t),
    caption: captionAt(p.overlays, t),
    masks,
    loupe: loupeAt(p.zoom, t),
  }
}

/** Output pixel size for a project at a given output height (e.g. 1080, 2160). Even numbers for encoders. */
export function outputSize(project: Project, height: number): { width: number; height: number } {
  const a = project.style.aspect
  const s = project.sources.screen
  const ratio =
    a === 'auto' ? (s ? s.width / s.height : 16 / 9)
    : typeof a === 'object' ? a.w / a.h
    : (([w, h]) => w / h)(a.split(':').map(Number))
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return ratio >= 1 ? { width: even(height * ratio), height: even(height) } : { width: even(height), height: even(height / ratio) }
}
