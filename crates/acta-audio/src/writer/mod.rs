//! `SegmentWriter` (WP1). Contrato de comportamiento: docs/01-arquitectura.md §5.
//!
//! Reglas NO negociables (lecciones de Meetily):
//! - Un fallo al escribir un segmento NO se reintenta en bucle con el mismo
//!   nombre: el índice SIEMPRE avanza y el buffer SIEMPRE se vacía.
//! - Si un segmento falla, se emite `HealthIssue::WriteFailed` y se sigue con
//!   el siguiente.
//! - El nombre del fichero nunca se reutiliza.

use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::recording::{AudioFormat, AudioFrame, SegmentInfo, SessionManifest, StopReason, Track};
use acta_core::time::UnixMs;
use acta_core::{PortError, PortResult};

#[derive(Debug, Clone)]
pub struct SegmentWriterConfig {
    pub layout: DataLayout,
    pub meeting_id: MeetingId,
    pub format: AudioFormat,
    pub segment_seconds: u32,
    /// Cada cuánto se hace flush del `.tmp` (para perder ≤ esto en un crash).
    pub flush_every_ms: u32,
}

/// Segmento cerrado durante un `push`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finalized {
    pub track: Track,
    pub segment: SegmentInfo,
}

pub struct SegmentWriter {
    config: SegmentWriterConfig,
}

impl SegmentWriter {
    /// Crea carpetas y el manifiesto inicial (status Recording).
    pub fn create(config: SegmentWriterConfig, started_at: UnixMs) -> PortResult<Self> {
        let _ = started_at;
        Err(PortError::NotImplemented(format!(
            "SegmentWriter::create for {}",
            config.meeting_id
        )))
    }

    /// Añade un frame. Devuelve los segmentos que se hayan cerrado.
    pub fn push(&mut self, frame: &AudioFrame) -> PortResult<Vec<Finalized>> {
        let _ = (frame, &self.config);
        Err(PortError::NotImplemented("SegmentWriter::push".into()))
    }

    pub fn pause(&mut self, at: UnixMs) -> PortResult<()> {
        let _ = at;
        Err(PortError::NotImplemented("SegmentWriter::pause".into()))
    }

    pub fn resume(&mut self, at: UnixMs) -> PortResult<()> {
        let _ = at;
        Err(PortError::NotImplemented("SegmentWriter::resume".into()))
    }

    /// Cierra todo (fsync + rename) y deja el manifiesto en `Stopped`.
    pub fn finish(self, reason: StopReason, at: UnixMs) -> PortResult<SessionManifest> {
        let _ = (reason, at);
        Err(PortError::NotImplemented("SegmentWriter::finish".into()))
    }
}

/// Escribe el manifiesto de forma atómica: `manifest.json.tmp` → fsync → rename → fsync del directorio.
pub fn write_manifest_atomic(layout: &DataLayout, manifest: &SessionManifest) -> PortResult<()> {
    let _ = (layout, manifest);
    Err(PortError::NotImplemented("write_manifest_atomic".into()))
}

pub fn read_manifest(layout: &DataLayout, meeting_id: MeetingId) -> PortResult<SessionManifest> {
    let path = layout.manifest_path(meeting_id);
    let bytes = std::fs::read(&path)?;
    Ok(serde_json::from_slice(&bytes)?)
}
