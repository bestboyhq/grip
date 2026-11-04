---
name: agents
description: Grip's tools for AI agents, as an MCP server. Use when changing electron/agents.ts, build/grip-mcp, the tools agents call, how agent edits reach the editor, or the Agents section of Settings.
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
- Tools: list_projects, get_project, get_transcript, transcribe_project, edit_project, get_frame, export_project, share_project, export_status, open_project.
  None deletes anything: edits are data on top of the recording, and the user undoes them, and restore_cut brings back what a cut removed.
- Grip does the craft, so a small model makes the same video as a large one: the model says what it wants, Grip's tuned code decides how.
  cut_fillers and shorten_pauses cut what the Transcript tab's buttons cut (`resolveWordEdits` in `src/engine/transcript`), and a cut whose end lands inside a word moves to that word's edge.
  match_captions takes the script and lines it up with the spoken words at the fewest caption changes, so a model never counts word indexes; a script that matches under half the words is refused.
  auto_zoom places the editor's auto zooms (`generateAutoZooms`) on the recording's clicks and typing, turns Auto zoom on at its level, and replaces the auto zooms placed before, so calling it twice never stacks them.
  The server's instructions and edit_project's description make it the first zoom pass, which the model then fits to the narration with set_zoom, remove_zoom, and add_zoom: a model left to place every zoom itself never reaches for it.
  Its answer says how many zooms it placed, or that the recording has no clicks or typing, so the model knows to place its own.
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
- Tool failures are results with `isError` and text that says what to fix; only protocol mistakes are JSON-RPC errors.
- Settings (Agents) shows the Claude Code command, at user scope so the tools work in every folder, and the JSON other agent apps take, each with Copy.

Gotchas:

- Some agent apps hand the model `structuredContent` and drop the text, so every fact the text states is in the data too (`message`, `next`).
- Some agent apps never show the model the server's instructions (Claude Code's `--bare` drops them), so what a model must know to use a tool well sits in that tool's description too.
  Pages stay near 8k tokens as JSON: 500 words a get_transcript answer, 100 clips, zooms, and clicks a get_project answer, with `next` as the start to ask again with.
- Pages go by output time, every play of a word in output order, so clips that repeat or move never loop or skip a page.
- `#`, emoji, and accents in a path round-trip: the editor's project rides its hash route's query, read with URLSearchParams and matched in NFC.
- A reloaded editor page stops listening: requests wait for its `agents:ready`, and a pending one fails with an error that says where the project stands.
- Some clients first probe `server/discover`; "method not found" sends them on to `initialize`.
- Small models send `null` for what they leave out and lists as JSON strings: both parse as if sent right.
- A fix comes as edits in output seconds rounded to the hundredth, ends rounded down and starts up, so applying it never leaves the problem a hair short of fixed.

Done when an agent app, set up with one paste from Settings and Grip quit, cuts, zooms, captions, and exports a project, and the user undoes it all in one step.
And when a small model given the same short brief as a large one exports a video with no problems that scores close to the large one's.
