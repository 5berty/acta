//! Concatenación final con hound (WP1). Nada de ffmpeg.

use acta_core::layout::DataLayout;
use acta_core::recording::{SessionManifest, Track};
use acta_core::{PortError, PortResult};
use std::path::PathBuf;

/// Une los segmentos de una pista en `audio/<track>.wav` (vía `.tmp` + rename).
pub fn concat_track(layout: &DataLayout, manifest: &SessionManifest, track: Track) -> PortResult<PathBuf> {
    let _ = (layout, manifest, track);
    Err(PortError::NotImplemented("concat_track".into()))
}

/// Mezcla mono `audio/mix.wav` (suma con limitador) para reproducir.
pub fn mixdown(layout: &DataLayout, manifest: &SessionManifest) -> PortResult<PathBuf> {
    let _ = (layout, manifest);
    Err(PortError::NotImplemented("mixdown".into()))
}
