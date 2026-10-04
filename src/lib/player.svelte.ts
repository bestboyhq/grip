// Owner: audio/media. Preview playback of doc.project: playback clock, synced audio, and
// rendering through src/engine/compose.ts (the same path export uses).
// Times are OUTPUT seconds.

export const player = $state({ time: 0, duration: 0, playing: false })

/** Start rendering the open project into `canvas`. Returns a detach function. */
export function attach(_canvas: HTMLCanvasElement): () => void {
  return () => {}
}
export function play() {
  player.playing = true
}
export function pause() {
  player.playing = false
}
export const toggle = () => (player.playing ? pause() : play())
export function seek(t: number) {
  player.time = Math.min(Math.max(t, 0), player.duration)
}
