// The open project in an editor window: state, edits, undo/redo, autosave.
// Every mutation goes through edit() so undo, dirty tracking, and autosave cover it.

import type { Project, Transcript } from '../shared/project.ts'
import type { InputEvent } from '../shared/events.ts'
import { invoke } from './ipc.ts'

class Doc {
  project = $state<Project | null>(null)
  path = $state('') // absolute path of the .studio bundle
  // Raw: a 2-hour recording has ~1M events and ~20k words. They are never edited in place, only
  // replaced, so they stay plain arrays the engine reads at full speed (no deep proxies, no snapshots).
  events = $state.raw<InputEvent[]>([])
  transcript = $state.raw<Transcript | null>(null)
  rev = $state(0) // bumps on every change; derived data keys off it
  dirty = $state(false)
  saveError = $state('') // why the last save failed; cleared by the next one that lands
}
export const doc = new Doc()

export const selection = $state({ ids: [] as string[] })

interface Snapshot {
  json: string
}
const undoStack: Snapshot[] = []
const redoStack: Snapshot[] = []
const LIMIT = 300 // ponytail: full JSON snapshots; switch to patches if projects grow past a few MB

let saveTimer: ReturnType<typeof setTimeout> | undefined

function changed() {
  doc.rev++
  doc.dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save().catch(() => {}), 800) // a failure shows as doc.saveError
}

/** Write the project to disk. A failed save keeps the edits dirty (the next autosave or close retries)
 *  and sets doc.saveError; it still rejects, for callers that must know (close, Move to Trash). */
export async function save() {
  if (!doc.project || !doc.dirty) return
  clearTimeout(saveTimer)
  const snap = $state.snapshot(doc.project)
  doc.dirty = false
  try {
    await invoke('projects:save', doc.path, snap)
    doc.saveError = ''
  } catch (e) {
    doc.dirty = true
    doc.saveError = (e as Error).message
    throw e
  }
}

let mergeKey = ''

/** Apply an edit. `fn` mutates the project in place. Consecutive edits with the same `merge` key
 *  (one slider drag, one color-panel session) share one undo step. */
export function edit(fn: (p: Project) => void, merge?: string) {
  if (!doc.project) return
  if (!merge || merge !== mergeKey) {
    undoStack.push({ json: JSON.stringify(doc.project) })
    if (undoStack.length > LIMIT) undoStack.shift()
    redoStack.length = 0
  }
  mergeKey = merge ?? ''
  fn(doc.project)
  changed()
}

function swap(from: Snapshot[], to: Snapshot[]) {
  const s = from.pop()
  if (!s || !doc.project) return
  mergeKey = ''
  to.push({ json: JSON.stringify(doc.project) })
  const p: Project = JSON.parse(s.json)
  doc.project = p
  // Items the step removed leave the selection, so Delete or Copy never act on nothing.
  const live = new Set([...p.clips, ...p.zooms, ...p.layouts, ...p.masks].map((x) => x.id))
  if (selection.ids.some((id) => !live.has(id))) selection.ids = selection.ids.filter((id) => live.has(id))
  changed()
}
export const undo = () => swap(undoStack, redoStack)
export const redo = () => swap(redoStack, undoStack)
export const canUndo = () => undoStack.length > 0
export const canRedo = () => redoStack.length > 0
