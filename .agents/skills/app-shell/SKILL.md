---
name: app-shell
description: The native macOS app shell. Use when changing the menu bar, dock icon, window positions, global shortcuts, URL scheme, quit prompts, updates, crash reporting, or onboarding.
---

# App shell

The native macOS app around everything else.

- Menu bar app; the dock icon hides during recording and shows whenever a window is open.
- One click on the menu bar icon (or ⌥⌘↵, which the user can change in Settings) opens the area picker, and while recording finishes; the menu is on right-click.
  Esc closes the whole picker, toolbar included.
  A recording or screenshot ends in a small result card (copy as a video under 20 MB, GIF, link, edit), not in the editor.
  Its copy, GIF, and link use the project's style, which starts plain (see compositor).
  Recent Captures (menu bar menu and the toolbar's gear) reopens the last five cards, across restarts; their screenshots stay in Grip's own folder, since `$TMPDIR` gets purged.
- Windows remember positions per display and return on-screen after a display disconnects.
- Global shortcuts, a URL scheme for automation (Raycast), and drag-and-drop of project files onto the app or menu bar icon.
- Ask before quitting during a recording or export, and Cancel on any prompt really cancels.
- Universal binary, in-app auto-update, crash reports with diagnostics, and plain-language messages for system error codes (disk full, permission denied).

Done when a new user goes from install, through permissions, to a first exported video without reading docs.
