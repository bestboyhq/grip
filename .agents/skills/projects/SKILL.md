---
name: projects
description: Project bundles, presets, and their lifecycle. Use when changing the project format, saving, autosave, migrations, recovery, video import, presets, or Finder previews.
---

# Projects

Project files, presets, and their lifecycle.

- A project is a bundle: raw sources, event stream, a versioned edit document, and a thumbnail.
- Save atomically (write a temp file, then rename), autosave, and keep the previous version as a backup.
- Migrate older schemas forward without loss; an older app refuses newer projects with a clear message.
- An interrupted recording becomes a recoverable project on the next launch.
- Voiceover takes live in the bundle's voiceovers/ folder, each `<id>.m4a` with its voice track and words beside it, listed in sources.takes.
  Deleting a voiceover keeps its take, so undo brings it back.
- A take is pending in project.json from its first second until the editor saved its items.
  A crash, a power loss, or a window closed mid-take loses at most its last second: the next open makes the file whole and places it where it was recorded.
- A new project with a taken name gets a unique name, and Remove moves the project to the Trash.
- Import any .mp4 or .mov as a project; features that need event data degrade gracefully.
- Presets are portable files that bundle their assets, with a default fallback for a missing asset.
- A preset is shown on the project's own frame before it is applied: thumbnails and a hover preview, through the one compositor.
- A preset carries the look, not the recording: applying one keeps the camera in the corner it was recorded in.
- A project remembers the preset its look came from, so changes since show as edited, with Update and Revert.
- One preset can be the look new recordings start with; a deleted one leaves the default look.
- Finder and Quick Look previews, recent projects, and reopening at the saved playhead.

Done when killing the app at any instant during save, recording, or export leaves every project openable.
