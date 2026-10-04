// Built-in cursors: our own vector drawings, used for imported videos and as the fallback when a
// recorded cursor image is missing. Sizes are in points (the "image px" of a CursorLayer), drawn
// with Canvas 2D paths so they rasterize the same in a window and in an export worker.
// Each image has PAD points of transparent margin for the soft shadow; hotspots include it.

const PAD = 4

export interface BuiltinCursor {
  w: number // points, including PAD on each side
  h: number
  hotX: number
  hotY: number
  draw(ctx: OffscreenCanvasRenderingContext2D, res: number): void // ctx scaled to points by res; origin at the image top-left
}

function cursor(w: number, h: number, hotX: number, hotY: number, paint: (ctx: OffscreenCanvasRenderingContext2D) => void): BuiltinCursor {
  return {
    w: w + 2 * PAD,
    h: h + 2 * PAD,
    hotX: hotX + PAD,
    hotY: hotY + PAD,
    draw(ctx, res) {
      ctx.save()
      ctx.translate(PAD, PAD)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.32)'
      ctx.shadowBlur = 2.2 * res // shadows ignore the transform, so scale them by hand
      ctx.shadowOffsetY = 0.9 * res
      paint(ctx)
      ctx.restore()
    },
  }
}

const ARROW = new Path2D('M1 1 L1 17.2 L5.05 13.35 L7.75 19.55 L10.55 18.35 L7.9 12.3 L13.4 12.1 Z')

// Pointing hand: index finger up, three folded fingers, thumb on the left.
const HAND = new Path2D(
  'M5.6 10.2 V2.9 C5.6 0.5 9.1 0.5 9.1 2.9 V9.1' +
    ' C9.1 7.2 12.4 7.2 12.4 9.2 V10' +
    ' C12.4 8.3 15.5 8.3 15.5 10.4 V11.2' +
    ' C15.5 9.7 18.4 9.9 18.4 12 V16.1' +
    ' C18.4 18.7 17.2 20.3 16.3 21.5 V23.5 H8.2 V21.7' +
    ' C6.9 20.3 4.7 17.9 2.9 15.4' +
    ' C1.7 13.8 2.3 11.9 4 12.4 C4.7 12.6 5.2 13.2 5.6 13.9 Z',
)
const HAND_LINES = new Path2D('M9.1 9.8 V13.4 M12.4 10.4 V13.4 M15.5 11.4 V13.4')

const IBEAM = new Path2D(
  'M1 1.2 H3.2 C4.2 1.2 4.8 1.6 5.25 2.2 C5.7 1.6 6.3 1.2 7.3 1.2 H9.5' +
    ' V2.9 H7.4 C6.6 2.9 6.15 3.4 6.15 4.1 V17.9 C6.15 18.6 6.6 19.1 7.4 19.1 H9.5 V20.8' +
    ' H7.3 C6.3 20.8 5.7 20.4 5.25 19.8 C4.8 20.4 4.2 20.8 3.2 20.8 H1 V19.1 H3.1' +
    ' C3.9 19.1 4.35 18.6 4.35 17.9 V4.1 C4.35 3.4 3.9 2.9 3.1 2.9 H1 Z',
)

export const CURSORS: Record<'arrow' | 'pointer' | 'ibeam', BuiltinCursor> = {
  arrow: cursor(15, 21, 1, 1, (ctx) => {
    ctx.fillStyle = '#000'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke(ARROW)
    ctx.shadowColor = 'transparent'
    ctx.fill(ARROW)
  }),
  pointer: cursor(19.5, 24.5, 7.35, 1.2, (ctx) => {
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1.15
    ctx.fill(HAND)
    ctx.shadowColor = 'transparent'
    ctx.stroke(HAND)
    ctx.lineWidth = 0.85
    ctx.stroke(HAND_LINES)
  }),
  ibeam: cursor(10.5, 22, 5.25, 11, (ctx) => {
    ctx.fillStyle = '#000'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.7
    ctx.stroke(IBEAM)
    ctx.shadowColor = 'transparent'
    ctx.fill(IBEAM)
  }),
}

/** Texture pixels per point when rasterizing built-ins: sharp up to a 4K export at 2x zoom. */
export const CURSOR_RES = 8
