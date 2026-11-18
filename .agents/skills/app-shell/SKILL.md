---
name: app-shell
description: The native macOS app shell. Use when changing the launch, menu bar, dock icon, window positions, global shortcuts, URL scheme, quit prompts, updates, crash reporting, or onboarding.
---

# App shell

The native macOS app around everything else.

- Menu bar app; the dock icon shows whenever a window is open, recording or not.
  Hiding it for a recording left the editor on screen with no icon to switch back to it, which reads as Grip gone.
  The icon follows the activation policy (`updateDock`), never Electron's `app.dock.show()`: with Grip active, that brings the Dock forward first, and Finder stayed highlighted in it after every recording that ended in the editor.
  The policy turns regular before a normal window shows: once the window has activated Grip, macOS keeps the other app's menu bar.
  Floating panels skip Electron's dock change in `setVisibleOnAllWorkspaces` (`skipTransformProcessType`) and keep `canHide` off themselves, so hiding other apps never takes the recording controls.
  It opens at login unless the user turns that off (onboarding's last page proposes it, Settings has the switch): waiting in the menu bar, Grip opens within a frame or two, while a cold launch takes ~350 ms.
  A launch at login stays in the menu bar; macOS marks it with the launched-as-login-item Apple Event (`wasOpenedAtLogin`).
  Dev and hidden runs never add a login item: the bare dev Electron would open at login instead.
- One click on the menu bar icon (or the user's record shortcut) opens the area picker at once (the freeze lands under it, see capture), and while recording finishes; the menu is on right-click.
  It opens in the mode picked last, and in area before the first pick: an area's card offers Screenshot and Record both, so nobody chooses one before they see the other.
  Esc closes the whole picker, toolbar included.
  Opening Grip (a launch, the Dock icon, opening it again from Finder or Spotlight) shows the toolbar alone, with nothing frozen.
  A frozen screen nobody asked for reads as a hung Mac to a new user.
  The end of onboarding opens the picker like the shortcut does: Continue asked for it, and a new user facing the toolbar alone does not know what comes next.
  A recording or screenshot ends in a small result card (copy as a video under 20 MB, GIF, link, edit), not in the editor.
  The card leaves by itself 4 s after it shows or its copy is done, held while the pointer rests on it, an export runs, or a failure shows.
  A recording's card that stayed until closed sat over the user's work after every take.
  Its copy, GIF, and link use the project's style, which starts plain (see compositor).
  Recent Captures (menu bar menu and the toolbar's gear) reopens the last five cards, across restarts; their screenshots stay in Grip's own folder, since `$TMPDIR` gets purged.
  Recent Projects, with thumbnails, sit in both menus too: a closed editor is one click back, and the editor's title bar says its edits are saved.
- A launch shows the toolbar whole in its first frame: it shows once it has drawn itself with its settings and devices (shell:painted).
  A panel that fills in after it appears reads as a blink.
  The main thread stays free until then: device discovery runs on a worker (AVFoundation's first takes ~60 ms), and modules only some features use (the updater, mediabunny) load on first use, since every static import in `electron/` costs every launch.
  Chromium loads the toolbar's page only once the launch turn ends, so launch work the toolbar does not need (the menu bar icon, the first update check) waits until it has painted (`afterToolbar`).
  A window is on screen once `reveal` shows it: AppKit hands window changes to the window server only when the main thread's turn ends, so `reveal` commits them at once (`commitWindows`); the toolbar's turn went on to make the overlays, and it showed 50 ms late.
  Shown again, the toolbar waits for a frame drawn with that pick's state (`whenDrawn`), never showing the last one's.
- Windows remember positions per display and return on-screen after a display disconnects.
  Fixed-size windows keep their size: the first screen capture in a process re-sets every window's style mask, which turns a frameless one resizable and a title bar taller (`keepFixed` puts it back).
  The recording controls, camera bubble, and result card show on the display the recording was started on, never where the mouse went since.
- Global shortcuts, a URL scheme for automation (Raycast), and drag-and-drop of project files onto the app or menu bar icon.
  Many users want Grip on macOS's own screenshot keys (⇧⌘5), and macOS takes those before any app sees them.
  The record shortcut has no default: people reach for different keys.
  Onboarding ends waiting for the user's own, with Continue once they press them and Skip leaving none; Settings sets, changes, or removes it (⌫).
  Onboarding goes past permissions only with Screen Recording on, since Grip can do nothing without it; the shortcut is the user's to skip.
  Any key with ⌘ or ⌃ makes one, and so does an F key: ⌘4 is what people try first.
  One modifier takes those keys from every other app, so the field saves it and says what it costs; keys that type text (⌥A, ⇧A, a bare key) are refused.
  The field shows each key as it goes down, refused ones too: a field that stays empty while keys are held reads as broken.
  A switch in Settings hands ⇧⌘5 to Grip (off leaves none); while the user types a shortcut, macOS's shortcuts reach the field, and the macOS one on the keys picked stays off while Grip runs: back on when the user picks other keys or quits Grip.
  macOS lets its shortcuts through only to the active app with Accessibility on, and Chromium still drops every key macOS reserves before the page sees it, so the field takes its keys from AppKit.
  Only real key presses prove this works: a page-level key event skips both layers.
- Ask before quitting during a recording or export, and Cancel on any prompt really cancels.
- Universal binary, in-app auto-update, crash reports with diagnostics, and plain-language messages for system error codes (disk full, permission denied).
  A restart into an update, asked for or not, comes back to the menu bar and to the editors that were open, each where it was: updating is no reason to open the picker.
  An open editor never holds an update back, since it saves and comes back; only work a restart cuts short does (a recording, an export, a transcription, a playing preview).
  An editor left open for days held back every update until its next quit, and a preview can play for long with no input, which reads as the user being away.
  Check for Updates… answers in a card under the menu bar icon, never in a system dialog: checking, the download with what's new, ready, up to date, or what failed with Try Again.
  The question of moving Grip to Applications asks there too.
  A system dialog for each step read as cheap: one click on Check for Updates… took up to three modals to get through.
  A waiting update also shows on the recording toolbar, with Later and Restart to Update.

Done when a new user goes from install, through permissions, to a first exported video without reading docs.
