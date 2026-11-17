//! Eventos Tauri (backend → UI). `app.emit(NAME, payload)` a todas las ventanas.
//!
//! | evento | payload | frecuencia |
//! |---|---|---|
//! | `session:state` | `SessionSnapshot` | en cada transición + 1 Hz mientras graba (timer) |
//! | `session:levels` | `Levels` | ≈10 Hz mientras graba |
//! | `session:health` | `HealthWarning` | al aparecer/limpiarse un aviso |
//! | `processing:progress` | `ProcessingProgress` | por paso / fracción |
//! | `meeting:updated` | `MeetingUpdated` | al cambiar estado/título de una reunión |
//! | `capture:saved` | `Capture` | captura guardada durante la reunión |
//! | `chat:delta` | `ChatDelta` | streaming de respuestas |
//! | `live:partial` | `LivePartial` | solo con previsualización en vivo |
//! | `model:download` | `ModelDownload` | descarga de modelos ASR/embeddings |
//! | `localmodel:download` | `llm::local::LocalLlmDownload` | descarga del modelo local integrado |
//! | `main:navigate` | `MainNavigate` | `main_window_show{meetingId}`: la ventana principal abre esa reunión |
//! | `live:transcript` | `LiveTranscript` | cada pocos segundos mientras graba (ver `api::live`) |
//! | `live:answer` | `LiveAnswer` | streaming de `live_ask` |

use crate::ids::MeetingId;
use crate::library::MeetingStatus;
use serde::{Deserialize, Serialize};

pub mod event_names {
    pub const SESSION_STATE: &str = "session:state";
    pub const SESSION_LEVELS: &str = "session:levels";
    pub const SESSION_HEALTH: &str = "session:health";
    pub const PROCESSING_PROGRESS: &str = "processing:progress";
    pub const MEETING_UPDATED: &str = "meeting:updated";
    pub const CAPTURE_SAVED: &str = "capture:saved";
    pub const CHAT_DELTA: &str = "chat:delta";
    pub const LIVE_PARTIAL: &str = "live:partial";
    pub const MODEL_DOWNLOAD: &str = "model:download";
    pub const LOCAL_LLM_DOWNLOAD: &str = "localmodel:download";
    pub const MAIN_NAVIGATE: &str = "main:navigate";
    /// `api::LiveTranscript` (segmentos nuevos o cambiados).
    pub const LIVE_TRANSCRIPT: &str = "live:transcript";
    /// `api::LiveAnswer` (streaming de `live_ask`).
    pub const LIVE_ANSWER: &str = "live:answer";
    /// `api::PermissionChanged`.
    pub const PERMISSIONS_CHANGED: &str = "permissions:changed";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainNavigate {
    pub meeting_id: MeetingId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingUpdated {
    pub meeting_id: MeetingId,
    pub status: MeetingStatus,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownload {
    pub name: String,
    pub fraction: f32,
    pub done: bool,
    pub error: Option<String>,
}
