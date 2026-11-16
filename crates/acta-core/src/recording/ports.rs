use super::model::*;
use crate::{EventStream, PortResult};
use async_trait::async_trait;

/// Fuente de audio de las dos pistas. macOS: `acta-mac-bridge` (Core Audio
/// process tap + mic en el sidecar Swift). Windows (después): cpal + WASAPI
/// process loopback, posiblemente como dos fuentes combinadas.
///
/// Garantías que debe dar el adaptador:
/// - Frames de cada pista en orden de `seq`. Si se pierden, `Overrun`.
/// - El stream termina SOLO tras `stop()` o un fallo irrecuperable
///   (precedido de `TrackState { state: Failed }`).
/// - Si el proceso nativo muere, reintenta y emite `Restarted`.
#[async_trait]
pub trait AudioSource: Send + Sync {
    async fn start(
        &self,
        request: CaptureRequest,
    ) -> PortResult<(CaptureStarted, EventStream<AudioEvent>)>;
    async fn pause(&self) -> PortResult<()>;
    async fn resume(&self) -> PortResult<()>;
    async fn stop(&self) -> PortResult<()>;
    /// Cambia los PIDs del process tap sin cortar la grabación.
    async fn retarget(&self, system: SystemTarget) -> PortResult<()>;
}
