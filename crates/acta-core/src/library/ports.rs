//! Puertos de persistencia y búsqueda. Impl: acta-store (WP2) con SQLite
//! (rusqlite) + FTS5 + sqlite-vec. Todos async: el adaptador usa
//! `spawn_blocking` sobre una conexión protegida.

use super::cleanup::{MeetingCleanupFacts, MeetingTouch};
use super::model::*;
use crate::ids::{ActionItemId, CaptureId, GroupId, MeetingId, SpeakerId, VoiceprintId};
use crate::minutes::{Minutes, MinutesOutput};
use crate::screen::{Capture, ScreenShare};
use crate::settings::Settings;
use crate::time::UnixMs;
use crate::transcription::{Transcript, Voiceprint, VoiceprintSummary};
use crate::PortResult;
use async_trait::async_trait;

#[async_trait]
pub trait MeetingStore: Send + Sync {
    async fn create_meeting(&self, meeting: NewMeeting) -> PortResult<Meeting>;
    async fn patch_meeting(&self, id: MeetingId, patch: MeetingPatch) -> PortResult<Meeting>;
    async fn get_meeting(&self, id: MeetingId) -> PortResult<Option<Meeting>>;
    async fn get_meeting_detail(&self, id: MeetingId) -> PortResult<Option<MeetingDetail>>;
    async fn list_meetings(&self, query: MeetingQuery) -> PortResult<Page<MeetingSummary>>;
    /// Borra filas (cascada) y devuelve OK; la carpeta la borra la app.
    async fn delete_meeting(&self, id: MeetingId) -> PortResult<()>;
    /// Pone o quita la estrella.
    async fn set_meeting_favourite(&self, id: MeetingId, favourite: bool) -> PortResult<Meeting>;
    /// Apunta que la reunión se abrió o se usó (búsqueda, chat) en `at`.
    async fn touch_meeting(&self, id: MeetingId, touch: MeetingTouch, at: UnixMs) -> PortResult<()>;
    /// «Mantener»: la reunión no vuelve a sugerirse para borrar.
    async fn set_cleanup_keep(&self, id: MeetingId, keep: bool) -> PortResult<()>;
    /// Datos de TODAS las reuniones para la heurística de limpieza
    /// (`library::cleanup::evaluate`), de la más antigua a la más nueva.
    async fn cleanup_facts(&self) -> PortResult<Vec<MeetingCleanupFacts>>;

    /// Reemplaza hablantes + utterances de la reunión.
    async fn save_transcript(&self, transcript: Transcript) -> PortResult<()>;
    async fn get_transcript(&self, id: MeetingId) -> PortResult<Option<Transcript>>;
    async fn rename_speaker(
        &self,
        meeting_id: MeetingId,
        speaker_id: SpeakerId,
        display_name: String,
        confirmed: bool,
    ) -> PortResult<()>;
    async fn link_speaker_voiceprint(
        &self,
        speaker_id: SpeakerId,
        voiceprint_id: Option<VoiceprintId>,
    ) -> PortResult<()>;

    /// Reemplaza resumen, decisiones, tareas y escaleta de la reunión.
    async fn save_minutes(&self, output: MinutesOutput) -> PortResult<()>;
    async fn get_minutes(&self, id: MeetingId) -> PortResult<Option<Minutes>>;
    async fn set_action_item_done(&self, id: ActionItemId, done: bool) -> PortResult<()>;

    async fn add_capture(&self, capture: Capture) -> PortResult<()>;
    async fn update_capture(&self, capture: Capture) -> PortResult<()>;
    async fn list_captures(&self, meeting_id: MeetingId) -> PortResult<Vec<Capture>>;
    async fn get_capture(&self, id: CaptureId) -> PortResult<Option<Capture>>;
    async fn delete_capture(&self, id: CaptureId) -> PortResult<()>;

    /// Reemplaza los tramos de pantalla compartida (aparecen en el timeline
    /// como `screenShare`).
    async fn save_screen_shares(&self, meeting_id: MeetingId, shares: Vec<ScreenShare>) -> PortResult<()>;
}

#[async_trait]
pub trait GroupStore: Send + Sync {
    async fn list_groups(&self) -> PortResult<Vec<Group>>;
    async fn create_group(&self, name: String, description: Option<String>) -> PortResult<Group>;
    async fn update_group(
        &self,
        id: GroupId,
        name: Option<String>,
        description: Option<String>,
    ) -> PortResult<Group>;
    async fn delete_group(&self, id: GroupId) -> PortResult<()>;
    async fn set_group_favourite(&self, id: GroupId, favourite: bool) -> PortResult<Group>;
    async fn add_meeting(&self, group_id: GroupId, meeting_id: MeetingId) -> PortResult<()>;
    async fn remove_meeting(&self, group_id: GroupId, meeting_id: MeetingId) -> PortResult<()>;
    /// Reemplaza las sugerencias pendientes.
    async fn save_suggestions(&self, suggestions: Vec<GroupSuggestion>) -> PortResult<()>;
    async fn list_suggestions(&self) -> PortResult<Vec<GroupSuggestion>>;
    /// Convierte la sugerencia en grupo (kind = Suggested) y la elimina.
    async fn accept_suggestion(&self, id: GroupId, name: Option<String>) -> PortResult<Group>;
    async fn dismiss_suggestion(&self, id: GroupId) -> PortResult<()>;
}

/// Huellas de voz (solo embeddings; borrables).
#[async_trait]
pub trait VoiceprintStore: Send + Sync {
    async fn list_voiceprints(&self) -> PortResult<Vec<VoiceprintSummary>>;
    async fn upsert_voiceprint(&self, voiceprint: Voiceprint) -> PortResult<()>;
    async fn delete_voiceprint(&self, id: VoiceprintId) -> PortResult<()>;
    /// Mejor coincidencia por coseno con el mismo `model`, si supera `min_similarity`.
    async fn nearest_voiceprint(
        &self,
        embedding: &[f32],
        model: &str,
        min_similarity: f32,
    ) -> PortResult<Option<(Voiceprint, f32)>>;
}

/// Indexado + búsqueda híbrida (FTS5 BM25 + sqlite-vec, fusión RRF).
#[async_trait]
pub trait SearchIndex: Send + Sync {
    /// (Re)construye chunks, FTS y vectores de la reunión y su embedding medio.
    /// Si hay embedder y falla, se indexa solo FTS y la reunión queda marcada
    /// para reindexar (ver `stale_meetings`).
    async fn index_meeting(&self, meeting_id: MeetingId) -> PortResult<()>;
    /// Quita la reunión del índice (chunks, FTS, vectores). Se llama
    /// `unindex_*` para no chocar con `GroupStore::remove_meeting`.
    async fn unindex_meeting(&self, meeting_id: MeetingId) -> PortResult<()>;
    /// Reuniones cuyo último indexado no pudo calcular embeddings.
    async fn stale_meetings(&self) -> PortResult<Vec<MeetingId>>;
    async fn search(&self, query: SearchQuery) -> PortResult<Vec<SearchHit>>;
}

/// Sugerencia de grupos por clustering de embeddings de reunión.
#[async_trait]
pub trait GroupSuggester: Send + Sync {
    /// Devuelve clusters SIN nombre (`name = None`); la app los nombra con
    /// `minutes::GroupNamer` y los guarda con `GroupStore::save_suggestions`.
    async fn suggest_groups(&self) -> PortResult<Vec<GroupSuggestion>>;
}

/// Embeddings locales (fastembed-rs, multilingual-e5-small, 384 dims).
#[async_trait]
pub trait Embedder: Send + Sync {
    fn model_id(&self) -> &str;
    fn dims(&self) -> usize;
    async fn embed(&self, texts: Vec<String>, kind: EmbedKind) -> PortResult<Vec<Vec<f32>>>;
}

#[async_trait]
pub trait SettingsStore: Send + Sync {
    /// Devuelve `Settings::default()` si no hay nada guardado.
    async fn load_settings(&self) -> PortResult<Settings>;
    async fn save_settings(&self, settings: Settings) -> PortResult<()>;
}
