---
name: app-shell
description: The native macOS app shell. Use when changing the menu bar, dock icon, window positions, global shortcuts, URL scheme, quit prompts, updates, crash reporting, or onboarding.
---

# App shell

The native macOS app around everything else.

- Menu bar app; the dock icon hides during recording and shows whenever a window is open.
- One click on the menu bar icon (or ⌥⌘↵, which the user can change in Settings) opens the area picker, and while recording finishes; the menu is on right-click.
  Esc closes the whole picker, toolbar included.
  Opening Grip (a launch, the Dock icon, opening it again from Finder or Spotlight, the end of onboarding) shows the toolbar alone, with nothing frozen.
  A frozen screen nobody asked for reads as a hung Mac to a new user.
  A recording or screenshot ends in a small result card (copy as a video under 20 MB, GIF, link, edit), not in the editor.
  Its copy, GIF, and link use the project's style, which starts plain (see compositor).
  Recent Captures (menu bar menu and the toolbar's gear) reopens the last five cards, across restarts; their screenshots stay in Grip's own folder, since `$TMPDIR` gets purged.
  Recent Projects, with thumbnails, sit in both menus too: a closed editor is one click back, and the editor's title bar says its edits are saved.
- Windows remember positions per display and return on-screen after a display disconnects.
  The recording controls, camera bubble, and result card show on the display the recording was started on, never where the mouse went since.
- Global shortcuts, a URL scheme for automation (Raycast), and drag-and-drop of project files onto the app or menu bar icon.
  Many users want Grip on macOS's own screenshot keys (⇧⌘5), and macOS takes those before any app sees them.
  Settings offers ⇧⌘5 in one click; while the user types a shortcut, macOS's shortcuts reach the field, and the macOS one on the keys picked stays off while Grip runs: back on when the user picks other keys or quits Grip.
  macOS lets its shortcuts through only to the active app with Accessibility on, and Chromium still drops every key macOS reserves before the page sees it, so the field takes its keys from AppKit.
  Only real key presses prove this works: a page-level key event skips both layers.
- Ask before quitting during a recording or export, and Cancel on any prompt really cancels.
- Universal binary, in-app auto-update, crash reports with diagnostics, and plain-language messages for system error codes (disk full, permission denied).
  A restart into an update, asked for or not, comes back to the menu bar only: updating is no reason to open the picker.

Done when a new user goes from install, through permissions, to a first exported video without reading docs.
