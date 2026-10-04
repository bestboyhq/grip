//! The one master clock. Every source (screen, camera, mic, system audio, input events)
//! stamps samples with host time and converts through here, so all tracks share source time.

use std::sync::atomic::{AtomicU64, Ordering};

unsafe extern "C" {
    fn mach_absolute_time() -> u64;
    fn mach_timebase_info(info: *mut [u32; 2]) -> i32;
}

/// Host time in nanoseconds (same clock as CMClockGetHostTimeClock and CGEvent timestamps).
pub fn now_ns() -> u64 {
    host_to_ns(unsafe { mach_absolute_time() })
}

/// Convert mach absolute time ticks to nanoseconds.
pub fn host_to_ns(ticks: u64) -> u64 {
    let mut tb = [0u32; 2];
    unsafe { mach_timebase_info(&mut tb) };
    (ticks as u128 * tb[0] as u128 / tb[1] as u128) as u64
}

/// Session clock: source time 0 = recording start, paused intervals removed.
pub struct SessionClock {
    start_ns: AtomicU64,
    paused_total_ns: AtomicU64,
    paused_at_ns: AtomicU64, // 0 = running
}

impl SessionClock {
    pub const fn new() -> Self {
        Self { start_ns: AtomicU64::new(0), paused_total_ns: AtomicU64::new(0), paused_at_ns: AtomicU64::new(0) }
    }
    pub fn start(&self, start_ns: u64) {
        self.start_ns.store(start_ns, Ordering::SeqCst);
        self.paused_total_ns.store(0, Ordering::SeqCst);
        self.paused_at_ns.store(0, Ordering::SeqCst);
    }
    pub fn pause(&self, at_ns: u64) {
        let _ = self.paused_at_ns.compare_exchange(0, at_ns, Ordering::SeqCst, Ordering::SeqCst);
    }
    pub fn resume(&self, at_ns: u64) {
        let p = self.paused_at_ns.swap(0, Ordering::SeqCst);
        if p != 0 {
            self.paused_total_ns.fetch_add(at_ns.saturating_sub(p), Ordering::SeqCst);
        }
    }
    pub fn is_paused(&self) -> bool {
        self.paused_at_ns.load(Ordering::SeqCst) != 0
    }
    /// Source time in seconds for a host time in ns. None while paused or before start.
    pub fn source_secs(&self, host_ns: u64) -> Option<f64> {
        let start = self.start_ns.load(Ordering::SeqCst);
        if start == 0 || host_ns < start || self.is_paused() {
            return None;
        }
        let t = host_ns - start - self.paused_total_ns.load(Ordering::SeqCst).min(host_ns - start);
        Some(t as f64 / 1e9)
    }
}

/// The clock of the current recording session, shared by every capture module.
pub static SESSION: SessionClock = SessionClock::new();

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pauses_are_removed() {
        let c = SessionClock::new();
        c.start(1_000_000_000);
        assert_eq!(c.source_secs(2_000_000_000), Some(1.0));
        c.pause(2_000_000_000);
        assert_eq!(c.source_secs(2_500_000_000), None);
        c.resume(3_000_000_000);
        assert_eq!(c.source_secs(4_000_000_000), Some(2.0));
    }
}
