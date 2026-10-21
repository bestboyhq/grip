---
name: timeline
description: The editor timeline for cutting, speed changes, and directing the video. Use when changing tracks, editing tools, keyboard shortcuts, the command menu, undo, or timeline zoom and performance.
---

# Timeline

The editor where users cut, speed up, and direct the video.

- Tracks, top to bottom as the frame is built: camera layouts, zooms, masks, then clips (trim, cut, speed, volume, with their audio), then keystrokes and captions.
  An item track shows once it has items and stays for the session; the Add menu, Z, L, and ⌘K add items, so no empty track waits for them.
- Zooms pass over each other on their one track: no extra rows.
  Where they overlap, an inset outline over them names what combines there, with a narrower, brighter outline inside wherever more of them overlap; outlines have no fill, so the zooms show through.
  Each zoom keeps its ends, grabbable inside an outline too, and its label in the part it has alone.
  The zoom track grows a step for each zoom stacked at once, live while dragging, so the innermost outline keeps a single zoom's height.
  A shorter zoom draws over a longer one, so one inside another always shows and takes the click.
  Layouts and masks never overlap.
- Selection is a hairline ring and a soft glow in the item's colour, never a thick white border.
- Keyboard-first: C cuts at the playhead, X ripple-deletes, holding ⌥ arms the split tool, arrows step 0.5 s (1 s with Shift), 0-9 set zoom level, and ⌘K reaches every action.
  Shortcuts stay inactive while a text field has focus.
- Undo and redo cover every edit and return the playhead to the same source moment.
- Dragging and resizing leave the playhead in place, and a dragged edge tracks the pointer exactly, on sped-up clips too.
  Trimming a clip edge shows the frame at the edge in the preview as it moves, source being trimmed back in included, so no cut is blind.
- Timeline zoom with pinch and ⌘-scroll, animated and centered on the playhead.
- Multi-select, copy and paste, duplicate, and apply-to-all for zooms, speeds, and layouts.

Done when scrolling, zooming, and dragging hold 60 fps on a 2-hour project with hundreds of items.
