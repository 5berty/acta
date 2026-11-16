//! Comandos Tauri: nombre → (argumentos, resultado).
//!
//! | comando | args (JS, camelCase) | resultado |
//! |---|---|---|
//! | `session_get_state` | — | `SessionSnapshot` |
//! | `session_start` | `{ app?: MeetingApp }` | `SessionSnapshot` |
//! | `session_pause` / `session_resume` / `session_stop` / `session_dismiss` | — | `SessionSnapshot` |
//! | `prompt_answer` | `{ promptId, answer }` | `SessionSnapshot` |
//! | `capture_manual` | — | `Capture \| null` |
//! | `meetings_list` | `{ query: MeetingQuery }` | `Page<MeetingSummary>` |
//! | `meeting_get` | `{ id }` | `MeetingDetail` |
//! | `meeting_update` | `{ id, title }` | `Meeting` |
//! | `meeting_delete` | `{ id }` | `null` |
//! | `meeting_reprocess` | `{ request: ReprocessRequest }` | `null` |
//! | `speaker_rename` | `{ meetingId, speakerId, displayName, remember }` | `null` |
//! | `action_item_set_done` | `{ id, done }` | `null` |
//! | `capture_delete` | `{ id }` | `null` |
//! | `groups_list` | — | `Group[]` |
//! | `group_create` | `{ name, description? }` | `Group` |
//! | `group_update` | `{ id, name?, description? }` | `Group` |
//! | `group_delete` | `{ id }` | `null` |
//! | `group_add_meeting` / `group_remove_meeting` | `{ groupId, meetingId }` | `null` |
//! | `group_suggestions_list` | — | `GroupSuggestion[]` |
//! | `group_suggestions_refresh` | — | `GroupSuggestion[]` |
//! | `group_suggestion_accept` | `{ id, name? }` | `Group` |
//! | `group_suggestion_dismiss` | `{ id }` | `null` |
//! | `search` | `{ query: SearchQuery }` | `SearchHit[]` |
//! | `chat_threads_list` | `{ scope?: ChatScope }` | `ChatThread[]` |
//! | `chat_thread_create` | `{ scope: ChatScope }` | `ChatThread` |
//! | `chat_thread_delete` | `{ threadId }` | `null` |
//! | `chat_messages_list` | `{ threadId }` | `ChatMessage[]` |
//! | `chat_send` | `{ threadId, text }` | `ChatSendResult` (+ eventos `chat:delta`) |
//! | `voiceprints_list` | — | `VoiceprintSummary[]` |
//! | `voiceprint_delete` | `{ id }` | `null` |
//! | `settings_get` | — | `Settings` |
//! | `settings_update` | `{ settings }` | `Settings` |
//! | `llm_provider_test` | `{ providerId }` | `ProviderTestResult` |
//! | `llm_cli_detect` | — | `CliDetection` |
//! | `permissions_status` | — | `PermissionState[]` |
//! | `permissions_request` | `{ kind }` | `PermissionStatus` |
//! | `open_system_settings` | `{ kind }` | `null` |
//! | `health_get` | — | `HealthWarning[]` |
//! | `app_info` | — | `AppInfo` |
//! | `overlay_set_expanded` | `{ expanded }` | `null` |
//! | `main_window_show` | `{ meetingId? }` | `null` |

use crate::chat::ChatMessage;
use crate::ids::ChatMessageId;
use crate::recording::{HealthWarning, SessionState};
use crate::time::UnixMs;
use serde::{Deserialize, Serialize};

/// Nombres de comando (para no teclear strings sueltos en Rust).
pub mod command_names {
    pub const SESSION_GET_STATE: &str = "session_get_state";
    pub const SESSION_START: &str = "session_start";
    pub const SESSION_PAUSE: &str = "session_pause";
    pub const SESSION_RESUME: &str = "session_resume";
    pub const SESSION_STOP: &str = "session_stop";
    pub const SESSION_DISMISS: &str = "session_dismiss";
    pub const PROMPT_ANSWER: &str = "prompt_answer";
    pub const CAPTURE_MANUAL: &str = "capture_manual";
    pub const MEETINGS_LIST: &str = "meetings_list";
    pub const MEETING_GET: &str = "meeting_get";
    pub const MEETING_UPDATE: &str = "meeting_update";
    pub const MEETING_DELETE: &str = "meeting_delete";
    pub const MEETING_REPROCESS: &str = "meeting_reprocess";
    pub const SPEAKER_RENAME: &str = "speaker_rename";
    pub const ACTION_ITEM_SET_DONE: &str = "action_item_set_done";
    pub const CAPTURE_DELETE: &str = "capture_delete";
    pub const GROUPS_LIST: &str = "groups_list";
    pub const GROUP_CREATE: &str = "group_create";
    pub const GROUP_UPDATE: &str = "group_update";
    pub const GROUP_DELETE: &str = "group_delete";
    pub const GROUP_ADD_MEETING: &str = "group_add_meeting";
    pub const GROUP_REMOVE_MEETING: &str = "group_remove_meeting";
    pub const GROUP_SUGGESTIONS_LIST: &str = "group_suggestions_list";
    pub const GROUP_SUGGESTIONS_REFRESH: &str = "group_suggestions_refresh";
    pub const GROUP_SUGGESTION_ACCEPT: &str = "group_suggestion_accept";
    pub const GROUP_SUGGESTION_DISMISS: &str = "group_suggestion_dismiss";
    pub const SEARCH: &str = "search";
    pub const CHAT_THREADS_LIST: &str = "chat_threads_list";
    pub const CHAT_THREAD_CREATE: &str = "chat_thread_create";
    pub const CHAT_THREAD_DELETE: &str = "chat_thread_delete";
    pub const CHAT_MESSAGES_LIST: &str = "chat_messages_list";
    pub const CHAT_SEND: &str = "chat_send";
    pub const VOICEPRINTS_LIST: &str = "voiceprints_list";
    pub const VOICEPRINT_DELETE: &str = "voiceprint_delete";
    pub const SETTINGS_GET: &str = "settings_get";
    pub const SETTINGS_UPDATE: &str = "settings_update";
    pub const LLM_PROVIDER_TEST: &str = "llm_provider_test";
    pub const LLM_CLI_DETECT: &str = "llm_cli_detect";
    pub const PERMISSIONS_STATUS: &str = "permissions_status";
    pub const PERMISSIONS_REQUEST: &str = "permissions_request";
    pub const OPEN_SYSTEM_SETTINGS: &str = "open_system_settings";
    pub const HEALTH_GET: &str = "health_get";
    pub const APP_INFO: &str = "app_info";
    pub const OVERLAY_SET_EXPANDED: &str = "overlay_set_expanded";
    pub const MAIN_WINDOW_SHOW: &str = "main_window_show";
}

/// Estado de la sesión tal como lo ve la UI (comandos `session_*` y evento
/// `session:state`). La pregunta abierta, si la hay, está DENTRO de `state`
/// (`detected.prompt` o `recording.stopPrompt`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub state: SessionState,
    /// Tiempo grabado (sin pausas) en ms.
    pub elapsed_ms: u64,
    /// Avisos de salud activos.
    pub warnings: Vec<HealthWarning>,
    /// Hay pantalla compartida y se está capturando.
    pub screen_sharing: bool,
    pub capture_count: u32,
    pub at: UnixMs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendResult {
    pub user_message: ChatMessage,
    /// Id del mensaje de respuesta; llegan `chat:delta` con este id.
    pub assistant_message_id: ChatMessageId,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDetection {
    /// Ruta absoluta de `claude` si se encontró (login shell `zsh -lc 'command -v claude'`).
    pub claude: Option<String>,
    pub codex: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub sidecar_version: Option<String>,
    pub macos_version: Option<String>,
}
