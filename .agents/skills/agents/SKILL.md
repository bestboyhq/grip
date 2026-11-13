---
name: agents
description: Grip's tools for AI agents, as an MCP server and the grip CLI. Use when changing electron/agents.ts, build/grip-mcp, build/grip, the tools agents call, record_demo, how agent edits reach the editor, or the Agents section of Settings.
---

# Agents

Agent apps list, read, edit, export, and share projects through Grip's MCP server.

- The server lives in the main process (`electron/agents.ts`): JSON-RPC 2.0, one message per line, no SDK.
  It speaks protocol 2025-11-25 back to 2024-11-05, with progress notifications, on a Unix socket in the user's temporary folder (`getconf DARWIN_USER_TEMP_DIR`), mode 0600.
  Grip.app's socket is `Grip.sock`; a dev checkout's is `Grip-<12 hex of the md5 of its path>.sock`, so checkouts never meet.
- Agent apps run `grip-mcp` (`build/grip-mcp`, shipped as `Contents/Resources/grip-mcp`), which pipes stdio to the socket.
  It is POSIX sh and `/usr/bin/nc`, every tool by its full path: agent apps start it with a bare environment, and Grip's RunAsNode fuse stays off, so Grip's own binary cannot run it.
- Nothing listening: `grip-mcp` starts Grip in the menu bar (`open -n -g -a … --args --background`, or `npm run dev -- --background` in a checkout) and waits up to 20 s.
  `-n` makes a running Grip a second instance, which hands its arguments over and exits, so no picker opens.
  A running Grip whose socket the system purged listens again on that second instance.
  Still nothing: each request gets a JSON-RPC error that says why.
- A shell runs `grip` (`build/grip`, shipped as `Contents/Resources/grip`): `grip <tool> [json]`, the JSON on stdin when the argument is left out, and `grip` alone lists the tools.
  It pipes initialize and one tools/call through `grip-mcp`, so it starts Grip the same way, and reads JSON with JavaScript for Automation (`osascript -l JavaScript`), which every Mac has.
  It prints the text, the image paths in a new temporary folder, then the structured data as JSON; it exits 1 when the call failed, 2 when the arguments are not JSON.
- Tools: list_projects, get_project, get_transcript, transcribe_project, edit_project, get_frame, export_project, share_project, export_status, open_project, get_feedback, reply_feedback, record_demo.
  None deletes anything: edits are data on top of the recording, and the user undoes them, and restore_cut brings back what a cut removed.
- Grip does the craft, so a small model makes the same video as a large one: the model says what it wants, Grip's tuned code decides how.
  cut_fillers and shorten_pauses cut what the Transcript tab's buttons cut (`resolveWordEdits` in `src/engine/transcript`), and a cut whose end lands inside a word moves to that word's edge.
  match_captions takes the script and lines it up with the spoken words at the fewest caption changes, so a model never counts word indexes; a script that matches under half the words is refused.
  Every get_project and edit_project answer lists the problems (`zoomProblems` in `src/engine/zoom`) with the exact call that fixes each: a zoom too short to read, a zoom the camera glides to and leaves before it holds still, the camera moving while a cut jumps the picture, the video ending mid zoom-out, captions on with no transcript.
  The checks go by the camera's real springs and glide times (the export's layout, `layoutOf`), so a project without problems never moves the camera across a cut.
- get_frame renders a frame through the editor's still renderer, the export's compositor, as JPEG image content; a closed project opens in the editor for it.
- get_project lists the clicks with the clips and zooms: each press's output time and its x, y on the recording, the point add_zoom aims at, so an agent zooms on what the user clicked instead of guessing from the words.
  An add_zoom names its look (zoom or loupe) or takes the one last picked in Grip, and never changes that pick.
- transcribe_project and the editor's Transcribe share one run per project: every window hears its progress, so an editor shows an agent's run as its own and takes the transcript when it lands.
  It waits up to 45 s like an export, and asking again waits on the same run.
- Every time an agent sees or gives is in output seconds, mapped through the one time map.
  Words are what the video says: the recording's merged with its voiceovers' (loadSpoken in electron/transcript.ts), indexed as the editor's Transcript tab shows them.
  A list of edits applies together or not at all, every time in it as the timeline stood before the list (`src/shared/edits.ts`).
- A project open in an editor is read and edited through that editor (`agents:request`, `agents:reply`): the user watches the edits land as one undo step, saved before the reply.
  A closed project is edited on disk under the bundle lock; one opened meanwhile takes the edit through its editor instead.
- Exports never show a dialog and never replace a file: to the path given, or under the project's name into the export folder, numbered past any file there.
  An agent's export never moves the folder the user's next export opens in.
  A call waits up to 45 s, as clients give up near 60 s, then returns the id export_status waits on.
- The review loop runs on a share link (`electron/feedback.ts`): get_feedback reads its comment threads, and reply_feedback answers them, as Grip's signed-in account, and resolves the ones that are done.
  A link is a share link, with or without `?k=`, or its bare 12-character id; the key rides along to the platform, and the link's team needs none.
  Threads come open first, each with its moment (seconds and m:ss), its spot on the frame when it points at one, writer, guest or not, text, when, and every reply in written order, however deep it answers; reactions are only counted.
  When this Mac shared the take a thread was made on (`sharedFrom` in `electron/share.ts`), the open thread brings that project's frame at its time, rendered by get_frame, with its spot ringed: each take is its own recording.
  reply_feedback posts each reply in order, with the agent app's name from its initialize so the link page can tag it, and reports each result; a reply to a reply resolves the thread it is in.
- An agent's frame opens the project's editor without focus (`openProject` with `focus: false`), and an agent's share leaves the clipboard alone: the user keeps typing and pasting where they are.
- record_demo films a web page while Grip runs an agent's steps on it (`electron/demo.ts`, its pure half `src/shared/demo.ts`): click, hover, type, press, scroll, wait, each with an optional `say` that labels the step and becomes a chapter of its share link.
  The page is an offscreen window in its own in-memory session, sandboxed, with no Node, popups, downloads, permissions, or dialogs, so it needs no Screen Recording permission and never shows.
  Its GPU textures reach a hidden encoder window (`#/demo`, `src/windows/demo/Demo.svelte`) as VideoFrames, each at the time it painted, and leave as the screen track of a fresh recording: no cursor in the pixels, input in events.jsonl in video px, so auto zoom, the smooth cursor, and click effects apply.
  Input is real (`sendInputEvent`), the pointer gliding to each target on the same eased arc as the README demos, after the target shows, comes into view (wheeled there), is uncovered, and holds still.
  Then it exports an MP4 and a GIF, renders one frame per step through get_frame, and shares the MP4 with the GIF when asked; past 45 s it answers with an id for export_status.
  With `link` (a share link or its id, read by `parseLink`), the video becomes that link's next take, so every place the link was posted shows the fix; `link` implies share, a take keeps its link's privacy, and its title renames the link.
  A link full of takes sends it out as a new link, and the answer says which it became (`take` in the data).
  A failed step answers with which step, why, and the page as it gave up, and leaves no project: the bundle holds only `.part` files until the last step.
- Tool failures are results with `isError` and text that says what to fix; only protocol mistakes are JSON-RPC errors.
- Settings (Agents) shows the Claude Code command, at user scope so the tools work in every folder, and the JSON other agent apps take, each with Copy.

Gotchas:

- Some agent apps hand the model `structuredContent` and drop the text, so every fact the text states is in the data too (`message`, `next`).
  Pages stay near 8k tokens as JSON: 500 words a get_transcript answer, 100 clips, zooms, and clicks a get_project answer, with `next` as the start to ask again with.
- Some agent apps never show the model the server's instructions (Claude Code's `--bare` drops them), so what a model must know to use a tool well sits in that tool's description too.
- Pages go by output time, every play of a word in output order, so clips that repeat or move never loop or skip a page.
- `#`, emoji, and accents in a path round-trip: the editor's project rides its hash route's query, read with URLSearchParams and matched in NFC.
- A reloaded editor page stops listening: requests wait for its `agents:ready`, and a pending one fails with an error that says where the project stands.
- Some clients first probe `server/discover`; "method not found" sends them on to `initialize`.
- Small models send `null` for what they leave out and lists as JSON strings: both parse as if sent right.
- A thread's time is the shared video's, and its frame is the project as it stands now: a cut since the share moves what shows there, and a frame past the new end is refused with that reason.
- Feedback pages go by the video's time, not by a count: an agent that resolves threads between pages would skip threads with an offset.
  A page that is all one moment takes every thread there, so asking again with next always moves on.
- A 401 signs Grip out, as a failed share does, and reply_feedback stops there; every failure says to sign in from the menu bar icon.
- A fix comes as edits in output seconds rounded to the hundredth, ends rounded down and starts up, so applying it never leaves the problem a hair short of fixed.
- An offscreen page answers the debugger only once it has a renderer: record_demo loads `about:blank` before it turns on focus emulation, or the call waits forever.
- `invalidate()` on a shared-texture page paints no texture, and a still page paints nothing: record_demo holds the latest paint to open and close the video with.
- Chromium names the arrow `pointer` and the pointing hand `hand` in `cursor-changed`.
- A Mac turns ⌘A, ⌘Z, and ⌘← into editing commands in its key bindings, which an offscreen page lacks: press sends those keys over the debugger with their command (`Input.dispatchKeyEvent` `commands`), which runs unless the page takes the key.
  ⌘C, ⌘X, and ⌘V reach only the page's own handlers, so a demo never reads or replaces the user's clipboard.

Done when an agent app, set up with one paste from Settings and Grip quit, cuts, zooms, captions, and exports a project, and the user undoes it all in one step.
And when a small model given the same short brief as a large one exports a video with no problems that scores close to the large one's.
