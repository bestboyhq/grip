//! Owner: camera. AVFoundation camera and iPhone/iPad (CoreMediaIO) capture, Vision effects.
//! The capture session (capture.rs) drives CameraRecorder; keep this signature.

use std::path::Path;

pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

pub struct CameraRecorder;

impl CameraRecorder {
    /// Start recording device `device_id` to `path` (fragmented MP4), timestamps from clock::SESSION.
    pub fn start(_device_id: &str, _path: &Path) -> Result<Self, String> {
        Err("camera recording not implemented".into())
    }
    pub fn pause(&self) {}
    pub fn resume(&self) {}
    /// Stop and finalize the file.
    pub fn stop(self) -> Result<VideoInfo, String> {
        Err("camera recording not implemented".into())
    }
}
