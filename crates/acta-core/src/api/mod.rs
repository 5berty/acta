//! Contrato Tauri (comandos + eventos) entre la app (WP6) y la UI (WP5).
//!
//! Espejo en TypeScript: `apps/desktop/src/api/types.ts` y `contract.ts`.
//! Si cambias algo aquí, cambia el espejo en el MISMO commit.
//!
//! Convenciones:
//! - Nombres de comando en snake_case (`meeting_get`). Los argumentos se
//!   pasan desde JS en camelCase (`{ meetingId }`): Tauri los convierte.
//! - Todos los DTO se serializan en camelCase, salvo `Escaleta` (claves en
//!   castellano snake_case, igual que el JSON del LLM).
//! - Errores: los comandos devuelven `Result<T, ApiError>`.

pub mod commands;
pub mod events;

pub use commands::*;
pub use events::*;

use crate::PortError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ApiErrorCode {
    PermissionDenied,
    NotFound,
    Unavailable,
    Timeout,
    InvalidInput,
    InvalidState,
    Internal,
}

/// Error que recibe la UI. `message` en castellano y apto para mostrar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{code:?}: {message}")]
pub struct ApiError {
    pub code: ApiErrorCode,
    pub message: String,
}

impl From<PortError> for ApiError {
    fn from(e: PortError) -> Self {
        let code = match &e {
            PortError::PermissionDenied(_) => ApiErrorCode::PermissionDenied,
            PortError::NotFound(_) => ApiErrorCode::NotFound,
            PortError::Unavailable(_) => ApiErrorCode::Unavailable,
            PortError::Timeout(_) => ApiErrorCode::Timeout,
            PortError::InvalidInput(_) => ApiErrorCode::InvalidInput,
            _ => ApiErrorCode::Internal,
        };
        ApiError {
            code,
            message: e.to_string(),
        }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
