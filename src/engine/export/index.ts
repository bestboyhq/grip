// Export engine: one job, from project to encoded bytes. Runs in the hidden export window
// (src/windows/export/Export.svelte), never in the editor. Every output frame goes through
// renderFrame (the same path as preview) and reaches the encoder, static or not.
// MP4: OffscreenCanvas -> VideoFrame -> VideoEncoder (hardware H.264 or HEVC) -> mediabunny MP4
//      with fast start reserved up front; bytes leave through io.write at their file positions,
//      so memory stays flat and files of any size work. Audio: renderAudio -> AAC 48 kHz stereo,
//      exactly as many samples as the video lasts.
// GIF: the same frames, read back at GIF size and encoded in gif.worker.ts.

import { AudioBufferSource, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, canEncodeVideo, type StreamTargetChunk } from 'mediabunny'
import { outputSize, prepare, type SceneInput } from '../scene.ts'
import { renderFrame, type Media } from '../compose.ts'
import { Renderer } from '../gpu/renderer.ts'
import { fileUrl, openVideo, type FrameSource } from '../media/index.ts'
import { renderAudio } from '../audio/index.ts'
import { parseEvents } from '../../shared/events.ts'
import type { Transcript } from '../../shared/project.ts'
import { AUDIO_BITRATE, SAMPLE_RATE, frameCount, videoBitrate, type ExportOptions, type JobSpec } from './options.ts'
import { AAC_PRIMING, setEditDuration } from './mp4.ts'

export interface ExportIO {
  /** Write bytes at a file position; resolves once written (backpressure). */
  write(position: number, data: Uint8Array): Promise<void>
  /** 0..0.99 while encoding. The file is only complete (1) once the caller has closed it. */
  progress(p: number, phase: string): void
  /** Video opener, openVideo unless a test swaps it. */
  open?: (url: string) => Promise<FrameSource>
}

type Input = Omit<SceneInput, 'width' | 'height'>

/** Encode `job` through io.write. Resolves with the final file size in bytes. */
export async function exportProject(job: JobSpec, io: ExportIO): Promise<number> {
  const { project, bundle } = job
  const s = project.sources
  const url = (rel: string) => fileUrl(`${bundle}/${rel}`)
  const read = async (rel: string, what: string) => {
    const res = await fetch(url(rel)).catch(() => null)
    if (!res?.ok) throw new Error(`Could not read the ${what} (${rel}).`)
    return res
  }
  const [events, transcript] = await Promise.all([
    s.events ? read(s.events, 'input events').then((r) => r.text()).then(parseEvents) : [],
    s.transcript ? read(s.transcript, 'transcript').then((r) => r.json() as Promise<Transcript>) : null,
  ])
  const open = io.open ?? openVideo
  const video = (file: string, what: string) =>
    open(url(file)).catch((e) => {
      throw new Error(`Could not read the ${what} (${file}): ${e instanceof Error ? e.message : e}`)
    })
  const media: Media = {}
  try {
    if (s.screen) media.screen = await video(s.screen.file, 'screen recording')
    if (s.camera) media.camera = await video(s.camera.file, 'camera recording')
    if (s.camera?.matte && project.style.camera.removeBackground) media.matte = await video(s.camera.matte, 'camera matte')
    const input: Input = { project, events, transcript }
    return job.options.format === 'gif' ? await gif(job, input, media, io) : await mp4(job, input, media, io)
  } finally {
    media.screen?.close()
    media.camera?.close()
    media.matte?.close()
  }
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** The largest size with the same aspect the encoder accepts: hardware H.264 stops at 4096 px a
 *  side, so a 4K ultrawide export scales down to fit (HEVC goes to 8192). Software only as a last resort. */
export async function fitEncoder(o: Pick<ExportOptions, 'codec' | 'fps' | 'quality'>, width: number, height: number) {
  const codec = o.codec === 'hevc' ? 'hevc' : 'avc'
  const ok = (w: number, h: number, hw: boolean) =>
    canEncodeVideo(codec, { width: w, height: h, frameRate: o.fps, quality: new Quality({ bitrate: videoBitrate(w, h, o) }), hardwareAcceleration: hw ? 'prefer-hardware' : 'no-preference' })
  for (const hardware of [true, false]) {
    if (await ok(width, height, hardware)) return { width, height, hardware }
    let lo = 0
    let hi = 1
    for (let i = 0; i < 12; i++) {
      const k = (lo + hi) / 2
      if (await ok(even(width * k), even(height * k), hardware)) lo = k
      else hi = k
    }
    if (lo > 0) return { width: even(width * lo), height: even(height * lo), hardware }
  }
  throw new Error(`This Mac cannot encode ${o.codec === 'hevc' ? 'HEVC' : 'H.264'} video.`)
}

async function stage(job: JobSpec, input: Input, width: number, height: number) {
  const p = prepare({ ...input, width, height })
  if (!(p.map.duration > 0)) throw new Error('Nothing to export: the timeline is empty.')
  const r = await Renderer.create(new OffscreenCanvas(width, height), (rel) => fileUrl(`${job.bundle}/${rel}`))
  return { p, r }
}

async function mp4(job: JobSpec, input: Input, media: Media, io: ExportIO): Promise<number> {
  const o = job.options
  const base = outputSize(input.project, o.size)
  const { width, height, hardware } = await fitEncoder(o, base.width, base.height)
  const { p, r } = await stage(job, input, width, height)
  try {
    const n = frameCount(p.map.duration, o.fps)
    const samples = Math.round((n / o.fps) * SAMPLE_RATE) // audio exactly as long as the video
    let size = 0
    const target = new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        async write({ data, position }) {
          await io.write(position, data)
          size = Math.max(size, position + data.byteLength)
        },
      }),
      { chunked: true, chunkSize: 8 << 20 },
    )
    let moov: { data: Uint8Array; position: number } | null = null
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve', onMoov: (data, position) => (moov = { data: data.slice(), position }) }), target })
    let encoded = 0
    const video = new CanvasSource(r.canvas, {
      codec: o.codec === 'hevc' ? 'hevc' : 'avc',
      quality: new Quality({ bitrate: videoBitrate(width, height, o) }),
      keyFrameInterval: 2,
      latencyMode: 'quality',
      hardwareAcceleration: hardware ? 'prefer-hardware' : 'no-preference',
      onEncodedPacket: () => io.progress((0.99 * ++encoded) / n, 'Rendering'),
    })
    // Starting at -priming makes mediabunny write an edit list that skips the encoder's priming.
    const audio = new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: AUDIO_BITRATE }) }, { startTimestamp: -AAC_PRIMING / SAMPLE_RATE })
    output.addVideoTrack(video, { frameRate: o.fps, maximumPacketCount: n })
    output.addAudioTrack(audio, { maximumPacketCount: Math.ceil(samples / 512) + 16 })
    await output.start()
    try {
      // Audio goes in 1 s chunks, kept ahead of the video so the muxer interleaves without buffering.
      let a = 0
      const audioUntil = async (t: number) => {
        while (a < samples && a < t * SAMPLE_RATE) {
          const b = Math.min(samples, a + SAMPLE_RATE)
          await audio.add(exactly(await renderAudio(p, job.bundle, a / SAMPLE_RATE, b / SAMPLE_RATE), b - a))
          a = b
        }
      }
      for (let i = 0; i < n; i++) {
        const t = i / o.fps
        ;(globalThis as any).__step = ['audio', i]
        await audioUntil(t + 0.5)
        ;(globalThis as any).__step = ['render', i]
        await renderFrame(r, p, media, t)
        ;(globalThis as any).__step = ['add', i]
        await video.add(t, 1 / o.fps)
      }
      await audioUntil(Infinity)
      io.progress(0.99, 'Finalizing')
      await output.finalize()
      const m = moov as { data: Uint8Array; position: number } | null
      if (!m) throw new Error('The MP4 header was not written.')
      setEditDuration(m.data, n / o.fps)
      await io.write(m.position, m.data)
      return size
    } catch (e) {
      await output.cancel().catch(() => {})
      throw e
    }
  } finally {
    r.destroy()
  }
}

/** A chunk from the audio engine trimmed or padded to exactly `length` frames of 48 kHz stereo. */
function exactly(buf: AudioBuffer, length: number): AudioBuffer {
  if (buf.sampleRate !== SAMPLE_RATE) throw new Error(`The audio engine returned ${buf.sampleRate} Hz audio, expected ${SAMPLE_RATE} Hz.`)
  if (buf.length === length && buf.numberOfChannels === 2) return buf
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
  for (let c = 0; c < 2; c++) out.copyToChannel(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)).subarray(0, length), c)
  return out
}

async function gif(job: JobSpec, input: Input, media: Media, io: ExportIO): Promise<number> {
  const o = job.options
  const base = outputSize(input.project, o.size)
  const limit = o.maxMB * 1e6
  let k = 1
  for (let pass = 1; ; pass++) {
    const res = await gifPass(job, input, media, io, even(base.width * k), even(base.height * k), limit, pass === 1 ? 'Rendering' : `Fitting under ${o.maxMB} MB`)
    if ('size' in res) return res.size
    // Over the limit: bytes scale with pixel count, so shrink by the projected overshoot and retry.
    k *= Math.sqrt(limit / res.projected) * 0.92
    if (Math.min(base.width, base.height) * k < 120) throw new Error(`This GIF cannot fit under ${o.maxMB} MB. Shorten it, lower the frame rate, or allow a larger size.`)
  }
}

/** One GIF encode at a fixed size. Stops early with the projected size once over `limit`. */
async function gifPass(job: JobSpec, input: Input, media: Media, io: ExportIO, width: number, height: number, limit: number, phase: string): Promise<{ size: number } | { projected: number }> {
  const o = job.options
  const { p, r } = await stage(job, input, width, height)
  const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' })
  const replies: Array<{ resolve: (b: Uint8Array) => void; reject: (e: Error) => void }> = []
  worker.onmessage = (e) => {
    const q = replies.shift()!
    if (e.data.error) q.reject(new Error(`GIF encoding failed: ${e.data.error}`))
    else q.resolve(e.data.bytes)
  }
  worker.onerror = (e) => {
    e.preventDefault()
    for (const q of replies.splice(0)) q.reject(new Error(`GIF encoder crashed: ${e.message}`))
  }
  const send = (msg: unknown, transfer: Transferable[] = []) =>
    new Promise<Uint8Array>((resolve, reject) => {
      replies.push({ resolve, reject })
      worker.postMessage(msg, transfer)
    })
  const readback = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
  let size = 0
  let written = 0
  const n = frameCount(p.map.duration, o.fps)
  const put = async (bytes: Uint8Array) => {
    if (bytes.length) await io.write(size, bytes)
    size += bytes.length
  }
  try {
    await put(await send({ start: { width, height, fps: o.fps, loop: o.loop } }))
    const inflight: Promise<Uint8Array>[] = []
    for (let i = 0; i < n; i++) {
      await renderFrame(r, p, media, i / o.fps)
      readback.drawImage(r.canvas, 0, 0)
      const { data } = readback.getImageData(0, 0, width, height)
      inflight.push(send({ frame: data.buffer }, [data.buffer]))
      // Two frames in flight: the worker encodes one while the next renders.
      while (inflight.length > 1) {
        await put(await inflight.shift()!)
        io.progress((0.99 * ++written) / n, phase)
      }
      // Over the limit, or clearly headed there a quarter of the way in: stop and refit now.
      if (limit && written && (size > limit || (written > n / 4 && (size * n) / written > 2 * limit))) return { projected: (size * n) / written }
    }
    inflight.push(send({ finish: true }))
    for (const b of inflight) await put(await b)
    io.progress(0.99, 'Finalizing')
    return limit && size > limit ? { projected: size } : { size }
  } finally {
    worker.terminate()
    r.destroy()
  }
}
