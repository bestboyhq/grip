// AAC priming fix-up for MP4 output. The platform AAC encoder (AudioToolbox, through WebCodecs)
// emits 2112 priming samples before the real audio and pads the last packet to 1024 samples.
// Export starts the audio track at -2112 samples, so mediabunny writes an edit list that skips the
// priming (audio in sync), then setEditDuration() cuts the edit at the video's exact length (audio
// exactly as long as video), the way AVFoundation writes it.

/** AudioToolbox's AAC-LC encoder delay in samples. */
// ponytail: a platform constant, verified by the impulse round trip in the export check; measure it
// at startup if Chromium ever switches AAC encoders.
export const AAC_PRIMING = 2112

/** Set the audio track's edit (and the track and movie durations) to `seconds`, in place.
 *  `bytes` starts with the moov box (mediabunny's onMoov data). */
export function setEditDuration(bytes: Uint8Array, seconds: number): void {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = (p: number) => String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3])
  const children = (start: number, end: number) => {
    const out: Array<{ type: string; body: number; end: number }> = []
    for (let p = start; p + 8 <= end; ) {
      let size = v.getUint32(p)
      let head = 8
      if (size === 1) [size, head] = [Number(v.getBigUint64(p + 8)), 16]
      else if (size === 0) size = end - p
      if (size < head) break
      out.push({ type: type(p + 4), body: p + head, end: p + size })
      p += size
    }
    return out
  }
  const find = (list: ReturnType<typeof children>, t: string) => {
    const b = list.find((x) => x.type === t)
    if (!b) throw new Error(`MP4 fix-up: no ${t} box`)
    return b
  }
  // Full boxes: version byte, then 64-bit fields in version 1 and 32-bit ones in version 0.
  const put = (p: number, wide: boolean, n: number) => (wide ? v.setBigUint64(p, BigInt(n)) : v.setUint32(p, n))
  const moov = find(children(0, bytes.length), 'moov')
  const top = children(moov.body, moov.end)
  const mvhd = find(top, 'mvhd')
  const wide = bytes[mvhd.body] === 1
  const scale = v.getUint32(mvhd.body + (wide ? 20 : 12))
  const units = Math.round(seconds * scale)
  put(mvhd.body + (wide ? 24 : 16), wide, units)
  let patched = false
  for (const trak of top.filter((b) => b.type === 'trak')) {
    const kids = children(trak.body, trak.end)
    const mdia = find(kids, 'mdia')
    if (type(find(children(mdia.body, mdia.end), 'hdlr').body + 8) !== 'soun') continue
    const tkhd = find(kids, 'tkhd')
    const tw = bytes[tkhd.body] === 1
    put(tkhd.body + (tw ? 28 : 20), tw, units)
    const edts = find(kids, 'edts')
    const elst = find(children(edts.body, edts.end), 'elst')
    const ew = bytes[elst.body] === 1
    if (v.getUint32(elst.body + 4) !== 1) throw new Error('MP4 fix-up: expected one audio edit')
    put(elst.body + 8, ew, units)
    patched = true
  }
  if (!patched) throw new Error('MP4 fix-up: no audio track')
}
