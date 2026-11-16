//! Adaptadores "no disponible": si el sidecar no arranca (no está instalado,
//! permisos, crash al iniciar), la app sigue abriendo la biblioteca y explica
//! el motivo en cada acción nativa en lugar de morir.

use crate::native::{InputDevices, ModelManager};
use acta_core::api::ModelStatus;
use acta_core::api::ModelDownload;
use acta_core::detection::*;
use acta_core::permissions::*;
use acta_core::recording::*;
use acta_core::transcription::*;
use acta_core::{EventStream, PortError, PortResult};
use async_trait::async_trait;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Unavailable(pub String);

impl Unavailable {
    fn err<T>(&self) -> PortResult<T> {
        Err(PortError::Unavailable(self.0.clone()))
    }
}

#[async_trait]
impl AudioSource for Unavailable {
    async fn start(&self, _r: CaptureRequest) -> PortResult<(CaptureStarted, EventStream<AudioEvent>)> {
        self.err()
    }
    async fn pause(&self) -> PortResult<()> {
        self.err()
    }
    async fn resume(&self) -> PortResult<()> {
        self.err()
    }
    async fn stop(&self) -> PortResult<()> {
        Ok(())
    }
    async fn retarget(&self, _s: SystemTarget) -> PortResult<()> {
        self.err()
    }
}

#[async_trait]
impl MeetingDetector for Unavailable {
    async fn start(&self, _c: DetectionConfig) -> PortResult<EventStream<DetectionEvent>> {
        self.err()
    }
    async fn stop(&self) -> PortResult<()> {
        Ok(())
    }
}

#[async_trait]
impl SpeakerNameSource for Unavailable {
    async fn watch(&self, _app: &MeetingApp) -> PortResult<EventStream<SpeakerSignal>> {
        self.err()
    }
    async fn unwatch(&self) -> PortResult<()> {
        Ok(())
    }
}

#[async_trait]
impl Transcriber for Unavailable {
    async fn transcribe(&self, _r: TranscribeRequest, _p: Option<ProgressFn>) -> PortResult<Vec<AsrSegment>> {
        self.err()
    }
}

#[async_trait]
impl Diarizer for Unavailable {
    async fn diarize(&self, _w: &Path, _o: DiarizeOptions, _p: Option<ProgressFn>) -> PortResult<DiarizationResult> {
        self.err()
    }
}

#[async_trait]
impl PermissionsProbe for Unavailable {
    async fn status(&self) -> PortResult<Vec<PermissionState>> {
        Ok([
            PermissionKind::Microphone,
            PermissionKind::SystemAudio,
            PermissionKind::Accessibility,
            PermissionKind::Automation,
            PermissionKind::ScreenRecording,
        ]
        .into_iter()
        .map(|kind| PermissionState { kind, status: PermissionStatus::Unknown, target: None })
        .collect())
    }
    async fn request(&self, _k: PermissionKind) -> PortResult<PermissionStatus> {
        self.err()
    }
}

#[async_trait]
impl ModelManager for Unavailable {
    async fn status(&self) -> PortResult<Vec<ModelStatus>> {
        self.err()
    }
    async fn download(&self, _name: &str) -> PortResult<EventStream<ModelDownload>> {
        self.err()
    }
}

#[async_trait]
impl InputDevices for Unavailable {
    async fn inputs(&self) -> PortResult<Vec<acta_core::api::AudioInput>> {
        self.err()
    }
}
