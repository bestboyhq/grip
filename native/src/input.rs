//! Owner: input-events. Event tap, cursor images, key mapping -> sources/events.jsonl + cursors/.
//! The capture session (capture.rs) drives InputRecorder; keep this signature.

use std::path::Path;
use std::sync::{Arc, Mutex};

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

pub struct InputRecorder;

impl InputRecorder {
    /// Start writing `dir/events.jsonl` and `dir/cursors/*.png`, timestamps from clock::SESSION.
    pub fn start(_dir: &Path, _geometry: Arc<Mutex<CaptureGeometry>>) -> Result<Self, String> {
        Err("input recording not implemented".into())
    }
    /// Flush and close.
    pub fn stop(self) -> Result<(), String> {
        Ok(())
    }
}
