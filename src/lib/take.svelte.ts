// Owner: audio. Recording a voiceover take in the editor (src/shared/voiceover.ts places it,
// electron/voiceover.ts records the mic): a 3-2-1 while the mic opens, then the video plays from the
// playhead with the recording's mic muted, and you talk over it until Stop or the end. The take lands as
// Voiceover items where it was heard, punched in over older ones, and the editor saves them before the
// take stops being pending, so a crash at any point leaves it on disk to place again.
//
// Timing: take second 0 is the host time the take rolled at (performance.now() moved onto the host
// clock), and that second plays at the output time being heard then (heardAt, on the audio clock).
// ponytail: the output device's clock and the host clock drift apart, 0 on built-in audio and 20-50 ppm
// on external interfaces (about 30 ms over a 10-minute take). If long takes slip there, measure the
// audio clock's rate against the host clock over the take and scale the knots by it.

import { doc, edit, save, selection } from './doc.svelte.ts'
import { invoke, listen } from './ipc.ts'
import { ensureAudio, heardAt, pause, play, player, recordingTake, seek } from './player.svelte.ts'
import { uid } from '../shared/project.ts'
import { mapRange, timeMap, toOutput } from '../shared/timemap.ts'
import { MIN_TAKE, land, place, trim, type Span } from '../shared/voiceover.ts'

/** The take in progress. `from`: the output second it records from; `n`: its "Voiceover <n>"; `again`:
 *  the item it records again (hidden meanwhile, back when it is cancelled); `error`: why the last one
 *  failed, for the editor's notice. */
export const take = $state({ phase: '' as '' | 'countdown' | 'recording' | 'saving', count: 0, mic: '', from: 0, n: 0, again: null as string | null, error: '' })

/** The take as it records, for the timeline, which redraws with the playhead anyway (so plain, not
 *  $state): the output second its second 0 played at, and what the mic heard ([take second, peak]). */
export const live = { zero: 0, levels: [] as Array<[number, number]> }

interface Run {
  id: string
  path: string
  from: number
  opened: Promise<{ name: string }>
  rolled: Promise<unknown>
  zero: number // output time of take second 0
  spans: Span[]
}
let cur: Run | null = null
let idle: Promise<unknown> = Promise.resolve() // the last take's cancel: the next one opens the mic after it

/** Record a take from the playhead (from the start when it is at the end), or over item `again`. */
export async function startTake(again?: string) {
  const p = doc.project
  if (!p || take.phase) return
  pause()
  const old = again ? p.voiceovers.find((v) => v.id === again) : undefined
  const map = timeMap(p.clips)
  const from = old ? (toOutput(map, old.start) ?? mapRange(map, old.start, old.end)[0]?.[0] ?? 0) : player.time > player.duration - 0.3 ? 0 : player.time
  const takes = p.sources.takes ?? []
  const n = (old && takes.find((t) => t.id === old.take)?.n) || Math.max(0, ...takes.map((t) => t.n)) + 1
  const id = uid()
  const path = doc.path
  const me: Run = (cur = { id, path, from, opened: idle.then(() => invoke('voiceover:open', path, id)), rolled: Promise.resolve(), zero: 0, spans: [] })
  Object.assign(take, { phase: 'countdown', count: 3, mic: '', from, n, again: old?.id ?? null, error: '' })
  Object.assign(live, { zero: from, levels: [] })
  seek(from)
  me.opened.then((m) => void (cur === me && (take.mic = m.name)), () => {})
  const ready = Promise.all([me.opened, hostOffset(), ensureAudio()])
  ready.catch((e) => fail(me, e))
  for (let c = 3; c > 0; c--) {
    take.count = c
    await new Promise((r) => setTimeout(r, 1000))
    if (cur !== me) return
  }
  const [, offset] = await ready.catch(() => [])
  if (cur !== me || offset === undefined || !doc.project) return
  take.phase = 'recording'
  recordingTake(from)
  play()
  if (!player.playing) return fail(me, new Error('The video can’t play yet. Try again in a moment.'))
  const at = performance.now()
  me.zero = live.zero = heardAt(at)
  me.spans = place(timeMap(doc.project.clips), me.zero, from)
  me.rolled = invoke('voiceover:roll', me.path, { id: me.id, at: at + offset, n, pending: me.spans }).catch((e) => fail(me, e))
}

/** Stop: a counting take is cancelled; a recording one lands where it was heard, up to now. */
export async function stopTake() {
  const me = cur
  if (!me || take.phase === 'saving') return
  if (take.phase === 'countdown') return cancel(me)
  take.phase = 'saving'
  pause()
  const end = player.time
  recordingTake(null)
  try {
    await me.rolled
    if (cur !== me) return // it failed to roll
    const duration: number = await invoke('voiceover:stop', me.path, me.id)
    const len = Math.min(duration, end - me.zero)
    const spans = trim(me.spans, len)
    if (len - (me.from - me.zero) < MIN_TAKE || !spans.length) return void (idle = invoke('voiceover:cancel', me.path, me.id).catch(() => {}))
    const again = take.again
    edit((p) => {
      p.voiceovers = land(p.voiceovers.filter((v) => v.id !== again), me.id, spans)
    })
    selection.ids = doc.project!.voiceovers.filter((v) => v.take === me.id).map((v) => v.id)
    reset() // editing goes on while it saves
    await save()
    await invoke('voiceover:placed', me.path, me.id)
  } catch (e) {
    take.error = message(e)
  } finally {
    if (cur === me) reset()
  }
}

/** Nothing recorded yet: the mic closes, and the item recorded again stays. */
function cancel(me: Run) {
  reset()
  idle = me.opened.catch(() => {}).then(() => invoke('voiceover:cancel', me.path, me.id)).catch(() => {})
}

/** The take could not go on: back to editing, with why. What it recorded goes. */
function fail(me: Run, e: unknown) {
  if (cur !== me) return
  cancel(me)
  take.error = message(e)
}

function reset() {
  cur = null
  if (take.phase === 'recording') {
    pause()
    recordingTake(null)
  }
  Object.assign(take, { phase: '', count: 0, again: null })
}

const message = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  return /No audio/.test(m) ? 'The microphone sent no sound, so no voiceover was added.' : m
}

/** Host ms minus performance.now() ms, from the fastest of a few round trips to the main process. */
async function hostOffset(): Promise<number> {
  let best = Infinity
  let offset = 0
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now()
    const h: number = await invoke('voiceover:now')
    const t1 = performance.now()
    if (t1 - t0 < best) [best, offset] = [t1 - t0, h - (t0 + t1) / 2]
  }
  return offset
}

listen('voiceover:level', (l: { id: string; t: number; peak: number }) => void (cur?.id === l.id && live.levels.push([l.t, l.peak])))

// The video ended, or something else paused it: the take stops there.
$effect.root(() => {
  $effect(() => {
    if (take.phase === 'recording' && !player.playing) void stopTake()
  })
})
