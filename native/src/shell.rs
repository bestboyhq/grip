//! Owner: app-shell. The menu bar's appearance, for the one menu bar icon that has color.
#![cfg_attr(test, allow(dead_code))] // napi exports are only referenced from JS

use napi_derive::napi;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication};
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
