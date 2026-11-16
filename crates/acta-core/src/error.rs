//! Errores compartidos por todos los puertos.

use serde::{Deserialize, Serialize};

/// Error que devuelve cualquier puerto. Los adaptadores mapean sus errores
/// internos a una de estas variantes; el mensaje es para logs (inglés o
/// castellano), `api::ApiError` es lo que ve la UI.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum PortError {
    /// Falta un permiso TCC (micrófono, audio del sistema, pantalla, AX...).
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("not found: {0}")]
    NotFound(String),
    /// El recurso externo no está disponible (sidecar caído, CLI no instalada...).
    #[error("unavailable: {0}")]
    Unavailable(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    /// Respuesta mal formada (JSON del LLM inválido, protocolo del sidecar...).
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    #[error("io: {0}")]
    Io(String),
    #[error("cancelled")]
    Cancelled,
    #[error("not implemented: {0}")]
    NotImplemented(String),
    #[error("internal: {0}")]
    Internal(String),
}

pub type PortResult<T> = Result<T, PortError>;

impl From<std::io::Error> for PortError {
    fn from(e: std::io::Error) -> Self {
        PortError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for PortError {
    fn from(e: serde_json::Error) -> Self {
        PortError::InvalidResponse(e.to_string())
    }
}
