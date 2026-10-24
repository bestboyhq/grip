<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="Grip app icon">
</p>

<h1 align="center">Grip</h1>

<p align="center">
  <b>Record your screen. Get a video worth watching.</b><br>
  Grip zooms where you click, glides your cursor, and captions your voice for you.<br>
  Free and open source, for the Mac.
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/grip/releases/latest"><img src="https://img.shields.io/badge/Download_for_macOS-000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS" height="40"></a>
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/grip/releases/latest"><img src="https://img.shields.io/github/v/release/bestboyhq/grip?label=release&color=5e5ce6" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-15%2B-1c1c1e?logo=apple" alt="macOS 15 or later">
  <img src="https://img.shields.io/badge/Apple_silicon-native-1c1c1e" alt="Native on Apple silicon">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-1c1c1e" alt="AGPL-3.0 license"></a>
</p>

<p align="center">
  <img src=".github/readme/hero.gif" width="100%" alt="A deployments dashboard polished by Grip on a pastel iridescent wallpaper: the view zooms in as the cursor glides to the Deploy button, the click swells through the screen, a new build slides in as Building, a glass loupe magnifies its timer as it counts up, and the build turns Ready as the cursor glides back to its start.">
</p>

<p align="center">
  <sub>Exported by Grip from a raw 6-second take.
  The zoom, the gliding cursor, and the click swell are automatic.
  The only edits: a trim, a wallpaper, a glass loupe on the new build, and a larger cursor that returns to its start, so the GIF loops.</sub>
</p>

---

Raw screen recordings are hard to watch: a tiny cursor on a huge screen, nothing in focus, and a lot of "um".
With Grip you record once and skip the editing.
The view zooms where you click and follows what you type, the cursor glides instead of jittering, and your voice comes out clean and captioned.
Stop the recording, and the video is one click from your clipboard or a share link.

When you do want to edit, nothing is baked in.
Grip keeps your screen, camera, mic, and every click and keystroke on separate tracks, so every zoom, cut, and caption stays a choice you can change.

Need a screenshot instead?
The same keystroke grabs one, lets you mark it up, and puts it on your clipboard.

## Why Grip

- **Free and open source.** No subscription, no account, no watermark.
- **A screenshot tool built in.** Freeze the screen, draw arrows, boxes, ink, and text on top, pixelate what's private, and paste.
- **Everything runs on your Mac.** Recording, editing, transcription, background removal, and face tracking.
- **Nothing is baked in.** Raw tracks stay untouched, and every zoom, cut, and caption is an edit you can undo.
- **What you preview is what you export.** One GPU renderer and one audio graph draw both, frame for frame.
- **Links your team comments on.** Share links live on bestboy.dev; teammates, viewers, and comments never cost anything.
- **Keyboard first.** One shortcut to capture, single keys to edit, `⌘K` for everything else, and `grip://` links for scripts.

### The usual screen recorder bugs, designed out

Each bug below shipped in a real screen recorder.
Grip designs them out from the first commit instead of patching them later.

| The usual bug | How Grip rules it out |
| --- | --- |
| Subtitles drift or ignore your cuts | Captions, zooms, keystrokes, and audio all map through **one shared time map** of cuts and speed changes. |
| Zooms shift when you trim the clip before them | Every timed item lives in **source time**, so a zoom stays on its moment however you cut around it. |
| The cursor is baked into the video | The screen is recorded **without the cursor**. Grip redraws it from the event stream. |
| The export doesn't match the preview | The frame at time *t* is a **pure function** of the project and *t*, drawn by the same renderer for both. |
| A crash or power loss eats the take | Tracks are written in fragments. An interrupted recording is **rebuilt at the next launch**. |
| A full disk corrupts the recording | Grip won't start with under 1 GB free, warns when space runs low, and **keeps what it wrote**. |
| `#` or emoji in a project name breaks a feature | Names like `Demo #1 ✨ café` are **in the test suite** and the demo project. |
| Long projects make the editor crawl | The timeline is checked against a **2-hour project** with 500 cuts, 300 zooms, and 20,000 caption words. |

## Capture in one keystroke

Press **⌥⌘↩︎** or click the menu bar icon.
The screen freezes under Grip's overlay, in the mode you used last, with your last area still selected.
Draw right on top of the frozen screen, then copy it, save it, or record it.

<p align="center">
  <img src=".github/readme/capture.webp" width="100%" alt="Grip's capture overlay on a frozen screen: a selected area of a web app with a red box around the Project name field, a red arrow and the label 'Name it, then create' pointing at the Create project button, a yellow pen underline under the heading, and two pixelated project names. A tool strip with arrow, rectangle, pen, text, pixelate, and six colors sits beside the area, and a bar below it offers Save ⌘S and Copy ⌘C.">
</p>

<p align="center">
  <sub>One keystroke, a few marks, and ⌘C puts it on your clipboard.</sub>
</p>

- **Record it.** Press **↩︎** for a 3-2-1 countdown, then record.
  The countdown shows whether auto-zoom is on, and **Z** flips it.
  Or pick a whole display, one window, or an iPhone or iPad over USB.
- **Or screenshot it.** **⌘C** copies the area at once, **⌘S** saves it to the Desktop.
  Picking a display or a window, **⌘C** copies that; a window comes alone, with clear corners.
  Screenshots keep the Display P3 colors macOS uses.
- **Mark it up first.** Arrow, rectangle, pen, text, and pixelate, each on one key (**A R P T B**), in six colors.
  The pen draws smooth ink that thins with speed, or with pressure on a stylus.
  Drag any shape to move it, and undo covers every stroke.
- **Size it exactly.** Drag the handles, type a size, lock 16:9, 4:3, 1:1, or 9:16, or snap a window to a preset size.

### While you record

<p align="center">
  <img src=".github/readme/ink.gif" width="100%" alt="A landing page draft on a green wallpaper: after ⌥⇧⌘D appears as keycaps, red ink circles the headline 'Get paid in days, not weeks.', an arrow sweeps down to the Start free trial button, and a line underlines the $24 price. The view zooms out to the whole page and the ink fades away.">
</p>

<p align="center">
  <sub>Draw on screen with ⌥⇧⌘D while you record.
  The ink fades on its own.</sub>
</p>

- **Camera, mic, and system audio on one clock**, so lips stay in sync for hours.
- **A camera bubble** in the corner of the area.
  Drag it, and the video puts your camera there too.
- **Draw on screen** with **⌥⇧⌘D**.
  The ink fades out on screen just as it will in the video.
- **Speaker notes** in a scrolling prompter only you can see.
- **Grip stays out of the shot.** Its windows never show up in the recording, and desktop icons can hide too.
  On several displays, the controls stay on the one you're recording, wherever the mouse goes.
- **Pause, resume, restart, or discard** a take, from the widget, the menu bar, or a shortcut.
- **Warnings that matter.** Grip tells you when your mic goes silent or disconnects, before the take is wasted.

### Then share it before you leave the flow

Every recording ends in a small result card:

- **Copy** an MP4 that fits under 20 MB, ready to paste into Slack, Discord, WhatsApp, or Mail.
- **GIF** under 10 MB, sized for GitHub READMEs and issues.
- **Link** to a share page that works before the upload even finishes.
- **Edit** to open the full editor.

Drag the preview straight into another app to drop the file.
**Recent Captures** in the menu bar reopens your last five screenshots and recordings.

## Polished by default

<p align="center">
  <img src=".github/readme/loupe.gif" width="100%" alt="A revenue dashboard on a dark wallpaper with a teal glow: a glass loupe follows the cursor along the MRR growth chart, magnifying each day's tooltip, stretches like liquid as it glides up to the Net new MRR and MRR figures, then magnifies the Export CSV button as it turns to Exported.">
</p>

<p align="center">
  <sub>A glass loupe magnifies one spot and keeps the rest of the dashboard in view.</sub>
</p>

- **Auto-zoom.** Clicks and typing become zooms that follow your cursor.
  Each one is a plain timeline item you can move, retime, or switch off.
  Pick a smooth glide or a focused move that settles fast.
  Rather zoom by hand? Turn auto-zoom off for new recordings in Settings.
- **A glass loupe.** Magnify one spot and keep the rest of the screen in view.
  The lens refracts like real glass and stretches like liquid as it follows the cursor.
  Pick its size, and every new zoom keeps the look you chose last.
- **A cursor worth watching.** Redrawn from events: smoothed, passing exactly through every click, hidden when idle, with motion blur.
  Each click swells through the screen itself, and the loupe and zooms carry it.
  Or pick a lit wave, a soft circle, or a focus ring that locks onto the click, plus click sounds, a larger size, or a touch-style circle.
- **Keystrokes as keycaps.** Shortcuts appear as macOS keycaps in your own keyboard layout.
  Password fields stay private.

<p align="center">
  <img src=".github/readme/captions.gif" width="100%" alt="A launch checklist titled Relay 2.0 launch: as a voice narrates, big word-by-word captions read 'Okay, launch day.', 'Changelog, done.', 'Demo video, done.', and 'Pricing page, done.' while each item is checked off and the progress bar fills, then 'And…' before the last item, Go live, is checked and the status turns Live.">
</p>

<p align="center">
  <sub>Word-by-word captions carry the story, even in a silent GIF.</sub>
</p>

- **Captions written on your Mac.** NVIDIA Parakeet v3 transcribes 25 European languages on device, with timing for every word.
  Show them a line or a word at a time, fading or sliding in.
- **A voice that sounds produced.** DeepFilterNet3 takes background noise down on your Mac, a de-esser softens harsh S sounds, and a slow leveler keeps quiet phrases audible.
  Your voice plays at -14 LUFS like online video, with a limiter so nothing clips.
- **A clean frame, your call.** New recordings show the screen edge to edge.
  Pick a wallpaper and Grip adds the padding to show it, and one undo takes both back.
  Rounded corners and a soft shadow are a slider away.

## Edit a video like a doc

<p align="center">
  <img src=".github/readme/editor.webp" width="100%" alt="The Grip editor: the preview shows a glass loupe over a Create project button with a caption below, the transcript panel shows three filler words struck through, and the timeline shows a zoom and a loupe above clips split where the fillers were cut.">
</p>

- **Edit by transcript.** Select words and press Delete, and the video follows.
  Grip finds filler words and long pauses: remove the fillers or shorten the pauses in one click.
  Double-click a word to fix its caption.
- **A keyboard-first timeline.** `C` cuts, `X` ripple-deletes, `Z` adds a zoom, and `⌘K` reaches every action.
  Copy, paste, duplicate, merge clips, reset a trim, or bring back anything you cut.
  Zooms, camera layouts, and masks sit in lanes above the video, and a lane shows up once it has something in it.
- **Crop** the recording down to the part that matters, and zooms aim inside the crop.
- **Speed without chipmunks.** Any clip from 0.25× to 8×, with pitch-preserving time-stretch.
- **Per-clip sound and cursor.** Set the mic and system audio from muted to 200% each, hide the cursor, or turn off its smoothing for one clip.
  A background music track sits under the mix.
- **Camera layouts.** Picture-in-picture, fullscreen, split screen, or hidden, animated as they change.
- **Masks.** Blur or pixelate anything sensitive, or highlight what matters.
  Masks stay locked to the content through zooms.
- **Safe by default.** Your raw recording never changes.
  Edits are autosaved as you go, and undo covers every one.

## Make it yours

<p align="center">
  <img src=".github/readme/macbook.gif" width="100%" alt="A calendar app inside a MacBook frame on a warm hazy wallpaper: the view pushes in as the user drags out a new event, types 'Design review', adds Maya Chen as a guest, picks a sage color, and saves, then pulls back to the whole laptop with the new event in the week.">
</p>

<p align="center">
  <sub>A MacBook frame and a wallpaper, added after the recording.</sub>
</p>

<p align="center">
  <img src=".github/readme/wallpapers.webp" width="100%" alt="A grid of 28 Grip wallpapers: soft gradients, a synthwave sun, neon tunnels, sunset dunes, iridescent foil, aurora, bokeh, and a prism.">
</p>

- **185 wallpapers** in 8 collections: Soft, Spring, Sunset, Radiant, Energy, Iridescent, Midnight, and Neon.
  Each one is drawn live on the GPU, so it stays sharp at any size and in any format.
  Or use your macOS wallpapers, a gradient, a color, or any image, with optional blur.
- **Device frames** for MacBook, iPhone, and iPad.
- **Every format:** 16:9, 9:16, 4:5, 1:1, or custom.
  Narrow formats follow the cursor.
- **Camera styles:** circle, rounded, or square, mirrored or not, with background removal, face tracking, and hide when silent.
  Grade it with a built-in look or your own `.cube` LUT.
- **Presets** save a whole look as a portable `.grippreset` file, images included.

## Export and share

<p align="center">
  <img src=".github/readme/formats.gif" width="100%" alt="One chat recording exported three ways and played side by side: 16:9 for YouTube, 1:1 for LinkedIn, and 9:16 for Reels. In each, the view follows the cursor as the user opens a thread, replies 'Safari + iOS look good. Ship it 🚀', sends it with ⌘↩︎, and reacts with 🎉.">
</p>

<p align="center">
  <sub>One recording, three formats.
  Narrow formats follow the cursor, so nothing important falls out of frame.</sub>
</p>

- **MP4** in H.264 or HEVC, from 720p to 4K at 30 or 60 fps, hardware encoded.
  Set a size limit and Grip fits the file under it.
- **GIF** with per-scene palettes, so colors don't flicker, plus a loop count and a size target.
- **To a file, the clipboard, or a link.** Exports queue up in the background while you keep editing, and batch export renders many projects in one go.
- **Subtitles** as SRT or VTT, aligned through every cut and speed change.
- **Share links** with timestamped comments, private links, and view counts.
  Uploads resume after a lost connection or a restart.
  Share the whole editable project too: the other side opens it in Grip with one link.

## Private by design

Recording, editing, transcription, and background removal all run on your Mac.
Recording and editing need no account; sharing a link signs in to bestboy.dev once.
There is no telemetry, and crash reports stay on your disk.
Grip goes online only to download the speech model once (about 670 MB), to check for updates, and to upload when you share.

Grip lives in the menu bar, and opened at login it starts there quietly.
Updates download in the background and install themselves while you're away, never during a recording or an export.

## Shortcuts

| Anywhere | |
| --- | --- |
| **⌥⌘↩︎** | Capture: open the picker, or finish the recording (change it in Settings) |
| **⌥⇧⌘P** | Pause or resume |
| **⌥⇧⌘D** | Draw on screen while recording |
| **⌥⇧⌘⌫** | Discard the recording |
| **⌥⌘.** | Start or stop the speaker notes prompter |

| In the picker | |
| --- | --- |
| **↩︎** | Record the area |
| **Z** | During the countdown: turn auto-zoom on or off |
| **⌘C** / **⌘S** | Copy the screenshot / save it to the Desktop |
| **A R P T B** | Arrow, rectangle, pen, text, pixelate |
| **Esc** | Close the picker |

| In the editor | |
| --- | --- |
| **Space** | Play or pause |
| **C** or **⌘B** | Cut at the playhead |
| **S** or hold **⌥** | Split tool |
| **X** | Ripple delete |
| **Z** / **1**-**9**, **0** / **E** | Add a zoom / set its level from 1.5× to 6× / switch it on or off |
| **L** / **M** | Add a camera layout / mute a clip |
| **← →** / **↑ ↓** | Step 0.5 s (1 s with **⇧**) / jump between cuts |
| **⌘C** / **⌘V** / **⌘D** | Copy / paste at the playhead / duplicate |
| **⌘=** / **⌘-** / **⌘0** | Zoom the timeline in / out / to fit |
| **⌘E** | Export |
| **⌘K** | Command menu: every action, searchable |

Automate Grip from Raycast, Shortcuts, or a script with `grip://` links:

```sh
open "grip://record?mode=area"   # also display, window, device; no mode opens the last one
open "grip://stop"
open "grip://open?path=/Users/me/Movies/Demo.grip"
open "grip://open?url=https://bestboy.dev/v/x7Kq2mP9aB3c"   # a shared project
```

## Under the hood

Grip is built on three rules, so the bugs typical of screen recorders cannot happen by design.

- **Raw sources, separate tracks.** Screen without the cursor, camera, mic, system audio, and the input event stream.
  The cursor is redrawn from events, which is what makes smoothing, hiding, and click effects possible.
- **One time map.** Every zoom, caption word, and keystroke lives in source time and maps to the output through one shared map of cuts and speed changes.
  Captions and audio stay in sync after hundreds of cuts.
- **Pure render.** The frame at time *t* is a function of the project and *t*.
  Preview and export share one WebGPU renderer and one audio graph, so the export matches the preview frame for frame.

The stack: Electron and Svelte 5 for the app, a Rust addon (napi-rs, objc2) for ScreenCaptureKit, AVFoundation, CoreGraphics event taps, and Vision, a WebGPU compositor, WebCodecs with VideoToolbox for decoding and encoding, and [mediabunny](https://github.com/Vanilagy/mediabunny) for muxing.

## Build from source

You need macOS 15 or later on Apple silicon, Node 24, Rust, and the Xcode command line tools.

```sh
git clone https://github.com/bestboyhq/grip && cd grip
npm ci
npm run build:native   # the Rust addon
npm run dev            # the app, with hot reload
```

No time to record? Generate a 24-second demo project (needs `ffmpeg`) and open it:

```sh
npx electron scripts/fixture/make.ts
npm run dev -- --open ".context/fixtures/Demo #1 ✨ café.grip"
```

Run the checks with `npm test`, `npm run check`, and `cd native && cargo test`.

## Contributing

Issues and pull requests are welcome.
Read [AGENTS.md](AGENTS.md) for the invariants and the code style, and the skill in [`.agents/skills/`](.agents/skills) for the area you touch: each one lists what screen recorders in that area usually get wrong.
Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), and every merged `feat` or `fix` ships to users as an in-app update.

## License

[AGPL-3.0](LICENSE)
