<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="Grip app icon">
</p>

<h1 align="center">Grip</h1>

<p align="center">
  <b>One shortcut for screenshots and polished demos.</b><br>
  Grip is the free screen recorder for Mac that zooms where you click, smooths your cursor, and captions your voice.<br>
  Open source. No subscription, no account, no watermark. Free for commercial use.
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/grip/releases/latest"><img src="https://img.shields.io/badge/Download_for_macOS-000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS" height="40"></a>
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/grip/releases/latest"><img src="https://img.shields.io/github/v/release/bestboyhq/grip?label=release&color=5e5ce6" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-15%2B-1c1c1e?logo=apple" alt="macOS 15 or later">
  <img src="https://img.shields.io/badge/Apple_silicon-native-1c1c1e" alt="Native on Apple silicon">
  <img src="https://img.shields.io/badge/signed-notarized-1c1c1e" alt="Signed and notarized by Apple">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-1c1c1e" alt="AGPL-3.0 license"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset=".github/readme/hero-light.gif">
    <img src=".github/readme/hero.gif" width="100%" alt="A deployments dashboard polished by Grip on a pastel iridescent wallpaper, in a seamless loop: a glass loupe on the top build's Ready status lets go as the cursor leaves, and the view zooms in as it glides to the Deploy button. The click swells through the screen and the build turns Building. A loupe appears on the cursor as it sweeps back, grows wide over the build's row, closes onto the status, and tightens as the build turns Ready.">
  </picture>
</p>

<p align="center">
  <sub>Exported by Grip from a raw 4-second take.
  The zoom, the smooth cursor, and the click swell are automatic.
  The only edits: a wallpaper, a glass loupe that follows the cursor and changes size, and a larger cursor.
  The take ends where it starts, so the GIF loops.</sub>
</p>

<p align="center">
  If Grip saves you an edit, <a href="https://github.com/bestboyhq/grip">a star</a> helps other people find it.
</p>

---

Raw screen recordings are hard to watch: a tiny cursor on a huge screen, nothing in focus, and a lot of "um".
With Grip you record once and skip the editing.
Stop the recording, and the video is one click from your clipboard or a share link.

## What you get

- **Auto-zoom.** Clicks and typing become zooms that follow your cursor.
  A glass loupe magnifies one spot and keeps the rest of the screen in view, so nobody gets dizzy.
- **A smooth cursor.** Redrawn from your real clicks, with motion blur, click effects, and keystrokes as keycaps.
- **Captions and a clean voice.** Transcribed on your Mac in 25 European languages, with noise taken down and levels evened out.
- **Edit by transcript.** Select words and press Delete, and the video follows.
  Filler words and long pauses go in one click.
- **A screenshot tool.** The same shortcut freezes the screen: add arrows, boxes, ink, and text, pixelate what's private, and paste.
- **Share in one click.** An MP4 under 20 MB, a GIF under 10 MB for a README, or a link your team comments on.
- **Your look.** 165 wallpapers, MacBook, iPhone, and iPad frames, camera layouts, and 16:9, 1:1, or 9:16 from one take.
- **Nothing is baked in.** Raw tracks stay untouched, and every zoom, cut, and caption is an edit you can undo.
- **Your agent records the demo.** Grip is an MCP server: Claude Code, Codex, or Cursor films a UI change for the pull request.

The [guide](docs/guide.md) covers all of it.

## It does not break

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

## Private by design

Recording, editing, transcription, and background removal all run on your Mac.
Recording and editing need no account; sharing a link signs in to bestboy.dev once.
Grip shares usage stats, like a finished recording or an export, and never what you record.
One switch in Settings turns them off, and so does `DO_NOT_TRACK=1`.
[Exactly what Grip sends](docs/guide.md#private-by-design).

## Agents

Grip is an MCP server: agent apps can record a demo of a web app, then cut, zoom, caption, export, and share it.
Add it to Claude Code:

```sh
claude mcp add --scope user grip -- /Applications/Grip.app/Contents/Resources/grip-mcp
```

[Other agent apps, every tool, and the `grip` CLI](docs/guide.md#agents).

## Docs

- [Capture](docs/guide.md#capture-in-one-keystroke): screenshots, markup, recording, and the result card.
- [Polished by default](docs/guide.md#polished-by-default): auto-zoom, the loupe, the cursor, captions, and voice.
- [The editor](docs/guide.md#edit-a-video-like-a-doc): transcript, timeline, speed, voiceover, layouts, and masks.
- [Make it yours](docs/guide.md#make-it-yours): wallpapers, device frames, formats, camera styles, and presets.
- [Export and share](docs/guide.md#export-and-share): MP4, GIF, subtitles, and share links.
- [Shortcuts](docs/guide.md#shortcuts) and `grip://` links for Raycast, Shortcuts, and scripts.
- [Under the hood](docs/guide.md#under-the-hood): the three rules and the stack.
- [Build from source](docs/guide.md#build-from-source).

## Contributing

Issues and pull requests are welcome.
[Build from source](docs/guide.md#build-from-source) takes four commands.
Read [AGENTS.md](AGENTS.md) for the invariants and the code style, and the skill in [`.agents/skills/`](.agents/skills) for the area you touch: each one lists what screen recorders in that area usually get wrong.
Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), and every merged `feat` or `fix` ships to users as an in-app update.
Before your first pull request is merged, you sign the [Contributor License Agreement](CLA.md) by commenting on the pull request as the CLA bot asks.
You keep the copyright in your work, and the agreement lets the maintainer also use it under other licenses.

## License

Copyright (C) 2026 Szymon Grącki and Grip contributors

Licensed under [AGPL-3.0-only](LICENSE).
As an additional term under AGPL section 7(e), the license grants no rights to the names Grip and Best Boy or their logos: see [TRADEMARKS.md](TRADEMARKS.md).
Contributions require signing the [CLA](CLA.md).
Third-party components and their licenses are listed in [NOTICE](NOTICE).
