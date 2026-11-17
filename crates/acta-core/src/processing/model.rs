use crate::ids::MeetingId;
use serde::{Deserialize, Serialize};

/// Pasos del procesado, en orden.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessingStep {
    /// Cerrar segmentos y concatenar pistas con hound (`audio/mic.wav`, `system.wav`, `mix.wav`).
    Concatenating,
    /// ASR (Parakeet TDT v3) de ambas pistas.
    Transcribing,
    /// Diarización (pyannote community-1) SOLO de la pista `system`.
    Diarizing,
    /// Asignar nombres: roster/hablante activo de Teams + huellas de voz.
    NamingSpeakers,
    /// LLM: resumen, decisiones, tareas, escaleta, momentos clave.
    Summarizing,
    /// Chunks + FTS5 + embeddings (sqlite-vec).
    Indexing,
    /// Promover candidatas elegidas por el LLM y borrar el resto.
    PruningCaptures,
}

impl ProcessingStep {
    pub const ORDER: [ProcessingStep; 7] = [
        ProcessingStep::Concatenating,
        ProcessingStep::Transcribing,
        ProcessingStep::Diarizing,
        ProcessingStep::NamingSpeakers,
        ProcessingStep::Summarizing,
        ProcessingStep::Indexing,
        ProcessingStep::PruningCaptures,
    ];
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingProgress {
    pub meeting_id: MeetingId,
    pub step: ProcessingStep,
    /// 0.0..=1.0 dentro del paso.
    pub fraction: f32,
}

/// Qué pasos re-ejecutar en `meeting_reprocess`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReprocessRequest {
    pub meeting_id: MeetingId,
    /// Vacío = todos desde `Transcribing`.
    pub steps: Vec<ProcessingStep>,
    /// Proveedor/modelo SOLO para este reintento (acta y escaleta); no cambia
    /// los ajustes. `None` = el de `Settings.llm.minutesProvider`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm: Option<LlmOverride>,
}

/// «Reintentar con…»: proveedor y, opcionalmente, modelo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmOverride {
    pub provider_id: crate::ids::ProviderId,
    #[serde(default)]
    pub model: Option<String>,
}
