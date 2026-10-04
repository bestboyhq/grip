//! ScreenCaptureKit: display, window, and area capture with system audio, plus the display and
//! window listings for the recorder UI.

use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchRetained};
use napi_derive::napi;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, DefinedClass, MainThreadMarker, define_class, msg_send};
use objc2_app_kit::{
    NSApplicationActivationOptions, NSBitmapImageFileType, NSBitmapImageRep, NSImageCompressionFactor,
    NSRunningApplication, NSScreen,
};
use objc2_core_foundation::{CFArray, CFDictionary, CFRetained, CFString, CFType, CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayIsBuiltin, CGDisplayIsMain, CGDisplayIsOnline, CGDisplayMode,
    CGGetActiveDisplayList, CGImage, CGPreflightScreenCaptureAccess, CGRectMakeWithDictionaryRepresentation,
    CGWindowListCopyWindowInfo, CGWindowListOption, kCGColorSpaceSRGB, kCGDisplayStreamYCbCrMatrix_ITU_R_709_2,
    kCGWindowBounds, kCGWindowOwnerPID,
};
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_core_video::kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
use objc2_foundation::{
    NSArray, NSBundle, NSData, NSDataBase64EncodingOptions, NSDictionary, NSError, NSNumber, NSString,
};
use objc2_screen_capture_kit::{
    SCCaptureResolutionType, SCContentFilter, SCDisplay, SCFrameStatus, SCRunningApplication, SCScreenshotManager,
    SCShareableContent, SCStream, SCStreamConfiguration, SCStreamDelegate, SCStreamFrameInfoContentRect,
    SCStreamFrameInfoContentScale, SCStreamFrameInfoScaleFactor, SCStreamFrameInfoScreenRect, SCStreamFrameInfoStatus,
    SCStreamOutput, SCStreamOutputType, SCWindow,
};

use super::{Rect, Target, Tracks};
use crate::input::CaptureGeometry;
use crate::permissions::{Permission, PermissionStatus, missing, permission_status};
use crate::writer::{fit_encoder, interleaved_f32, ns_error};

/// What a target records: output size, frame rate, and how global points map to its pixels.
pub struct Plan {
    pub width: usize,
    pub height: usize,
    pub fps: f64,
    pub geometry: CaptureGeometry,
}

#[napi(object)]
pub struct Display {
    pub id: u32,
    pub name: String,
    /// Global points, origin top-left of the main display.
    pub frame: Rect,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub scale: f64,
    pub refresh_rate: f64,
    pub is_main: bool,
}

#[napi(object)]
#[derive(Debug)]
pub struct Window {
    pub id: u32,
    pub title: String,
    pub app: String,
    pub bundle_id: String,
    /// Global points, origin top-left of the main display.
    pub frame: Rect,
    /// Small JPEG as a data URL; absent when the window could not be captured.
    pub thumbnail: Option<String>,
}

fn rect(r: CGRect) -> Rect {
    Rect { x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height }
}

fn refresh_rate(display: u32) -> f64 {
    let hz = CGDisplayCopyDisplayMode(display).map_or(0.0, |m| CGDisplayMode::refresh_rate(Some(&m)));
    if hz > 0.0 { hz } else { 60.0 } // built-in panels report 0
}

fn active_displays() -> Vec<u32> {
    let mut ids = [0u32; 32];
    let mut n = 0u32;
    unsafe { CGGetActiveDisplayList(32, ids.as_mut_ptr(), &mut n) };
    ids[..n as usize].to_vec()
}

/// Displays from CoreGraphics: no Screen Recording permission needed.
pub fn displays() -> Vec<Display> {
    // NSScreen knows the user-facing names; it is main-thread only (napi calls run there).
    let names: Vec<(u32, String)> = MainThreadMarker::new().map_or(vec![], |mtm| {
        NSScreen::screens(mtm)
            .iter()
            .filter_map(|s| {
                let id = s.deviceDescription().objectForKey(&NSString::from_str("NSScreenNumber"))?;
                Some((id.downcast::<NSNumber>().ok()?.as_u32(), s.localizedName().to_string()))
            })
            .collect()
    });
    active_displays()
        .into_iter()
        .enumerate()
        .map(|(i, id)| {
            let frame = rect(CGDisplayBounds(id));
            let mode = CGDisplayCopyDisplayMode(id);
            let pw = mode.as_ref().map_or(frame.w, |m| CGDisplayMode::pixel_width(Some(m)) as f64);
            let ph = mode.as_ref().map_or(frame.h, |m| CGDisplayMode::pixel_height(Some(m)) as f64);
            let fallback =
                if CGDisplayIsBuiltin(id) { "Built-in Display".into() } else { format!("Display {}", i + 1) };
            Display {
                id,
                name: names.iter().find(|(n, _)| *n == id).map_or(fallback, |(_, s)| s.clone()),
                frame,
                pixel_width: pw as u32,
                pixel_height: ph as u32,
                scale: pw / frame.w,
                refresh_rate: refresh_rate(id),
                is_main: CGDisplayIsMain(id),
            }
        })
        .collect()
}

/// Shareable content from ScreenCaptureKit. Without permission: the one-line reason.
fn content(on_screen_only: bool) -> Result<Retained<SCShareableContent>, String> {
    if !CGPreflightScreenCaptureAccess() {
        return Err(missing(Permission::Screen).into());
    }
    let (tx, rx) = mpsc::channel();
    let done = RcBlock::new(move |c: *mut SCShareableContent, e: *mut NSError| {
        let r = unsafe { Retained::retain(c) }
            .ok_or_else(|| unsafe { e.as_ref() }.map_or("Screen content is unavailable".to_string(), ns_error));
        let _ = tx.send(r);
    });
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            true,
            on_screen_only,
            &done,
        )
    };
    rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "Timed out listing screen content".to_string())?
}

const FINDER: &str = "com.apple.finder";

/// Kept out of every capture, video and audio: our own processes (main app and its helpers,
/// so the widget, camera preview, and area picker never show) and system notification banners.
/// Hiding desktop icons leaves Finder out too, except its windows: the icons are Finder's
/// desktop window, which `content` does not list.
/// ponytail: Finder windows opened after the start stay hidden with the icons; follow them with
/// SCStream.updateContentFilter if that matters.
fn excluded(
    content: &SCShareableContent,
    hide_icons: bool,
) -> (Retained<NSArray<SCRunningApplication>>, Retained<NSArray<SCWindow>>) {
    let pid = std::process::id() as i32;
    let bundle = NSBundle::mainBundle().bundleIdentifier().map(|s| s.to_string());
    let apps: Vec<_> = unsafe { content.applications() }
        .iter()
        .filter(|a| {
            let id = unsafe { a.bundleIdentifier() }.to_string();
            (unsafe { a.processID() }) == pid
                || id == "com.apple.notificationcenterui"
                || (hide_icons && id == FINDER)
                || bundle.as_ref().is_some_and(|b| id == *b || id.starts_with(&format!("{b}.")))
        })
        .collect();
    let finder_windows: Vec<_> = unsafe { content.windows() }
        .iter()
        .filter(|w| hide_icons && unsafe { w.owningApplication() }.is_some_and(|a| unsafe { a.bundleIdentifier() }.to_string() == FINDER))
        .collect();
    (NSArray::from_retained_slice(&apps), NSArray::from_retained_slice(&finder_windows))
}

fn find_window(content: &SCShareableContent, id: u32) -> Option<Retained<SCWindow>> {
    unsafe { content.windows() }.iter().find(|w| unsafe { w.windowID() } == id)
}

fn find_display(content: &SCShareableContent, id: u32) -> Option<Retained<SCDisplay>> {
    unsafe { content.displays() }.iter().find(|d| unsafe { d.displayID() } == id)
}

/// The display containing the center of `r` (global points), else the main one.
fn display_at(r: CGRect) -> u32 {
    let (cx, cy) = (r.origin.x + r.size.width / 2.0, r.origin.y + r.size.height / 2.0);
    let ids = active_displays();
    ids.iter()
        .copied()
        .find(|&id| {
            let b = CGDisplayBounds(id);
            cx >= b.origin.x && cx < b.origin.x + b.size.width && cy >= b.origin.y && cy < b.origin.y + b.size.height
        })
        .or_else(|| ids.iter().copied().find(|&id| CGDisplayIsMain(id)))
        .unwrap_or(0)
}

/// Owner pid and frame (global points) of window `id`, from the window server: no permission needed.
fn window_info(id: u32) -> Option<(i32, CGRect)> {
    let list = CGWindowListCopyWindowInfo(CGWindowListOption::OptionIncludingWindow, id)?;
    // SAFETY: a CFArray of CFDictionary is toll-free bridged to NSArray of NSDictionary.
    let list: &NSArray<NSDictionary<NSString, AnyObject>> = unsafe { &*(&*list as *const CFArray).cast() };
    let info = list.firstObject()?;
    let pid = number(&info, cf_ns(unsafe { kCGWindowOwnerPID }))? as i32;
    Some((pid, cg_rect(&info, cf_ns(unsafe { kCGWindowBounds }))?))
}

fn cf_ns(s: &CFString) -> &NSString {
    // SAFETY: CFString is toll-free bridged to NSString.
    unsafe { &*(s as *const CFString).cast() }
}

pub fn window_exists(id: u32) -> bool {
    window_info(id).is_some()
}

/// Why the source of `target` is gone, if it is.
pub fn lost(target: &Target) -> Option<&'static str> {
    match target {
        Target::Display { display_id } | Target::Area { display_id, .. } if !CGDisplayIsOnline(*display_id) => {
            Some("The display was disconnected.")
        }
        Target::Window { window_id, .. } if !window_exists(*window_id) => Some("The window was closed."),
        Target::Device { device_id } if !crate::camera::is_connected(device_id) => {
            Some("The iPhone or iPad was disconnected.")
        }
        _ => None,
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> *mut CFType;
    fn AXUIElementCopyAttributeValue(element: &CFType, attribute: &CFString, value: *mut *mut CFType) -> i32;
    fn AXUIElementSetAttributeValue(element: &CFType, attribute: &CFString, value: &CFType) -> i32;
    fn AXValueCreate(kind: u32, value: *const c_void) -> *mut CFType;
    fn AXValueGetValue(value: &CFType, kind: u32, out: *mut c_void) -> u8;
}
const AX_POINT: u32 = 1; // kAXValueTypeCGPoint
const AX_SIZE: u32 = 2; // kAXValueTypeCGSize

fn retained(p: *mut CFType) -> Option<CFRetained<CFType>> {
    NonNull::new(p).map(|p| unsafe { CFRetained::from_raw(p) })
}

fn ax_get(element: &CFType, attribute: &str) -> Option<CFRetained<CFType>> {
    let mut out = std::ptr::null_mut();
    let err = unsafe { AXUIElementCopyAttributeValue(element, &CFString::from_str(attribute), &mut out) };
    retained(out).filter(|_| err == 0)
}

fn ax_frame(window: &CFType) -> Option<CGRect> {
    let (mut origin, mut size) = (CGPoint::ZERO, CGSize::ZERO);
    let point = unsafe { AXValueGetValue(&*ax_get(window, "AXPosition")?, AX_POINT, (&mut origin as *mut CGPoint).cast()) };
    let sized = unsafe { AXValueGetValue(&*ax_get(window, "AXSize")?, AX_SIZE, (&mut size as *mut CGSize).cast()) };
    (point != 0 && sized != 0).then(|| CGRect::new(origin, size))
}

fn ax_set<T>(window: &CFType, attribute: &str, kind: u32, value: &T) -> bool {
    retained(unsafe { AXValueCreate(kind, (value as *const T).cast()) }).is_some_and(|v| unsafe {
        AXUIElementSetAttributeValue(window, &CFString::from_str(attribute), &v) == 0
    })
}

fn near(a: CGRect, b: CGRect) -> bool {
    [a.origin.x - b.origin.x, a.origin.y - b.origin.y, a.size.width - b.size.width, a.size.height - b.size.height]
        .iter()
        .all(|d| d.abs() < 1.0)
}

/// Move and resize window `id` to `frame` (global points) with the Accessibility API before it is
/// recorded. Returns where it ended up: an app may hold a minimum size or keep it on screen.
pub fn place_window(id: u32, frame: Rect) -> Result<CGRect, String> {
    if permission_status(Permission::Accessibility) != PermissionStatus::Granted {
        return Err(missing(Permission::Accessibility).into());
    }
    let (pid, now) = window_info(id).ok_or("That window is no longer open.")?;
    let app = retained(unsafe { AXUIElementCreateApplication(pid) }).ok_or("That app cannot be controlled.")?;
    let windows = ax_get(&app, "AXWindows").ok_or("Studio could not move that window.")?;
    // SAFETY: AXWindows is a CFArray of AXUIElements.
    let windows: &CFArray<CFType> = unsafe { &*(&*windows as *const CFType).cast() };
    // ponytail: the public API has no window id, so the window is found by its frame; two windows
    // of one app stacked exactly may swap. _AXUIElementGetWindow (private) if that ever bites.
    let window = (0..windows.len())
        .filter_map(|i| windows.get(i))
        .find(|w| ax_frame(w).is_some_and(|f| near(f, now)))
        .ok_or("Studio could not move that window.")?;
    let target = CGRect::new(CGPoint::new(frame.x, frame.y), CGSize::new(frame.w, frame.h));
    // Size, move, size again: a move can clamp the size and a resize can push the window.
    let moved = ax_set(&window, "AXSize", AX_SIZE, &target.size)
        & ax_set(&window, "AXPosition", AX_POINT, &target.origin)
        & ax_set(&window, "AXSize", AX_SIZE, &target.size);
    if !moved {
        return Err("Studio could not move that window.".into());
    }
    // The window server shows the new frame a moment later; record from there.
    let deadline = std::time::Instant::now() + Duration::from_secs(1);
    loop {
        let r = window_info(id).map(|(_, r)| r).ok_or("That window is no longer open.")?;
        if near(r, target) || std::time::Instant::now() > deadline {
            return Ok(r);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Resolve `target` into a content filter, a stream configuration, and the plan.
pub fn prepare(
    target: &Target,
    fps: Option<f64>,
    audio: bool,
    hide_icons: bool,
) -> Result<(Retained<SCContentFilter>, Retained<SCStreamConfiguration>, Plan), String> {
    let content = content(false)?;
    let config = unsafe { SCStreamConfiguration::new() };
    let (filter, area, display_id) = match *target {
        Target::Display { display_id } | Target::Area { display_id, .. } => {
            let display = find_display(&content, display_id).ok_or("That display is no longer connected.")?;
            let (apps, keep) = excluded(&content, hide_icons);
            let filter = unsafe {
                SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(
                    SCContentFilter::alloc(),
                    &display,
                    &apps,
                    &keep,
                )
            };
            let b = CGDisplayBounds(display_id);
            let area = match *target {
                Target::Area { rect: r, .. } => {
                    // Clamp to the display; the picker may hand us a rect hanging off an edge.
                    let x = r.x.clamp(0.0, b.size.width);
                    let y = r.y.clamp(0.0, b.size.height);
                    let w = r.w.min(b.size.width - x);
                    let h = r.h.min(b.size.height - y);
                    if w < 16.0 || h < 16.0 {
                        return Err("The selected area is too small to record.".into());
                    }
                    let local = CGRect::new(CGPoint::new(x, y), CGSize::new(w, h));
                    unsafe { config.setSourceRect(local) };
                    CGRect::new(CGPoint::new(b.origin.x + x, b.origin.y + y), CGSize::new(w, h))
                }
                _ => b,
            };
            (filter, area, display_id)
        }
        Target::Window { window_id, frame } => {
            let window = find_window(&content, window_id).ok_or("That window is no longer open.")?;
            let frame = match frame {
                Some(f) => place_window(window_id, f)?,
                None => unsafe { window.frame() },
            };
            let filter =
                unsafe { SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &window) };
            unsafe {
                config.setIgnoreShadowsSingleWindow(true); // the editor draws its own shadow
                config.setScalesToFit(true); // a window resized larger still fits the file
                config.setPreservesAspectRatio(true);
            }
            // Bring it to the front so the recording starts on it.
            if let Some(app) = unsafe { window.owningApplication() }
                && let Some(app) =
                    NSRunningApplication::runningApplicationWithProcessIdentifier(unsafe { app.processID() })
            {
                app.activateWithOptions(NSApplicationActivationOptions::empty());
            }
            (filter, frame, display_at(frame))
        }
        Target::Synthetic { .. } | Target::Device { .. } => {
            return Err("This target does not use ScreenCaptureKit".into());
        }
    };
    let scale = unsafe { SCShareableContent::infoForFilter(&filter).pointPixelScale() } as f64;
    let scale = if scale > 0.0 { scale } else { 2.0 };
    let (width, height) = fit_encoder(area.size.width * scale, area.size.height * scale);
    let fps = fps.unwrap_or_else(|| refresh_rate(display_id)).clamp(1.0, 60.0);
    unsafe {
        config.setWidth(width);
        config.setHeight(height);
        config.setMinimumFrameInterval(CMTime::new(1000, (fps * 1000.0).round() as i32));
        config.setPixelFormat(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange);
        config.setColorSpaceName(kCGColorSpaceSRGB);
        config.setColorMatrix(kCGDisplayStreamYCbCrMatrix_ITU_R_709_2);
        config.setShowsCursor(false); // the editor redraws the cursor from events
        config.setQueueDepth(8);
        config.setCaptureResolution(SCCaptureResolutionType::Best);
        config.setCapturesAudio(audio);
        config.setSampleRate(48_000);
        config.setChannelCount(2);
        config.setExcludesCurrentProcessAudio(true);
    }
    let geometry = CaptureGeometry {
        x: area.origin.x,
        y: area.origin.y,
        w: area.size.width,
        h: area.size.height,
        scale: width as f64 / area.size.width,
    };
    Ok((filter, config, Plan { width, height, fps, geometry }))
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and Output does not implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "StudioStreamOutput"]
    #[ivars = Arc<Tracks>]
    struct Output;

    unsafe impl NSObjectProtocol for Output {}

    unsafe impl SCStreamOutput for Output {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(&self, _stream: &SCStream, sb: &CMSampleBuffer, kind: SCStreamOutputType) {
            on_sample(self.ivars(), sb, kind);
        }
    }

    unsafe impl SCStreamDelegate for Output {
        #[unsafe(method(stream:didStopWithError:))]
        fn did_stop(&self, _stream: &SCStream, error: &NSError) {
            let t = self.ivars();
            t.lose(lost(&t.target).map_or_else(|| format!("Screen capture stopped: {}", ns_error(error)), String::from));
        }
    }
);

fn frame_info(sb: &CMSampleBuffer) -> Option<Retained<NSDictionary<NSString, AnyObject>>> {
    let arr = unsafe { sb.sample_attachments_array(false) }?;
    // SAFETY: CFArray of CFDictionary is toll-free bridged to NSArray of NSDictionary.
    let arr: &NSArray<NSDictionary<NSString, AnyObject>> = unsafe { &*(&*arr as *const CFArray).cast() };
    arr.firstObject()
}

fn number(info: &NSDictionary<NSString, AnyObject>, key: &NSString) -> Option<f64> {
    Some(info.objectForKey(key)?.downcast::<NSNumber>().ok()?.as_f64())
}

fn cg_rect(info: &NSDictionary<NSString, AnyObject>, key: &NSString) -> Option<CGRect> {
    let d = info.objectForKey(key)?;
    let mut r = CGRect::default();
    // SAFETY: the value is a CGRect dictionary representation (a CFDictionary).
    let d: &CFDictionary = unsafe { &*(&*d as *const AnyObject).cast() };
    unsafe { CGRectMakeWithDictionaryRepresentation(Some(d), &mut r) }.then_some(r)
}

fn on_sample(t: &Tracks, sb: &CMSampleBuffer, kind: SCStreamOutputType) {
    let Some(host) = crate::clock::cm_ns(unsafe { sb.presentation_time_stamp() }) else { return };
    if kind == SCStreamOutputType::Screen {
        let Some(info) = frame_info(sb) else { return };
        // Idle/blank/suspended frames carry no image: only real content goes into the file.
        if number(&info, unsafe { SCStreamFrameInfoStatus }) != Some(SCFrameStatus::Complete.0 as f64) {
            return;
        }
        let Some(pb) = (unsafe { sb.image_buffer() }) else { return };
        if matches!(t.target, Target::Window { .. }) {
            follow_window(t, &info);
        }
        t.video(pb, host);
    } else if kind == SCStreamOutputType::Audio
        && let Some((samples, ch, rate)) = interleaved_f32(sb)
    {
        t.system_audio(host, &samples, ch, rate);
    }
}

/// Window capture: keep the input geometry on the window as it moves or resizes. The content
/// sits at `contentRect` (points in the frame) scaled by `contentScale`; `scaleFactor` is pixels per point.
fn follow_window(t: &Tracks, info: &NSDictionary<NSString, AnyObject>) {
    let (Some(screen), Some(content), Some(cs), Some(sf)) = (
        cg_rect(info, unsafe { SCStreamFrameInfoScreenRect }),
        cg_rect(info, unsafe { SCStreamFrameInfoContentRect }),
        number(info, unsafe { SCStreamFrameInfoContentScale }),
        number(info, unsafe { SCStreamFrameInfoScaleFactor }),
    ) else {
        return;
    };
    if cs <= 0.0 || sf <= 0.0 {
        return;
    }
    let mut g = t.geometry.lock().unwrap();
    let scale = cs * sf;
    g.x = screen.origin.x - content.origin.x / cs;
    g.y = screen.origin.y - content.origin.y / cs;
    g.w = t.size.0 as f64 / scale;
    g.h = t.size.1 as f64 / scale;
    g.scale = scale;
}

/// Run `start` with a completion block and wait for it.
fn wait(start: impl FnOnce(&block2::DynBlock<dyn Fn(*mut NSError)>)) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let done = RcBlock::new(move |e: *mut NSError| {
        let _ = tx.send(unsafe { e.as_ref() }.map(ns_error));
    });
    start(&done);
    match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(None) => Ok(()),
        Ok(Some(e)) => Err(e),
        Err(_) => Err("Timed out waiting for screen capture".into()),
    }
}

/// A running SCStream feeding `Tracks`.
pub struct Stream {
    stream: Retained<SCStream>,
    _output: Retained<Output>,
    _queues: Vec<DispatchRetained<DispatchQueue>>,
}

impl Stream {
    pub fn start(
        filter: &SCContentFilter,
        config: &SCStreamConfiguration,
        tracks: Arc<Tracks>,
        audio: bool,
    ) -> Result<Self, String> {
        let output = Output::alloc().set_ivars(tracks);
        let output: Retained<Output> = unsafe { msg_send![super(output), init] };
        let delegate = ProtocolObject::from_ref(&*output);
        let stream = unsafe {
            SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), filter, config, Some(delegate))
        };
        let mut queues = vec![DispatchQueue::new("studio.capture.screen", None)];
        let sink = ProtocolObject::from_ref(&*output);
        unsafe {
            stream.addStreamOutput_type_sampleHandlerQueue_error(sink, SCStreamOutputType::Screen, Some(&queues[0]))
        }
        .map_err(|e| ns_error(&e))?;
        if audio {
            queues.push(DispatchQueue::new("studio.capture.audio", None));
            unsafe {
                stream.addStreamOutput_type_sampleHandlerQueue_error(sink, SCStreamOutputType::Audio, Some(&queues[1]))
            }
            .map_err(|e| ns_error(&e))?;
        }
        wait(|done| unsafe { stream.startCaptureWithCompletionHandler(Some(done)) })
            .map_err(|e| format!("Screen capture did not start: {e}"))?;
        Ok(Self { stream, _output: output, _queues: queues })
    }

    pub fn stop(self) {
        // Errors here mean it already stopped (display gone, window closed): nothing to undo.
        let _ = wait(|done| unsafe { self.stream.stopCaptureWithCompletionHandler(Some(done)) });
    }
}

/// On-screen app windows, front to back, with small thumbnails.
pub fn windows() -> Result<Vec<Window>, String> {
    let content = content(true)?;
    let own: Vec<i32> = excluded(&content, false).0.iter().map(|a| unsafe { a.processID() }).collect();
    let found: Vec<(Retained<SCWindow>, Window)> = unsafe { content.windows() }
        .iter()
        .filter_map(|w| unsafe {
            let app = w.owningApplication()?;
            let frame = w.frame();
            if w.windowLayer() != 0
                || own.contains(&app.processID())
                || frame.size.width < 64.0
                || frame.size.height < 64.0
            {
                return None;
            }
            let name = app.applicationName().to_string();
            let title = w.title().map(|t| t.to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| name.clone());
            let info = Window {
                id: w.windowID(),
                title,
                app: name,
                bundle_id: app.bundleIdentifier().to_string(),
                frame: rect(frame),
                thumbnail: None,
            };
            Some((w, info))
        })
        .collect();
    let (tx, rx) = mpsc::channel();
    for (i, (w, info)) in found.iter().enumerate() {
        let filter = unsafe { SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), w) };
        let config = unsafe { SCStreamConfiguration::new() };
        let k = (480.0 / info.frame.w).min(300.0 / info.frame.h);
        unsafe {
            config.setWidth((info.frame.w * k).round().max(2.0) as usize);
            config.setHeight((info.frame.h * k).round().max(2.0) as usize);
            config.setShowsCursor(false);
            config.setIgnoreShadowsSingleWindow(true);
        }
        let tx = tx.clone();
        let done = RcBlock::new(move |img: *mut CGImage, _e: *mut NSError| {
            let _ = tx.send((i, unsafe { img.as_ref() }.and_then(jpeg_data_url)));
        });
        unsafe {
            SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(&filter, &config, Some(&done))
        };
    }
    drop(tx);
    let mut found: Vec<Window> = found.into_iter().map(|(_, w)| w).collect();
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while let Ok((i, t)) = rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
        found[i].thumbnail = t;
    }
    Ok(found)
}

fn jpeg_data_url(img: &CGImage) -> Option<String> {
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), img);
    let props =
        NSDictionary::from_slices(&[unsafe { NSImageCompressionFactor }], &[&*NSNumber::new_f64(0.8) as &AnyObject]);
    let data: Retained<NSData> =
        unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &props) }?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        data.base64EncodedStringWithOptions(NSDataBase64EncodingOptions::empty())
    ))
}
