# Pipeline

Reached from `SKILL.md` step 3.
The concrete loop that makes changes fast and cheap.

## Material

- Extract each product take as a PNG frame sequence:

  ffmpeg -i take.mp4 -start_number 0 frames/f%04d.png

- Find the real moments on timestamped contact sheets: the click, the "Ready" state, the editor area.
  A moment is a frame number; write it as a constant in the source.
- Time-remap a take when a moment must fall on a beat.

## Frame server

- Serve the composition as one page; the page draws frame `t` and writes each posted frame to disk.
- Malini's browser is the render engine: headless and offscreen, so the user's Mac stays untouched.
- 1080p60 means 1440 frames for a 24 s film.

## Render loop

- Time one full-quality frame before you start, then scale it to the whole film.
- Render the seconds that changed at half size first, then the full film only when every slice passes.

## Encode

- One ffmpeg pass joins the frames with the track:

  ffmpeg -framerate 60 -i frames/f%04d.png -i track.wav -c:v libx264 -pix_fmt yuv420p film.mp4

- The film must come out exactly the track's length.

## Compare and gotchas

- Compare raw frames, never two encodes: lossy encodes of the same frames differ by about 45 dB anyway.
  56 dB or better between a rebuild and its original is GPU rounding, not a change.
- Frames take disk fast, tens of GB for one film at 1080p60.
  Ask before deleting old frames when the disk runs near full.
