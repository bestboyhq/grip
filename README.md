<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="Grip app icon">
</p>

<h1 align="center">Grip</h1>

<p align="center">
  <b>Record your screen. Get a polished video.</b><br>
  Auto-zoom, a smooth cursor, captions, and one-click export.<br>
  A free and open source screen recorder and editor for the Mac.
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
  <img src=".github/readme/hero.gif" width="100%" alt="A recording polished by Grip: the view zooms in on a form as the user clicks and types, the cursor glides, the shortcut ⌘A appears as keycaps, and captions follow the narration.">
</p>

<p align="center">
  <sub>Exported by Grip from a raw 24-second screen recording with voice-over.
  Zooms, cursor, and keycaps are automatic.
  The only edits: captions on, filler words out.</sub>
</p>

---

Most screen recordings are hard to watch: a tiny cursor on a huge screen, nothing in focus, and a lot of "um".
Grip records your screen, camera, mic, and every click and keystroke on separate tracks, then directs the video for you.
It zooms where you click, follows where you type, redraws a smooth cursor, and writes captions on your Mac.
Nothing gets baked in, so every choice stays editable.

## Polished by default

- **Auto-zoom.** Clicks and typing become zooms that follow your cursor. Each one is a plain timeline item you can move, retime, or switch off.
- **A cursor worth watching.** Grip records the cursor apart from the screen and redraws it: smoothed, passing exactly through every click, hidden when idle, with click effects and motion blur.
- **Keystrokes as keycaps.** Shortcuts appear as macOS keycaps in your own keyboard layout. Password fields stay private.
- **A voice that sounds produced.** Noise reduction, loudness normalized to -16 LUFS, and a limiter so nothing clips.
- **Captions written on your Mac.** NVIDIA Parakeet v3 transcribes 25 European languages on device, with timing for every word.
- **A frame that looks designed.** Wallpaper, padding, rounded corners, and a soft shadow from the first frame.

## Edit a video like a doc

<p align="center">
  <img src=".github/readme/editor.webp" width="100%" alt="The Grip editor: a live preview with captions, the transcript panel with filler words underlined and a Remove filler words button, and a timeline with clip, zoom, keystroke, and word tracks.">
</p>

- **Edit by transcript.** Delete words and the video follows. Grip finds filler words and long pauses, and you confirm the cut.
- **A keyboard-first timeline.** `C` cuts, `X` ripple-deletes, `Z` adds a zoom, and `⌘K` reaches every action. Undo covers every edit.
- **Speed without chipmunks.** Any clip from 0.25× to 8×, with pitch-preserving time-stretch.
- **Camera layouts.** Picture-in-picture, fullscreen, split screen, or hidden, animated as they change.
- **Masks.** Blur or pixelate anything sensitive, or highlight what matters. Masks stay locked to the content through zooms.
- **Non-destructive.** Your raw recording never changes. Edits are data on top, autosaved as you go.

## Record anything

- Your whole display, one window, an area, or an iPhone or iPad over USB.
- Camera, microphone, and system audio on one clock, so lips stay in sync.
- Speaker notes in a prompter only you can see. Grip's own windows never show up in the recording, and desktop icons can hide too.
- Pause, resume, or restart a take. Grip warns you when your mic goes silent.
- Crash-safe: a crash or power loss keeps your recording, and Grip stops cleanly before the disk fills.

## Make it yours

<p align="center">
  <img src=".github/readme/wallpapers.webp" width="100%" alt="A grid of 28 Grip wallpapers: soft gradients, a synthwave sun, neon tunnels, sunset dunes, iridescent foil, aurora, bokeh, and a prism.">
</p>

- **185 wallpapers** in 8 collections, rendered live on the GPU. Or use your macOS wallpapers, a gradient, a color, or any image.
- **Device frames** for MacBook, iPhone, and iPad.
- **Every format:** 16:9, 9:16, 4:5, 1:1, or custom. Narrow formats follow the cursor.
- **Camera styles:** circle, rounded, or square, background removal, face tracking, hide when silent, and color grades or your own `.cube` LUT.
- **Presets** save a look as a portable `.grippreset` file.

## Export and share

- **MP4** in H.264 or HEVC, up to 4K at 60 fps, hardware encoded.
- **GIF** with per-scene palettes, a loop count, and a size target.
- **To a file, the clipboard, or a link.** Batch export runs in the background while you keep editing.
- **Subtitles** as SRT or VTT, aligned through every cut and speed change.
- **Share links** with timestamped comments, private links, and view counts, served by a [small server](server) you host yourself.

## Private by design

Recording, editing, transcription, and background removal all run on your Mac.
There is no account and no telemetry, and crash reports stay on your disk.
Grip goes online only to download the speech model once (about 670 MB), to check for updates, and to upload when you share.

## Shortcuts

| Anywhere | |
| --- | --- |
| **⌥⌘↩︎** | Start or stop recording |
| **⌥⇧⌘P** | Pause or resume |
| **⌥⇧⌘⌫** | Discard the recording |
| **⌥⌘.** | Show or hide speaker notes |

| In the editor | |
| --- | --- |
| **Space** | Play or pause |
| **C** or **⌘B** | Cut at the playhead |
| **S** or hold **⌥** | Split tool |
| **X** | Ripple delete |
| **Z** / **0**-**9** / **E** | Add a zoom / set its level / switch it on or off |
| **L** / **M** | Add a camera layout / mute a clip |
| **← →** / **↑ ↓** | Step 0.5 s (1 s with **⇧**) / jump between cuts |
| **⌘K** | Command menu: every action, searchable |

Automate Grip from Raycast, Shortcuts, or a script with `grip://` links:

```sh
open "grip://record?mode=area"   # also display, window, device
open "grip://stop"
open "grip://open?path=/Users/me/Movies/Demo.grip"
```

## Under the hood

Grip is built on three rules, so the bugs typical of screen recorders cannot happen by design.

- **Raw sources, separate tracks.** Screen without the cursor, camera, mic, system audio, and the input event stream. The cursor is redrawn from events, which is what makes smoothing, hiding, and click effects possible.
- **One time map.** Every zoom, caption word, and keystroke lives in source time and maps to the output through one shared map of cuts and speed changes. Captions and audio stay in sync after hundreds of cuts.
- **Pure render.** The frame at time *t* is a function of the project and *t*. Preview and export share one WebGPU renderer and one audio graph, so the export matches the preview frame for frame.

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

Run the share server with `npm run server`, and the checks with `npm test`, `npm run check`, and `cd native && cargo test`.

## Contributing

Issues and pull requests are welcome.
Read [AGENTS.md](AGENTS.md) for the invariants and the code style, and the skill in [`.agents/skills/`](.agents/skills) for the area you touch: each one lists what screen recorders in that area usually get wrong.
Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), and every merged `feat` or `fix` ships to users as an in-app update.

## License

[AGPL-3.0](LICENSE)
