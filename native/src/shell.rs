//! Owner: app-shell. The menu bar's appearance, for the one menu bar icon that has color, and
//! windows that show at once and without AppKit's zoom. macOS's own shortcuts, when the record shortcut wants their keys.
#![cfg_attr(test, allow(dead_code))] // napi exports are only referenced from JS

use std::cell::RefCell;
use std::ptr::{NonNull, null_mut};

use block2::RcBlock;
use napi::Status;
use napi::bindgen_prelude::Buffer;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use objc2::{MainThreadMarker, msg_send};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{
    NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication, NSEvent, NSEventMask,
    NSEventModifierFlags, NSView, NSWindowAnimationBehavior,
};
use objc2_foundation::NSArray;

/// Whether the menu bar draws its icons white. It follows the wallpaper as well as the system
/// appearance, so it is read off the window of Grip's own menu bar icon, the app's appearance until
/// there is one.
#[napi]
pub fn menu_bar_dark() -> bool {
    let Some(mtm) = MainThreadMarker::new() else { return false };
    let app = NSApplication::sharedApplication(mtm);
    let bar = app.windows().iter().find(|w| w.class().name() == c"NSStatusBarWindow");
    let appearance = bar.map_or_else(|| app.effectiveAppearance(), |w| w.effectiveAppearance());
    let (light, dark) = unsafe { (NSAppearanceNameAqua, NSAppearanceNameDarkAqua) };
    appearance.bestMatchFromAppearancesWithNames(&NSArray::from_slice(&[light, dark])).is_some_and(|n| &*n == dark)
}

/// No zoom when the window shows: AppKit scales a window in over 150 ms, which would set the
/// picker's frozen screen moving. `handle`: BrowserWindow.getNativeWindowHandle(), its NSView.
#[napi]
pub fn disable_window_animation(handle: Buffer) {
    let (Some(_mtm), Ok(bytes)) = (MainThreadMarker::new(), <[u8; 8]>::try_from(&handle[..])) else { return };
    // SAFETY: Electron hands out the pointer of the window's live content NSView, on the main thread.
    let Some(view) = (unsafe { (usize::from_ne_bytes(bytes) as *const NSView).as_ref() }) else { return };
    if let Some(window) = view.window() {
        window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    }
}

/// What the main thread changed so far (a window just shown) goes to the window server now. AppKit sends it
/// only when the main thread's turn ends, and work after a show in the same turn (more windows to make)
/// held the window back: the toolbar showed 50 ms late at launch.
#[napi]
pub fn commit_windows() {
    if MainThreadMarker::new().is_none() {
        return;
    }
    // SAFETY: QuartzCore's CATransaction, loaded with AppKit; +flush takes no arguments, on the main thread.
    let _: () = unsafe { msg_send![objc2::class!(CATransaction), flush] };
}

// macOS's own shortcuts (System Settings › Keyboard › Keyboard Shortcuts) fire before any app sees
// their keys, and only private CoreGraphics calls read them or let them through.
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGSMainConnectionID() -> i32;
    fn CGSSetGlobalHotKeyOperatingMode(connection: i32, mode: u32) -> i32;
    fn CGSIsSymbolicHotKeyEnabled(id: u32) -> bool;
    fn CGSSetSymbolicHotKeyEnabled(id: u32, on: bool) -> i32;
    fn CGSGetSymbolicHotKeyValue(id: u32, ch: *mut u16, code: *mut u16, modifiers: *mut u32) -> i32;
}

/// A key press, as src/shared/shortcut.ts reads one off a KeyboardEvent.
#[napi(object)]
pub struct KeyPress {
    pub code: String,
    pub ctrl_key: bool,
    pub alt_key: bool,
    pub shift_key: bool,
    pub meta_key: bool,
}

thread_local! {
    /// AppKit's key monitor while a shortcut is being typed.
    static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

/// While `onKey` is set, the user can type any shortcut into a shortcut field, macOS's own (⇧⌘4,
/// ⌘Space) included. macOS lets its shortcuts through only to the active app, and only with
/// Accessibility on; accessibility shortcuts still fire. Chromium then drops the keys macOS reserves
/// before the page sees them, so each press with ⌘ or ⌃, and each F key, goes to `onKey` instead.
#[napi]
pub fn catch_shortcut_keys(
    #[napi(ts_arg_type = "((press: KeyPress) => void) | null")] on_key: Option<ThreadsafeFunction<KeyPress, (), KeyPress, Status, false, true>>,
) {
    if MainThreadMarker::new().is_none() {
        return;
    }
    unsafe { CGSSetGlobalHotKeyOperatingMode(CGSMainConnectionID(), if on_key.is_some() { 2 } else { 0 }) };
    MONITOR.with_borrow_mut(|monitor| {
        if let Some(m) = monitor.take() {
            unsafe { NSEvent::removeMonitor(&m) };
        }
        let Some(on_key) = on_key else { return };
        let block = RcBlock::new(move |e: NonNull<NSEvent>| -> *mut NSEvent {
            let event = unsafe { e.as_ref() };
            let Some(p) = press(event.keyCode(), event.modifierFlags()) else { return e.as_ptr() };
            on_key.call(p, ThreadsafeFunctionCallMode::NonBlocking);
            null_mut()
        });
        *monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block) };
    });
}

/// The press a shortcut field gets from AppKit rather than the page: one with ⌘ or ⌃, or an F key.
fn press(key: u16, flags: NSEventModifierFlags) -> Option<KeyPress> {
    let code = dom_code(key)?;
    let has = |m| flags.contains(m);
    let f_key = code.starts_with('F'); // F1 to F20: no other code starts with F
    (has(NSEventModifierFlags::Command) || has(NSEventModifierFlags::Control) || f_key).then(|| KeyPress {
        code: code.into(),
        ctrl_key: has(NSEventModifierFlags::Control),
        alt_key: has(NSEventModifierFlags::Option),
        shift_key: has(NSEventModifierFlags::Shift),
        meta_key: has(NSEventModifierFlags::Command),
    })
}

/// A key's KeyboardEvent.code: its place on a US keyboard. None for Esc, which the page handles.
fn dom_code(key: u16) -> Option<&'static str> {
    const ANSI: [&str; 0x34] = [
        "KeyA", "KeyS", "KeyD", "KeyF", "KeyH", "KeyG", "KeyZ", "KeyX", "KeyC", "KeyV", "IntlBackslash", "KeyB", "KeyQ", "KeyW",
        "KeyE", "KeyR", "KeyY", "KeyT", "Digit1", "Digit2", "Digit3", "Digit4", "Digit6", "Digit5", "Equal", "Digit9", "Digit7",
        "Minus", "Digit8", "Digit0", "BracketRight", "KeyO", "KeyU", "BracketLeft", "KeyI", "KeyP", "Enter", "KeyL", "KeyJ",
        "Quote", "KeyK", "Semicolon", "Backslash", "Comma", "Slash", "KeyN", "KeyM", "Period", "Tab", "Space", "Backquote",
        "Backspace",
    ];
    ANSI.get(usize::from(key)).copied().or(match key {
        0x4C => Some("NumpadEnter"),
        0x75 => Some("Delete"),
        0x73 => Some("Home"),
        0x77 => Some("End"),
        0x74 => Some("PageUp"),
        0x79 => Some("PageDown"),
        0x7B => Some("ArrowLeft"),
        0x7C => Some("ArrowRight"),
        0x7D => Some("ArrowDown"),
        0x7E => Some("ArrowUp"),
        _ => crate::input::special_key(key).filter(|k| k.starts_with('F')), // F1 to F20
    })
}

/// The ids of macOS's shortcuts that are on and use `keys`, in macOS notation ('⇧⌘5').
#[napi]
pub fn system_shortcuts(keys: String) -> Vec<u32> {
    (0..512)
        .filter(|&id| {
            let (mut ch, mut code, mut mods) = (0, 0, 0);
            let read = unsafe { CGSIsSymbolicHotKeyEnabled(id) && CGSGetSymbolicHotKeyValue(id, &mut ch, &mut code, &mut mods) == 0 };
            read && notation(ch, code, mods).is_some_and(|k| k == keys)
        })
        .collect()
}

/// Turn a macOS shortcut on or off until logout; System Settings keeps showing the user's choice.
#[napi]
pub fn set_system_shortcut(id: u32, on: bool) {
    unsafe { CGSSetSymbolicHotKeyEnabled(id, on) };
}

/// A macOS shortcut's keys as src/shared/shortcut.ts writes them: modifiers in macOS order, then the
/// key's symbol, or the character it stores (its US key, as Grip's shortcuts go by key place).
fn notation(ch: u16, code: u16, mods: u32) -> Option<String> {
    let key = crate::input::special_key(code)
        .map(String::from)
        .or_else(|| char::from_u32(ch.into()).filter(char::is_ascii_graphic).map(|c| c.to_ascii_uppercase().to_string()))
        .filter(|_| code != u16::MAX)?; // no key set
    let symbols = [(0x40000, '⌃'), (0x80000, '⌥'), (0x20000, '⇧'), (0x100000, '⌘')];
    Some(symbols.iter().filter(|&&(flag, _)| mods & flag != 0).map(|&(_, s)| s).chain(key.chars()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_shortcuts_read_as_grip_writes_them() {
        assert_eq!(notation(b'5'.into(), 0x17, 0x120000).as_deref(), Some("⇧⌘5")); // the screenshot toolbar
        assert_eq!(notation(b'3'.into(), 0x14, 0x160000).as_deref(), Some("⌃⇧⌘3"));
        assert_eq!(notation(b'd'.into(), 0x02, 0x180000).as_deref(), Some("⌥⌘D"));
        assert_eq!(notation(u16::MAX, 0x24, 0x180000).as_deref(), Some("⌥⌘↩"));
        assert_eq!(notation(u16::MAX, 0x60, 0x800000).as_deref(), Some("F5")); // F keys carry fn
        assert_eq!(notation(u16::MAX, u16::MAX, 0), None);
        assert_eq!(notation(b'5'.into(), u16::MAX, 0x120000), None);
    }

    #[test]
    fn shortcut_keys_reach_the_field_as_the_page_would_see_them() {
        use NSEventModifierFlags as M;
        let p = press(0x15, M::Shift | M::Command).unwrap(); // ⇧⌘4, which Chromium keeps from the page
        assert_eq!((p.code.as_str(), p.ctrl_key, p.alt_key, p.shift_key, p.meta_key), ("Digit4", false, false, true, true));
        assert_eq!(press(0x24, M::Option | M::Command).map(|p| p.code).as_deref(), Some("Enter"));
        assert_eq!(press(0x00, M::Control).map(|p| p.code).as_deref(), Some("KeyA"));
        assert_eq!(press(0x67, M::Function).map(|p| p.code).as_deref(), Some("F11")); // Show Desktop's key
        assert_eq!(press(0x7E, M::Command).map(|p| p.code).as_deref(), Some("ArrowUp"));
        assert!(press(0x00, M::Option).is_none()); // ⌥A types a character: the page has it
        assert!(press(0x30, M::empty()).is_none()); // Tab moves focus
        assert!(press(0x35, M::Command).is_none()); // Esc cancels, in the page
        assert!(press(0x66, M::Command).is_none()); // no code for 英数
    }
}
