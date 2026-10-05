// Timeline edits and the commands that reach them. Every edit goes through doc.edit() (undo, dirty,
// autosave). Edits that move content in output time put the playhead back on the same source moment:
// keep the source time, seek through toOutput afterwards.

import { tick } from 'svelte'
import { uid, type CameraLayout, type CameraLayoutKind, type Clip, type Mask, type Project, type Zoom } from '../../../shared/project.ts'
import { clipAt, splitAt, timeMap, toSource } from '../../../shared/timemap.ts'
import { canRedo, canUndo, doc, edit, redo, selection, undo } from '../../../lib/doc.svelte.ts'
import { player, seek, toggle } from '../../../lib/player.svelte.ts'
import type { Command } from '../commands/registry.ts'
import * as M from './model.ts'

export type Kind = 'clips' | M.ItemTrack
type Items = { clips: Clip[]; zooms: Zoom[]; layouts: CameraLayout[]; masks: Mask[] }
const KINDS: Kind[] = ['clips', 'zooms', 'layouts', 'masks']
const ITEM_KINDS: M.ItemTrack[] = ['zooms', 'layouts', 'masks']

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 8]
export const VOLUMES = [0, 0.5, 1, 1.5, 2]
export const LEVELS = [1.5, 2, 2.5, 3, 4, 5]
export const LAYOUTS: Array<[CameraLayoutKind, string]> = [['pip', 'Picture in picture'], ['fullscreen', 'Fullscreen'], ['split', 'Split'], ['hidden', 'Hidden']]
export const MASKS: Array<[Mask['kind'], string]> = [['blur', 'Blur'], ['pixelate', 'Pixelate'], ['highlight', 'Highlight']]

const project = () => doc.project as Project
const list = (k: Kind) => project()[k] as M.Item[]
const mapNow = () => timeMap(project().clips)
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))

export const selected = <K extends Kind>(k: K): Items[K] =>
  (doc.project ? (doc.project[k] as M.Item[]).filter((x) => selection.ids.includes(x.id)) : []) as Items[K]
const has = (k: Kind) => selected(k).length > 0

/** Selected clips, or the clip under the playhead when nothing is selected. */
function targetClips(): Set<string> {
  if (has('clips')) return new Set(selection.ids)
  if (selection.ids.length || !doc.project?.clips.length) return new Set()
  const p = project()
  return new Set([p.clips[clipAt(timeMap(p.clips), player.time)].id])
}

/** Apply an edit that changes output timing and keep the playhead on the same source moment. */
export async function keepingPlayhead(fn: () => void) {
  if (!doc.project) return
  const before = mapNow()
  const t = player.time
  fn()
  await tick() // let the player see the new duration before seeking
  if (doc.project) seek(M.sameMoment(before, mapNow(), t))
}

/** Edit only when `next` differs, so no-ops leave no undo step. */
function set<K extends keyof Items>(k: K, next: Items[K]) {
  if (JSON.stringify(next) !== JSON.stringify(project()[k])) edit((p) => { p[k] = next as Project[K] })
}

/** Change the items of kind `k` in `ids` (every one when absent). */
function each<K extends keyof Items>(k: K, ids: Set<string> | null, fn: (x: Items[K][number]) => Items[K][number]) {
  if (ids?.size !== 0) set(k, (project()[k] as Items[K][number][]).map((x) => (!ids || ids.has(x.id) ? fn(x) : x)) as Items[K])
}
const ids = (k: Kind) => new Set(selected(k).map((x) => x.id))

// ---- Clips ----

export function cut(t = player.time) {
  set('clips', splitAt(project().clips, t))
}

export function remove() {
  if (!doc.project) return
  const ids = selection.ids.length ? new Set(selection.ids) : targetClips()
  const p = project()
  const clips = M.removeClips(p.clips, ids)
  const items = ITEM_KINDS.map((k) => [k, (p[k] as M.Item[]).filter((x) => !ids.has(x.id))] as const)
  if (clips === p.clips && items.every(([k, xs]) => xs.length === p[k].length)) return
  selection.ids = []
  keepingPlayhead(() =>
    edit((q) => {
      q.clips = clips
      for (const [k, xs] of items) (q[k] as M.Item[]) = xs
    }),
  )
}

export function setSpeed(speed: number) {
  const target = targetClips()
  keepingPlayhead(() => each('clips', target, (c) => ({ ...c, speed })))
}

export const setVolume = (volume: number) => each('clips', targetClips(), (c) => ({ ...c, volume, muted: false }))

export function toggleMute() {
  const target = targetClips()
  const muted = !project().clips.filter((c) => target.has(c.id)).every((c) => c.muted)
  each('clips', target, (c) => ({ ...c, muted }))
}

export function speedToAll() {
  const speed = selected('clips')[0]?.speed
  if (speed) keepingPlayhead(() => each('clips', null, (c) => ({ ...c, speed })))
}

/** Merge the selected clip with its neighbor. */
export function merge(dir: 1 | -1) {
  const i = project().clips.findIndex((c) => c.id === selected('clips')[0]?.id)
  const next = M.mergeClips(project().clips, dir > 0 ? i : i - 1)
  if (i >= 0 && next !== project().clips) keepingPlayhead(() => set('clips', next))
}
export const canMerge = (dir: 1 | -1) => {
  const s = selected('clips')
  if (s.length !== 1) return false
  const i = project().clips.findIndex((c) => c.id === s[0].id)
  return M.mergeClips(project().clips, dir > 0 ? i : i - 1) !== project().clips
}

export function restore(after: number) {
  keepingPlayhead(() => set('clips', M.restoreCut(project().clips, after, project().sources.duration)))
}

/** The cut marker nearest the playhead (what clicking its marker restores), for the keyboard. */
const nearestCut = () =>
  M.cuts(mapNow(), project().sources.duration).reduce<M.Cut | null>((a, c) => (!a || Math.abs(c.t - player.time) < Math.abs(a.t - player.time) ? c : a), null)

// ---- Zooms, layouts, masks ----

export const setLevel = (level: number) => each('zooms', ids('zooms'), (z) => ({ ...z, level }))
// Toggles turn a setting on for every selected zoom unless all of them have it already.
export function toggleZooms() {
  const enabled = !selected('zooms').every((z) => z.enabled)
  each('zooms', ids('zooms'), (z) => ({ ...z, enabled }))
}
export function toggleInstant() {
  const instant = !selected('zooms').every((z) => z.instant)
  each('zooms', ids('zooms'), (z) => ({ ...z, instant }))
}
export function toggleLoupe() {
  const mode = selected('zooms').every((z) => z.mode === 'loupe') ? 'zoom' : 'loupe'
  each('zooms', ids('zooms'), (z) => ({ ...z, mode }))
}
export const followCursor = () => each('zooms', ids('zooms'), (z) => ({ ...z, target: { kind: 'cursor' } }))
export function levelToAll() {
  const level = selected('zooms')[0]?.level
  if (level) each('zooms', null, (z) => ({ ...z, level }))
}
export const setLayout = (kind: CameraLayoutKind) => each('layouts', ids('layouts'), (l) => ({ ...l, kind }))
export function layoutToAll() {
  const kind = selected('layouts')[0]?.kind
  if (kind) each('layouts', null, (l) => ({ ...l, kind }))
}
export const setMask = (kind: Mask['kind']) => each('masks', ids('masks'), (m) => ({ ...m, kind }))

/** A new item of `track` over source [start, end]. */
export function make(track: M.ItemTrack, start: number, end: number): Zoom | CameraLayout | Mask {
  const id = uid()
  if (track === 'zooms') return { id, start, end, level: project().style.autoZoom.level || 2, target: { kind: 'cursor' }, enabled: true } satisfies Zoom
  if (track === 'layouts') return { id, start, end, kind: 'fullscreen' } satisfies CameraLayout
  return { id, start, end, kind: 'blur', rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 } } satisfies Mask
}

/** Add an item about 3 output seconds long at output time t, fitted into free space; selects it. */
export function add(track: M.ItemTrack, t = player.time, len = 3) {
  if (!doc.project) return
  const m = mapNow()
  const a = Math.min(t, Math.max(0, m.duration - len))
  const r = M.fit(list(track), toSource(m, a), toSource(m, Math.min(a + len, m.duration)), project().sources.duration)
  if (!r) return
  const item = make(track, r[0], r[1])
  edit((q) => {
    ;(q[track] as M.Item[]).push(item)
  })
  selection.ids = [item.id]
}

// ---- Selection, clipboard ----

let clipboard: Items | null = null
export const canPaste = () => !!doc.project && !!clipboard

export function copy() {
  if (selection.ids.length) clipboard = Object.fromEntries(KINDS.map((k) => [k, plain(selected(k))])) as Items
}

/** Paste at the playhead: clips are inserted there (their zooms come along, being in source time);
 *  other items land at the playhead's source moment, keeping their spacing. */
export function paste() {
  if (!clipboard || !doc.project) return
  if (clipboard.clips.length) {
    const copies = clipboard.clips.map((c) => ({ ...c, id: uid() }))
    set('clips', M.insertClips(project().clips, player.time, copies))
    selection.ids = copies.map((c) => c.id) // not the clip the paste split in two
    return
  }
  const before = new Set(KINDS.flatMap((k) => list(k).map((x) => x.id)))
  const first = Math.min(...ITEM_KINDS.flatMap((k) => clipboard![k].map((x) => x.start)))
  if (!isFinite(first)) return
  placeItems(clipboard, toSource(mapNow(), player.time) - first)
  selection.ids = KINDS.flatMap((k) => list(k).map((x) => x.id)).filter((id) => !before.has(id))
}

function placeItems(from: Items, delta: number) {
  const duration = project().sources.duration
  const added: string[] = []
  const next = ITEM_KINDS.map((k) => {
    const r = M.placeCopies(list(k), from[k] as M.Item[], delta, duration)
    added.push(...r.added)
    return [k, r.items] as const
  })
  if (!added.length) return
  edit((q) => {
    for (const [k, xs] of next) (q[k] as M.Item[]) = xs
  })
}

/** Copies right after the selection: clips in output order, items after the selected span. */
export function duplicate() {
  if (!doc.project || !selection.ids.length) return
  const before = new Set(KINDS.flatMap((k) => list(k).map((x) => x.id)))
  if (has('clips')) keepingPlayhead(() => set('clips', M.duplicateClips(project().clips, new Set(selection.ids))))
  else {
    const items = Object.fromEntries(KINDS.map((k) => [k, plain(selected(k))])) as Items
    const all = ITEM_KINDS.flatMap((k) => items[k] as M.Item[])
    placeItems(items, Math.max(...all.map((x) => x.end)) - Math.min(...all.map((x) => x.start)))
  }
  selection.ids = KINDS.flatMap((k) => list(k).map((x) => x.id)).filter((id) => !before.has(id))
}

/** Select every item of the kinds already selected, or everything. */
export function selectAll() {
  if (!doc.project) return
  const kinds = KINDS.filter(has)
  selection.ids = (kinds.length ? kinds : KINDS).flatMap((k) => list(k).map((x) => x.id))
}

// ---- Playhead ----

export const step = (by: number) => seek(Math.min(Math.max(player.time + by, 0), mapNow().duration))

/** Jump to the previous or next clip edge. */
export function jump(dir: 1 | -1) {
  const m = mapNow()
  const edges = [...m.outStarts, m.duration]
  const t = dir > 0 ? edges.find((e) => e > player.time + 1e-3) : edges.findLast((e) => e < player.time - 1e-3)
  if (t !== undefined) seek(t)
}

// ---- Commands ----

export function timelineCommands(view: { zoom: (f: number) => void; fit: () => void; split: () => void }): Command[] {
  const open = () => !!doc.project
  const clipTarget = () => open() && targetClips().size > 0
  const c = (id: string, group: string, title: string, run: () => void, enabled: () => boolean = open, keys?: string[], extra: Partial<Command> = {}): Command => ({
    id: `timeline.${id}`, group, title, run, enabled, keys, ...extra,
  })
  return [
    c('play', 'Playback', 'Play / pause', toggle, open, ['Space']),
    c('back', 'Playback', 'Step back 0.5 s', () => step(-0.5), open, ['←'], { repeat: true }),
    c('forward', 'Playback', 'Step forward 0.5 s', () => step(0.5), open, ['→'], { repeat: true }),
    c('back1', 'Playback', 'Step back 1 s', () => step(-1), open, ['⇧←'], { repeat: true }),
    c('forward1', 'Playback', 'Step forward 1 s', () => step(1), open, ['⇧→'], { repeat: true }),
    c('prevEdge', 'Playback', 'Previous cut', () => jump(-1), open, ['↑'], { repeat: true }),
    c('nextEdge', 'Playback', 'Next cut', () => jump(1), open, ['↓'], { repeat: true }),
    c('start', 'Playback', 'Go to start', () => seek(0), open, ['↖']),
    c('end', 'Playback', 'Go to end', () => seek(mapNow().duration), open, ['↘']),

    c('undo', 'Edit', 'Undo', () => keepingPlayhead(undo), () => open() && canUndo(), ['⌘Z'], { repeat: true }),
    c('redo', 'Edit', 'Redo', () => keepingPlayhead(redo), () => open() && canRedo(), ['⇧⌘Z'], { repeat: true }),
    c('cut', 'Edit', 'Cut at playhead', () => cut(), open, ['C', '⌘B']),
    c('split', 'Edit', 'Split tool', view.split, open, ['S'], { hint: 'or hold ⌥' }),
    c('delete', 'Edit', 'Delete', remove, () => open() && (selection.ids.length > 0 || targetClips().size > 0), ['X', '⌫', '⌦'], {
      hint: 'ripple delete for clips',
    }),
    c('cutItems', 'Edit', 'Cut', () => (copy(), remove()), () => open() && selection.ids.length > 0, ['⌘X'], { hint: 'copy, then delete' }),
    c('copy', 'Edit', 'Copy', copy, () => open() && selection.ids.length > 0, ['⌘C']),
    c('paste', 'Edit', 'Paste at playhead', paste, canPaste, ['⌘V']),
    c('duplicate', 'Edit', 'Duplicate', duplicate, () => open() && selection.ids.length > 0, ['⌘D']),
    c('selectAll', 'Edit', 'Select all', selectAll, open, ['⌘A']),
    c('deselect', 'Edit', 'Deselect', () => { selection.ids = [] }, () => selection.ids.length > 0, ['⎋']),

    ...SPEEDS.map((s) => c(`speed${s}`, 'Clip', `Set speed ${s}×`, () => setSpeed(s), clipTarget)),
    c('speedAll', 'Clip', 'Apply speed to all clips', speedToAll, () => open() && has('clips')),
    ...VOLUMES.map((v) => c(`volume${v}`, 'Clip', `Set volume ${v * 100}%`, () => setVolume(v), clipTarget)),
    c('mute', 'Clip', 'Mute / unmute clip', toggleMute, clipTarget, ['M']),
    c('mergePrev', 'Clip', 'Merge with previous clip', () => merge(-1), () => open() && canMerge(-1)),
    c('mergeNext', 'Clip', 'Merge with next clip', () => merge(1), () => open() && canMerge(1)),
    c('restoreCut', 'Clip', 'Restore the nearest cut', () => restore(nearestCut()!.after), () => open() && !!nearestCut(), [], { hint: 'brings back what was cut there' }),

    c('addZoom', 'Zoom', 'Add zoom at playhead', () => add('zooms'), open, ['Z']),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) =>
      c(`level${d}`, 'Zoom', `Set zoom level ${M.levelForDigit(d)}×`, () => setLevel(M.levelForDigit(d)), () => open() && has('zooms'), [String(d)]),
    ),
    c('toggleZoom', 'Zoom', 'Enable / disable zoom', toggleZooms, () => open() && has('zooms'), ['E']),
    c('instant', 'Zoom', 'Instant / animated zoom', toggleInstant, () => open() && has('zooms'), [], { hint: 'cut in and out' }),
    c('loupe', 'Zoom', 'Loupe / full zoom', toggleLoupe, () => open() && has('zooms'), [], { hint: 'magnify in place' }),
    c('followCursor', 'Zoom', 'Zoom follows the cursor', followCursor, () => open() && has('zooms'), [], { hint: 'or click the preview to aim' }),
    c('levelAll', 'Zoom', 'Apply zoom level to all zooms', levelToAll, () => open() && has('zooms')),

    c('addLayout', 'Camera layout', 'Add camera layout at playhead', () => add('layouts'), () => open() && !!project().sources.camera, ['L']),
    ...LAYOUTS.map(([k, name]) => c(`layout-${k}`, 'Camera layout', `Camera layout: ${name}`, () => setLayout(k), () => open() && has('layouts'))),
    c('layoutAll', 'Camera layout', 'Apply camera layout to all', layoutToAll, () => open() && has('layouts')),

    c('addMask', 'Mask', 'Add mask at playhead', () => add('masks'), open),
    ...MASKS.map(([k, name]) => c(`mask-${k}`, 'Mask', `Mask: ${name}`, () => setMask(k), () => open() && has('masks'))),

    c('zoomIn', 'Timeline', 'Zoom in timeline', () => view.zoom(1.5), open, ['⌘=', '⇧⌘+'], { repeat: true }),
    c('zoomOut', 'Timeline', 'Zoom out timeline', () => view.zoom(1 / 1.5), open, ['⌘-'], { repeat: true }),
    c('fit', 'Timeline', 'Fit timeline', view.fit, open, ['⌘0']),
  ]
}
