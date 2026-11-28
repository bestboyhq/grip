// Owner: capture. The area picker's loupe on the GPU: the editor's glass lens (src/engine/gpu/glass.wgsl)
// over the frozen screen, drawn by loupe.wgsl onto a canvas of its own over the whole window.
import glass from '../../engine/gpu/glass.wgsl?raw'
import code from './loupe.wgsl?raw'
import type { Pixels } from './beyond.ts'

type Rect4 = [x0: number, y0: number, x1: number, y1: number]

export interface Lens {
  x: number // center, canvas px
  y: number
  radius: number // canvas px
  mag: number
  glass: number // how much the glass shows: its light and dispersion
  lift: number // 0 flat on the screen, 1 picked up: its shadow
  pt: number // canvas px per point
  at: { x: number; y: number } // texture px under the center, magnified: the pointer stays on its pixel
  flat: { x: number; y: number } // texture px under the center unmagnified: what its shadow falls on
  perPx: number // texture px per canvas px, unmagnified
  cell: number // the checkerboard's cell, texture px
  area: Rect4 | null // texture px
  screen: Rect4 | null // texture px: where the display ends, dashed
  even: number[] // checkerboard colors, 0 to 1
  odd: number[]
  rules: Rect4[] // the measure lines, texture px: up to four
  brand: number[] // their color, 0 to 1
}

export type Loupe = NonNullable<Awaited<ReturnType<typeof loupe>>>

/** A loupe drawing on `canvas`, or null where WebGPU is not available. */
export async function loupe(canvas: HTMLCanvasElement) {
  const gpu = navigator.gpu
  const device = await (await gpu?.requestAdapter())?.requestDevice()
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null
  if (!device || !ctx) return null
  const format = gpu.getPreferredCanvasFormat()
  ctx.configure({ device, format, alphaMode: 'premultiplied', colorSpace: 'display-p3' }) // the still's raw pixels are P3
  const module = device.createShaderModule({ code: glass + '\n' + code })
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  })
  const uniforms = device.createBuffer({ size: 14 * 16, usage: 64 | 8 }) // UNIFORM | COPY_DST: GPUBufferUsage is not typed here
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'linear' })
  let texture: GPUTexture | null = null
  let group: GPUBindGroup | null = null
  return {
    /** What it magnifies: the still, or the room around it once there is one. */
    source(px: Pixels | null) {
      texture?.destroy()
      ;[texture, group] = [null, null]
      if (!px) return
      texture = device.createTexture({ size: [px.width, px.height], format: 'rgba8unorm', usage: 4 | 2 }) // TEXTURE_BINDING | COPY_DST
      device.queue.writeTexture({ texture }, px.data as Uint8Array<ArrayBuffer>, { bytesPerRow: px.width * 4 }, [px.width, px.height])
      group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          { binding: 1, resource: texture.createView() },
          { binding: 2, resource: sampler },
        ],
      })
    },
    draw(l: Lens) {
      if (!group) return
      const none: Rect4 = [0, 0, 0, 0]
      const rules = [0, 1, 2, 3].map((i) => l.rules[i])
      device.queue.writeBuffer(uniforms, 0, new Float32Array([
        l.x, l.y, l.radius, l.mag,
        l.glass, l.lift, l.pt, l.area ? 1 : 0,
        l.at.x, l.at.y, l.perPx, l.cell,
        ...(l.area ?? none),
        ...(l.screen ?? none),
        ...l.even, 1,
        ...l.odd, 1,
        ...rules.flatMap((r) => r ?? none),
        ...rules.map((r) => (r ? 1 : 0)),
        ...l.brand, 1,
        l.flat.x, l.flat.y, 0, 0,
      ]))
      // Only around the lens and its shadow: the canvas covers the window.
      const { width: cw, height: ch } = ctx.canvas
      const reach = 3.3 * l.radius
      const [x0, y0] = [Math.max(0, Math.floor(l.x - reach)), Math.max(0, Math.floor(l.y - reach))]
      const [x1, y1] = [Math.min(cw, Math.ceil(l.x + reach)), Math.min(ch, Math.ceil(l.y + reach))]
      const enc = device.createCommandEncoder()
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] })
      if (x1 > x0 && y1 > y0) {
        pass.setScissorRect(x0, y0, x1 - x0, y1 - y0)
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, group)
        pass.draw(3)
      }
      pass.end()
      device.queue.submit([enc.finish()])
    },
    destroy: () => device.destroy(),
  }
}
