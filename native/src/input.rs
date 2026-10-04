//! Owner: input-events. Event tap, cursor images, key mapping -> sources/events.jsonl + cursors/.
//! The capture session (capture.rs) drives InputRecorder; keep this signature.
//!
//! Two threads per recording:
//! - tap: a listen-only CGEventTap on its own run loop (moves, drags, buttons, scroll, keys, flags).
//! - ticker, 120 Hz: polls the pointer and the three main buttons, which needs no permission.
//!   It fills what the tap does not see (warps, moves during a pause, a tap macOS creates but keeps
//!   silent, no tap at all); one shared state per button makes the first source to see a change
//!   record it, so nothing doubles. It also reads the system cursor image (on moves, and at 30 Hz
//!   while still), polls secure input, flushes every 250 ms and fsyncs every 2 s.
//! Keyboard layouts are read on the main thread (TIS asserts the main queue on macOS 14+ in GUI
//! apps) and translated on any thread with UCKeyTranslate.

use std::cell::RefCell;
use std::collections::HashSet;
use std::ffi::c_void;
use std::fs::File;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex, MutexGuard, Once, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use dispatch2::DispatchQueue;
use objc2::rc::{Retained, autoreleasepool};
use objc2::{AllocAnyThread, ClassType, MainThreadMarker, msg_send};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSCursor};
use objc2_core_foundation::{
    CFData, CFDictionary, CFMachPort, CFNotificationCenter, CFNotificationName, CFNotificationSuspensionBehavior, CFNumber,
    CFPreferencesAppSynchronize, CFPreferencesCopyAppValue, CFRetained, CFRunLoop, CFString, CFType, kCFRunLoopCommonModes,
    kCFRunLoopDefaultMode,
};
use objc2_core_graphics::{
    CGDataProvider, CGEvent, CGEventField, CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGEventTapOptions,
    CGEventTapPlacement, CGEventTapProxy, CGEventType, CGImage, CGMouseButton, CGPreflightListenEventAccess,
};
use objc2_foundation::NSDictionary;
use serde::Serialize;

use crate::clock;

/// Maps global display points (origin top-left of the main display) to screen.mp4 pixels.
/// Shared and mutable: window capture follows a moving window.
#[derive(Clone, Copy, Debug)]
pub struct CaptureGeometry {
    pub x: f64, // captured rect in global points
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub scale: f64, // screen.mp4 pixels per point
}

/// screen.mp4 pixels of a global point. Points outside the captured rect stay outside (the
/// renderer clips), so a cursor leaving the window still moves the right way.
fn to_pixels(g: &CaptureGeometry, x: f64, y: f64) -> (f64, f64) {
    (round((x - g.x) * g.scale, 100.0), round((y - g.y) * g.scale, 100.0))
}

fn round(v: f64, k: f64) -> f64 {
    (v * k).round() / k
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---- Events: one JSON object per line, the shape of src/shared/events.ts InputEvent. ----

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Event<'a> {
    Move { x: f64, y: f64 },
    Down { x: f64, y: f64, button: &'static str },
    Up { x: f64, y: f64, button: &'static str },
    Scroll { x: f64, y: f64, dx: f64, dy: f64 },
    Key { down: bool, key: &'a str, code: u16, mods: Vec<&'static str> },
    #[serde(rename_all = "camelCase")]
    Cursor { id: &'a str, hot_x: f64, hot_y: f64, w: usize, h: usize, scale: f64 },
    Secure { on: bool },
}

#[derive(Serialize)]
struct Line<'a> {
    t: f64,
    #[serde(flatten)]
    ev: &'a Event<'a>,
}

/// Buffered JSONL. Writes only whole lines, so a crash tears at most the last one.
struct Writer {
    file: File,
    buf: Vec<u8>,
    err: Option<String>,
}

/// A disk that stays full this long (about 10 minutes of fast mouse input) drops events instead of memory.
const MAX_BUF: usize = 64 << 20;

impl Writer {
    fn push(&mut self, t: f64, ev: &Event) {
        if serde_json::to_writer(&mut self.buf, &Line { t: round(t, 1e6), ev }).is_ok() {
            self.buf.push(b'\n');
        }
        if self.buf.len() > MAX_BUF {
            self.buf.clear();
            self.err.get_or_insert("Some input events were lost: the disk stayed full.".into());
        }
    }

    fn flush(&mut self, sync: bool) {
        while !self.buf.is_empty() {
            match self.file.write(&self.buf) {
                Ok(n) if n > 0 => {
                    self.buf.drain(..n);
                }
                Err(e) if e.kind() == ErrorKind::Interrupted => {}
                // Keep the buffer and retry on the next flush: the disk may free up.
                r => {
                    let why = r.err().map_or("disk full".into(), |e| e.to_string());
                    self.err.get_or_insert(format!("Could not write input events: {why}"));
                    return;
                }
            }
        }
        if sync && let Err(e) = self.file.sync_data() {
            self.err.get_or_insert(format!("Could not write input events: {e}"));
        }
    }
}

/// CGEvent timestamps are documented as nanoseconds but carry mach ticks on Apple silicon, and
/// synthetic events may carry 0. Take whichever reading lands within the last second, else now.
fn event_ns(ts: u64) -> u64 {
    let now = clock::now_ns();
    let recent = |ns: u64| ns <= now && now - ns < 1_000_000_000;
    let ticks = clock::host_to_ns(ts);
    if recent(ticks) {
        ticks
    } else if recent(ts) {
        ts
    } else {
        now
    }
}

struct Shared {
    writer: Mutex<Writer>,
    geometry: Arc<Mutex<CaptureGeometry>>,
    pos: Mutex<(f64, f64)>,    // last recorded pointer position, global points
    buttons: Mutex<[bool; 3]>, // last recorded state of left, right, middle
    tap_mouse_ns: AtomicU64,   // host time the tap last saw a mouse event
    moved: AtomicBool,         // pointer recorded since the last cursor image check
    stop: AtomicBool,
}

impl Shared {
    /// Write `ev` at host time `host_ns`. False while paused or before the session starts.
    fn emit(&self, host_ns: u64, ev: &Event) -> bool {
        let Some(t) = clock::SESSION.source_secs(host_ns) else { return false };
        lock(&self.writer).push(t, ev);
        true
    }

    /// A pointer event at global point (gx, gy); `make` builds it from screen.mp4 pixels.
    fn pointer(&self, host_ns: u64, gx: f64, gy: f64, make: impl FnOnce(f64, f64) -> Event<'static>) -> bool {
        let (x, y) = to_pixels(&lock(&self.geometry), gx, gy);
        let ok = self.emit(host_ns, &make(x, y));
        if ok {
            *lock(&self.pos) = (gx, gy);
            self.moved.store(true, Relaxed);
        }
        ok
    }

    /// Button `index` (0 left, 1 right, 2+ other) is now `down()`, unless already recorded so.
    /// `down` is read under the lock so a poll cannot interleave with the tap's own report.
    fn button(&self, host_ns: u64, gx: f64, gy: f64, index: usize, down: impl FnOnce() -> bool) {
        let mut state = lock(&self.buttons);
        let down = down();
        if state.get(index) == Some(&down) {
            return;
        }
        let button = ["left", "right"].get(index).copied().unwrap_or("other");
        if self.pointer(host_ns, gx, gy, |x, y| if down { Event::Down { x, y, button } } else { Event::Up { x, y, button } })
            && let Some(s) = state.get_mut(index)
        {
            *s = down;
        }
    }
}

// ---- Keys ----

const CAPS: u64 = 0x10000;
const SHIFT: u64 = 0x20000;
const CTRL: u64 = 0x40000;
const ALT: u64 = 0x80000;
const CMD: u64 = 0x100000;
const FN: u64 = 0x800000;
const DEVICE_BITS: u64 = 0x207F; // NX_DEVICE* left/right modifier bits

/// Keys whose label does not depend on the layout.
fn special_key(code: u16) -> Option<&'static str> {
    Some(match code {
        0x24 => "↩",
        0x4C => "⌤",
        0x30 => "⇥",
        0x31 => "Space",
        0x33 => "⌫",
        0x75 => "⌦",
        0x35 => "⎋",
        0x47 => "⌧",
        0x7B => "←",
        0x7C => "→",
        0x7D => "↓",
        0x7E => "↑",
        0x73 => "↖",
        0x77 => "↘",
        0x74 => "⇞",
        0x79 => "⇟",
        0x72 => "Help",
        0x7A => "F1",
        0x78 => "F2",
        0x63 => "F3",
        0x76 => "F4",
        0x60 => "F5",
        0x61 => "F6",
        0x62 => "F7",
        0x64 => "F8",
        0x65 => "F9",
        0x6D => "F10",
        0x67 => "F11",
        0x6F => "F12",
        0x69 => "F13",
        0x6B => "F14",
        0x71 => "F15",
        0x6A => "F16",
        0x40 => "F17",
        0x4F => "F18",
        0x50 => "F19",
        0x5A => "F20",
        0x66 => "英数",
        0x68 => "かな",
        _ => return None,
    })
}

/// macOS sets the fn flag on arrows, F-keys and the navigation block by itself; it is noise there.
fn implies_fn(code: u16) -> bool {
    (0x72..=0x7E).contains(&code) || special_key(code).is_some_and(|k| k.starts_with('F'))
}

/// Modifiers held in `flags`, in macOS order: fn ⌃ ⌥ ⇧ ⌘.
fn modifiers(flags: u64, code: u16) -> Vec<&'static str> {
    [(FN, "fn"), (CTRL, "⌃"), (ALT, "⌥"), (SHIFT, "⇧"), (CMD, "⌘")]
        .into_iter()
        .filter(|&(m, _)| flags & m != 0 && !(m == FN && implies_fn(code)))
        .map(|(_, s)| s)
        .collect()
}

/// flagsChanged: which modifier key changed and whether it is now down.
fn modifier_key(code: u16, flags: u64) -> Option<(&'static str, bool)> {
    let (key, device, generic) = match code {
        0x37 => ("⌘", 0x08, CMD),
        0x36 => ("⌘", 0x10, CMD),
        0x38 => ("⇧", 0x02, SHIFT),
        0x3C => ("⇧", 0x04, SHIFT),
        0x3A => ("⌥", 0x20, ALT),
        0x3D => ("⌥", 0x40, ALT),
        0x3B => ("⌃", 0x01, CTRL),
        0x3E => ("⌃", 0x2000, CTRL),
        0x3F => ("fn", 0, FN),
        0x39 => ("⇪", 0, CAPS),
        _ => return None,
    };
    // Left and right share one flag; the device bits tell them apart when the source sets them.
    let down = if device != 0 && flags & DEVICE_BITS != 0 { flags & device != 0 } else { flags & generic != 0 };
    Some((key, down))
}

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn UCKeyTranslate(
        layout: *const c_void,
        code: u16,
        action: u16,
        modifiers: u32,
        kbd_type: u32,
        options: u32,
        dead_key_state: *mut u32,
        max_len: usize,
        len: *mut usize,
        chars: *mut u16,
    ) -> i32;
    fn TISCopyCurrentKeyboardLayoutInputSource() -> Option<NonNull<CFType>>;
    fn TISCopyCurrentASCIICapableKeyboardLayoutInputSource() -> Option<NonNull<CFType>>;
    fn TISGetInputSourceProperty(source: &CFType, key: &CFString) -> Option<NonNull<CFData>>;
    static kTISPropertyUnicodeKeyLayoutData: &'static CFString;
    static kTISNotifySelectedKeyboardInputSourceChanged: &'static CFString;
    fn IsSecureEventInputEnabled() -> u8;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
}

/// A keyboard layout ('uchr' data), copied out of TIS so any thread can use it.
type Layout = Arc<[u32]>;

fn layout_of(source: &CFType) -> Option<Layout> {
    let data = unsafe { TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)?.as_ref() };
    let bytes = unsafe { data.as_bytes_unchecked() };
    Some(bytes.chunks(4).map(|c| u32::from_ne_bytes(std::array::from_fn(|i| c.get(i).copied().unwrap_or(0)))).collect())
}

/// What `code` types on `layout` with Carbon modifier state `mods` (⌘ 1, shift 2, caps 4, option 8).
/// Dead keys read as themselves (⌥E is "´"), control characters as None.
fn translate(layout: &[u32], code: u16, mods: u32, kbd_type: u32) -> Option<String> {
    let (mut dead, mut len, mut buf) = (0u32, 0usize, [0u16; 8]);
    let err = unsafe { UCKeyTranslate(layout.as_ptr().cast(), code, 0, mods, kbd_type, 1, &mut dead, buf.len(), &mut len, buf.as_mut_ptr()) };
    let s = String::from_utf16(&buf[..len.min(buf.len())]).ok()?;
    (err == 0 && !s.is_empty() && !s.chars().any(char::is_control)).then_some(s)
}

#[derive(Clone)]
struct Keymap {
    typing: Option<Layout>,    // the active layout (Russian, Greek, Dvorak...)
    shortcuts: Option<Layout>, // the ASCII-capable layout macOS uses for ⌘ shortcuts
}

static KEYMAP: Mutex<Keymap> = Mutex::new(Keymap { typing: None, shortcuts: None });

/// Label for a key: the character the active layout types, or for ⌘/⌃ shortcuts the key of the
/// ASCII-capable layout under ⌘ alone, in upper case, as menus show it (⌘C on a Russian layout is
/// "C"; "Dvorak - QWERTY ⌘" reads QWERTY).
fn key_label(code: u16, flags: u64, kbd_type: u32, km: &Keymap) -> Option<String> {
    if let Some(k) = special_key(code) {
        return Some(k.into());
    }
    if flags & (CMD | CTRL) != 0 {
        let layout = km.shortcuts.as_ref().or(km.typing.as_ref())?;
        return translate(layout, code, 1, kbd_type).map(|s| s.to_uppercase());
    }
    let mods = [(SHIFT, 2), (CAPS, 4), (ALT, 8)].into_iter().filter(|&(f, _)| flags & f != 0).map(|(_, m)| m).sum();
    translate(km.typing.as_ref()?, code, mods, kbd_type)
}

/// Main thread only.
fn refresh_keymap() {
    let read = |copy: unsafe extern "C" fn() -> Option<NonNull<CFType>>| {
        let source = unsafe { CFRetained::from_raw(copy()?) };
        layout_of(&source)
    };
    let km = Keymap { typing: read(TISCopyCurrentKeyboardLayoutInputSource), shortcuts: read(TISCopyCurrentASCIICapableKeyboardLayoutInputSource) };
    *lock(&KEYMAP) = km;
}

unsafe extern "C-unwind" fn layout_changed(_: *mut CFNotificationCenter, _: *mut c_void, _: *const CFNotificationName, _: *const c_void, _: *const CFDictionary) {
    refresh_keymap();
}

/// Read the layouts now and again whenever the user switches input source. Off the main thread
/// this is queued to the main queue; until it runs, keys fall back to the event's own characters.
fn watch_keymap() {
    static WATCH: Once = Once::new();
    let work = || {
        refresh_keymap();
        WATCH.call_once(|| {
            let Some(center) = CFNotificationCenter::distributed_center() else { return };
            // DeliverImmediately: the recorder is never the active app, and inactive apps get these coalesced.
            unsafe {
                center.add_observer(
                    &KEYMAP as *const _ as *const c_void,
                    Some(layout_changed),
                    Some(kTISNotifySelectedKeyboardInputSourceChanged),
                    std::ptr::null(),
                    CFNotificationSuspensionBehavior::DeliverImmediately,
                )
            };
        });
    };
    if MainThreadMarker::new().is_some() { work() } else { DispatchQueue::main().exec_async(work) }
}

/// The characters the window server attached to the event (its own pass through the layout).
fn typed_chars(ev: &CGEvent) -> Option<String> {
    let (mut len, mut buf) = (0, [0u16; 8]);
    unsafe { CGEvent::keyboard_get_unicode_string(Some(ev), buf.len() as _, &mut len, buf.as_mut_ptr()) };
    let s = String::from_utf16(&buf[..(len as usize).min(buf.len())]).ok()?;
    (!s.is_empty() && !s.chars().any(char::is_control)).then_some(s)
}

fn secure_input() -> bool {
    unsafe { IsSecureEventInputEnabled() != 0 }
}

/// Whether the tap receives keys: Input Monitoring, or Accessibility, granted.
fn keys_allowed() -> bool {
    CGPreflightListenEventAccess() || unsafe { AXIsProcessTrusted() != 0 }
}

fn on_key(s: &Shared, host: u64, ty: CGEventType, ev: &CGEvent) {
    // Secure input (password fields): never record a key, not even a modifier.
    if secure_input() {
        return;
    }
    let code = CGEvent::integer_value_field(Some(ev), CGEventField::KeyboardEventKeycode) as u16;
    let flags = CGEvent::flags(Some(ev)).0;
    let mods = modifiers(flags, code);
    if ty == CGEventType::FlagsChanged {
        let Some((key, down)) = modifier_key(code, flags) else { return };
        // Caps Lock reports each toggle once, not a press and a release.
        let downs: &[bool] = if key == "⇪" { &[true, false] } else if down { &[true] } else { &[false] };
        for &down in downs {
            s.emit(host, &Event::Key { down, key, code, mods: mods.clone() });
        }
        return;
    }
    let kbd_type = CGEvent::integer_value_field(Some(ev), CGEventField::KeyboardEventKeyboardType) as u32;
    let km = lock(&KEYMAP).clone();
    let shortcut = flags & (CMD | CTRL) != 0;
    let label = key_label(code, flags, kbd_type, &km).or_else(|| typed_chars(ev).map(|c| if shortcut { c.to_uppercase() } else { c }));
    if let Some(key) = label {
        s.emit(host, &Event::Key { down: ty == CGEventType::KeyDown, key: &key, code, mods });
    }
}

// ---- Tap ----

// Mouse down/up/moved/dragged (1-7), key down/up, flagsChanged (10-12), scroll (22), other button (25-27).
const TAP_MASK: u64 = 0b1111 << 1 | 0b111 << 5 | 0b111 << 10 | 1 << 22 | 0b111 << 25;

fn on_event(s: &Shared, ty: CGEventType, ev: &CGEvent) {
    let host = event_ns(CGEvent::timestamp(Some(ev)));
    if matches!(ty, CGEventType::KeyDown | CGEventType::KeyUp | CGEventType::FlagsChanged) {
        return on_key(s, host, ty, ev);
    }
    s.tap_mouse_ns.store(clock::now_ns(), Relaxed);
    let p = CGEvent::location(Some(ev));
    let button = || CGEvent::integer_value_field(Some(ev), CGEventField::MouseEventButtonNumber) as usize;
    match ty {
        CGEventType::MouseMoved | CGEventType::LeftMouseDragged | CGEventType::RightMouseDragged | CGEventType::OtherMouseDragged => {
            s.pointer(host, p.x, p.y, |x, y| Event::Move { x, y });
        }
        CGEventType::LeftMouseDown | CGEventType::RightMouseDown | CGEventType::OtherMouseDown => s.button(host, p.x, p.y, button(), || true),
        CGEventType::LeftMouseUp | CGEventType::RightMouseUp | CGEventType::OtherMouseUp => s.button(host, p.x, p.y, button(), || false),
        CGEventType::ScrollWheel => {
            // Pixel-precise deltas (natural scrolling applied), in screen.mp4 pixels. Axis 1 is vertical.
            let k = lock(&s.geometry).scale;
            let d = |f| round(CGEvent::double_value_field(Some(ev), f) * k, 100.0);
            let (dx, dy) = (d(CGEventField::ScrollWheelEventPointDeltaAxis2), d(CGEventField::ScrollWheelEventPointDeltaAxis1));
            s.pointer(host, p.x, p.y, |x, y| Event::Scroll { x, y, dx, dy });
        }
        _ => {}
    }
}

thread_local! {
    static TAP: RefCell<Option<CFRetained<CFMachPort>>> = const { RefCell::new(None) };
}

unsafe extern "C-unwind" fn tap_callback(_: CGEventTapProxy, ty: CGEventType, event: NonNull<CGEvent>, user: *mut c_void) -> *mut CGEvent {
    if matches!(ty, CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput) {
        TAP.with_borrow(|tap| tap.iter().for_each(|t| CGEvent::tap_enable(t, true)));
    } else {
        on_event(unsafe { &*(user as *const Shared) }, ty, unsafe { event.as_ref() });
    }
    event.as_ptr()
}

/// Run the tap on its own thread. None when macOS refuses to create one.
fn spawn_tap(s: Arc<Shared>) -> Option<JoinHandle<()>> {
    let (tx, rx) = mpsc::channel();
    let thread = std::thread::Builder::new().name("input-tap".into()).spawn(move || {
        let user = Arc::as_ptr(&s) as *mut c_void; // s outlives the tap: invalidated below
        let tap = unsafe { CGEvent::tap_create(CGEventTapLocation::SessionEventTap, CGEventTapPlacement::TailAppendEventTap, CGEventTapOptions::ListenOnly, TAP_MASK, Some(tap_callback), user) };
        // Returning early drops tx, which reads as "no tap" below.
        let (Some(tap), Some(run_loop)) = (tap, CFRunLoop::current()) else { return };
        let Some(source) = CFMachPort::new_run_loop_source(None, Some(&tap), 0) else { return };
        run_loop.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
        CGEvent::tap_enable(&tap, true);
        TAP.set(Some(tap.clone()));
        let _ = tx.send(true);
        while !s.stop.load(Relaxed) {
            CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, 0.25, false);
        }
        CGEvent::tap_enable(&tap, false);
        tap.invalidate();
        TAP.set(None);
    });
    let thread = thread.ok()?;
    if rx.recv().unwrap_or(false) {
        Some(thread)
    } else {
        let _ = thread.join();
        None
    }
}

// ---- Cursor images ----

/// The system cursor as it looks now, keyed by a hash of its smallest rendition and hot spot.
struct Snapshot {
    hash: u64,
    best: Retained<CGImage>, // largest rendition, written once per hash
    w: usize,
    h: usize,
    px_per_pt: f64,
    hot: (f64, f64), // points, origin top-left
}

/// The cursor on screen now, whatever app set it. Falls back to the arrow if macOS will not say.
/// Deprecated in favor of letting ScreenCaptureKit bake the cursor into frames, which is exactly
/// what a redrawn cursor must avoid; there is no other public API for another app's cursor.
#[allow(deprecated)]
fn system_cursor() -> Option<Retained<NSCursor>> {
    NSCursor::currentSystemCursor().or_else(|| unsafe { msg_send![NSCursor::class(), arrowCursor] })
}

fn snapshot(cursor: &NSCursor) -> Option<Snapshot> {
    let image = cursor.image();
    let pt = image.size();
    let mut reps: Vec<Retained<CGImage>> =
        image.representations().iter().filter_map(|r| unsafe { r.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None) }).collect();
    reps.sort_by_key(|i| CGImage::width(Some(i)));
    let (small, best) = (reps.first()?, reps.last()?);
    let pixels = CGDataProvider::data(CGImage::data_provider(Some(small)).as_deref())?;
    let hot = cursor.hotSpot();
    let mut h = DefaultHasher::new();
    unsafe { pixels.as_bytes_unchecked() }.hash(&mut h);
    [CGImage::width(Some(small)) as f64, hot.x, hot.y, pt.width, pt.height].map(f64::to_bits).hash(&mut h);
    let (w, hh) = (CGImage::width(Some(best)), CGImage::height(Some(best)));
    (pt.width > 0.0 && w > 0).then(|| Snapshot { hash: h.finish(), best: best.clone(), w, h: hh, px_per_pt: w as f64 / pt.width, hot: (hot.x, hot.y) })
}

fn write_png(image: &CGImage, path: &Path) -> Result<(), String> {
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), image);
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("PNG encoding failed")?;
    let tmp = path.with_extension("png.tmp");
    std::fs::write(&tmp, png.to_vec()).and_then(|_| std::fs::rename(&tmp, path)).map_err(|e| format!("Could not save a cursor image: {e}"))
}

/// Accessibility > Display > Pointer size (1 to 4). The window server scales the cursor at
/// compose time, so the images we read do not include it.
fn cursor_size() -> f64 {
    let domain = CFString::from_static_str("com.apple.universalaccess");
    CFPreferencesAppSynchronize(&domain);
    CFPreferencesCopyAppValue(&CFString::from_static_str("mouseDriverCursorSize"), &domain)
        .and_then(|v| v.downcast::<CFNumber>().ok())
        .and_then(|n| n.as_f64())
        .filter(|s| (1.0..=16.0).contains(s))
        .unwrap_or(1.0)
}

struct Cursors {
    dir: PathBuf,
    saved: HashSet<u64>,
    last: Option<(u64, u64)>, // (image hash, scale bits) of the last recorded cursor event
    size: f64,
}

impl Cursors {
    fn check(&mut self, s: &Shared, now: u64, reread_size: bool) {
        if reread_size {
            self.size = cursor_size();
        }
        let Some(c) = system_cursor().and_then(|c| snapshot(&c)) else { return };
        let scale = c.px_per_pt / (self.size * lock(&s.geometry).scale); // image px per screen.mp4 px
        if self.last == Some((c.hash, scale.to_bits())) {
            return;
        }
        let id = format!("{:016x}", c.hash);
        if !self.saved.contains(&c.hash) {
            if let Err(e) = write_png(&c.best, &self.dir.join(format!("{id}.png"))) {
                lock(&s.writer).err.get_or_insert(e);
                return; // no event without its image; retried on the next check
            }
            self.saved.insert(c.hash);
        }
        let k = c.px_per_pt;
        let ev = Event::Cursor { id: &id, hot_x: round(c.hot.0 * k, 100.0), hot_y: round(c.hot.1 * k, 100.0), w: c.w, h: c.h, scale: round(scale, 1e6) };
        if s.emit(now, &ev) {
            self.last = Some((c.hash, scale.to_bits()));
        }
    }
}

// ---- Ticker ----

fn ticker(s: Arc<Shared>, mut cursors: Cursors) {
    let period = Duration::from_nanos(1_000_000_000 / 120);
    let (mut next, mut tick, mut secure) = (Instant::now(), 0u64, false);
    while !s.stop.load(Relaxed) {
        autoreleasepool(|_| {
            let now = clock::now_ns();
            if let Some(e) = CGEvent::new(None) {
                let p = CGEvent::location(Some(&e));
                // Moves: only while the tap is quiet, so a live tap's precise samples are not doubled.
                if now.saturating_sub(s.tap_mouse_ns.load(Relaxed)) > 50_000_000 && *lock(&s.pos) != (p.x, p.y) {
                    s.pointer(now, p.x, p.y, |x, y| Event::Move { x, y });
                }
                for i in 0..3 {
                    s.button(now, p.x, p.y, i, || CGEventSource::button_state(CGEventSourceStateID::CombinedSessionState, CGMouseButton(i as u32)));
                }
            }
            if s.moved.swap(false, Relaxed) || tick % 4 == 0 {
                cursors.check(&s, now, tick % 120 == 0);
            }
            if tick % 4 == 0 {
                let on = secure_input();
                if on != secure && s.emit(now, &Event::Secure { on }) {
                    secure = on;
                }
            }
            if tick % 30 == 29 {
                lock(&s.writer).flush(tick % 240 == 239);
            }
        });
        tick += 1;
        next = (next + period).max(Instant::now()); // after a stall (system sleep) resume, do not burst
        std::thread::sleep(next.saturating_duration_since(Instant::now()));
    }
}

// ---- Recorder ----

pub struct InputRecorder {
    shared: Arc<Shared>,
    threads: Vec<JoinHandle<()>>,
    warning: Option<&'static str>,
}

impl InputRecorder {
    /// Start writing `dir/events.jsonl` and `dir/cursors/*.png`, timestamps from clock::SESSION.
    pub fn start(dir: &Path, geometry: Arc<Mutex<CaptureGeometry>>) -> Result<Self, String> {
        Self::start_with(dir, geometry, true)
    }

    fn start_with(dir: &Path, geometry: Arc<Mutex<CaptureGeometry>>, use_tap: bool) -> Result<Self, String> {
        let cursors = dir.join("cursors");
        std::fs::create_dir_all(&cursors).map_err(|e| format!("Could not create {}: {e}", cursors.display()))?;
        let path = dir.join("events.jsonl");
        let file = File::create(&path).map_err(|e| format!("Could not create {}: {e}", path.display()))?;
        let shared = Arc::new(Shared {
            writer: Mutex::new(Writer { file, buf: Vec::with_capacity(64 << 10), err: None }),
            geometry,
            pos: Mutex::new((f64::NAN, f64::NAN)),
            buttons: Mutex::new([false; 3]),
            tap_mouse_ns: AtomicU64::new(0),
            moved: AtomicBool::new(false),
            stop: AtomicBool::new(false),
        });
        watch_keymap();
        let tap = if use_tap { spawn_tap(shared.clone()) } else { None };
        let warning = match (tap.is_some(), keys_allowed()) {
            (true, true) => None,
            (true, false) => Some("Keystrokes are not recorded: allow Studio in System Settings > Privacy & Security > Input Monitoring."),
            (false, _) => Some("Keystrokes and scrolling are not recorded: allow Studio in System Settings > Privacy & Security > Input Monitoring."),
        };
        let cursors = Cursors { dir: cursors, saved: HashSet::new(), last: None, size: cursor_size() };
        let s = shared.clone();
        let ticker = std::thread::Builder::new().name("input-ticker".into()).spawn(move || ticker(s, cursors));
        let mut threads: Vec<_> = tap.into_iter().collect();
        match ticker {
            Ok(t) => threads.push(t),
            Err(e) => {
                let mut r = InputRecorder { shared, threads, warning };
                let _ = r.finish();
                return Err(format!("Could not start input recording: {e}"));
            }
        }
        Ok(Self { shared, threads, warning })
    }

    /// Why part of the input is missing from this recording (a permission), in one plain line.
    pub fn warning(&self) -> Option<&'static str> {
        self.warning
    }

    /// Flush and close.
    pub fn stop(mut self) -> Result<(), String> {
        self.finish()
    }

    fn finish(&mut self) -> Result<(), String> {
        self.shared.stop.store(true, Relaxed);
        self.threads.drain(..).for_each(|t| drop(t.join()));
        let mut w = lock(&self.shared.writer);
        w.flush(true);
        w.err.take().map_or(Ok(()), Err)
    }
}

impl Drop for InputRecorder {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2_core_foundation::{CFArray, CGPoint};
    use objc2_core_graphics::CGWarpMouseCursorPosition;
    use serde_json::{Value, json};

    unsafe extern "C" {
        fn mach_absolute_time() -> u64;
    }
    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        fn TISCreateInputSourceList(filter: &CFDictionary, all_installed: u8) -> Option<NonNull<CFArray<CFType>>>;
        static kTISPropertyInputSourceID: &'static CFString;
    }

    const ANSI: u32 = 40;

    fn layout(id: &str) -> Layout {
        let key: &CFString = unsafe { kTISPropertyInputSourceID };
        let filter = CFDictionary::<CFString, CFString>::from_slices(&[key], &[&CFString::from_str(id)]);
        let list = unsafe { CFRetained::from_raw(TISCreateInputSourceList(filter.as_opaque(), 1).expect(id)) };
        layout_of(&list.get(0).expect(id)).expect(id)
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("studio-input # ✨ café {name} {}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_events(dir: &Path) -> Vec<Value> {
        let text = std::fs::read_to_string(dir.join("events.jsonl")).unwrap();
        assert!(text.is_empty() || text.ends_with('\n'), "only whole lines are written");
        text.lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    #[test]
    fn coordinates_map_global_points_to_video_pixels() {
        let g = CaptureGeometry { x: 100.0, y: 50.0, w: 800.0, h: 600.0, scale: 2.0 };
        assert_eq!(to_pixels(&g, 100.0, 50.0), (0.0, 0.0));
        assert_eq!(to_pixels(&g, 500.25, 350.5), (800.5, 601.0));
        assert_eq!(to_pixels(&g, 90.0, 40.0), (-20.0, -20.0)); // left of the window: stays outside
        // A display left of and above the main one has negative global points.
        let g = CaptureGeometry { x: -1920.0, y: -1080.0, w: 1920.0, h: 1080.0, scale: 1.0 };
        assert_eq!(to_pixels(&g, -960.0, -1.0), (960.0, 1079.0));
        assert_eq!(to_pixels(&g, 0.333333, 0.0), (1920.33, 1080.0));
    }

    #[test]
    fn event_timestamps_accept_ticks_ns_and_zero() {
        let ticks = unsafe { mach_absolute_time() };
        let ns = clock::host_to_ns(ticks);
        assert!(event_ns(ticks).abs_diff(ns) < 50_000_000);
        assert!(event_ns(ns).abs_diff(ns) < 50_000_000);
        assert!(event_ns(0).abs_diff(clock::now_ns()) < 50_000_000);
    }

    #[test]
    fn keys_map_through_the_layout() {
        let us = layout("com.apple.keylayout.US");
        let ru = layout("com.apple.keylayout.Russian");
        let pl = layout("com.apple.keylayout.PolishPro");
        let km = |typing: &Layout| Keymap { typing: Some(typing.clone()), shortcuts: Some(us.clone()) };
        let label = |km: &Keymap, code, flags| key_label(code, flags, ANSI, km);

        assert_eq!(label(&km(&us), 0x00, 0).as_deref(), Some("a"));
        assert_eq!(label(&km(&us), 0x00, SHIFT).as_deref(), Some("A"));
        assert_eq!(label(&km(&us), 0x00, CAPS).as_deref(), Some("A"));
        assert_eq!(label(&km(&us), 0x0E, ALT).as_deref(), Some("´")); // dead key reads as itself
        assert_eq!(label(&km(&us), 0x08, CMD | SHIFT).as_deref(), Some("C")); // shortcut: base key, upper case
        assert_eq!(label(&km(&us), 0x08, CTRL).as_deref(), Some("C")); // not the ^C control character
        // Non-Latin layout: typing goes through it, shortcuts through the ASCII-capable layout.
        assert_eq!(label(&km(&ru), 0x00, 0).as_deref(), Some("ф"));
        assert_eq!(label(&km(&ru), 0x29, SHIFT).as_deref(), Some("Ж"));
        assert_eq!(label(&km(&ru), 0x08, CMD).as_deref(), Some("C"));
        assert_eq!(label(&km(&pl), 0x00, ALT).as_deref(), Some("ą"));
        // Dvorak - QWERTY ⌘: types Dvorak, shortcuts read QWERTY.
        let dq = layout("com.apple.keylayout.DVORAK-QWERTYCMD");
        let dq = Keymap { typing: Some(dq.clone()), shortcuts: Some(dq) };
        assert_eq!(label(&dq, 0x22, 0).as_deref(), Some("c"));
        assert_eq!(label(&dq, 0x22, CMD).as_deref(), Some("I"));
        // Layout-independent keys.
        for (code, key) in [(0x24, "↩"), (0x30, "⇥"), (0x33, "⌫"), (0x75, "⌦"), (0x35, "⎋"), (0x31, "Space"), (0x7B, "←"), (0x7E, "↑"), (0x7A, "F1"), (0x5A, "F20"), (0x74, "⇞"), (0x77, "↘")] {
            assert_eq!(label(&km(&ru), code, SHIFT).as_deref(), Some(key));
        }
        // No layout yet: nothing from the layout (the event's own characters take over).
        assert_eq!(label(&Keymap { typing: None, shortcuts: None }, 0x00, 0), None);
    }

    #[test]
    fn modifiers_follow_macos_order() {
        assert_eq!(modifiers(CMD | SHIFT | ALT | CTRL | FN, 0x03), ["fn", "⌃", "⌥", "⇧", "⌘"]);
        assert_eq!(modifiers(CMD | SHIFT, 0x23), ["⇧", "⌘"]);
        assert_eq!(modifiers(FN | SHIFT, 0x7B), ["⇧"]); // arrows carry fn by themselves
        assert_eq!(modifiers(FN, 0x60), Vec::<&str>::new()); // so do F-keys
        assert_eq!(modifiers(CAPS, 0x00), Vec::<&str>::new());

        assert_eq!(modifier_key(0x37, CMD | 0x08), Some(("⌘", true)));
        assert_eq!(modifier_key(0x37, 0), Some(("⌘", false)));
        assert_eq!(modifier_key(0x36, CMD | 0x08), Some(("⌘", false))); // right ⌘ up, left still held
        assert_eq!(modifier_key(0x37, CMD), Some(("⌘", true))); // synthetic events lack device bits
        assert_eq!(modifier_key(0x3C, SHIFT | 0x04), Some(("⇧", true)));
        assert_eq!(modifier_key(0x3F, FN), Some(("fn", true)));
        assert_eq!(modifier_key(0x39, CAPS), Some(("⇪", true)));
        assert_eq!(modifier_key(0x00, 0), None);
    }

    #[test]
    fn writer_writes_whole_json_lines() {
        let dir = tmp("writer");
        let path = dir.join("events.jsonl");
        let mut w = Writer { file: File::create(&path).unwrap(), buf: Vec::new(), err: None };
        w.push(0.1234567891, &Event::Move { x: 1.5, y: 2.0 });
        w.push(1.0, &Event::Key { down: true, key: "\"", code: 39, mods: vec!["⇧"] });
        w.push(1.1, &Event::Key { down: false, key: "\\ é ✨", code: 42, mods: vec![] });
        w.push(2.0, &Event::Cursor { id: "00ff", hot_x: 10.0, hot_y: 10.0, w: 280, h: 400, scale: 2.5 });
        w.push(3.0, &Event::Secure { on: true });
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "", "buffered until flushed");
        w.flush(true);
        assert!(w.buf.is_empty() && w.err.is_none());
        let ev = read_events(&dir);
        assert_eq!(ev.len(), 5);
        assert_eq!(ev[0], json!({ "t": 0.123457, "type": "move", "x": 1.5, "y": 2.0 }));
        assert_eq!(ev[1]["key"], "\"");
        assert_eq!(ev[1]["mods"], json!(["⇧"]));
        assert_eq!(ev[2]["key"], "\\ é ✨");
        assert_eq!(ev[3], json!({ "t": 2.0, "type": "cursor", "id": "00ff", "hotX": 10.0, "hotY": 10.0, "w": 280, "h": 400, "scale": 2.5 }));
        assert_eq!(ev[4], json!({ "t": 3.0, "type": "secure", "on": true }));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn tap_and_polling_record_each_button_change_once() {
        let dir = tmp("buttons");
        let s = Shared {
            writer: Mutex::new(Writer { file: File::create(dir.join("events.jsonl")).unwrap(), buf: Vec::new(), err: None }),
            geometry: Arc::new(Mutex::new(CaptureGeometry { x: 0.0, y: 0.0, w: 100.0, h: 100.0, scale: 2.0 })),
            pos: Mutex::new((f64::NAN, f64::NAN)),
            buttons: Mutex::new([false; 3]),
            tap_mouse_ns: AtomicU64::new(0),
            moved: AtomicBool::new(false),
            stop: AtomicBool::new(false),
        };
        clock::SESSION.start(clock::now_ns());
        let now = clock::now_ns();
        s.button(now, 10.0, 5.0, 0, || true); // tap reports the press
        s.button(now, 10.0, 5.0, 0, || true); // the poll sees it too: already recorded
        s.button(now, 10.0, 5.0, 0, || false); // the poll sees the release first
        s.button(now, 10.0, 5.0, 0, || false); // then the tap: already recorded
        s.button(now, 10.0, 5.0, 1, || false); // right never pressed: nothing
        s.button(now, 10.0, 5.0, 4, || true); // a side button only the tap sees
        lock(&s.writer).flush(false);
        let ev: Vec<_> = read_events(&dir).iter().map(|e| (e["type"].as_str().unwrap().to_owned(), e["button"].as_str().unwrap().to_owned(), e["x"].as_f64().unwrap())).collect();
        let e = |t: &str, b: &str| (t.to_owned(), b.to_owned(), 20.0);
        assert_eq!(ev, [e("down", "left"), e("up", "left"), e("down", "other")]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cursor_capture_writes_the_largest_rendition() {
        let Some(cursor) = system_cursor() else { return eprintln!("no window server: skipped") };
        let a = snapshot(&cursor).expect("snapshot");
        let b = snapshot(&system_cursor().unwrap()).expect("snapshot");
        assert_eq!(a.hash, b.hash, "the same cursor hashes the same");
        assert!(a.px_per_pt >= 2.0, "best rendition is at least retina: {}", a.px_per_pt);
        assert!(a.hot.0 * a.px_per_pt < a.w as f64 && a.hot.1 * a.px_per_pt < a.h as f64);
        let dir = tmp("cursor");
        let path = dir.join("c.png");
        write_png(&a.best, &path).unwrap();
        let png = std::fs::read(&path).unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let dim = |i: usize| u32::from_be_bytes(png[i..i + 4].try_into().unwrap()) as usize;
        assert_eq!((dim(16), dim(20)), (a.w, a.h));
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Records for real in this process with the tap and with the polling fallback. Both must
    /// leave the pointer position and the cursor image, whether or not anyone touches the mouse.
    #[test]
    fn records_pointer_and_cursor_in_both_modes() {
        if system_cursor().is_none() {
            return eprintln!("no window server: skipped");
        }
        for use_tap in [true, false] {
            let dir = tmp(if use_tap { "tap" } else { "poll" });
            let geometry = Arc::new(Mutex::new(CaptureGeometry { x: 0.0, y: 0.0, w: 1440.0, h: 900.0, scale: 2.0 }));
            clock::SESSION.start(clock::now_ns());
            let rec = InputRecorder::start_with(&dir, geometry, use_tap).unwrap();
            if !use_tap {
                assert!(rec.warning().unwrap().starts_with("Keystrokes and scrolling are not recorded"));
            }
            std::thread::sleep(Duration::from_millis(400));
            rec.stop().unwrap();
            let ev = read_events(&dir);
            let p = CGEvent::location(CGEvent::new(None).as_deref());
            let mv = ev.iter().find(|e| e["type"] == "move").expect("initial pointer position");
            assert!(mv["t"].as_f64().unwrap() < 0.1);
            assert!((mv["x"].as_f64().unwrap() - p.x * 2.0).abs() < 1.0, "{mv} vs {p:?}");
            let cur = ev.iter().find(|e| e["type"] == "cursor").expect("cursor image");
            assert!(dir.join("cursors").join(format!("{}.png", cur["id"].as_str().unwrap())).exists());
            assert!(cur["scale"].as_f64().unwrap() > 0.0);
            assert!(!dir.join("cursors").read_dir().unwrap().any(|f| f.unwrap().path().extension().unwrap() == "tmp"));
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    /// Manual: `cargo test live_polling_demo -- --ignored --nocapture`. Moves the real pointer in
    /// a small circle for a second (then puts it back) while the polling fallback records into
    /// .context/input-live/ for inspection.
    #[test]
    #[ignore]
    fn live_polling_demo() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.context/input-live/Live #1 ✨ café.studio/sources");
        let _ = std::fs::remove_dir_all(&dir);
        let home = CGEvent::location(CGEvent::new(None).as_deref());
        let geometry = Arc::new(Mutex::new(CaptureGeometry { x: 0.0, y: 0.0, w: 1440.0, h: 900.0, scale: 2.0 }));
        clock::SESSION.start(clock::now_ns());
        let rec = InputRecorder::start_with(&dir, geometry, false).unwrap();
        println!("warning: {:?}", rec.warning());
        std::thread::sleep(Duration::from_millis(500));
        for i in 0..=60 {
            let a = i as f64 / 60.0 * std::f64::consts::TAU;
            CGWarpMouseCursorPosition(CGPoint::new(home.x + 80.0 * a.sin(), home.y - 80.0 + 80.0 * a.cos()));
            std::thread::sleep(Duration::from_millis(16));
        }
        CGWarpMouseCursorPosition(home);
        std::thread::sleep(Duration::from_millis(1500));
        rec.stop().unwrap();
        println!("{}", dir.display());
    }
}
