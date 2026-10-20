//! Owner: app-shell. The menu bar's appearance, for the one menu bar icon that has color, and
//! windows that show without AppKit's zoom. macOS's own shortcuts, when the record shortcut wants their keys.
#![cfg_attr(test, allow(dead_code))] // napi exports are only referenced from JS

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication, NSView,
    NSWindowAnimationBehavior,
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

/// While on, macOS's own shortcuts (⇧⌘4, ⌘Space) reach Grip instead of firing, so the user can type
/// one into a shortcut field. Only while Grip is the active app; accessibility shortcuts still fire.
#[napi]
pub fn suspend_system_shortcuts(on: bool) {
    unsafe { CGSSetGlobalHotKeyOperatingMode(CGSMainConnectionID(), if on { 2 } else { 0 }) };
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
}
