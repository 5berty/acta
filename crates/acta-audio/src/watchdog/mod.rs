//! Watchdog de salud (WP1). Reglas en `acta_core::recording::health`.

use acta_core::recording::{AudioFrame, HealthConfig, HealthWarning, Track};
use acta_core::time::UnixMs;

pub struct Watchdog {
    pub config: HealthConfig,
}

impl Watchdog {
    pub fn new(config: HealthConfig) -> Self {
        Self { config }
    }

    pub fn on_frame(&mut self, frame: &AudioFrame, at: UnixMs) {
        let _ = (frame, at);
    }

    pub fn on_segment_finalized(&mut self, track: Track, at: UnixMs) {
        let _ = (track, at);
    }

    /// Llamar a 1 Hz. Devuelve avisos NUEVOS o LIMPIADOS desde el último tick.
    pub fn tick(&mut self, now: UnixMs, free_disk_bytes: Option<u64>) -> Vec<HealthWarning> {
        let _ = (now, free_disk_bytes);
        Vec::new()
    }
}
