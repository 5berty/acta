//! Pipeline que se monta en cada ejecución con los Ajustes del momento (el
//! usuario puede cambiar de proveedor LLM entre reuniones).

use crate::llm::{build_provider, model_of};
use acta_audio::processing::DefaultPipeline;
use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::library::{MeetingStore, SearchIndex, VoiceprintStore};
use acta_core::llm::LlmProviderFactory;
use acta_core::minutes::{MinutesGenerator, MinutesInput, MinutesOutput};
use acta_core::processing::{ProcessingPipeline, ProcessingStep, ProgressSink};
use acta_core::settings::Settings;
use acta_core::time::Clock;
use acta_core::transcription::{Diarizer, Transcriber};
use acta_core::{PortError, PortResult};
use acta_llm::minutes::LlmMinutesGenerator;
use async_trait::async_trait;
use std::sync::{Arc, RwLock};

pub type SharedSettings = Arc<RwLock<Settings>>;

pub fn read(settings: &SharedSettings) -> Settings {
    settings.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Sin proveedor: el paso de resumen falla con un mensaje claro.
struct NoMinutes(String);

#[async_trait]
impl MinutesGenerator for NoMinutes {
    async fn generate(&self, _input: MinutesInput) -> PortResult<MinutesOutput> {
        Err(PortError::Unavailable(self.0.clone()))
    }
}

pub struct DynamicPipeline {
    pub layout: DataLayout,
    pub settings: SharedSettings,
    pub store: Arc<dyn MeetingStore>,
    pub voiceprints: Arc<dyn VoiceprintStore>,
    pub search: Arc<dyn SearchIndex>,
    pub transcriber: Arc<dyn Transcriber>,
    pub diarizer: Arc<dyn Diarizer>,
    pub factory: Arc<dyn LlmProviderFactory>,
    pub clock: Arc<dyn Clock>,
}

impl DynamicPipeline {
    fn minutes(&self, settings: &Settings) -> Arc<dyn MinutesGenerator> {
        match build_provider(settings, self.factory.as_ref(), settings.llm.minutes_provider.as_ref()) {
            Ok((cfg, provider)) => Arc::new(LlmMinutesGenerator::new(provider, self.clock.clone()).with_model(model_of(&cfg))),
            Err(e) => Arc::new(NoMinutes(e.to_string())),
        }
    }
}

#[async_trait]
impl ProcessingPipeline for DynamicPipeline {
    async fn run(&self, meeting_id: MeetingId, steps: &[ProcessingStep], progress: &dyn ProgressSink) -> PortResult<()> {
        let settings = read(&self.settings);
        let pipeline = DefaultPipeline {
            layout: self.layout.clone(),
            minutes: self.minutes(&settings),
            settings,
            store: self.store.clone(),
            voiceprints: self.voiceprints.clone(),
            search: self.search.clone(),
            transcriber: self.transcriber.clone(),
            diarizer: self.diarizer.clone(),
        };
        pipeline.run(meeting_id, steps, progress).await
    }
}
