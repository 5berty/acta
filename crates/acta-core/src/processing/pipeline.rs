//! Contrato del orquestador del procesado. La implementación (WP1) vive en
//! `acta-audio::processing::DefaultPipeline` porque concatenar es I/O; solo
//! usa puertos, así que se prueba entera con fakes.
//!
//! Reglas de fusión del transcript (ver docs/01-arquitectura.md §6.4):
//! - Pista `mic` → hablante "Yo" (is_me = true). No se diariza.
//! - Pista `system` → turnos de diarización; cada utterance ASR se asigna al
//!   turno con mayor solape.
//! - Nombre de cada hablante diarizado: (1) huella de voz confirmada con
//!   similitud ≥ umbral, (2) hablante activo de Teams con mayor solape
//!   temporal, (3) "Speaker N". Nunca se marca `confirmed` sin el usuario.
//! - Eco: si la pista `system` contiene la voz de Edu (altavoces), las
//!   utterances `system` que solapan ≥ 80 % con una `mic` de texto casi
//!   igual se descartan.

use super::model::ProcessingStep;
use crate::ids::MeetingId;
use crate::PortResult;
use async_trait::async_trait;

/// Recibe el progreso del pipeline (la app lo reenvía como evento Tauri).
pub trait ProgressSink: Send + Sync {
    fn progress(&self, meeting_id: MeetingId, step: ProcessingStep, fraction: f32);
}

/// Punto de entrada que usa la app. Impl: `acta-audio::processing::DefaultPipeline`.
#[async_trait]
pub trait ProcessingPipeline: Send + Sync {
    /// Ejecuta `steps` (en el orden de `ProcessingStep::ORDER`). Idempotente:
    /// cada paso sobrescribe su salida.
    async fn run(
        &self,
        meeting_id: MeetingId,
        steps: &[ProcessingStep],
        progress: &dyn ProgressSink,
    ) -> PortResult<()>;
}
