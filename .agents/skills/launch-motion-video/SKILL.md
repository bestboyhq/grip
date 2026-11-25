---
name: launch-motion-video
description: Make a rendered motion graphics video - a launch film, a product film, a showreel - where the music sets the tempo and every cut falls on a beat, through a render loop built for fast changes and cheap review. Use when asked to make a motion video, launch video, or showreel, when choosing music, shots, or pacing for one, when iterating on a cut, or when a cut is called chaotic, flashy, or lacking cohesion.
---

# Launch motion video

The bar for every film: it shows what an incredible motion designer you are, like your showreel for a résumé.
Go all out on music, tempo, and beat matching - the bar is set very high.

## The way to work

One source file renders every frame as a function of time.
Every note becomes one edit to that file, never a manual frame edit.
A slice render answers a change before a full render does.
Speed is where the quality comes from: the same effort yields many cuts instead of one.

## Steps

1. **Map the music.**
   The track decides the film.
   Ask for the track the way a person names one: the artist, the version, and where the file lives.
   The track sets the length: a 24 s logo track makes a 24 s film, and "24s is fine" - keep the track's whole run.
   Draw the waveform and spectrum, then write the beat grid: tempo in BPM, every beat time, the phrase boundaries, the hit.
   **Done when** the beat grid is a list of constants in the source file, with one idea mapped to each phrase.

2. **Write the script on the grid.**
   The script names the product's real act: press the shortcut, zoom on what is important, then continue the product's regular flow.
   The logo lands on the hit.
   Motion follows meaning: zoom on what's important while the narration talks about it.
   **Done when** the script reads as one sentence a person can retell, and no phrase carries two ideas.

3. **Build the source.**
   One file draws every frame from the beat grid, real product footage, and the brand's own fonts, colors, icons and wallpapers.
   The browser renders it through a frame server.
   Read `references/pipeline.md` when you build it, and again when you encode or compare cuts.
   **Done when** one command renders the whole film from the source, and the source lives in the worktree (`.context/…`), never only in `/tmp`: the Mac deletes `/tmp` on restart.

4. **Slice, then full.**
   After an edit, render only the seconds that changed, at half size, and look at those frames first.
   A full render runs only when every slice passes.
   **Done when** each change was answered by a slice render, and the final full render ran once.

5. **Review cheap.**
   Answer each question with the fewest pixels: a slice beats the full film, a contact sheet beats a video, a measurement in the page beats a screenshot.
   Review on contact sheets at full size, one frame every quarter second, and put a frame in your reply only when it carries the decision.
   **Done when** every scene was checked on the sheet, not by trusting the render.

6. **Iterate.**
   Show the cut, take the notes, land every note in the next cut.
   **Done when** the cut plays from first frame to last, every cut on a beat, the logo on the hit, and no scene outstays its phrase.

## Craft rules

- **Pace over flash.**
  When the pace holds, keep it.
  A flash is an accent: one or two in a film, each with a chosen strength.
  A moment that only lands through a flash has weak motion: rework the scene instead of adding another flash.

- **Cohesion.**
  Build every scene from one system: one engine, one light, one motion language, one grid.
  Ten scenes from one system read as one film; ten systems read as noise.

- **Edit it like a dog.**
  Cut hard, cut short, cut again.
  A scene that says its idea in two beats stays two beats.
