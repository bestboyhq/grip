<!-- Transcript lab: #/dev?lab=Transcript&project=<bundle path>[&repeat=N]
     The transcript panel on a real bundle, a stand-in player clock, the caption cue at the playhead,
     and the SRT export, to check edit-by-text against captions without the rest of the editor.
     repeat=N tiles the transcript N times to feel a 2-hour project; edits save the tiled project
     into the bundle, so point it at a scratch copy. -->
<script lang="ts">
  import { doc } from '../../../lib/doc.svelte.ts'
  import { player, toggle, seek } from '../../../lib/player.svelte.ts'
  import { invoke } from '../../../lib/ipc.ts'
  import { fileUrl } from '../../../engine/media/index.ts'
  import { parseEvents } from '../../../shared/events.ts'
  import { timeMap } from '../../../shared/timemap.ts'
  import type { Transcript } from '../../../shared/project.ts'
  import { cues, outputWords, toSRT } from '../../../engine/transcript/index.ts'
  import TranscriptPanel from '../../editor/transcript/TranscriptPanel.svelte'

  let { params }: { params: URLSearchParams } = $props()
  let error = $state('')

  const path = $derived(params.get('project') ?? '')
  const repeat = $derived(Number(params.get('repeat') ?? 1))

  $effect(() => {
    if (!path) return
    ;(async () => {
      const { project } = await invoke('projects:open', path)
      if (project.sources.events) doc.events = parseEvents(await (await fetch(fileUrl(`${path}/${project.sources.events}`))).text())
      if (repeat > 1) {
        const t: Transcript | null = await invoke('transcript:load', path)
        if (t) {
          const d = project.sources.duration
          doc.transcript = { ...t, words: Array.from({ length: repeat }, (_, k) => t.words.map((w) => ({ ...w, start: w.start + k * d, end: w.end + k * d }))).flat() }
          project.sources.duration = d * repeat
          project.clips = [{ ...project.clips[0], start: 0, end: d * repeat }]
        }
      }
      doc.path = path
      doc.project = project
    })().catch((e) => (error = String(e)))
  })

  const map = $derived(doc.project ? timeMap($state.snapshot(doc.project.clips)) : null)
  $effect(() => {
    if (map) player.duration = map.duration
  })
  const lines = $derived(doc.transcript && map ? cues(outputWords($state.snapshot(doc.transcript) as Transcript, map, $state.snapshot(doc.project!.captionEdits)), map) : [])
  const line = $derived(lines.find((c) => c.start <= player.time && player.time < c.end))
  const srt = $derived(doc.transcript && doc.project ? toSRT($state.snapshot(doc.transcript) as Transcript, $state.snapshot(doc.project.clips), $state.snapshot(doc.project.captionEdits)) : '')

  // Stand-in playback clock (the real one is player.svelte.ts's job).
  $effect(() => {
    if (!player.playing) return
    let last = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      seek(player.time + (now - last) / 1000)
      last = now
      if (player.time >= player.duration) player.playing = false
      else raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  })
  const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`
</script>

<div class="lab">
  <main>
    {#if !path}
      <p>Add <code>&project=&lt;bundle path&gt;</code> to the URL.</p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
    <div class="stage">
      <p class="caption">{line?.text ?? ''}</p>
    </div>
    <div class="controls">
      <button onclick={toggle}>{player.playing ? 'Pause' : 'Play'}</button>
      <span>{clock(player.time)} / {clock(player.duration)}</span>
    </div>
    <pre>{srt.slice(0, 4000)}</pre>
  </main>
  <aside><TranscriptPanel /></aside>
</div>

<style>
  .lab {
    display: grid;
    grid-template-columns: 1fr 360px;
    height: 100vh;
    background: #141416;
  }
  main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    min-height: 0;
  }
  .stage {
    aspect-ratio: 16 / 9;
    max-height: 45vh;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    border-radius: 10px;
    background: linear-gradient(135deg, #3b2f6b, #1d4a5a);
  }
  .caption {
    margin: 0 0 6%;
    padding: 4px 12px;
    border-radius: 6px;
    background: rgb(0 0 0 / 0.55);
    font-size: 22px;
    font-weight: 600;
    min-height: 1em;
  }
  .caption:empty {
    visibility: hidden;
  }
  .controls {
    display: flex;
    gap: 12px;
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
  pre {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    font: 11px/1.4 var(--mono);
    color: var(--text-dim);
    user-select: text;
  }
  aside {
    border-left: 1px solid var(--border);
    min-height: 0;
  }
  .error {
    color: var(--danger);
  }
</style>
