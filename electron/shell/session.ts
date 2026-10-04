// Stop and cancel while the capture engine starts. The engine ignores both until it records (it
// has nothing to stop yet), so a click on Finish or Delete right after the countdown would be lost
// and the recording would run on. The shell holds the last one and sends it once the engine records.
// Pure: no electron imports, so node:test can run it.

export type Held = 'stop' | 'cancel' | null

/** `cmd` arrived while the engine starts: what to hold. Delete wins over Finish. */
export const hold = (held: Held, cmd: 'stop' | 'cancel'): Held => (cmd === 'cancel' ? 'cancel' : (held ?? 'stop'))

/** The engine moved to `next`: the command to send now, and what stays held. */
export function release(held: Held, next: string): [send: Held, held: Held] {
  if (next === 'starting') return [null, held]
  return [next === 'recording' ? held : null, null]
}
