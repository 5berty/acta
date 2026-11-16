//! Vigilancia de salud de la grabación (WP1). Tipos de contrato + política
//! pura; el `Watchdog` con I/O (disco libre, ficheros) vive en acta-audio.
//!
//! Reglas por defecto (`HealthConfig`):
//! - `TrackStalled`: una pista no entrega frames durante `stall_ms` (3 s).
//! - `TrackAllZeros`: una pista entrega SOLO ceros exactos durante
//!   `zeros_ms` (10 s). Es la firma de TCC denegado (Core Audio devuelve
//!   silencio digital en vez de error).
//! - `SegmentsStalled`: no se finaliza ningún segmento en
//!   `segment_seconds + segment_grace_ms` (el fallo de Meetily: los
//!   checkpoints dejaron de aparecer y nadie avisó).
//! - `DiskLow`: menos de `min_free_bytes` en el volumen de datos.
//! - `Overrun`, `SidecarRestarted`, `WriteFailed`: al ocurrir.
//!
//! Cada aviso se emite al empezar y se "limpia" (`cleared = true`) al
//! resolverse. La UI lo muestra en la pastilla (punto rojo + texto).

use crate::permissions::PermissionKind;
use crate::recording::Track;
use crate::time::UnixMs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HealthIssue {
    TrackStalled { track: Track },
    TrackAllZeros { track: Track },
    SegmentsStalled { track: Track },
    DiskLow { free_bytes: u64 },
    Overrun { track: Track, dropped_frames: u64 },
    SidecarRestarted { count: u32 },
    WriteFailed { track: Track, message: String },
    PermissionMissing { permission: PermissionKind },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthWarning {
    pub issue: HealthIssue,
    pub since: UnixMs,
    /// `true` = el problema se ha resuelto; la UI quita el aviso.
    pub cleared: bool,
    /// Texto para el usuario, en castellano.
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthConfig {
    pub stall_ms: u64,
    pub zeros_ms: u64,
    pub segment_grace_ms: u64,
    pub min_free_bytes: u64,
}

impl Default for HealthConfig {
    fn default() -> Self {
        Self {
            stall_ms: 3_000,
            zeros_ms: 10_000,
            segment_grace_ms: 10_000,
            min_free_bytes: 1_000_000_000,
        }
    }
}
