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
- A new project with a taken name gets a unique name, and Remove moves the project to the Trash.
- Import any .mp4 or .mov as a project; features that need event data degrade gracefully.
- Presets are portable files that bundle their assets, with a default fallback for a missing asset.
- Finder and Quick Look previews, recent projects, and reopening at the saved playhead.

Done when killing the app at any instant during save, recording, or export leaves every project openable.
