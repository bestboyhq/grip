# Set up Grip and record a demo

You are a coding agent.
Grip is a macOS app that turns a web page you drive into a polished video: it zooms where each click lands, glides the cursor, and marks each step.
Follow these steps in order, then put the video in the pull request of the change you are working on.

Run every command yourself.
Ask the user only to approve the first upload or to sign in, and do not wait on a command that needs them.

## 1. Check the machine

Grip runs on macOS 15 or later on Apple silicon.

```sh
sw_vers -productVersion   # 15.0 or later
uname -m                  # arm64
```

If either check fails, stop and report `blocked: Grip needs macOS 15 or later on Apple silicon`.

## 2. Install Grip if it is missing

```sh
if [ ! -d /Applications/Grip.app ]; then
  tmp=$(mktemp -d)
  curl -fsSL https://bestboy.dev/download/grip -o "$tmp/Grip.dmg"
  hdiutil attach -nobrowse -quiet -mountpoint "$tmp/mnt" "$tmp/Grip.dmg"
  cp -R "$tmp/mnt/Grip.app" /Applications/
  hdiutil detach -quiet "$tmp/mnt"
fi
```

Grip is signed and notarized, so it opens without a prompt, and it updates itself after this.

## 3. Add Grip to your tools

Skip this step if a `grip` MCP server is already in your tools.
Otherwise run the line for the agent you are, at user scope, so Grip works in every project.
Keep the user's other MCP servers as they are.

| Agent | Command |
| --- | --- |
| Claude Code | `claude mcp add --scope user grip -- /Applications/Grip.app/Contents/Resources/grip-mcp` |
| Codex | `codex mcp add grip -- /Applications/Grip.app/Contents/Resources/grip-mcp` |
| OpenCode | `opencode mcp add grip --global -- /Applications/Grip.app/Contents/Resources/grip-mcp` |
| Gemini CLI | `gemini mcp add --scope user grip /Applications/Grip.app/Contents/Resources/grip-mcp` |
| VS Code | `code --add-mcp '{"name":"grip","type":"stdio","command":"/Applications/Grip.app/Contents/Resources/grip-mcp"}'` |
| Amp | `amp mcp add grip -- /Applications/Grip.app/Contents/Resources/grip-mcp` |
| Devin | `devin mcp add grip -- /Applications/Grip.app/Contents/Resources/grip-mcp` |
| Cursor | Add `"grip": { "command": "/Applications/Grip.app/Contents/Resources/grip-mcp" }` under `mcpServers` in `~/.cursor/mcp.json` |
| Zed | Add the same entry under `context_servers` in Zed's settings file |
| Any other MCP client | Add a stdio server named `grip` whose command is `/Applications/Grip.app/Contents/Resources/grip-mcp` |

Most agents load a new MCP server only in the next session.
Do not wait for it: Grip's CLI runs the same tools now.

```sh
/Applications/Grip.app/Contents/Resources/grip                       # lists the tools
/Applications/Grip.app/Contents/Resources/grip <tool> '<json input>'  # runs one
/Applications/Grip.app/Contents/Resources/grip <tool> < input.json    # reads the input from stdin
```

## 4. Record a demo

1. Make sure the page with the change is running, for example the dev server on localhost.
   With no change in progress, record the app's main flow to prove Grip works.
2. Write the steps a person takes to see the change: what to click, what to type, what to wait for.
   Use the selectors your tests use: CSS, or `text=Deploy` for visible text.
   Keep it under 30 seconds: one flow, start to finish.
3. Record it.

With the MCP tool:

```json
record_demo({
  "url": "http://localhost:3000/deployments",
  "title": "Deploy from the list",
  "steps": [
    { "click": "text=Deploy", "say": "Deploy from the list" },
    { "wait": "text=Building" },
    { "wait": "text=Ready", "say": "It updates live" }
  ],
  "share": true
})
```

With the CLI, put the same input in a file:

```sh
/Applications/Grip.app/Contents/Resources/grip record_demo < demo.json
```

4. Look at the frame Grip returns for each step: an image with the MCP tool, a file path with the CLI.
   If a frame does not show the change, fix the steps and record again.
   If a step fails, Grip stops and names it: fix that step and record again.

## 5. Put the demo in the pull request

Add the link under a `## Demo` heading at the top of the pull request description:

```markdown
## Demo

[Deploy from the list](https://bestboy.dev/v/x7Kq2mP9aB3c), recorded with Grip.
```

On GitHub, `gh pr edit <number> --body-file <file>` updates the description.
Post the same link in the issue and the team's channel when the user asks: they show its poster and title.

## 6. Answer your team's feedback

When the user asks you to work on the feedback, read it with `get_feedback({ "link": "<share link>" })`.
Each thread has its moment in the video, the spot on the frame it points at, who wrote it, and its replies.
Fix what the threads ask for.
Record the demo again with `"link": "<share link>"` added: the new video becomes the link's next version, so every place the link was posted shows the fix.
Then answer each thread with `reply_feedback`:

```json
reply_feedback({
  "link": "https://bestboy.dev/v/x7Kq2mP9aB3c",
  "replies": [
    { "comment": "<thread id>", "text": "Fixed: Deploy now locks while it runs. Version 2 shows it.", "resolve": true }
  ]
})
```

Resolve a thread only when the change does what it asks.
When you cannot do what a thread asks, reply with why and leave it open.

## 7. Report

End with this block, and nothing after it:

```
Grip: ready | waiting for sign-in | blocked: <reason>
Tools: loaded | next session (used the CLI)
Demo: <share link or file path>, <seconds> s, <steps passed>/<steps>
Pull request: <link> | none
```

## Rules

- A share link uploads the video to bestboy.dev, where anyone with the link can watch it.
  Ask the user once before the first upload in a project, and never share a page that shows secrets or customer data.
- If sharing asks for sign-in, tell the user to sign in from Grip's menu bar icon, and give the MP4's path until then.
- Record again whenever the change does: an old demo misleads the reviewer.
