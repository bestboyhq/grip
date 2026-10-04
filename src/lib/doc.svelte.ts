// The open project in an editor window: state, edits, undo/redo, autosave.
// Every mutation goes through edit() so undo, dirty tracking, and autosave cover it.

import type { Project, Transcript } from '../shared/project.ts'
import type { InputEvent } from '../shared/events.ts'
import type { FaceSample } from '../engine/scene.ts'
import { invoke } from './ipc.ts'

export const doc = $state({
  project: null as Project | null,
  path: '', // absolute path of the .studio bundle
  events: [] as InputEvent[],
  transcript: null as Transcript | null,
  faces: [] as FaceSample[], // sources.camera.faces, for face-follow crop
  rev: 0, // bumps on every change; derived data keys off it
  dirty: false,
})

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
  saveTimer = setTimeout(save, 800)
}

export async function save() {
  if (!doc.project || !doc.dirty) return
  clearTimeout(saveTimer)
  const snap = $state.snapshot(doc.project)
  doc.dirty = false
  await invoke('projects:save', doc.path, snap)
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
  doc.project = JSON.parse(s.json)
  changed()
}
export const undo = () => swap(undoStack, redoStack)
export const redo = () => swap(redoStack, undoStack)
export const canUndo = () => undoStack.length > 0
export const canRedo = () => redoStack.length > 0
