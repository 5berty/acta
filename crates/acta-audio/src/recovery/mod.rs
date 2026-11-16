//! Recuperación tras crash (WP1).

use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::recording::SessionManifest;
use acta_core::{PortError, PortResult};

/// Reuniones cuyo manifiesto quedó en `Recording`/`Paused`.
pub fn scan_incomplete(layout: &DataLayout) -> PortResult<Vec<MeetingId>> {
    let _ = layout;
    Err(PortError::NotImplemented("scan_incomplete".into()))
}

/// Repara `.wav.tmp` (cabecera según tamaño real, descarta medio sample),
/// los renombra, recalcula el manifiesto y lo deja en `Stopped`.
pub fn recover(layout: &DataLayout, meeting_id: MeetingId) -> PortResult<SessionManifest> {
    let _ = (layout, meeting_id);
    Err(PortError::NotImplemented("recover".into()))
}
