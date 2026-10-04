<!-- Preview playback lab: #/dev?lab=Player&project=<absolute .studio path>.
     Plays the project through the real player (renderFrame + audio worker), with a mic waveform
     under the scrubber and live timing stats. window.__player exposes the player for automation. -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { doc } from '../../../lib/doc.svelte.ts'
  import { invoke } from '../../../lib/ipc.ts'
  import { attach, pause, play, player, scrub, seek, stats, toggle } from '../../../lib/player.svelte.ts'
  import { parseEvents } from '../../../shared/events.ts'
  import { timeMap } from '../../../shared/timemap.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import { peaks } from '../../../engine/audio/index.ts'

  let { params }: { params: URLSearchParams } = $props()
  const path = $derived(params.get('project') ?? '')

  let canvas = $state<HTMLCanvasElement>()
  let wave = $state<HTMLCanvasElement>()
  let loadError = $state('')
  let line = $state('')

  onMount(() => {
    if (!path) return
    let stop: (() => void) | undefined
    ;(async () => {
      try {
        const { project } = await invoke('projects:open', path)
        const ev = project.sources.events ? await fetch(fileUrl(`${path}/${project.sources.events}`)).then((r) => r.text()) : ''
        doc.path = path
        doc.events = parseEvents(ev)
        doc.project = project
        stop = attach(canvas!)
        await drawWave()
      } catch (e) {
        loadError = e instanceof Error ? e.message : String(e)
      }
    })()
    stats.sync = []
    const timer = setInterval(() => {
      // Largest gap between the audio being heard and the frame drawn, over the last 250 ms of playback.
      const av = stats.sync!.reduce((m, [a, v]) => Math.max(m, Math.abs(a - v) * 1000), -1)
      stats.sync = []
      line = `${stats.renderMs.toFixed(1)} ms/frame (max ${stats.maxRenderMs.toFixed(1)}) · ${stats.dropped} dropped · ${stats.starved} audio frames starved · A/V ${av < 0 ? 'n/a' : `${av.toFixed(1)} ms`} · ${stats.grains} scrub grains · prepare ${stats.prepareMs.toFixed(1)} ms ×${stats.prepares} · ${stats.frames} frames`
    }, 250)
    ;(window as any).__player = { player, stats, play, pause, seek, scrub, toggle }
    return () => {
      clearInterval(timer)
      stats.sync = null
      stop?.()
    }
  })

  async function drawWave() {
    const p = doc.project
    if (!p?.sources.mic || !wave) return
    const dpr = devicePixelRatio
    const w = (wave.width = Math.round(wave.clientWidth * dpr))
    const h = (wave.height = Math.round(wave.clientHeight * dpr))
    const g = wave.getContext('2d')!
    const m = timeMap(p.clips)
    const url = fileUrl(`${path}/${p.sources.mic.file}`)
    g.fillStyle = 'rgb(124 108 255 / 0.55)'
    for (let i = 0; i < p.clips.length; i++) {
      const c = p.clips[i]
      const x0 = Math.round((m.outStarts[i] / m.duration) * w)
      const x1 = Math.round(((m.outStarts[i] + (c.end - c.start) / c.speed) / m.duration) * w)
      if (x1 <= x0) continue
      const pk = await peaks(url, c.start, c.end, x1 - x0)
      for (let x = 0; x < x1 - x0; x++) {
        const lo = pk[2 * x]
        const hi = pk[2 * x + 1]
        g.fillRect(x0 + x, h / 2 - hi * (h / 2), 1, Math.max(1, (hi - lo) * (h / 2)))
      }
    }
  }

  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`
</script>

<svelte:window onkeydown={(e) => e.code === 'Space' && (e.preventDefault(), toggle())} />

<main>
  {#if !path}
    <p class="hint">Open with <code>#/dev?lab=Player&amp;project=&lt;absolute path to a .studio bundle&gt;</code></p>
  {:else}
    <div class="stage"><canvas bind:this={canvas}></canvas></div>
    <footer>
      <button class="play" onclick={toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
        {#if player.playing}
          <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
        {:else}
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2.5v11a.8.8 0 0 0 1.2.7l9-5.5a.8.8 0 0 0 0-1.4l-9-5.5A.8.8 0 0 0 4 2.5z" /></svg>
        {/if}
      </button>
      <span class="time">{fmt(player.time)} <span class="dim">/ {fmt(player.duration)}</span></span>
      <div class="track">
        <canvas class="wave" bind:this={wave}></canvas>
        <div class="head" style:left="{(player.time / (player.duration || 1)) * 100}%"></div>
        <input
          type="range"
          min="0"
          max={player.duration}
          step="0.001"
          value={player.time}
          oninput={(e) => scrub(Number(e.currentTarget.value))}
          aria-label="Playhead"
        />
      </div>
    </footer>
    <p class="stats">{line}</p>
    {#if loadError || player.error}<p class="error">{loadError || player.error}</p>{/if}
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--text);
  }
  .hint {
    margin: auto;
    color: var(--text-dim);
  }
  .stage {
    flex: 1;
    min-height: 0;
    padding: 16px;
    display: flex;
  }
  .stage canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px 4px;
    border-top: 1px solid var(--border);
  }
  .play {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: var(--bg-raised);
    display: grid;
    place-items: center;
    cursor: pointer;
    fill: var(--text);
  }
  .play:hover {
    background: var(--bg-hover);
  }
  .time {
    font: 12px var(--mono);
    font-variant-numeric: tabular-nums;
    min-width: 128px;
  }
  .dim {
    color: var(--text-dim);
  }
  .track {
    position: relative;
    flex: 1;
    height: 40px;
    border-radius: 6px;
    background: var(--bg-raised);
    overflow: hidden;
  }
  .wave {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    pointer-events: none;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .stats,
  .error {
    margin: 0;
    padding: 2px 16px 10px;
    font: 11px var(--mono);
    color: var(--text-dim);
  }
  .error {
    color: var(--danger);
  }
</style>
