---
name: timeline
description: The editor timeline for cutting, speed changes, and directing the video. Use when changing tracks, editing tools, keyboard shortcuts, the command menu, undo, or timeline zoom and performance.
---

# Timeline

The editor where users cut, speed up, and direct the video.

- Tracks, top to bottom as the frame is built: camera layouts, zooms, masks, then clips (trim, cut, speed, volume, with their audio), voiceovers heard over them, then keystrokes and captions.
  An item track shows once it has items and stays for the session; the Add menu, Z, L, B, V, and ⌘K add items, so no empty track waits for them.
  B and the editor's Blur button add a blur: hiding a name or email is one click, and ⌘K finds it by "blur".
- Zooms pass over each other on their one track: no extra rows.
  Where they overlap, an inset outline over them names what combines there, with a narrower, brighter outline inside wherever more of them overlap; outlines have no fill, so the zooms show through.
  Each zoom keeps its ends, grabbable inside an outline too, and its label in the part it has alone.
  The zoom track grows a step for each zoom stacked at once, live while dragging, so the innermost outline keeps a single zoom's height.
  A shorter zoom draws over a longer one, so one inside another always shows and takes the click.
  Layouts and masks never overlap.
- Selection is a hairline ring and a soft glow in the item's colour, never a thick white border.
- A clip shows its recording: frames set into its blue body behind a 3 px rim, its waveform on the band below them, and its label in a chip over the frames at the left of its visible part.
  Frames are pinned to source time, a tile a power of two source seconds long, so zooming reuses the frames already decoded and a tile still decoding shows the one before it.
  They decode on their own decoder, never the preview's.
- Dragging a clip moves it to a new place in the output order; a click still moves the playhead there, and with one clip a drag scrubs.
  The clip lifts and follows the pointer, a hollow slot shows where it lands, and the other clips glide aside to make room; its zooms, layouts, masks, and voiceovers ride along, being in source time.
  It passes a neighbour once it is over that neighbour's middle; Esc puts it back.
  ⌘K moves the selected clip a place earlier or later.
- Keyboard-first: ⌘B (or C) cuts at the playhead, Q and W delete the clip under the playhead before or after it, X ripple-deletes, holding ⌥ arms the split tool, arrows step 0.5 s (1 s with Shift), 0-9 set zoom level, and ⌘K reaches every action.
  People bring these keys from other editors: the bar shows Cut with ⌘B, and ⌘K finds it by "split".
  ⌫ and ⌦ do what X does, as in any Mac app: either one doing nothing reads as an editor that ignores its own platform.
  Shortcuts stay inactive while a text field has focus.
- Undo and redo cover every edit and return the playhead to the source moment it was on at that step, an edit made while playing included.
  Undoing a ripple delete puts it back inside the clip that returns, not at the far end of it, so the view stays on what came back.
  While playing, undo and redo keep the playhead on the frame it plays instead: what is heard carries on rather than jump back.
  Timing edits keep the playhead on the source moment it shows.
- Dragging items and resizing leave the playhead in place, and a dragged edge tracks the pointer exactly, on sped-up clips too.
  Trimming a clip edge shows the frame at the edge in the preview as it moves, source being trimmed back in included, so no cut is blind.
  An edge dragged out into the source of the clip next to it in the output takes it over: that clip gives way, down to its shortest, and the split between them stays under the pointer at either clip's speed.
  An edge that stops there pins both parts of a fresh split, with nothing to trim.
  A lens above the edge magnifies the recording around it: frames, voice, and words, with cut source ghosted and the clip next to the edge playing on, up to where another clip's source or the recording ends.
  Moving the pointer up into the lens trims at the lens's scale, about 7 px a frame; back down, the drag carries on from where the edge is.
  The lens is the one magnifier: the timeline keeps its layout while trimming.
  After an edit a fitted timeline glides to its new length, and a trimmed start edge's gap closes in the same glide, so nothing jumps.
- Timeline zoom with pinch and ⌘-scroll, animated and anchored at the pointer: the moment under it stays under it.
  Zooming around the playhead instead throws the view away from where the user points.
  The zoom keys and slider, which point nowhere on the timeline, zoom around the playhead.
- Playing, the view rides along once the playhead reaches its middle, keeping it there while the recording slides under it; it never jumps a page.
  A seek out of view eases there over 250 ms, a far one starting a view away, so the glide shows the way without racing through the timeline.
  A scroll while playing lets go: the view stays where the user put it, and rides on once the playhead is in view and the timeline has been left alone for a second.
  A view that pages, or snaps back to the playhead while the user scrolls, pulls them out of their work.
  Under reduced motion the view pages instead of sliding.
- Multi-select, copy and paste, duplicate, and apply-to-all for zooms, speeds, and layouts.
- V, or Voiceover after Cut in the bar, records a take from the playhead, from the start when the playhead is at the end.
  A 3-2-1 names the mic; Space, V, Esc, or Stop cancel it, and stop the take once it records.
  Other keys, clicks, and edits do nothing while a take runs, so nothing moves the video under the voice; agents' edits get an error that says to try again.
  The Voiceover track opens with the 3-2-1, without its empty-track hint, and the take grows in it with its waveform as it records.
  A take lands selected where it was heard, punched in over older ones, and the Audio tab opens on it; a take under 0.2 s was a slip of the key and is dropped.
  Voiceovers slide with their audio, trim only within their take's audio, and mute with M; the mic's waveform under one that mutes it is ghosted.
  Record again hides the item and records from its start under its number; cancelled, the item is back.

Done when scrolling, zooming, and dragging hold 60 fps on a 2-hour project with hundreds of items.
