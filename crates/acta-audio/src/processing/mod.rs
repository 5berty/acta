//! `DefaultPipeline` (WP1): impl de `acta_core::processing::ProcessingPipeline`.
//! Pasos y reglas de fusión: docs/01-arquitectura.md §6.

use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::library::{MeetingStore, SearchIndex, VoiceprintStore};
use acta_core::minutes::MinutesGenerator;
use acta_core::processing::{ProcessingPipeline, ProcessingStep, ProgressSink};
use acta_core::settings::Settings;
use acta_core::transcription::{Diarizer, Transcriber};
use acta_core::{PortError, PortResult};
use async_trait::async_trait;
use std::sync::Arc;

pub struct DefaultPipeline {
    pub layout: DataLayout,
    pub settings: Settings,
    pub store: Arc<dyn MeetingStore>,
    pub voiceprints: Arc<dyn VoiceprintStore>,
    pub search: Arc<dyn SearchIndex>,
    pub transcriber: Arc<dyn Transcriber>,
    pub diarizer: Arc<dyn Diarizer>,
    pub minutes: Arc<dyn MinutesGenerator>,
}

#[async_trait]
impl ProcessingPipeline for DefaultPipeline {
    async fn run(
        &self,
        meeting_id: MeetingId,
        steps: &[ProcessingStep],
        progress: &dyn ProgressSink,
    ) -> PortResult<()> {
        let _ = (meeting_id, steps, progress);
        Err(PortError::NotImplemented("DefaultPipeline::run".into()))
    }
}
