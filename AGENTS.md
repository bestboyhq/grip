# Agent rules

The rules in this file apply to all code in the repository.
Domain rules live in `.agents/skills/`, as plain Markdown in the Agent Skills format that belongs to no particular tool, one folder per skill.
`.claude/skills` links to it.
Each product domain has one: `capture`, `input-events`, `camera`, `audio`, `motion`, `auto-zoom`, `compositor`, `export`, `timeline`, `transcript`, `projects`, `sharing`, `app-shell`.

Read the skill for the domain you are touching before changing code there.

## Product

We are building a screen recorder and editor that turns a raw recording into a polished video with little or no manual editing: auto-zoom, smooth cursor, camera, captions, one-click export and share.
The domain skills in `.agents/skills/` collect what screen recorders in this category get wrong.
Their gotchas are bugs and limits that shipped in real products; design each one out from the first commit.

Every domain obeys these invariants:

- **Non-destructive.** Recording writes raw sources to separate tracks: screen without the cursor, camera, mic, system audio, and the input event stream.
  Edits are data on top, and sources stay immutable.
  The cursor is redrawn from events, which is what makes smoothing, hiding, cursor sets, and click effects possible.
- **Source time.** Store every timed item (zoom, layout, mask, caption word, keystroke) in source time and map it to output time through one shared time map of cuts and speed changes.
  Each feature that did its own mapping shipped a bug: SRT export ignoring cuts, transcript words lost after cuts, mic desync with many cuts, zooms shifting when durations changed.
- **Pure render.** The frame at output time t is a pure function of (project, t).
  Seeking, cutting mid-animation, and parallel export then work for free.
- **Parity.** Preview and export share one renderer and one audio graph: same frames, same volume, same effects.
- **Crash-safe.** A crash, power loss, or full disk loses at most the last seconds of a recording and none of the saved edits.
- **Huge projects.** Everything stays responsive on a 2-hour 4K recording with hundreds of cuts.
  Waveforms, timelines, project loading, and exports over 2 GB are what break first at that scale.
- **Hostile names.** Paths and project names with `#`, emoji, accents, and spaces round-trip through every feature.
  `#` in a project name is the classic regression.
- **Defaults over knobs.** Ship one tuned default before adding a setting.
  A setting added before its default was tuned usually ends up removed.

## Stack

- Electron shell.
  The main process is TypeScript run directly by Electron's Node (type stripping, no bundler).
  Renderers are Svelte 5 + Vite, one bundle with a hash route per window.
- Rust native addon in `native/` (napi-rs + objc2 crates) for everything that talks to macOS frameworks: ScreenCaptureKit, AVFoundation, CoreGraphics event taps, Vision, transcription.
- Rendering runs in Chromium: a WebGPU compositor, WebCodecs for hardware (VideoToolbox) decode and encode, mediabunny for demuxing and muxing.
  Frames stay on the GPU as `VideoFrame` handles; JS never touches pixel bytes.
- Transcription: NVIDIA Parakeet v3 on device via parakeet-rs, downloaded on first use.
- macOS 15+, Apple silicon first.

## Layout

- `src/shared/`: pure data contracts. `project.ts` is the document schema, `timemap.ts` the one time map, `events.ts` the input event stream.
- `src/engine/`: pure render. `scene.ts` turns (project, t) into a Scene; `compose.ts` is the single path to pixels for preview and export.
  Domains live in `layout.ts`, `motion/`, `zoom/`, `overlays/`, `input/`, `gpu/`, `media/`, `audio/`, `export/`, `transcript/`.
- `src/lib/`: renderer state. `doc.svelte.ts` owns edits, undo, and autosave; `player.svelte.ts` owns preview playback.
- `src/windows/<name>/`: one Svelte component per window route.
- `electron/`: main process; each `<domain>.ts` registers its `<domain>:*` IPC channels.
- `native/`: Rust addon, one module per domain; `clock.rs` is the master clock.
- `server/`: the share link server.

## Commands

- `npm run dev -- --open <bundle.studio>` runs the app.
  `STUDIO_CDP_PORT=<port>` exposes its windows to `agent-browser --cdp <port>`, and `STUDIO_HIDDEN=1` keeps them off screen.
- `npm run build:native` builds the Rust addon.
- `npx electron scripts/fixture/make.ts [out.studio]` generates a synthetic 24 s recording with events, camera, mic speech, and system audio, by default at `.context/fixtures/Demo #1 ✨ café.studio`.
- `npm test` runs node:test on pure modules, `npm run check` type-checks, `cd native && cargo test` tests the addon.

## Code: lazy senior developer

Lazy means efficient, not careless.
The best code is the code never written.
Lazy means less code, not less effort: understanding, root cause, and verification still get full effort.

Understand the problem first.
Read the task and the code it touches, and trace the real flow end to end.
Then stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that is already here.
3. Does the standard library do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

Bug fix = root cause, not symptom.
A report names a symptom.
Grep every caller of the function you touch and fix the shared function once.
One guard there is a smaller diff than one per caller, and a fix on only the path the ticket names leaves sibling callers broken.

Rules:

- No abstractions or boilerplate that nobody asked for.
- No new dependency if you can avoid it.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
  The smallest change in the wrong place is not lazy, it is a second bug.
- Complex request? Ship the lazy version and question it in the same response: "Did Y, it covers X. Need full X? Say so."
- Two stdlib options of the same size? Pick the one that is correct on edge cases.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment.
  Name the ceiling and the upgrade path.

Never lazy about:

- Understanding the problem. A small diff you do not understand is laziness dressed up as efficiency.
- Input validation at trust boundaries, error handling that prevents data loss, security, and accessibility.
- Calibration that real hardware needs. A clock drifts, a sensor reads off.
- Anything explicitly requested.
- Tests. Lazy code without its check is unfinished.
  Non-trivial logic leaves ONE runnable check behind: the smallest thing that fails if the logic breaks (an assert-based self-check or one small test file, no frameworks, no fixtures).
  Trivial one-liners need no test.
