// Owner: compositor. WebGPU compositor: draws a Scene with its source frames onto a canvas
// (HTMLCanvasElement for preview, OffscreenCanvas for export). Resolution independent: all
// geometry comes from the Scene in output px.
//
// Passes per frame (shaders.wgsl):
//   small      screen frame -> quarter-res mip pyramid, only while blur/pixelate masks show
//   main       background, shadow, device mockup, screen, blur/pixelate masks; motion blur over
//              the shutter's view samples
//   cursor     swept quad, motion blur over the shutter's cursor samples
//   highlight, loupe, camera
//   final      overlay canvas (clicks, drawings, keystrokes, captions) on top, dithered to the 8-bit canvas
// Composition happens in an rgba16float frame, so soft shadows and gradients never band before
// the final dither. Steady state allocates no GPU memory: textures live until the output size or
// an asset changes, and video frames come in zero-copy as external textures.

import type { Background, Rect } from '../../shared/project.ts'
import type { CursorLayer, Scene, View } from '../scene.ts'
import { deviceGeometry } from '../layout.ts'
import { drawOverlays } from '../overlays/index.ts'
import { oklab, parseColor, wallpaper, DEFAULT_WALLPAPER } from '../backgrounds/index.ts'
import { CURSORS, CURSOR_RES, type BuiltinName } from '../../assets/cursors.ts'
import { GRADE, gradeLut, parseCube, type Lut } from './lut.ts'
import shaders from './shaders.wgsl?raw'

// Wallpaper styles: one file per style defining wp_<style>(uv, wh) -> encoded sRGB, joined to the
// main module behind a generated dispatch, so adding a style is adding a file.
const styleCode = import.meta.glob<string>('./wallpapers/*.wgsl', { query: '?raw', import: 'default', eager: true })
const STYLES = Object.keys(styleCode).sort().map((k) => k.slice('./wallpapers/'.length, -'.wgsl'.length))
const shaderCode = (styles: string[]) => [
  shaders,
  ...styles.map((s) => styleCode[`./wallpapers/${s}.wgsl`]),
  `fn wallpaper(uv: vec2f, wh: vec2f, style: i32) -> vec3f {
  var c = vec3f(0.0);
  switch style {
${styles.map((s) => `    case ${STYLES.indexOf(s)}: { c = wp_${s}(uv, wh); }`).join('\n')}
    default: {}
  }
  return c;
}`,
].join('\n')

export interface Frames {
  screen: VideoFrame | null
  camera: VideoFrame | null
  /** Background-removal alpha matte for the camera frame (sources.camera.matte, same timing). */
  matte?: VideoFrame | null
}

/** Shutter samples for motion blur (see compose.ts), evenly spaced in time, oldest first. */
export interface Motion {
  views: View[]
  cursors: Array<CursorLayer | null>
}

// `struct Frame` in shaders.wgsl, in vec4 slots.
const A = 0, VIEWT = 1, SCR = 2, SCR2 = 3, SCR3 = 4, DEV = 5, SH = 6, VIEWS = 10, PARTS = 26, MASKS = 74
const CUR = 106, CURIMG = 107, CURTEX = 108, CURBOX = 109, CURS = 110, LOUPE = 126, LOUPE2 = 127
const CAM = 128, CAM1 = 129, CAM2 = 130, CAM3 = 131, CAM4 = 132, LUTMIN = 133, LUTMAX = 134, FIN = 135, VP = 136
const FRAME_SLOTS = 137
const PASS_SLOTS = 27 // `struct Pass`
const MAX_SAMPLES = 16, MAX_PARTS = 12, MAX_MASKS = 16, MAX_STOPS = 12
const MASK_KIND = { blur: 0, pixelate: 1, highlight: 2 } as const

// WebGPU flag values (the TS DOM lib has the types but not these namespaces).
const STAGE = { VERTEX: 1, FRAGMENT: 2 }
const BUF = { COPY_DST: 8, UNIFORM: 64 }
const TEX = { COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 }

const HDR: GPUTextureFormat = 'rgba16float'
const LDR: GPUTextureFormat = 'rgba8unorm'
const MAX_IMAGE = 8192

interface CursorTex {
  group: GPUBindGroup
  w: number // image px
  h: number
  hot: [number, number] | null // only on the arrow standing in for a missing recorded image; else the layer's hotspot
  res: number // texture px per image px
}

interface Small {
  w: number
  h: number
  tex: GPUTexture
  all: GPUTextureView
  target: GPUTextureView
  mips: Array<{ view: GPUTextureView; group: GPUBindGroup }>
}

const mipCount = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1

/** Up to n evenly spaced items, keeping both ends. */
const even = <T>(a: T[], n: number): T[] => (a.length <= n ? a : Array.from({ length: n }, (_, i) => a[Math.round((i * (a.length - 1)) / (n - 1))]))

/** Piecewise-linear sample of a shutter series at f in 0..1, matching viewAt/curAt in the shader. */
function along<T>(a: T[], f: number, mix: (x: T, y: T, k: number) => T): T {
  if (a.length === 1) return a[0]
  const x = Math.min(Math.max(f, 0), 1) * (a.length - 1)
  const i = Math.min(Math.floor(x), a.length - 2)
  return mix(a[i], a[i + 1], x - i)
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const mixView = (a: View, b: View, k: number): View => ({ center: { x: lerp(a.center.x, b.center.x, k), y: lerp(a.center.y, b.center.y, k) }, scale: lerp(a.scale, b.scale, k) })
const mixCursor = (a: CursorLayer, b: CursorLayer, k: number): CursorLayer => ({ ...a, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), scale: lerp(a.scale, b.scale, k), angle: lerp(a.angle, b.angle, k) })

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  private readonly device: GPUDevice
  private readonly ctx: GPUCanvasContext
  private readonly assetUrl: (rel: string) => string
  private lost: string | null = null

  private pipes!: Record<'main' | 'cursor' | 'highlight' | 'loupe' | 'camera' | 'final' | 'small' | 'mipLDR' | 'mipHDR' | 'bg' | 'blur' | 'viewblur', GPURenderPipeline>
  private groups!: { g0: GPUBindGroupLayout; g1: GPUBindGroupLayout; g2: GPUBindGroupLayout }
  private sampler!: GPUSampler
  private frameU!: GPUBuffer
  private passU!: GPUBuffer[] // background, blur x, blur y
  private readonly u = new Float32Array(FRAME_SLOTS * 4)
  private dummy2d!: GPUTextureView
  private dummy3d!: GPUTextureView
  private noCursor!: GPUBindGroup
  private smallG0!: GPUBindGroup
  private placeholder!: VideoFrame

  // Bound to the output size.
  private w = 0
  private h = 0
  private frame?: GPUTexture
  private frameView?: GPUTextureView
  private overlay?: GPUTexture
  private overlayCanvas?: OffscreenCanvas
  private overlayCtx?: OffscreenCanvasRenderingContext2D
  private finalGroup?: GPUBindGroup
  private zoomed?: { tex: GPUTexture; view: GPUTextureView; group: GPUBindGroup } // the zoomed layer at t, while the view moves

  // Bound to content; rebuilt only when it changes.
  private bgKey = ''
  private bgView?: GPUTextureView
  private bgTex?: GPUTexture
  private small?: Small
  private lutKey = ''
  private lutTex?: GPUTexture
  private lut: Lut | null = null
  private g0?: GPUBindGroup

  private readonly cursors = new Map<string, Promise<CursorTex>>()
  private readonly images = new Map<string, Promise<ImageBitmap | null>>()
  private readonly luts = new Map<string, Promise<Lut | null>>()
  private readonly warned = new Set<string>()

  private constructor(canvas: HTMLCanvasElement | OffscreenCanvas, device: GPUDevice, ctx: GPUCanvasContext, assetUrl: (rel: string) => string) {
    this.canvas = canvas
    this.device = device
    this.ctx = ctx
    this.assetUrl = assetUrl
  }

  /** `assetUrl(relPath)` resolves bundle-relative assets (cursor PNGs, background images, LUTs). */
  static async create(canvas: HTMLCanvasElement | OffscreenCanvas, assetUrl: (rel: string) => string): Promise<Renderer> {
    const gpu = (globalThis.navigator as Navigator | undefined)?.gpu
    if (!gpu) throw new Error('This Mac cannot render video: WebGPU is not available.')
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('This Mac cannot render video: no GPU is available.')
    const device = await adapter.requestDevice()
    const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!ctx) throw new Error('Could not start GPU rendering on this canvas.')
    const format = gpu.getPreferredCanvasFormat()
    ctx.configure({ device, format, alphaMode: 'opaque' })
    const r = new Renderer(canvas, device, ctx, assetUrl)
    device.lost.then((info) => (r.lost = info.message || info.reason))
    device.addEventListener('uncapturederror', (e) => console.error('Grip GPU error:', (e as GPUUncapturedErrorEvent).error.message))
    await r.init(format)
    return r
  }

  /** A scene with only a background, e.g. for wallpaper thumbnails. */
  static backgroundScene(background: Background, width: number, height: number, blur = 0): Scene {
    return {
      t: 0, src: 0, width, height, unit: Math.min(width, height) / 1080, background, backgroundBlur: blur,
      view: { center: { x: width / 2, y: height / 2 }, scale: 1 },
      screen: null, camera: null, cursor: null, clicks: [], drawings: [], keystrokes: [], caption: null, masks: [], loupe: null,
    }
  }

  private async init(canvasFormat: GPUTextureFormat) {
    const d = this.device
    let styles = STYLES
    if (import.meta.env.DEV) {
      // A style that does not compile renders black instead of taking the whole compositor down
      // while someone works on it.
      const ok = await Promise.all(STYLES.map(async (s) => {
        const errors = (await d.createShaderModule({ code: shaderCode([s]) }).getCompilationInfo()).messages.filter((m) => m.type === 'error')
        if (errors.length) console.error(`Wallpaper style ${s}.wgsl: ` + errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '))
        return !errors.length
      }))
      styles = STYLES.filter((_, i) => ok[i])
    }
    const module = d.createShaderModule({ code: shaderCode(styles) })
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter((m) => m.type === 'error')
    if (errors.length) throw new Error('Compositor shader: ' + errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; '))

    const F = STAGE.FRAGMENT
    const tex = (binding: number, viewDimension: GPUTextureViewDimension = '2d'): GPUBindGroupLayoutEntry => ({ binding, visibility: F, texture: { sampleType: 'float', viewDimension } })
    this.groups = {
      g0: d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: STAGE.VERTEX | F, buffer: { type: 'uniform' } },
          { binding: 1, visibility: F, sampler: { type: 'filtering' } },
          tex(2), tex(3), tex(4, '3d'),
        ],
      }),
      g1: d.createBindGroupLayout({ entries: [0, 1, 2].map((binding) => ({ binding, visibility: F, externalTexture: {} })) }),
      g2: d.createBindGroupLayout({ entries: [tex(0)] }),
    }
    const scene = d.createPipelineLayout({ bindGroupLayouts: [this.groups.g0, this.groups.g1, this.groups.g2] })
    const over = (alpha: GPUBlendComponent): GPUBlendState => ({ color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha })
    const keep: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one' } // leaves the dither mark alone
    const clear: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' } // opaque content is not dithered
    const pipe = (vs: string, fs: string, format: GPUTextureFormat, layout: GPUPipelineLayout | 'auto', blend?: GPUBlendState) =>
      d.createRenderPipelineAsync({
        layout,
        vertex: { module, entryPoint: vs },
        fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
        primitive: { topology: vs === 'vs_full' ? 'triangle-list' : 'triangle-strip' },
      })
    const [main, cursor, highlight, loupe, camera, final, small, mipLDR, mipHDR, bg, blur, viewblur] = await Promise.all([
      pipe('vs_full', 'fs_main', HDR, scene),
      pipe('vs_cursor', 'fs_cursor', HDR, scene, over(clear)),
      pipe('vs_full', 'fs_highlight', HDR, scene, over(keep)),
      pipe('vs_loupe', 'fs_loupe', HDR, scene, over(keep)),
      pipe('vs_camera', 'fs_camera', HDR, scene, over(clear)),
      pipe('vs_full', 'fs_final', canvasFormat, 'auto'),
      pipe('vs_full', 'fs_small', LDR, 'auto'),
      pipe('vs_full', 'fs_mip', LDR, 'auto'),
      pipe('vs_full', 'fs_mip', HDR, 'auto'),
      pipe('vs_full', 'fs_bg', HDR, 'auto'),
      pipe('vs_full', 'fs_blur', HDR, 'auto'),
      pipe('vs_full', 'fs_viewblur', HDR, 'auto'),
    ])
    this.pipes = { main, cursor, highlight, loupe, camera, final, small, mipLDR, mipHDR, bg, blur, viewblur }

    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' })
    this.frameU = d.createBuffer({ size: FRAME_SLOTS * 16, usage: BUF.UNIFORM | BUF.COPY_DST })
    this.passU = [0, 1, 2].map(() => d.createBuffer({ size: PASS_SLOTS * 16, usage: BUF.UNIFORM | BUF.COPY_DST }))
    this.dummy2d = this.texture(1, 1, LDR).createView()
    this.dummy3d = d.createTexture({ size: [2, 2, 2], dimension: '3d', format: HDR, usage: TEX.TEXTURE_BINDING }).createView({ dimension: '3d' })
    this.noCursor = d.createBindGroup({ layout: this.groups.g2, entries: [{ binding: 0, resource: this.dummy2d }] })
    this.smallG0 = d.createBindGroup({ layout: small.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.frameU } }, { binding: 1, resource: this.sampler }] })
    this.placeholder = new VideoFrame(new Uint8Array(16), { format: 'RGBA', codedWidth: 2, codedHeight: 2, timestamp: 0 })
  }

  /** Draw one frame. Assets (cursor images, background image, LUT) load on first use and are
   *  awaited, so the first frame is already correct; everything after that encodes and submits
   *  synchronously in one go. The caller owns and closes the frames after this resolves. */
  async draw(scene: Scene, frames: Frames, motion?: Motion): Promise<void> {
    this.check()
    const bg = scene.background
    const [cursor, image, lut] = await Promise.all([
      scene.cursor ? this.cursorTex(scene.cursor.image) : null,
      bg.kind === 'image' ? this.image(bg.file) : null,
      scene.camera?.lut ? this.lutFile(scene.camera.lut) : null,
    ])
    this.check()
    const d = this.device
    this.resize(scene.width, scene.height)
    this.ensureBackground(scene, image)
    if (scene.camera) this.ensureLut(scene.camera.lut ?? '', lut)
    const screen = frames.screen
    const needSmall = !!screen && !!scene.screen && scene.masks.some((m) => m.kind !== 'highlight')
    if (needSmall) this.ensureSmall(screen.displayWidth, screen.displayHeight)
    this.g0 ??= d.createBindGroup({
      layout: this.groups.g0,
      entries: [
        { binding: 0, resource: { buffer: this.frameU } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: this.bgView! },
        { binding: 3, resource: this.small?.all ?? this.dummy2d },
        { binding: 4, resource: this.lutTex?.createView({ dimension: '3d' }) ?? this.dummy3d },
      ],
    })
    const has = this.pack(scene, frames, motion, cursor)
    has.overlay = this.paintOverlay(scene)
    this.u[FIN * 4] = has.overlay ? 1 : 0
    d.queue.writeBuffer(this.frameU, 0, this.u)

    const ext = (f: VideoFrame | null | undefined) => d.importExternalTexture({ source: f ?? this.placeholder })
    const media = d.createBindGroup({
      layout: this.groups.g1,
      entries: [
        { binding: 0, resource: ext(screen) },
        { binding: 1, resource: ext(has.camera ? frames.camera : null) },
        { binding: 2, resource: ext(has.camera ? frames.matte : null) },
      ],
    })
    const enc = d.createCommandEncoder()
    if (needSmall) {
      const group = d.createBindGroup({ layout: this.pipes.small.getBindGroupLayout(1), entries: [{ binding: 0, resource: ext(screen) }] })
      this.blit(enc, this.pipes.small, this.small!.target, this.smallG0, group)
      for (const m of this.small!.mips) this.blit(enc, this.pipes.mipLDR, m.view, m.group)
    }
    // A moving view renders the zoomed layer once, then motion-blurs it by reprojection into the frame.
    const groups = [this.g0, media, cursor?.group ?? this.noCursor]
    const z = has.moving ? this.zoomTarget() : null
    if (z) {
      const zp = enc.beginRenderPass({ colorAttachments: [{ view: z.view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
      groups.forEach((g, i) => zp.setBindGroup(i, g))
      zp.setPipeline(this.pipes.main)
      zp.draw(3)
      zp.end()
    }
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.frameView!, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] })
    if (z) {
      pass.setPipeline(this.pipes.viewblur)
      pass.setBindGroup(0, z.group)
      pass.draw(3)
    }
    groups.forEach((g, i) => pass.setBindGroup(i, g))
    if (!z) {
      pass.setPipeline(this.pipes.main)
      pass.draw(3)
    }
    if (has.cursor) {
      pass.setPipeline(this.pipes.cursor)
      pass.draw(4)
    }
    if (has.highlight) {
      pass.setPipeline(this.pipes.highlight)
      pass.draw(3)
    }
    if (has.loupe) {
      pass.setPipeline(this.pipes.loupe)
      pass.draw(4)
    }
    if (has.camera) {
      pass.setPipeline(this.pipes.camera)
      pass.draw(4)
    }
    pass.end()
    this.blit(enc, this.pipes.final, this.ctx.getCurrentTexture().createView(), this.finalGroup!)
    d.queue.submit([enc.finish()])
  }

  /** Resolves when the GPU has finished every submitted frame (export backpressure, benchmarks). */
  finished(): Promise<void> {
    return this.device.queue.onSubmittedWorkDone()
  }

  destroy() {
    this.device.destroy()
    this.placeholder?.close()
    for (const p of this.images.values()) p.then((b) => b?.close())
    this.cursors.clear()
    this.images.clear()
    this.luts.clear()
  }

  // ---- Per-frame uniforms ----

  private pack(scene: Scene, frames: Frames, motion: Motion | undefined, cursor: CursorTex | null) {
    const u = this.u
    u.fill(0)
    const set = (slot: number, a = 0, b = 0, c = 0, d = 0) => u.set([a, b, c, d], slot * 4)
    const rect = (slot: number, r: Rect) => set(slot, r.x, r.y, r.w, r.h)
    const { width: W, height: H } = scene
    const views = motion && motion.views.length > 1 ? even(motion.views, MAX_SAMPLES) : [scene.view]
    const has = { moving: views.length > 1, cursor: false, highlight: false, loupe: false, camera: false, overlay: false }
    set(A, W, H, scene.unit, views.length)
    set(VIEWT, scene.view.center.x, scene.view.center.y, scene.view.scale, scene.screen?.viewportRadius ?? 0)
    rect(VP, scene.screen?.viewport ?? { x: 0, y: 0, w: W, h: H })
    views.forEach((v, i) => set(VIEWS + i, v.center.x, v.center.y, v.scale))

    const s = scene.screen
    if (s && s.rect.w > 0 && s.rect.h > 0) {
      const srcW = frames.screen?.displayWidth ?? s.rect.w
      const srcH = frames.screen?.displayHeight ?? s.rect.h
      const masks = scene.masks.slice(0, MAX_MASKS) // ponytail: 16 masks on screen at once; a storage buffer if anyone needs more
      const big = Math.max(srcW, srcH)
      const inset = Math.max(0, s.inset)
      const frame = { x: s.rect.x - inset, y: s.rect.y - inset, w: s.rect.w + 2 * inset, h: s.rect.h + 2 * inset }
      set(SCR2, Math.min(s.radius, frame.w / 2, frame.h / 2), 1, masks.length, s.shadow)
      set(SCR3, srcW, srcH, Math.max(8, Math.round(big / 72)), Math.max(0, Math.log2(big / 400)))
      rect(SCR, s.rect)
      const kx = srcW / s.rect.w, ky = srcH / s.rect.h
      masks.forEach((m, i) => {
        set(MASKS + i * 2, (m.rect.x - s.rect.x) * kx, (m.rect.y - s.rect.y) * ky, m.rect.w * kx, m.rect.h * ky)
        set(MASKS + i * 2 + 1, MASK_KIND[m.kind], m.opacity, big * 0.006)
        if (m.kind === 'highlight') has.highlight = true
      })
      const dev = deviceGeometry(s.device, frame)
      const parts = dev ? [...dev.parts.filter((p) => !p.over), ...dev.parts.filter((p) => p.over)].slice(0, MAX_PARTS) : []
      parts.forEach((p, i) => {
        rect(PARTS + i * 4, p.rect)
        set(PARTS + i * 4 + 1, ...p.radii)
        set(PARTS + i * 4 + 2, ...p.top)
        set(PARTS + i * 4 + 3, ...p.bottom)
      })
      const casters = (dev ? dev.shadow : [{ rect: frame, radius: s.radius }]).slice(0, 2)
      casters.forEach((c, i) => {
        rect(SH + i * 2, c.rect)
        set(SH + i * 2 + 1, Math.min(c.radius, c.rect.w / 2, c.rect.h / 2))
      })
      set(DEV, parts.length, parts.filter((p) => !p.over).length, casters.length, inset)
    }

    const c0 = scene.cursor
    if (c0 && cursor && c0.opacity > 0 && c0.scale > 0) {
      const moving = motion?.cursors.filter((c): c is CursorLayer => !!c && c.scale > 0) ?? []
      const cs = even(moving.length > 1 ? moving : [c0], MAX_SAMPLES)
      const [hx, hy] = cursor.hot ?? [c0.hotX, c0.hotY]
      set(CURIMG, cursor.w, cursor.h, hx, hy)
      set(CURTEX, cursor.res)
      cs.forEach((c, i) => set(CURS + i, c.x, c.y, c.scale, c.angle))
      // Swept bounds and samples per pixel, walking the shutter the way the shader does.
      const n = Math.max(cs.length, views.length)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, path = 0
      let prev: number[] | null = null
      for (let k = 0; k < n; k++) {
        const f = n > 1 ? k / (n - 1) : 0.5
        const v = along(views, f, mixView)
        const c = along(cs, f, mixCursor)
        const co = Math.cos(c.angle), si = Math.sin(c.angle)
        const pts = [[0, 0], [cursor.w, 0], [0, cursor.h], [cursor.w, cursor.h]].flatMap(([ix, iy]) => {
          const dx = (ix - hx) * c.scale, dy = (iy - hy) * c.scale
          const ux = c.x + co * dx - si * dy, uy = c.y + si * dx + co * dy
          return [(ux - v.center.x) * v.scale + W / 2, (uy - v.center.y) * v.scale + H / 2]
        })
        let step = 0
        for (let i = 0; i < 8; i += 2) {
          x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i])
          y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1])
          if (prev) step = Math.max(step, Math.hypot(pts[i] - prev[i], pts[i + 1] - prev[i + 1]))
        }
        path += step
        prev = pts
      }
      set(CURBOX, Math.max(x0 - 2, 0), Math.max(y0 - 2, 0), Math.min(x1 + 2, W), Math.min(y1 + 2, H))
      set(CUR, cs.length, Math.min(c0.opacity, 1), Math.min(32, Math.max(1, Math.ceil(path / 1.5))), 1)
      has.cursor = x1 > 0 && y1 > 0 && x0 < W && y0 < H
    }

    const l = scene.loupe
    if (l && l.opacity > 0 && l.radius > 0) {
      set(LOUPE, l.x, l.y, l.radius, Math.max(l.scale, 1e-3))
      set(LOUPE2, Math.min(l.opacity, 1), 1)
      has.loupe = true
    }

    const cam = scene.camera
    if (cam && frames.camera && cam.opacity > 0 && cam.rect.w > 0 && cam.rect.h > 0) {
      rect(CAM, cam.rect)
      set(CAM1, Math.min(cam.radius, cam.rect.w / 2, cam.rect.h / 2), cam.shadow, Math.min(cam.opacity, 1), cam.mirror ? 1 : 0)
      rect(CAM2, cam.crop)
      set(CAM3, cam.removeBackground && frames.matte ? 1 : 0, this.lut ? 1 : 0, this.lut?.size ?? 0)
      set(CAM4, frames.camera.displayWidth, frames.camera.displayHeight)
      if (this.lut) {
        set(LUTMIN, ...this.lut.min)
        set(LUTMAX, ...this.lut.max)
      }
      has.camera = true
    }
    return has
  }

  private paintOverlay(scene: Scene): boolean {
    if (!scene.clicks.length && !scene.drawings.length && !scene.keystrokes.length && !scene.caption) return false
    const ctx = this.overlayCtx!
    ctx.clearRect(0, 0, this.w, this.h)
    drawOverlays(ctx, scene)
    this.device.queue.copyExternalImageToTexture({ source: this.overlayCanvas! }, { texture: this.overlay!, premultipliedAlpha: true }, [this.w, this.h])
    return true
  }

  // ---- Resources ----

  private check() {
    if (this.lost) throw new Error(`Rendering stopped because the GPU was reset (${this.lost}). Reopen the project to continue.`)
  }

  private texture(w: number, h: number, format: GPUTextureFormat, mipLevelCount = 1): GPUTexture {
    const usage = TEX.TEXTURE_BINDING | TEX.RENDER_ATTACHMENT | (format === LDR ? TEX.COPY_DST : 0)
    return this.device.createTexture({ size: [Math.max(1, w), Math.max(1, h)], format, mipLevelCount, usage })
  }

  private blit(enc: GPUCommandEncoder, pipe: GPURenderPipeline, target: GPUTextureView, ...groups: GPUBindGroup[]) {
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] })
    pass.setPipeline(pipe)
    groups.forEach((g, i) => pass.setBindGroup(i, g))
    pass.draw(3)
    pass.end()
  }

  private srcGroup(pipe: GPURenderPipeline, src: GPUTextureView, pass?: GPUBuffer): GPUBindGroup {
    const entries: GPUBindGroupEntry[] = [{ binding: 1, resource: this.sampler }, { binding: 20, resource: src }]
    if (pass) entries.push({ binding: 21, resource: { buffer: pass } })
    return this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries })
  }

  private level = (t: GPUTexture, i: number) => t.createView({ baseMipLevel: i, mipLevelCount: 1 })

  /** Fill mip levels 1.. of `t` from level 0 by repeated 2x2 averaging. */
  private mips(enc: GPUCommandEncoder, t: GPUTexture, pipe: GPURenderPipeline) {
    for (let i = 1; i < t.mipLevelCount; i++) this.blit(enc, pipe, this.level(t, i), this.srcGroup(pipe, this.level(t, i - 1)))
  }

  private resize(W: number, H: number) {
    if (W === this.w && H === this.h) return
    if (!(W > 0 && H > 0 && W <= 16384 && H <= 16384)) throw new Error(`Cannot render a ${W}x${H} frame.`)
    this.w = W
    this.h = H
    if (this.canvas.width !== W) this.canvas.width = W
    if (this.canvas.height !== H) this.canvas.height = H
    this.frame?.destroy()
    this.overlay?.destroy()
    this.zoomed?.tex.destroy()
    this.zoomed = undefined
    this.frame = this.texture(W, H, HDR)
    this.frameView = this.frame.createView()
    this.overlay = this.texture(W, H, LDR)
    this.overlayCanvas = new OffscreenCanvas(W, H)
    this.overlayCtx = this.overlayCanvas.getContext('2d')!
    this.finalGroup = this.device.createBindGroup({
      layout: this.pipes.final.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameU } }, { binding: 10, resource: this.frameView }, { binding: 11, resource: this.overlay.createView() }],
    })
  }

  /** Target for the zoomed layer while the view moves; allocated on the first moving frame, kept after. */
  private zoomTarget() {
    if (!this.zoomed) {
      const tex = this.texture(this.w, this.h, HDR)
      const view = tex.createView()
      const group = this.device.createBindGroup({
        layout: this.pipes.viewblur.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.frameU } }, { binding: 1, resource: this.sampler }, { binding: 30, resource: view }],
      })
      this.zoomed = { tex, view, group }
    }
    return this.zoomed
  }

  /** Render the background (wallpaper, gradient, color, or image, then blur) into a texture the
   *  main pass samples under the zoom view. Rebuilt only when the background or size changes. */
  private ensureBackground(scene: Scene, image: ImageBitmap | null) {
    const { width: W, height: H } = scene
    const blur = Math.min(Math.max(scene.backgroundBlur || 0, 0), 1)
    const key = JSON.stringify([scene.background, blur, W, H, !!image])
    if (key === this.bgKey) return
    this.bgKey = key
    this.g0 = undefined
    this.bgTex?.destroy()
    const d = this.device
    const sigma = blur * 48 * scene.unit
    const lod = sigma > 0.5 ? Math.max(0, Math.floor(Math.log2(sigma / 4))) : 0
    const base = this.texture(W, H, HDR, sigma > 0.5 ? lod + 1 : 1)
    const p = new Float32Array(PASS_SLOTS * 4)
    const lab = (slot: number, c: readonly number[]) => p.set([...oklab(c), 1], slot * 4)
    const COLS = 15
    let bg = scene.background
    if (bg.kind === 'image' && !image) bg = { kind: 'wallpaper', id: DEFAULT_WALLPAPER }
    let img: GPUTexture | null = null
    const enc = d.createCommandEncoder()
    p.set([W, H], 5)
    if (bg.kind === 'color') {
      p[0] = 0
      lab(COLS, parseColor(bg.color) ?? [0, 0, 0])
    } else if (bg.kind === 'gradient') {
      const stops = bg.stops.map(parseColor).filter((c) => !!c).slice(0, MAX_STOPS) as number[][]
      if (!stops.length) stops.push([0, 0, 0])
      if (stops.length === 1) stops.push(stops[0])
      p.set([1, stops.length, ((bg.angle ?? 180) * Math.PI) / 180], 0)
      stops.forEach((c, i) => lab(COLS + i, c))
    } else if (bg.kind === 'wallpaper') {
      let w = wallpaper(bg.id)
      if (!STYLES.includes(w.style)) w = wallpaper(DEFAULT_WALLPAPER)
      p.set([2, w.colors.length, STYLES.indexOf(w.style)], 0)
      p.set(w.params.slice(0, 48), 3 * 4)
      w.colors.slice(0, 12).forEach((c, i) => lab(COLS + i, parseColor(c) ?? [0, 0, 0]))
    } else if (image) {
      img = this.texture(image.width, image.height, LDR, mipCount(image.width, image.height))
      d.queue.copyExternalImageToTexture({ source: image }, { texture: img, premultipliedAlpha: true }, [image.width, image.height])
      this.mips(enc, img, this.pipes.mipLDR)
      const k = Math.max(W / image.width, H / image.height) // cover
      const sx = W / (image.width * k), sy = H / (image.height * k)
      p.set([3], 0)
      p[7] = Math.max(0, Math.log2(1 / k))
      p.set([sx, sy, (1 - sx) / 2, (1 - sy) / 2], 8)
    }
    d.queue.writeBuffer(this.passU[0], 0, p)
    const group = d.createBindGroup({
      layout: this.pipes.bg.getBindGroupLayout(0),
      entries: [{ binding: 1, resource: this.sampler }, { binding: 21, resource: { buffer: this.passU[0] } }, { binding: 22, resource: img?.createView() ?? this.dummy2d }],
    })
    this.blit(enc, this.pipes.bg, this.level(base, 0), group)
    let result = base
    const temps = [base]
    if (sigma > 0.5) {
      // Blur at a reduced level so a large radius stays a short kernel: sigma there is 4..8 texels.
      this.mips(enc, base, this.pipes.mipHDR)
      const lw = Math.max(1, W >> lod), lh = Math.max(1, H >> lod)
      const s = sigma / 2 ** lod
      const a = this.texture(lw, lh, HDR)
      const b = this.texture(lw, lh, HDR)
      d.queue.writeBuffer(this.passU[1], 0, new Float32Array([1 / lw, 0, s, lod]))
      d.queue.writeBuffer(this.passU[2], 0, new Float32Array([0, 1 / lh, s, 0]))
      this.blit(enc, this.pipes.blur, a.createView(), this.srcGroup(this.pipes.blur, base.createView(), this.passU[1]))
      this.blit(enc, this.pipes.blur, b.createView(), this.srcGroup(this.pipes.blur, a.createView(), this.passU[2]))
      temps.push(a)
      result = b
    }
    d.queue.submit([enc.finish()])
    for (const t of temps) if (t !== result) t.destroy() // freed once the submitted work is done
    img?.destroy()
    this.bgTex = result
    this.bgView = result.createView()
  }

  private ensureSmall(fw: number, fh: number) {
    const w = Math.max(1, Math.ceil(fw / 4)), h = Math.max(1, Math.ceil(fh / 4))
    if (this.small && this.small.w === w && this.small.h === h) return
    this.small?.tex.destroy()
    const tex = this.texture(w, h, LDR, mipCount(w, h))
    const mips = Array.from({ length: tex.mipLevelCount - 1 }, (_, i) => ({ view: this.level(tex, i + 1), group: this.srcGroup(this.pipes.mipLDR, this.level(tex, i)) }))
    this.small = { w, h, tex, all: tex.createView(), target: this.level(tex, 0), mips }
    this.g0 = undefined
  }

  private ensureLut(key: string, lut: Lut | null) {
    if (key === this.lutKey) return
    this.lutKey = key
    this.lutTex?.destroy()
    this.lutTex = undefined
    this.lut = lut
    this.g0 = undefined
    if (!lut) return
    const n = lut.size
    this.lutTex = this.device.createTexture({ size: [n, n, n], dimension: '3d', format: HDR, usage: TEX.TEXTURE_BINDING | TEX.COPY_DST })
    this.device.queue.writeTexture({ texture: this.lutTex }, Float16Array.from(lut.data), { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n])
  }

  // ---- Asset loading (cached; failures fall back and warn once) ----

  private warn(what: string, e: unknown) {
    if (this.warned.has(what)) return
    this.warned.add(what)
    console.warn(`Grip could not load ${what}: ${e instanceof Error ? e.message : e}`)
  }

  private async bitmap(rel: string): Promise<ImageBitmap> {
    const res = await fetch(this.assetUrl(rel))
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const bmp = await createImageBitmap(await res.blob())
    if (bmp.width <= MAX_IMAGE && bmp.height <= MAX_IMAGE) return bmp
    const k = MAX_IMAGE / Math.max(bmp.width, bmp.height)
    const fit = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' })
    bmp.close()
    return fit
  }

  private image(file: string): Promise<ImageBitmap | null> {
    let p = this.images.get(file)
    if (!p) {
      p = this.bitmap(file).catch((e) => (this.warn(`background image ${file}`, e), null))
      this.images.set(file, p)
    }
    return p
  }

  private lutFile(file: string): Promise<Lut | null> {
    let p = this.luts.get(file)
    if (!p && file.startsWith(GRADE)) this.luts.set(file, (p = Promise.resolve(gradeLut(file))))
    if (!p) {
      p = fetch(this.assetUrl(file))
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
        .then(parseCube)
        .catch((e) => (this.warn(`color LUT ${file}`, e), null))
      this.luts.set(file, p)
    }
    return p
  }

  private cursorTex(image: string): Promise<CursorTex> {
    let p = this.cursors.get(image)
    if (!p) {
      p = this.loadCursor(image)
      this.cursors.set(image, p)
    }
    return p
  }

  private async loadCursor(image: string): Promise<CursorTex> {
    const builtin = CURSORS[image as BuiltinName]
    if (!builtin) {
      try {
        const bmp = await this.bitmap(`sources/cursors/${image}.png`)
        return this.cursorFrom(bmp, bmp.width, bmp.height, 1)
      } catch (e) {
        this.warn(`cursor ${image}`, e)
        // ponytail: the arrow is drawn at the missing image's scale, so its size can be off by that
        // image's pixel density; carry the recorded image size in CursorLayer if this path matters.
        return { ...(await this.cursorTex('arrow')), hot: [CURSORS.arrow.hotX, CURSORS.arrow.hotY] }
      }
    }
    const canvas = new OffscreenCanvas(Math.ceil(builtin.w * CURSOR_RES), Math.ceil(builtin.h * CURSOR_RES))
    const ctx = canvas.getContext('2d')!
    ctx.scale(CURSOR_RES, CURSOR_RES)
    builtin.draw(ctx, CURSOR_RES)
    return this.cursorFrom(canvas, builtin.w, builtin.h, CURSOR_RES)
  }

  private cursorFrom(source: ImageBitmap | OffscreenCanvas, w: number, h: number, res: number): CursorTex {
    this.check()
    const t = this.texture(source.width, source.height, LDR, mipCount(source.width, source.height))
    this.device.queue.copyExternalImageToTexture({ source }, { texture: t, premultipliedAlpha: true }, [source.width, source.height])
    const enc = this.device.createCommandEncoder()
    this.mips(enc, t, this.pipes.mipLDR)
    this.device.queue.submit([enc.finish()])
    const group = this.device.createBindGroup({ layout: this.groups.g2, entries: [{ binding: 0, resource: t.createView() }] })
    return { group, w, h, hot: null, res }
  }
}
