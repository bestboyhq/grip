//! Owner: capture. macOS privacy permissions: status, just-in-time requests, the System Settings
//! pane for each, and the one-line reason shown when one is missing.
#![cfg_attr(test, allow(dead_code))] // napi exports are only referenced from JS

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use napi::bindgen_prelude::spawn_blocking;
use napi_derive::napi;
use objc2::runtime::Bool;
use objc2_app_kit::NSWorkspace;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio, AVMediaTypeVideo};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFString};
use objc2_core_graphics::{CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
use objc2_foundation::{NSString, NSURL};

#[napi(string_enum = "camelCase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Permission {
    Screen,
    Accessibility,
    InputMonitoring,
    Microphone,
    Camera,
}

#[napi(string_enum = "camelCase")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: &CFDictionary) -> u8;
    static kAXTrustedCheckOptionPrompt: &'static CFString;
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOHIDCheckAccess(request: u32) -> u32;
    fn IOHIDRequestAccess(request: u32) -> u8;
}
const HID_LISTEN_EVENT: u32 = 1;

/// The one-line reason shown when `kind` is missing.
pub fn missing(kind: Permission) -> &'static str {
    match kind {
        Permission::Screen => {
            "Screen Recording is off for Studio. Turn it on in System Settings > Privacy & Security > Screen & System Audio Recording."
        }
        Permission::Accessibility => {
            "Accessibility is off for Studio. Turn it on in System Settings > Privacy & Security > Accessibility."
        }
        Permission::InputMonitoring => {
            "Input Monitoring is off for Studio. Turn it on in System Settings > Privacy & Security > Input Monitoring."
        }
        Permission::Microphone => {
            "Microphone access is off for Studio. Turn it on in System Settings > Privacy & Security > Microphone."
        }
        Permission::Camera => {
            "Camera access is off for Studio. Turn it on in System Settings > Privacy & Security > Camera."
        }
    }
}

fn av_status(video: bool) -> PermissionStatus {
    let Some(media) = (unsafe { if video { AVMediaTypeVideo } else { AVMediaTypeAudio } }) else {
        return PermissionStatus::Restricted;
    };
    match unsafe { AVCaptureDevice::authorizationStatusForMediaType(media) } {
        AVAuthorizationStatus::Authorized => PermissionStatus::Granted,
        AVAuthorizationStatus::Denied => PermissionStatus::Denied,
        AVAuthorizationStatus::Restricted => PermissionStatus::Restricted,
        _ => PermissionStatus::NotDetermined,
    }
}

fn granted(yes: bool) -> PermissionStatus {
    if yes { PermissionStatus::Granted } else { PermissionStatus::Denied }
}

/// Current status. Screen Recording and Accessibility cannot tell "never asked" from "denied".
#[napi]
pub fn permission_status(kind: Permission) -> PermissionStatus {
    match kind {
        Permission::Screen => granted(CGPreflightScreenCaptureAccess()),
        Permission::Accessibility => granted(unsafe { AXIsProcessTrusted() } != 0),
        Permission::InputMonitoring => match unsafe { IOHIDCheckAccess(HID_LISTEN_EVENT) } {
            0 => PermissionStatus::Granted,
            1 => PermissionStatus::Denied,
            _ => PermissionStatus::NotDetermined,
        },
        Permission::Microphone => av_status(false),
        Permission::Camera => av_status(true),
    }
}

/// Ask for `kind` (the system prompt appears only the first time) and return the new status.
/// If it stays denied, send the user to `openPermissionSettings`.
#[napi]
pub async fn request_permission(kind: Permission) -> napi::Result<PermissionStatus> {
    spawn_blocking(move || request(kind)).await.map_err(|e| napi::Error::from_reason(e.to_string()))
}

pub fn request(kind: Permission) -> PermissionStatus {
    match kind {
        Permission::Screen => {
            CGRequestScreenCaptureAccess();
        }
        Permission::Accessibility => {
            let prompt = CFDictionary::from_slices(&[unsafe { kAXTrustedCheckOptionPrompt }], &[CFBoolean::new(true)]);
            unsafe { AXIsProcessTrustedWithOptions(prompt.as_ref()) };
        }
        Permission::InputMonitoring => {
            unsafe { IOHIDRequestAccess(HID_LISTEN_EVENT) };
        }
        Permission::Microphone | Permission::Camera => {
            let video = kind == Permission::Camera;
            if av_status(video) == PermissionStatus::NotDetermined {
                let media = unsafe { if video { AVMediaTypeVideo } else { AVMediaTypeAudio } };
                if let Some(media) = media {
                    let (tx, rx) = mpsc::channel();
                    let done = RcBlock::new(move |_: Bool| {
                        let _ = tx.send(());
                    });
                    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(media, &done) };
                    let _ = rx.recv_timeout(Duration::from_secs(600)); // the user is reading the dialog
                }
            }
        }
    }
    permission_status(kind)
}

/// Open the System Settings pane where the user turns `kind` on.
#[napi]
pub fn open_permission_settings(kind: Permission) -> napi::Result<()> {
    let pane = match kind {
        Permission::Screen => "Privacy_ScreenCapture",
        Permission::Accessibility => "Privacy_Accessibility",
        Permission::InputMonitoring => "Privacy_ListenEvent",
        Permission::Microphone => "Privacy_Microphone",
        Permission::Camera => "Privacy_Camera",
    };
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane}");
    let url =
        NSURL::URLWithString(&NSString::from_str(&url)).ok_or_else(|| napi::Error::from_reason("Bad settings URL"))?;
    if NSWorkspace::sharedWorkspace().openURL(&url) {
        Ok(())
    } else {
        Err(napi::Error::from_reason("Could not open System Settings"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_status_answers_and_every_reason_is_one_line() {
        for kind in [
            Permission::Screen,
            Permission::Accessibility,
            Permission::InputMonitoring,
            Permission::Microphone,
            Permission::Camera,
        ] {
            let _ = permission_status(kind); // must not prompt, block, or crash without TCC grants
            let m = missing(kind);
            assert!(!m.contains('\n') && m.ends_with('.') && m.contains("System Settings"), "{m}");
        }
    }
}
