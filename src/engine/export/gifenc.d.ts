// gifenc ships no types. We use only its quantizer (pairwise nearest neighbor over an RGB565 histogram).
declare module 'gifenc/src/pnnquant2.js' {
  export default function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): number[][]
}
