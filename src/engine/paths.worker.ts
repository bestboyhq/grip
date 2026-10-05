// Owner: compositor. preparePaths (./scene.ts) off the main thread, for the preview: the cursor path
// and the zoom camera of a 2-hour project take a few hundred ms, which would stall the editor after
// every edit. The same function export runs inline, so preview and export get the same samples, and
// its caches reuse whichever path an edit left alone. The big inputs that rarely change (events,
// transcript, face track) come only when they do and stay here.

import { preparePaths, type SceneInput } from './scene.ts'

type Big = Pick<SceneInput, 'events' | 'transcript' | 'faces'>
export type PathsRequest = { id: number; input: Omit<SceneInput, keyof Big> } & Partial<Big>

const big: Big = { events: [], transcript: null, faces: undefined }

self.onmessage = ({ data }: MessageEvent<PathsRequest>) => {
  for (const k of ['events', 'transcript', 'faces'] as const) if (k in data) Object.assign(big, { [k]: data[k] })
  try {
    postMessage({ id: data.id, paths: preparePaths({ ...data.input, ...big }) })
  } catch (e) {
    postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) })
  }
}
