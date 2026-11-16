//! Adaptadores nativos (sidecar Swift en macOS) y su alternativa "no disponible".

use crate::unavailable::Unavailable;
use acta_core::api::{ModelDownload, ModelStatus};
use acta_core::detection::{MeetingDetector, SpeakerNameSource};
use acta_core::permissions::PermissionsProbe;
use acta_core::recording::AudioSource;
use acta_core::screen::ScreenCapturer;
use acta_core::transcription::{Diarizer, LiveTranscriber, Transcriber};
use acta_core::{EventStream, PortResult};
use async_trait::async_trait;
use std::sync::Arc;

/// Modelos locales de FluidAudio (sin puerto en acta-core: es cosa de la app).
#[async_trait]
pub trait ModelManager: Send + Sync {
    async fn status(&self) -> PortResult<Vec<ModelStatus>>;
    async fn download(&self, name: &str) -> PortResult<EventStream<ModelDownload>>;
}

#[derive(Clone)]
pub struct NativePorts {
    pub audio: Arc<dyn AudioSource>,
    pub detector: Arc<dyn MeetingDetector>,
    pub speakers: Arc<dyn SpeakerNameSource>,
    pub screen: Option<Arc<dyn ScreenCapturer>>,
    pub live: Option<Arc<dyn LiveTranscriber>>,
    pub transcriber: Arc<dyn Transcriber>,
    pub diarizer: Arc<dyn Diarizer>,
    pub permissions: Arc<dyn PermissionsProbe>,
    pub models: Arc<dyn ModelManager>,
    pub sidecar_version: Option<String>,
    pub macos_version: Option<String>,
    /// Por qué no hay sidecar (para el log y Ajustes).
    pub error: Option<String>,
    #[cfg(target_os = "macos")]
    pub client: Option<acta_mac_bridge::client::SidecarClient>,
}

impl NativePorts {
    pub fn unavailable(reason: impl Into<String>) -> Self {
        let reason = reason.into();
        let u = Arc::new(Unavailable(format!("El componente nativo de acta no está disponible: {reason}")));
        Self {
            audio: u.clone(),
            detector: u.clone(),
            speakers: u.clone(),
            screen: None,
            live: None,
            transcriber: u.clone(),
            diarizer: u.clone(),
            permissions: u.clone(),
            models: u,
            sidecar_version: None,
            macos_version: None,
            error: Some(reason),
            #[cfg(target_os = "macos")]
            client: None,
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use acta_core::layout::DataLayout;
    use acta_mac_bridge::audio::MacAudioSource;
    use acta_mac_bridge::client::{SidecarClient, SidecarConfig, locate_sidecar};
    use acta_mac_bridge::detection::MacMeetingDetector;
    use acta_mac_bridge::permissions::MacPermissions;
    use acta_mac_bridge::screen::MacScreenCapturer;
    use acta_mac_bridge::speakers::MacSpeakerNames;
    use acta_mac_bridge::transcription::{MacDiarizer, MacLiveTranscriber, MacModels, MacTranscriber};

    struct Models(MacModels);

    #[async_trait]
    impl ModelManager for Models {
        async fn status(&self) -> PortResult<Vec<ModelStatus>> {
            Ok(self
                .0
                .status()
                .await?
                .into_iter()
                .map(|m| ModelStatus { name: m.name, downloaded: m.downloaded, bytes: m.bytes })
                .collect())
        }
        async fn download(&self, name: &str) -> PortResult<EventStream<ModelDownload>> {
            self.0.download(name).await
        }
    }

    /// Lanza el sidecar (`Contents/MacOS/acta-mac` en el bundle) y monta los adaptadores.
    pub async fn start(layout: &DataLayout) -> NativePorts {
        let binary = match locate_sidecar(None) {
            Ok(b) => b,
            Err(e) => return NativePorts::unavailable(e.to_string()),
        };
        let config = SidecarConfig {
            binary,
            log_file: Some(layout.logs_dir().join("acta-mac.log")),
            ..SidecarConfig::default()
        };
        let client = match SidecarClient::start(config).await {
            Ok(c) => c,
            Err(e) => return NativePorts::unavailable(e.to_string()),
        };
        let hello = client.hello_info();
        NativePorts {
            audio: Arc::new(MacAudioSource::new(client.clone())),
            detector: Arc::new(MacMeetingDetector::new(client.clone())),
            speakers: Arc::new(MacSpeakerNames::new(client.clone())),
            screen: Some(Arc::new(MacScreenCapturer::new(client.clone()))),
            live: Some(Arc::new(MacLiveTranscriber::new(client.clone()))),
            transcriber: Arc::new(MacTranscriber::new(client.clone())),
            diarizer: Arc::new(MacDiarizer::new(client.clone())),
            permissions: Arc::new(MacPermissions::new(client.clone())),
            models: Arc::new(Models(MacModels::new(client.clone()))),
            sidecar_version: hello.as_ref().map(|h| h.sidecar_version.clone()),
            macos_version: hello.map(|h| h.macos_version),
            error: None,
            client: Some(client),
        }
    }
}

#[cfg(target_os = "macos")]
pub use mac::start;

/// Windows y Linux (todavía) no tienen adaptadores nativos.
#[cfg(not(target_os = "macos"))]
pub async fn start(_layout: &acta_core::layout::DataLayout) -> NativePorts {
    NativePorts::unavailable("plataforma no soportada todavía")
}
