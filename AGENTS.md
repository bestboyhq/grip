# Agent rules

The rules in this file apply to all code in the repository.
Domain rules live in `.agents/skills/`, as plain Markdown in the Agent Skills format that belongs to no particular tool, one folder per skill.
`.claude/skills` links to it.
Each product domain has one: `capture`, `input-events`, `camera`, `audio`, `motion`, `auto-zoom`, `compositor`, `export`, `timeline`, `transcript`, `projects`, `sharing`, `app-shell`.

Read the skill for the domain you are touching before changing code there.

## Product

We are building Grip, a screen recorder and editor that turns a raw recording into a polished video with little or no manual editing: auto-zoom, smooth cursor, camera, captions, one-click export and share.
The domain skills in `.agents/skills/` collect what screen recorders in this category get wrong.
Their gotchas are bugs and limits that shipped in real products; design each one out from the first commit.

Describe every behavior on its own terms in everything that lands in git: code, comments, skills, docs, commit messages, branch names, and PR titles and bodies.
Competing products stay unnamed there, even when one inspired the work or shipped the bug a gotcha records.

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
- **One family.** Every window looks, moves, and behaves like the other Bestboy apps.
  The platform's `docs/design.md` and `.agents/skills/design/SKILL.md` are the source; read them before changing a window's look or motion (`gh api repos/bestboyhq/platform/contents/<path> --jq .content | base64 -d`).
  `src/ui/theme.css` and `src/ui/motion.ts` copy their tokens, type, and motion by hand, and `src/ui/design.test.ts` fails on raw colors, stray curves, and hovers that fade.

## Stack

- Electron shell.
  The main process is TypeScript run directly by Electron's Node (type stripping, no bundler).
  Packaged builds run it as JavaScript that `scripts/strip.ts` strips at build time, so a launch never loads Node's stripper.
  Renderers are Svelte 5 + Vite, one bundle with a hash route per window.
- Rust native addon in `native/` (napi-rs + objc2 crates) for everything that talks to macOS frameworks: ScreenCaptureKit, AVFoundation, CoreGraphics event taps, Vision, transcription.
- Rendering runs in Chromium: a WebGPU compositor, WebCodecs for hardware (VideoToolbox) decode and encode, mediabunny for demuxing and muxing.
  Frames stay on the GPU as `VideoFrame` handles; JS never touches pixel bytes.
- Transcription: NVIDIA Parakeet v3 on device via parakeet-rs, downloaded on first use.
- Voice: DeepFilterNet3 (tract) and Silero VAD (ONNX Runtime) in the native addon, run once per recording into a voice track.
- macOS 15+, Apple silicon first.

## Layout

- `src/shared/`: pure data contracts. `project.ts` is the document schema, `timemap.ts` the one time map, `events.ts` the input event stream.
- `src/engine/`: pure render. `scene.ts` turns (project, t) into a Scene; `compose.ts` is the single path to pixels for preview and export.
  Domains live in `layout.ts`, `motion/`, `zoom/`, `overlays/`, `input/`, `gpu/`, `media/`, `audio/`, `export/`, `transcript/`.
- `src/lib/`: renderer state. `doc.svelte.ts` owns edits, undo, and autosave; `player.svelte.ts` owns preview playback.
- `src/windows/<name>/`: one Svelte component per window route.
- `electron/`: main process; each `<domain>.ts` registers its `<domain>:*` IPC channels.
- `native/`: Rust addon, one module per domain; `clock.rs` is the master clock.
- `site/`: the landing page at bestboy.dev/grip, its own npm package: SvelteKit prerendered behind a Cloudflare worker (`site/worker/index.ts`) on the `bestboy.dev/grip*` route.
  Its look is the Bestboy family's, from the platform's `docs/design.md`, and its claims and numbers come from the README.

Share links, accounts, and teams are hosted by the Bestboy platform at bestboy.dev (the private `bestboyhq/platform` repo, whose `docs/api.md` is the contract).
Grip's side is `electron/upload.ts` and `electron/account.ts`; `STUDIO_SHARE_URL=http://localhost:8787` points a dev run at a local platform.

## Commands

- `npm run dev -- --open <bundle.grip>` runs the app.
  `STUDIO_CDP_PORT=<port>` exposes its windows to `agent-browser --cdp <port>`, and `STUDIO_HIDDEN=1` keeps them off screen.
  One instance runs per worktree: a second launch hands its arguments to the running one and exits, so agents share it and its CDP port.
  `npm run dev -- --lab <Name>` opens `src/windows/dev/labs/<Name>.svelte`; the `Wallpapers` lab renders wallpapers for review.
- `npm run build:native` builds the Rust addon.
- `cd site && npm run dev` serves the landing page at `localhost:5173/grip`, and `npm test` there builds it and tests the worker.
  `sh site/media.sh` remakes its clips from the README's GIFs.
  `.github/workflows/site.yml` deploys it on merge, so a site-only change is a `chore(site)` or `docs(site)` and never ships an app release.
- `npx electron scripts/fixture/make.ts [out.grip]` generates a synthetic 24 s recording with events, camera, mic speech, and system audio, by default at `.context/fixtures/Demo #1 ✨ café.grip`.
- `APPLE_KEYCHAIN_PROFILE=<notarytool profile> npm run package` builds, signs with the Developer ID, and notarizes `release/Grip-*.dmg`.
  Without the variable it signs and skips notarization.
- Releases are automatic: every merge to `main` whose commits include a `feat`, `fix`, `perf`, or breaking change ships as an in-app update (`.github/workflows/ci.yml`).
  PR titles must be Conventional Commits, since the squash commit takes the title and `scripts/version.ts` picks the next version from it.
  Versions live in `v*` tags; `package.json`'s `0.0.0` is a placeholder CI overwrites.
- `node scripts/update-e2e.ts` proves a signed build still updates itself; CI runs it before every release (locally the terminal needs Accessibility).
- `npx electron build/icons.ts` renders `build/icon.png` from `build/Grip.icon` (needs Xcode 26+) and the menu bar icons from SVG.
  `build/Grip.icon` (Icon Composer) is the one source of the app icon; electron-builder compiles it, legacy `.icns` included.
- `npm test` runs node:test on pure modules, `npm run check` type-checks, `cd native && cargo test` tests the addon.
- `node scripts/notice.ts` rewrites `NOTICE`, every third-party component the app ships with its license and notices; `npm test` fails after a dependency change until it runs.
  The app ships `NOTICE`, `LICENSE`, and Chromium's notices, and its About panel points to them.

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
