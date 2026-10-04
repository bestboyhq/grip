<!-- Automated decode and mix checks, run by src/engine/media/media.test.ts in a hidden window:
     #/dev?lab=PlayerChecks&dir=<generated media dir>&fixture=<optional .studio bundle>.
     Results land in window.__checks as [{ name, ok, detail }]. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { createProject, type Project } from '../../../shared/project.ts'
  import { prepare } from '../../../engine/scene.ts'
  import { fileUrl, openVideo } from '../../../engine/media/index.ts'
  import { mix, peaks, planOf, renderAudio, voiceGains } from '../../../engine/audio/index.ts'
  import { parseEvents } from '../../../shared/events.ts'

  let { params }: { params: URLSearchParams } = $props()
  type Check = { name: string; ok: boolean; detail: string }
  let checks = $state<Check[]>([])
  let done = $state(false)

  const dir = $derived(params.get('dir') ?? '')
  const fixture = $derived(params.get('fixture') ?? '')

  async function check(name: string, fn: () => Promise<string | void>) {
    try {
      checks.push({ name, ok: true, detail: (await fn()) ?? '' })
    } catch (e) {
      checks.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(msg)
  }

  /** Red channel at the frame center: the generated clips encode their frame index as gray level. */
  function gray(f: VideoFrame) {
    const c = new OffscreenCanvas(8, 8)
    const g = c.getContext('2d')!
    g.drawImage(f, 0, 0, 8, 8)
    return g.getImageData(4, 4, 1, 1).data[0]
  }

  /** frameAt must return frame i for every t in [ts[i], ts[i+1]), in any access order. */
  async function frames(file: string, ts: number[], lum: (i: number) => number) {
    const src = await openVideo(fileUrl(`${dir}/${file}`))
    const expect = (t: number) => {
      let i = 0
      while (i + 1 < ts.length && ts[i + 1] <= t + 1e-9) i++
      return i
    }
    const probes: number[] = []
    ts.forEach((t, i) => probes.push(t, (t + (ts[i + 1] ?? src.duration)) / 2, (ts[i + 1] ?? src.duration) - 0.0005))
    const orders = [probes, [...probes].reverse(), probes.map((_, k) => probes[(k * 7) % probes.length])]
    let n = 0
    for (const order of orders) {
      for (const t of order) {
        const f = await src.frameAt(t)
        assert(f, `null at ${t}`)
        const i = expect(t)
        const got = Math.round(f!.timestamp / 1e3) / 1e3
        const g = gray(f!)
        f!.close()
        assert(Math.abs(got - ts[i]) < 1e-3, `t=${t.toFixed(4)}: frame ${got}, want ${ts[i]}`)
        assert(Math.abs(g - lum(i)) <= 4, `t=${t.toFixed(4)}: gray ${g}, want ${lum(i)} (frame ${i})`)
        n++
      }
    }
    const past = await src.frameAt(src.duration + 0.01)
    assert(past === null, 'a frame past the end')
    src.close()
    return `${n} lookups exact, null past ${src.duration.toFixed(3)} s`
  }

  /** Energy centroid (seconds) of the click in [a, b): its center, robust to codec smearing. */
  function peakAt(buf: AudioBuffer, a: number, b: number) {
    const x = buf.getChannelData(0)
    let e = 0
    let m = 0
    for (let i = Math.round(a * buf.sampleRate); i < Math.min(x.length, b * buf.sampleRate); i++) {
      e += x[i] * x[i]
      m += i * x[i] * x[i]
    }
    return m / e / buf.sampleRate
  }
  const prepared = (p: Project) => prepare({ project: p, events: [], transcript: null, width: 640, height: 400 })
  const audioOnly = (file: string, duration: number) => {
    const p = createProject('t', { duration, mic: { file, channels: 1, sampleRate: 48000 } })
    p.audio.mic.enhance = false
    return p
  }

  onMount(async () => {
    // VFR H.264 with B-frames: t_i = 0.04 i + 0.002 i^2, gray 16 + 8 i (see media.test.ts).
    const vfr = Array.from({ length: 24 }, (_, i) => Math.trunc((0.04 * i + 0.002 * i * i) / 0.001) / 1000) // as ffmpeg's setpts rounds
    await check('frameAt is exact on variable frame rate H.264 with B-frames', () => frames('vfr.mp4', vfr, (i) => Math.round(1.164 * 8 * i)))
    const cfr = Array.from({ length: 60 }, (_, i) => i / 30)
    await check('frameAt is exact on HEVC', () => frames('hevc.mp4', cfr, (i) => Math.round(1.164 * 3 * i)))
    await check('scrubbing backward frame by frame does not decode from the keyframe at every step', async () => {
      const src = await openVideo(fileUrl(`${dir}/hevc.mp4`))
      const walk = async (ts: number[]) => {
        const t0 = performance.now()
        for (const t of ts) (await src.frameAt(t))?.close()
        return performance.now() - t0
      }
      const steps = cfr.map((t) => t + 0.01)
      const fwd = await walk(steps)
      const back = await walk([...steps].reverse())
      src.close()
      // Kept frames: a restart per keyframe interval (4 here). Without them: one per step, about 25x forward.
      assert(back < 10 * fwd, `backward ${back.toFixed(0)} ms vs forward ${fwd.toFixed(0)} ms for ${steps.length} frames`)
      return `backward ${back.toFixed(0)} ms, forward ${fwd.toFixed(0)} ms`
    })

    await check('AAC audio stays aligned through encoder priming', async () => {
      const buf = await renderAudio(prepared(audioOnly(`${dir}/click.m4a`, 4)), '/', 0, 4)
      const a = peakAt(buf, 0.5, 1.5)
      const b = peakAt(buf, 2, 3)
      assert(Math.abs(a - 1.001) < 0.0005 && Math.abs(b - 2.501) < 0.0005, `click centers at ${a}, ${b}; want 1.001, 2.501`)
      return `clicks at ${a.toFixed(4)} s and ${b.toFixed(4)} s`
    })
    await check('an imported .mp4 is its own audio source', async () => {
      const buf = await renderAudio(prepared(audioOnly(`${dir}/av.mp4`, 3)), '/', 0, 3)
      const a = peakAt(buf, 0.5, 1.5)
      assert(Math.abs(a - 1.001) < 0.0005, `click center at ${a}, want 1.001`)
      const pk = await peaks(fileUrl(`${dir}/av.mp4`), 0, 3, 300)
      assert(pk.length === 600 && Math.max(...pk) > 0.3, 'peaks of the mp4 audio')
      return `click at ${a.toFixed(4)} s`
    })
    await check('AAC music starts at full level, every loop (no silent head)', async () => {
      const p = createProject('t', { duration: 6 })
      p.audio.music = { file: `${dir}/tone44.m4a`, volume: 1 } // 2 s of 44.1 kHz sine: loops at 2 s and 4 s
      const x = (await renderAudio(prepared(p), '/', 0, 6)).getChannelData(0)
      const rms = (a: number, b: number) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a))
      const steady = rms(24000, 48000)
      // After the 5 ms edge fade (start) and past the 10 ms loop crossfade (seam).
      const head = rms(240, 480) / steady
      const seam = rms(96240, 96480) / steady
      assert(head > 0.9 && seam > 0.9, `head ${head.toFixed(2)}, loop seam ${seam.toFixed(2)} of the steady level`)
      return `head ${head.toFixed(2)}, seam ${seam.toFixed(2)}`
    })
    await check('renderAudio length is exact; a 2x clip renders half the duration; chunks join exactly', async () => {
      const p = audioOnly(`${dir}/click.m4a`, 4)
      const whole = await renderAudio(prepared(p), '/', 1.2345, 3.21)
      assert(whole.length === Math.round(3.21 * 48000) - Math.round(1.2345 * 48000) && whole.numberOfChannels === 2, `length ${whole.length}`)
      p.clips[0].speed = 2
      const fast = prepared(p)
      assert(fast.map.duration === 2, `2x duration ${fast.map.duration}`)
      const all = await renderAudio(fast, '/', 0, 2)
      assert(all.length === 96000, `2x length ${all.length}`)
      const at = peakAt(all, 0.25, 0.75)
      assert(Math.abs(at - 0.5005) < 0.002, `2x click center at ${at}, want 0.5005`)
      const fast2 = prepared(p)
      const parts = [await renderAudio(fast2, '/', 0, 0.7), await renderAudio(fast2, '/', 0.7, 1.31), await renderAudio(fast2, '/', 1.31, 2)]
      const joined = parts.flatMap((b) => [...b.getChannelData(0)])
      const ref = all.getChannelData(0)
      assert(joined.length === ref.length && joined.every((v, i) => v === ref[i]), 'chunked export differs from one pass')
      return `${whole.length} frames; 2x: ${all.length} frames, click at ${at.toFixed(4)} s; 3 chunks bit-identical`
    })

    if (fixture) {
      const project: Project = await (await fetch(fileUrl(`${fixture}/project.json`))).json()
      await check('frameAt picks the right frame on the fixture (30 fps)', async () => {
        const src = await openVideo(fileUrl(`${fixture}/${project.sources.screen!.file}`))
        for (const t of [0, 0.0333, 1 / 30, 5.99, 6, 12.345, 23.95, 23.999, 24]) {
          const f = await src.frameAt(t)
          assert(f, `null at ${t}`)
          const want = Math.min(Math.floor(t * 30 + 1e-6), 719) / 30
          const got = f!.timestamp / 1e6
          f!.close()
          assert(Math.abs(got - want) < 1e-4, `t=${t}: frame at ${got}, want ${want}`)
        }
        assert((await src.frameAt(24.05)) === null, 'a frame past the end')
        // Sequential playback speed (the export path): 4 s of 4K-class frames.
        const t0 = performance.now()
        for (let i = 0; i < 120; i++) (await src.frameAt(8 + i / 30))?.close()
        const ms = (performance.now() - t0) / 120
        // Random access (scrubbing).
        const t1 = performance.now()
        for (const t of [20, 3, 15.5, 1, 22]) (await src.frameAt(t))?.close()
        const seekMs = (performance.now() - t1) / 5
        src.close()
        return `${src.width}x${src.height}, sequential ${ms.toFixed(1)} ms/frame, random ${seekMs.toFixed(0)} ms/seek`
      })
      await check('fixture mix: exact length, voice chain, peaks cached in the bundle', async () => {
        const p = prepared(project)
        const t0 = performance.now()
        let n = 0
        let peak = 0
        for (let t = 0; t < 24; t += 4) {
          const b = await renderAudio(p, fixture, t, Math.min(24, t + 4))
          n += b.length
          for (const ch of [b.getChannelData(0), b.getChannelData(1)]) for (const v of ch) peak = Math.max(peak, Math.abs(v))
        }
        const ms = performance.now() - t0
        assert(n === 24 * 48000, `length ${n}`)
        assert(peak > 0.1 && peak <= 0.892, `peak ${peak}`)
        const mic = fileUrl(`${fixture}/${project.sources.mic!.file}`)
        const pk = await peaks(mic, 0, 24, 1000)
        assert(pk.length === 2000, 'peaks shape')
        const zoomed = await peaks(mic, 2, 2.1, 1000) // finer than the cache: decoded on the spot
        assert(zoomed.length === 2000, 'zoomed peaks shape')
        const cached = await fetch(fileUrl(`${fixture}/cache/sources_mic.m4a.${(await fetch(mic, { method: 'HEAD' })).headers.get('content-length')}.analysis`), { method: 'HEAD' })
        assert(cached.ok, 'analysis cache file in the bundle')
        return `24 s rendered in ${ms.toFixed(0)} ms (${((24000 / ms) | 0)}x realtime), peak ${peak.toFixed(3)}, cache written`
      })
      await check('preview and export mix are bit-identical through 200 cuts and speed changes', async () => {
        const p: Project = structuredClone(project)
        p.style.cursor.clickSound = true
        p.clips = Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, start: i * 0.12, end: i * 0.12 + 0.1, speed: [1, 1.2, 2, 2.5][i % 4], volume: 1 }))
        const events = parseEvents(await (await fetch(fileUrl(`${fixture}/${p.sources.events}`))).text())
        // Preview: what the player sends, 200 ms at a time from the start.
        const plan = planOf(p, events, fixture, await voiceGains(p, fixture))
        const total = Math.round(plan.duration * 48000)
        const preview: number[] = []
        for (let s = 0; s < total; s += 9600) preview.push(...(await mix('parity', plan, s, Math.min(9600, total - s)))[0])
        // Export: renderAudio in 1 s chunks.
        const pe = prepare({ project: p, events, transcript: null, width: 640, height: 400 })
        const exported: number[] = []
        for (let t = 0; t < pe.map.duration; t += 1) exported.push(...(await renderAudio(pe, fixture, t, Math.min(pe.map.duration, t + 1))).getChannelData(0))
        assert(preview.length === exported.length, `lengths ${preview.length} vs ${exported.length}`)
        const diff = preview.findIndex((v, i) => v !== exported[i])
        assert(diff < 0, `first difference at sample ${diff}`)
        return `${plan.duration.toFixed(2)} s, ${preview.length} samples identical, ${plan.clicks.length} click sounds`
      })
    }
    done = true
    ;(window as any).__checks = $state.snapshot(checks)
  })
</script>

<main>
  <h1>Player checks {done ? '' : '…'}</h1>
  <ul>
    {#each checks as c (c.name)}
      <li class:fail={!c.ok}><b>{c.ok ? 'PASS' : 'FAIL'}</b> {c.name}<br /><small>{c.detail}</small></li>
    {/each}
  </ul>
</main>

<style>
  main {
    padding: 20px 24px;
    background: var(--bg);
    height: 100vh;
    overflow: auto;
    font: 12px var(--mono);
  }
  h1 {
    font: 600 15px var(--font);
  }
  li {
    margin-bottom: 8px;
    list-style: none;
  }
  b {
    color: #5fd38d;
  }
  .fail b {
    color: var(--danger);
  }
  small {
    color: var(--text-dim);
  }
</style>
