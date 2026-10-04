// Owner: compositor. Screen rect (padding, aspect fit, device mockup), camera rect per layout
// (pip, fullscreen, hidden, split) with animated layout transitions, and masks in output px.
// STUB: centered screen with padding, PiP camera, no transitions.

import type { TimeMap } from '../shared/timemap.ts'
import { toSource } from '../shared/timemap.ts'
import type { CameraLayer, MaskLayer, ScreenLayer, SceneInput } from './scene.ts'

export function prepareLayout(input: SceneInput, map: TimeMap, unit: number) {
  return { input, map, unit }
}

export function layoutAt(l: ReturnType<typeof prepareLayout>, t: number): { screen: ScreenLayer | null; camera: CameraLayer | null; masks: MaskLayer[] } {
  const { project, width, height } = l.input
  const st = project.style
  const s = project.sources.screen
  let screen: ScreenLayer | null = null
  if (s) {
    const pad = st.padding * l.unit
    const k = Math.min((width - 2 * pad) / s.width, (height - 2 * pad) / s.height)
    const w = s.width * k
    const h = s.height * k
    screen = { rect: { x: (width - w) / 2, y: (height - h) / 2, w, h }, radius: st.radius * l.unit, shadow: st.shadow, device: st.device }
  }
  let camera: CameraLayer | null = null
  if (project.sources.camera && st.camera.visible !== false) {
    const c = st.camera
    const w = c.size * l.unit
    const h = w / c.aspect
    const inset = c.inset * l.unit
    const x = c.position.endsWith('left') ? inset : width - inset - w
    const y = c.position.startsWith('top') ? inset : height - inset - h
    camera = {
      rect: { x, y, w, h },
      radius: c.shape === 'circle' ? Math.min(w, h) / 2 : c.shape === 'rounded' ? c.radius * l.unit : 0,
      shadow: c.shadow,
      mirror: c.mirror,
      opacity: 1,
      src: toSource(l.map, t),
      crop: { x: 0, y: 0, w: 1, h: 1 },
      removeBackground: c.removeBackground,
    }
  }
  return { screen, camera, masks: [] }
}
