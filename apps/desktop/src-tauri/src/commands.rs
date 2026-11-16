//! Comandos Tauri. Contrato: `acta_core::api::commands` (tabla completa).
//! TODO(WP6): implementar el resto de comandos delegando en el supervisor y los stores.

use acta_core::api::{ApiResult, SessionSnapshot};
use acta_core::recording::SessionState;
use acta_core::time::{Clock, SystemClock};

#[tauri::command]
pub async fn session_get_state() -> ApiResult<SessionSnapshot> {
    Ok(SessionSnapshot {
        state: SessionState::Idle,
        elapsed_ms: 0,
        warnings: vec![],
        screen_sharing: false,
        capture_count: 0,
        at: SystemClock.now(),
    })
}
