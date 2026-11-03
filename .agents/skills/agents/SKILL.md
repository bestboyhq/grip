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
- Tools: list_projects, get_project, get_transcript, transcribe_project, edit_project, export_project, share_project, export_status, open_project.
  None deletes anything: edits are data on top of the recording, and the user undoes them.
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
  Pages stay near 8k tokens as JSON: 500 words a get_transcript answer, 100 clips, zooms, and clicks a get_project answer, with `next` as the start to ask again with.
- Pages go by output time, every play of a word in output order, so clips that repeat or move never loop or skip a page.
- `#`, emoji, and accents in a path round-trip: the editor's project rides its hash route's query, read with URLSearchParams and matched in NFC.
- A reloaded editor page stops listening: requests wait for its `agents:ready`, and a pending one fails with an error that says where the project stands.
- Some clients first probe `server/discover`; "method not found" sends them on to `initialize`.

Done when an agent app, set up with one paste from Settings and Grip quit, cuts, zooms, captions, and exports a project, and the user undoes it all in one step.
