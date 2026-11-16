use super::model::*;
use crate::{EventStream, PortResult};
use async_trait::async_trait;

/// Detecta inicio y fin de reuniones. macOS: `acta-mac-bridge`.
/// Windows (después): CapabilityAccessManager + UI Automation.
#[async_trait]
pub trait MeetingDetector: Send + Sync {
    /// Empieza a vigilar. Devuelve el stream de eventos ya fusionados.
    /// Llamar dos veces reemplaza la configuración (el stream anterior termina).
    async fn start(&self, config: DetectionConfig) -> PortResult<EventStream<DetectionEvent>>;
    async fn stop(&self) -> PortResult<()>;
}

/// Lee nombres de participantes y hablante activo de la UI de la app.
/// macOS: Accessibility (AXUIElement) sobre Teams.
#[async_trait]
pub trait SpeakerNameSource: Send + Sync {
    async fn watch(&self, app: &MeetingApp) -> PortResult<EventStream<SpeakerSignal>>;
    async fn unwatch(&self) -> PortResult<()>;
}
