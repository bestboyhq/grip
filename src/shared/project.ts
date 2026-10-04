// The project document: `<name>.studio/project.json`.
// Sources are immutable raw recordings; everything else is edit data on top of them.
// Every timed item is stored in SOURCE time (seconds) and mapped to output time via ./timemap.ts.
// Lengths in Style are in "units": 1 unit = min(outputWidth, outputHeight) / 1080 px,
// so preview (small canvas) and export (full size) lay out identically.

export const PROJECT_VERSION = 1

export type Rect = { x: number; y: number; w: number; h: number }
/** Normalized rect, 0..1 relative to the screen source frame. */
export type NRect = Rect

export interface VideoSource {
  file: string // relative to the bundle, e.g. "sources/screen.mp4"
  width: number // pixels
  height: number
  fps: number
  /** Backing scale factor of the captured display (2 on retina). */
  scale: number
  /** iPhone/iPad rotation changes, by source time: from t on, turn the stored frames `deg`
   *  degrees clockwise to show them upright (the file keeps its first frame's orientation). */
  rotations?: Array<{ t: number; deg: number }>
}

export interface AudioSource {
  file: string // e.g. "sources/mic.m4a"
  channels: number
  sampleRate: number
}

export interface Sources {
  duration: number // seconds of source time
  screen?: VideoSource
  camera?: VideoSource & {
    matte?: string // background-removal alpha matte video, same timing as camera
    faces?: string // face track json: [{t, x, y, w, h}] normalized
  }
  mic?: AudioSource
  system?: AudioSource
  events?: string // "sources/events.jsonl"; absent for imported videos
  transcript?: string // "sources/transcript.json"; see Transcript
  imported?: boolean
}

/** A slice of source time placed on the output timeline. clips[] in output order IS the time map. */
export interface Clip {
  id: string
  start: number // source seconds
  end: number // source seconds, > start
  speed: number // 1 = normal, 2 = twice as fast
  volume: number // 0..2, 1 = unchanged
  muted?: boolean
}

export type ZoomTarget = { kind: 'cursor' } | { kind: 'point'; x: number; y: number } // x,y normalized 0..1

export interface Zoom {
  id: string
  start: number // source seconds
  end: number
  level: number // 1 = no zoom, 2 = 2x
  target: ZoomTarget
  instant?: boolean // cut in/out instead of animating
  mode?: 'zoom' | 'loupe' // loupe = magnify a region in place (glass), default 'zoom'
  auto?: boolean // generated from clicks/typing
  enabled: boolean
}

export type CameraLayoutKind = 'pip' | 'fullscreen' | 'hidden' | 'split'
export interface CameraLayout {
  id: string
  start: number
  end: number
  kind: CameraLayoutKind
}

export interface Mask {
  id: string
  start: number
  end: number
  kind: 'blur' | 'pixelate' | 'highlight'
  rect: NRect
}

/** Speed-up segments derived from typing or chosen by the user are just Clips with speed != 1. */

export interface Word {
  start: number // source seconds
  end: number
  text: string
  filler?: boolean
}
export interface Transcript {
  language: string
  words: Word[]
}

export type Aspect = 'auto' | '16:9' | '9:16' | '4:5' | '1:1' | { w: number; h: number }

export type Background =
  | { kind: 'wallpaper'; id: string }
  | { kind: 'gradient'; stops: string[]; angle: number }
  | { kind: 'color'; color: string }
  | { kind: 'image'; file: string } // relative to bundle ("assets/bg.jpg")

export type CameraPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface Style {
  aspect: Aspect
  background: Background
  backgroundBlur: number // 0..1
  padding: number // units around the screen
  radius: number // units, screen corner radius
  /** Units between the screen frame's edge and the recording inside it, filled with the recording's
   *  edge color, so content clears the rounded corners. Absent = 0. */
  inset?: number
  shadow: number // 0..1
  device: 'none' | 'macbook' | 'iphone' | 'ipad'
  motionBlur: boolean
  cursor: {
    visible: boolean
    size: number // 1 = native size
    smooth: boolean
    hideIdle: boolean
    loop: boolean // return to start position at the end
    click: 'none' | 'ripple' | 'circle' | 'shockwave'
    clickSound: boolean
    /** system (default) = the recorded cursor images; builtin = our vector set (arrow, pointer,
     *  I-beam; other recorded shapes stay as recorded); touch = a touch circle everywhere. */
    set?: 'system' | 'builtin' | 'touch'
  }
  camera: {
    visible?: boolean // absent = true; false hides the camera in every layout
    size: number // units, width of the PiP camera
    shape: 'circle' | 'rounded' | 'square'
    aspect: number // w/h, 1 = square
    radius: number // units, for 'rounded'
    shadow: number
    mirror: boolean
    position: CameraPosition
    inset: number // units from the output edge, independent of padding
    removeBackground: boolean
    followFace: boolean
    hideWhenSilent: boolean
    lut?: string // relative path to a .cube, or a built-in grade 'grade:<id>' (src/engine/gpu/lut.ts)
  }
  keystrokes: { visible: boolean; size: number }
  captions: {
    visible: boolean
    font: string
    size: number // units
    color: string
    position: 'bottom' | 'top'
    mode: 'line' | 'word'
    animation: 'appear' | 'fade' | 'slide'
  }
  autoZoom: { enabled: boolean; level: number }
}

export interface AudioMix {
  mic: { volume: number; muted: boolean; enhance: boolean } // enhance = noise reduction + loudness + limiter
  system: { volume: number; muted: boolean }
  music?: { file: string; volume: number }
}

export interface Project {
  version: number
  name: string
  createdAt: string // ISO
  sources: Sources
  clips: Clip[]
  zooms: Zoom[]
  layouts: CameraLayout[]
  masks: Mask[]
  /** Caption text fixes keyed by word index; the transcript itself stays immutable. */
  captionEdits: Record<number, string>
  style: Style
  audio: AudioMix
  /** Saved playhead, in source seconds (survives cuts). */
  playhead: number
  /** Auto zooms were generated, once, on the first open after recording or import; zooms the user
   *  deletes never come back. Absent in older files = not yet (migrate fills false). */
  autoZoomed: boolean
}

export const defaultStyle = (): Style => ({
  aspect: 'auto',
  background: { kind: 'wallpaper', id: 'dusk' },
  backgroundBlur: 0,
  padding: 80,
  radius: 14,
  inset: 0,
  shadow: 0.6,
  device: 'none',
  motionBlur: true,
  cursor: { visible: true, size: 1.6, smooth: true, hideIdle: true, loop: false, click: 'ripple', clickSound: false, set: 'system' },
  camera: {
    visible: true,
    size: 300,
    shape: 'rounded',
    aspect: 1,
    radius: 40,
    shadow: 0.5,
    mirror: true,
    position: 'bottom-right',
    inset: 40,
    removeBackground: false,
    followFace: false,
    hideWhenSilent: false,
  },
  keystrokes: { visible: true, size: 1 },
  captions: {
    visible: false,
    font: 'system-ui',
    size: 44,
    color: '#ffffff',
    position: 'bottom',
    mode: 'line',
    animation: 'fade',
  },
  autoZoom: { enabled: true, level: 2 },
})

export const uid = () => crypto.randomUUID().slice(0, 8)

export function createProject(name: string, sources: Sources): Project {
  return {
    version: PROJECT_VERSION,
    name,
    createdAt: new Date().toISOString(),
    sources,
    clips: [{ id: uid(), start: 0, end: sources.duration, speed: 1, volume: 1 }],
    zooms: [],
    layouts: [],
    masks: [],
    captionEdits: {},
    style: defaultStyle(),
    audio: { mic: { volume: 1, muted: false, enhance: true }, system: { volume: 1, muted: false } },
    playhead: 0,
    autoZoomed: false,
  }
}
