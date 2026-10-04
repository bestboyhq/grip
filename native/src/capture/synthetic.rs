//! Synthetic screen and system audio: scrolling text-like content and a tone, delivered through
//! the same path as ScreenCaptureKit. Tests and agents use it where Screen Recording permission
//! is unavailable.

use std::ptr::{NonNull, null_mut};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use objc2_core_foundation::{CFDictionary, CFRetained, CFString, CFType};
use objc2_core_video::{
    CVPixelBuffer, CVPixelBufferCreate, CVPixelBufferGetBaseAddressOfPlane, CVPixelBufferGetBytesPerRowOfPlane,
    CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
    kCVPixelBufferIOSurfacePropertiesKey, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
};

use crate::clock;

/// A text-like test pattern that scrolls a few pixels per frame, with a moving marker.
pub struct Pattern {
    pub width: usize,
    pub height: usize,
    luma: Vec<u8>, // 2 * height rows of `width`, wraps while scrolling
}

impl Pattern {
    pub fn new(width: usize, height: usize) -> Self {
        let rows = height * 2;
        let mut luma = vec![235u8; width * rows];
        // 12 x 20 px glyph cells with a pseudo-random 5x8 bitmap drawn at 2x, in lines of words.
        for (line, y0) in (24..rows.saturating_sub(24)).step_by(28).enumerate() {
            let mut x0 = 32;
            let mut word = 0;
            while x0 + 12 < width - 32 {
                let len = 3 + hash(line * 977 + word) as usize % 7;
                for c in 0..len {
                    let bits = hash(line * 7919 + word * 131 + c);
                    for gy in 0..8 {
                        for gx in 0..5 {
                            if bits >> (gy * 5 + gx) & 1 == 1 {
                                for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                                    let (x, y) = (x0 + c * 12 + gx * 2 + dx, y0 + gy * 2 + dy);
                                    if x < width && y < rows {
                                        luma[y * width + x] = 30;
                                    }
                                }
                            }
                        }
                    }
                }
                x0 += (len + 1) * 12;
                word += 1;
            }
        }
        Self { width, height, luma }
    }

    /// Frame `i`: content scrolled by 4 px per frame, marker at a position derived from `i`.
    pub fn frame(&self, i: u64) -> Option<CFRetained<CVPixelBuffer>> {
        let (w, h) = (self.width, self.height);
        let iosurface = CFDictionary::<CFString, CFType>::empty();
        let attrs = CFDictionary::from_slices(&[unsafe { kCVPixelBufferIOSurfacePropertiesKey }], &[&*iosurface]);
        let mut out: *mut CVPixelBuffer = null_mut();
        let format = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
        unsafe { CVPixelBufferCreate(None, w, h, format, Some(attrs.as_ref()), NonNull::from(&mut out)) };
        let pb = unsafe { CFRetained::from_raw(NonNull::new(out)?) };
        unsafe { CVPixelBufferLockBaseAddress(&pb, CVPixelBufferLockFlags(0)) };
        let scroll = (i as usize * 4) % (h * 2);
        let marker = (i as usize * 16) % w.saturating_sub(64).max(1);
        unsafe {
            let y_plane = CVPixelBufferGetBaseAddressOfPlane(&pb, 0) as *mut u8;
            let y_stride = CVPixelBufferGetBytesPerRowOfPlane(&pb, 0);
            for y in 0..h {
                let src = &self.luma[((y + scroll) % (h * 2)) * w..][..w];
                let row = std::slice::from_raw_parts_mut(y_plane.add(y * y_stride), w);
                row.copy_from_slice(src);
                if y < 48 {
                    row[marker..marker + 64].fill(81);
                }
            }
            let uv = CVPixelBufferGetBaseAddressOfPlane(&pb, 1) as *mut u8;
            let uv_stride = CVPixelBufferGetBytesPerRowOfPlane(&pb, 1);
            for y in 0..h / 2 {
                let row = std::slice::from_raw_parts_mut(uv.add(y * uv_stride), w);
                row.fill(128);
                if y < 24 {
                    for x in (marker..marker + 64).step_by(2) {
                        row[x] = 90; // Cb
                        row[x + 1] = 240; // Cr: red marker
                    }
                }
            }
            CVPixelBufferUnlockBaseAddress(&pb, CVPixelBufferLockFlags(0));
        }
        Some(pb)
    }
}

fn hash(n: usize) -> u64 {
    let mut x = n as u64 ^ 0x9e37_79b9_7f4a_7c15;
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// Sinks for the synthetic source, the same calls the ScreenCaptureKit stream makes.
pub trait Sink: Send + Sync + 'static {
    fn video(&self, pb: CFRetained<CVPixelBuffer>, host_ns: u64);
    fn system_audio(&self, host_ns: u64, samples: &[f32]);
}

pub struct Source {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl Source {
    pub fn start(sink: Arc<dyn Sink>, width: usize, height: usize, fps: f64, audio: bool) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let mut threads = vec![];
        let (s, k) = (stop.clone(), sink.clone());
        threads.push(thread::spawn(move || {
            let pattern = Pattern::new(width, height);
            let t0 = clock::now_ns();
            let mut i = 0u64;
            while !s.load(Ordering::SeqCst) {
                let due = t0 + (i as f64 * 1e9 / fps) as u64;
                let now = clock::now_ns();
                if due > now {
                    thread::sleep(Duration::from_nanos(due - now));
                }
                if let Some(pb) = pattern.frame(i) {
                    k.video(pb, clock::now_ns());
                }
                i += 1;
            }
        }));
        if audio {
            let s = stop.clone();
            threads.push(thread::spawn(move || {
                const RATE: f64 = 48_000.0;
                const CHUNK: usize = 960; // 20 ms
                let t0 = clock::now_ns();
                let mut n = 0u64;
                while !s.load(Ordering::SeqCst) {
                    let start = t0 + (n as f64 * 1e9 / RATE) as u64;
                    let due = start + (CHUNK as f64 * 1e9 / RATE) as u64;
                    let now = clock::now_ns();
                    if due > now {
                        thread::sleep(Duration::from_nanos(due - now));
                    }
                    let samples: Vec<f32> = (0..CHUNK)
                        .flat_map(|j| {
                            let v = ((n + j as u64) as f64 / RATE * 440.0 * std::f64::consts::TAU).sin() as f32 * 0.1;
                            [v, v]
                        })
                        .collect();
                    sink.system_audio(start, &samples);
                    n += CHUNK as u64;
                }
            }));
        }
        Self { stop, threads }
    }

    pub fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        for t in self.threads {
            let _ = t.join();
        }
    }
}
