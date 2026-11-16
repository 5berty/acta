//! Permisos del sistema (TCC en macOS).

use crate::PortResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionKind {
    /// NSMicrophoneUsageDescription.
    Microphone,
    /// Core Audio process tap: NSAudioCaptureUsageDescription (macOS 14.2+).
    SystemAudio,
    /// ScreenCaptureKit (capturas de pantalla compartida). Opt-in.
    ScreenRecording,
    /// AXUIElement sobre Teams (nombres, hablante activo, ventana de reunión).
    Accessibility,
    /// Apple Events a navegadores (URL de Meet). NSAppleEventsUsageDescription.
    Automation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
    /// No hay API para saberlo sin intentarlo (p. ej. audio del sistema).
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionState {
    pub kind: PermissionKind,
    pub status: PermissionStatus,
    /// Para Automation: el bundle id del navegador.
    pub target: Option<String>,
}

/// macOS: sidecar Swift (`permissions.status` / `permissions.request`).
#[async_trait]
pub trait PermissionsProbe: Send + Sync {
    async fn status(&self) -> PortResult<Vec<PermissionState>>;
    /// Lanza el diálogo del sistema si es posible; si no, devuelve el estado.
    async fn request(&self, kind: PermissionKind) -> PortResult<PermissionStatus>;
}
