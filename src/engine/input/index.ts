// Owner: input-events. Segments derived from the event stream, in SOURCE time.
// STUB: empty; the real detectors land with the input-events domain.

import type { InputEvent } from '../../shared/events.ts'

export interface Segment {
  start: number
  end: number
}

/** Stretches of continuous typing (candidates to speed up and to zoom in on). */
export function typingSegments(_events: InputEvent[]): Segment[] {
  return []
}

/** Stretches where the cursor does not move (candidates to hide the cursor). */
export function idleSegments(_events: InputEvent[], _minSeconds = 2): Segment[] {
  return []
}

/** Drop synthetic jitter (accessibility tools nudging the cursor) from mouse moves. */
export function removeJitter(events: InputEvent[]): InputEvent[] {
  return events
}
