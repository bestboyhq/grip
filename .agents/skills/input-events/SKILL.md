---
name: input-events
description: Cursor, click, scroll, and keystroke telemetry recorded beside the screen. Use when changing event capture, system cursor images, keyboard layout mapping, or typing, idle, and jitter detection.
---

# Input events

Cursor, click, scroll, and keystroke telemetry recorded beside the screen.

- Timestamp every event on the same clock as the video frames.
- Record the real system cursor images, every variant, on every supported macOS version, plus the system cursor size setting.
  A cursor baked into the capture plus a redrawn cursor is a double cursor.
- Record cursor type changes while the mouse is still, so a link click leaves no stale pointer hand.
- Map keys through the active layout, including non-Latin layouts, fn, F-keys, arrows, and the macOS modifier order ⌃⌥⇧⌘.
- Secure input (password fields) emits no keystrokes, and the overlay degrades gracefully.
- Pen strokes drawn on screen while recording are draw events in the same stream; the mouse presses that drew them are not clicks (no click effect, no auto-zoom).
- Derive editor segments: typing (to speed up), idle cursor (to hide), and synthetic jitter from accessibility tools (to remove).

Done when replaying the event stream over the raw capture reproduces exactly what the user saw, cursor shape included.
