//! Tiempo. Dos relojes distintos que NO se mezclan:
//!
//! - [`UnixMs`]: reloj de pared (ms desde epoch). Lo usan señales en vivo
//!   (detección, hablante activo, capturas) y metadatos.
//! - [`MediaMs`]: posición en el audio final de la reunión (ms desde el
//!   inicio de la grabación, SIN contar las pausas). Lo usan utterances,
//!   escaleta, timeline, capturas ya vinculadas y los saltos de reproducción.
//!
//! La conversión pared → media la hace `recording::SessionManifest::wall_to_media`.

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

/// Milisegundos desde epoch Unix (reloj de pared).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct UnixMs(pub i64);

/// Milisegundos en la línea temporal del audio de la reunión (sin pausas).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct MediaMs(pub u64);

impl UnixMs {
    pub fn plus_ms(self, ms: i64) -> Self {
        Self(self.0 + ms)
    }
    pub fn since(self, earlier: UnixMs) -> i64 {
        self.0 - earlier.0
    }
}

/// Puerto de reloj. Inyectable para tests deterministas.
pub trait Clock: Send + Sync {
    fn now(&self) -> UnixMs;
}

/// Reloj real del sistema.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> UnixMs {
        let d = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        UnixMs(d.as_millis() as i64)
    }
}

/// Reloj manual para tests.
#[derive(Debug, Clone, Default)]
pub struct ManualClock(Arc<AtomicI64>);

impl ManualClock {
    pub fn new(start: UnixMs) -> Self {
        Self(Arc::new(AtomicI64::new(start.0)))
    }
    pub fn advance_ms(&self, ms: i64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
    pub fn set(&self, t: UnixMs) {
        self.0.store(t.0, Ordering::SeqCst);
    }
}

impl Clock for ManualClock {
    fn now(&self) -> UnixMs {
        UnixMs(self.0.load(Ordering::SeqCst))
    }
}
