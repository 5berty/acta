//! Supervisor de sesión (WP1): dueño ÚNICO del `SessionState`. Recibe
//! `SessionEvent` (de la UI, del detector, de la autoparada, del writer),
//! aplica `transition` y ejecuta los `Effect`. Publica `SupervisorEvent`
//! que la app (WP6) reenvía como eventos Tauri.

use acta_core::api::{MeetingUpdated, SessionSnapshot};
use acta_core::detection::{MeetingDetector, SpeakerNameSource};
use acta_core::library::MeetingStore;
use acta_core::minutes::ImportantMomentDetector;
use acta_core::processing::{ProcessingPipeline, ProcessingProgress};
use acta_core::recording::{AudioSource, HealthWarning, Levels, SessionEvent};
use acta_core::screen::{Capture, ScreenCapturer};
use acta_core::settings::Settings;
use acta_core::time::Clock;
use acta_core::layout::DataLayout;
use acta_core::transcription::LiveTranscriber;
use acta_core::{PortError, PortResult};
use std::sync::Arc;

/// Lo que publica el supervisor (WP6 → `app.emit`).
#[derive(Debug, Clone)]
pub enum SupervisorEvent {
    /// → `session:state`
    Snapshot(SessionSnapshot),
    /// → `session:levels`
    Levels(Levels),
    /// → `session:health`
    Health(HealthWarning),
    /// → `capture:saved`
    CaptureSaved(Capture),
    /// → `processing:progress`
    Processing(ProcessingProgress),
    /// → `meeting:updated`
    MeetingUpdated(MeetingUpdated),
}

/// Puertos que necesita el supervisor (los inyecta WP6).
#[derive(Clone)]
pub struct SupervisorPorts {
    pub layout: DataLayout,
    pub clock: Arc<dyn Clock>,
    pub audio: Arc<dyn AudioSource>,
    pub detector: Arc<dyn MeetingDetector>,
    pub speakers: Arc<dyn SpeakerNameSource>,
    pub screen: Option<Arc<dyn ScreenCapturer>>,
    pub live: Option<Arc<dyn LiveTranscriber>>,
    pub moments: Arc<dyn ImportantMomentDetector>,
    pub store: Arc<dyn MeetingStore>,
    pub pipeline: Arc<dyn ProcessingPipeline>,
}

/// Handle clonable que usan los comandos Tauri.
#[derive(Clone)]
pub struct SupervisorHandle {
    _private: (),
}

impl SupervisorHandle {
    /// Envía un evento y devuelve el snapshot resultante.
    pub async fn send(&self, event: SessionEvent) -> PortResult<SessionSnapshot> {
        let _ = event;
        Err(PortError::NotImplemented("SupervisorHandle::send".into()))
    }

    pub async fn snapshot(&self) -> PortResult<SessionSnapshot> {
        Err(PortError::NotImplemented("SupervisorHandle::snapshot".into()))
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<SupervisorEvent> {
        let (_tx, rx) = tokio::sync::broadcast::channel(1);
        rx
    }
}

/// Arranca el supervisor en una tarea tokio: recuperación de sesiones
/// incompletas, detector, bucle de eventos.
pub async fn spawn(ports: SupervisorPorts, settings: Settings) -> PortResult<SupervisorHandle> {
    let _ = (ports, settings);
    Err(PortError::NotImplemented("supervisor::spawn".into()))
}
