// Owner: compositor. WebGPU compositor: draws a Scene with its source frames onto a canvas
// (HTMLCanvasElement for preview, OffscreenCanvas for export). Resolution independent: all
// geometry comes from the Scene in output px.
// STUB: Canvas 2D placeholder.

import type { Scene } from '../scene.ts'

export interface Frames {
  screen: VideoFrame | null
  camera: VideoFrame | null
}

export class Renderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  private constructor(canvas: HTMLCanvasElement | OffscreenCanvas, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
    this.canvas = canvas
    this.ctx = ctx
  }

  /** `assetUrl(relPath)` resolves bundle-relative assets (cursor PNGs, background images). */
  static async create(canvas: HTMLCanvasElement | OffscreenCanvas, _assetUrl: (rel: string) => string): Promise<Renderer> {
    return new Renderer(canvas, canvas.getContext('2d') as CanvasRenderingContext2D)
  }

  async draw(scene: Scene, frames: Frames): Promise<void> {
    const c = this.ctx
    c.fillStyle = '#1d1f27'
    c.fillRect(0, 0, scene.width, scene.height)
    if (scene.screen && frames.screen) {
      const r = scene.screen.rect
      c.drawImage(frames.screen, r.x, r.y, r.w, r.h)
    }
  }

  destroy() {}
}
