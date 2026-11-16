//! `AppCore`: la lógica de todos los comandos, sin tipos de Tauri (se prueba
//! con el store real en un directorio temporal y adaptadores falsos).

use crate::llm::{KeychainResolver, build_provider};
use crate::native::NativePorts;
use crate::pipeline::{DynamicPipeline, SharedSettings, read};
use acta_audio::processing::voiceprints::rename_speaker;
use acta_audio::supervisor::{SupervisorConfig, SupervisorHandle, SupervisorPorts, spawn_with};
use acta_core::api::*;
use acta_core::chat::*;
use acta_core::detection::MeetingApp;
use acta_core::ids::*;
use acta_core::layout::DataLayout;
use acta_core::library::*;
use acta_core::llm::{LlmProviderFactory, ProviderTestResult, SecretRef};
use acta_core::minutes::GroupNamer;
use acta_core::permissions::{PermissionKind, PermissionState, PermissionStatus};
use acta_core::processing::ReprocessRequest;
use acta_core::recording::{HealthWarning, PromptAnswer, SessionEvent, SessionState, StopReason};
use acta_core::screen::Capture;
use acta_core::settings::Settings;
use acta_core::time::Clock;
use acta_core::transcription::VoiceprintSummary;
use acta_core::{PortError, PortResult};
use acta_llm::chat::LlmChatEngine;
use acta_llm::moments::KeywordMomentDetector;
use acta_llm::naming::LlmGroupNamer;
use acta_llm::providers::detect::detect_cli_any;
use acta_llm::providers::{DefaultProviderFactory, test_provider};
use acta_store::SqliteStore;
use acta_store::secrets::{SecretStore, secret_ref_for_provider};
use futures::StreamExt;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// Publica eventos hacia la UI (Tauri `emit` en la app, un vector en tests).
pub trait Emit: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value);
}

pub struct AppCore {
    pub layout: DataLayout,
    pub clock: Arc<dyn Clock>,
    pub store: Arc<SqliteStore>,
    pub secrets: Arc<dyn SecretStore>,
    pub factory: Arc<dyn LlmProviderFactory>,
    pub settings: SharedSettings,
    pub supervisor: SupervisorHandle,
    pub native: NativePorts,
    pub emitter: Arc<dyn Emit>,
    /// Shell para detectar los CLI (`/bin/zsh`) y `$HOME`.
    pub shell: PathBuf,
    pub home: PathBuf,
}

pub struct CoreDeps {
    pub layout: DataLayout,
    pub clock: Arc<dyn Clock>,
    pub store: Arc<SqliteStore>,
    pub secrets: Arc<dyn SecretStore>,
    /// `None` = `DefaultProviderFactory` con el Llavero.
    pub factory: Option<Arc<dyn LlmProviderFactory>>,
    pub native: NativePorts,
    pub emitter: Arc<dyn Emit>,
    pub supervisor_config: SupervisorConfig,
}

fn to_json<T: serde::Serialize>(v: &T) -> serde_json::Value {
    serde_json::to_value(v).unwrap_or(serde_json::Value::Null)
}

impl AppCore {
    /// Monta todo y arranca el supervisor (recuperación incluida).
    pub async fn start(deps: CoreDeps) -> PortResult<Self> {
        use acta_core::library::SettingsStore;
        let settings = deps.store.load_settings().await?;
        let shared: SharedSettings = Arc::new(RwLock::new(settings.clone()));
        let factory = deps
            .factory
            .unwrap_or_else(|| Arc::new(DefaultProviderFactory::new(Arc::new(KeychainResolver(deps.secrets.clone())))));
        let pipeline = DynamicPipeline {
            layout: deps.layout.clone(),
            settings: shared.clone(),
            store: deps.store.clone(),
            voiceprints: deps.store.clone(),
            search: deps.store.clone(),
            transcriber: deps.native.transcriber.clone(),
            diarizer: deps.native.diarizer.clone(),
            factory: factory.clone(),
            clock: deps.clock.clone(),
        };
        let layout_root = deps.layout.root().to_path_buf();
        let ports = SupervisorPorts {
            layout: deps.layout.clone(),
            clock: deps.clock.clone(),
            audio: deps.native.audio.clone(),
            detector: deps.native.detector.clone(),
            speakers: deps.native.speakers.clone(),
            screen: deps.native.screen.clone(),
            live: deps.native.live.clone(),
            moments: Arc::new(KeywordMomentDetector::with_defaults(&settings.screen.keywords)),
            store: deps.store.clone(),
            pipeline: Arc::new(pipeline),
            disk_free: Arc::new(move |p| crate::system::disk_free(if p.exists() { p } else { &layout_root })),
        };
        let supervisor = spawn_with(ports, settings, deps.supervisor_config).await?;
        Ok(Self {
            layout: deps.layout,
            clock: deps.clock,
            store: deps.store,
            secrets: deps.secrets,
            factory,
            settings: shared,
            supervisor,
            native: deps.native,
            emitter: deps.emitter,
            shell: PathBuf::from("/bin/zsh"),
            home: dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")),
        })
    }

    pub fn settings(&self) -> Settings {
        read(&self.settings)
    }

    fn emit<T: serde::Serialize>(&self, name: &str, payload: &T) {
        self.emitter.emit(name, to_json(payload));
    }

    // ------------------------------------------------------------------
    // Sesión
    // ------------------------------------------------------------------

    pub async fn session_get_state(&self) -> PortResult<SessionSnapshot> {
        self.supervisor.snapshot().await
    }

    async fn session(&self, event: SessionEvent) -> PortResult<SessionSnapshot> {
        self.supervisor.send(event).await
    }

    /// Micro y audio del sistema resueltos ANTES de empezar. Tras reinstalar
    /// (cdhash nuevo) macOS vuelve a preguntar; si la captura arranca con el
    /// diálogo abierto, la HAL se queda bloqueada, la pastilla dice «Grabando
    /// 00:00» y la reunión sale vacía. Aquí se pregunta primero y, si el
    /// usuario dice que no, no se crea ninguna reunión.
    async fn ensure_capture_permissions(&self) -> PortResult<()> {
        // Sin sidecar no hay a quién preguntar: que lo explique la captura.
        let Ok(states) = self.native.permissions.status().await else { return Ok(()) };
        for (kind, name) in [(PermissionKind::Microphone, "Micrófono"), (PermissionKind::SystemAudio, "Audio del sistema")] {
            let mut status = states.iter().find(|p| p.kind == kind).map_or(PermissionStatus::Unknown, |p| p.status);
            if status == PermissionStatus::NotDetermined {
                status = self.native.permissions.request(kind).await?;
            }
            if status == PermissionStatus::Denied {
                return Err(PortError::PermissionDenied(format!(
                    "acta no tiene permiso de «{name}». Actívalo en Ajustes del Sistema › Privacidad y seguridad › {name} y vuelve a grabar."
                )));
            }
        }
        Ok(())
    }

    pub async fn session_start(&self, app: Option<MeetingApp>) -> PortResult<SessionSnapshot> {
        self.ensure_capture_permissions().await?;
        self.session(SessionEvent::StartRequested { app, at: self.clock.now() }).await
    }
    pub async fn session_pause(&self) -> PortResult<SessionSnapshot> {
        self.session(SessionEvent::PauseRequested { at: self.clock.now() }).await
    }
    pub async fn session_resume(&self) -> PortResult<SessionSnapshot> {
        self.session(SessionEvent::ResumeRequested { at: self.clock.now() }).await
    }
    pub async fn session_stop(&self) -> PortResult<SessionSnapshot> {
        self.session(SessionEvent::StopRequested { reason: StopReason::User, at: self.clock.now() }).await
    }
    pub async fn session_dismiss(&self) -> PortResult<SessionSnapshot> {
        self.session(SessionEvent::Dismiss).await
    }
    pub async fn prompt_answer(&self, prompt_id: PromptId, answer: PromptAnswer) -> PortResult<SessionSnapshot> {
        // Aceptar «¿Grabar?» también empieza a capturar.
        if answer == PromptAnswer::Accept
            && matches!(self.session_get_state().await?.state, SessionState::Detected { .. })
        {
            self.ensure_capture_permissions().await?;
        }
        self.session(SessionEvent::PromptAnswered { prompt_id, answer, at: self.clock.now() }).await
    }
    pub async fn capture_manual(&self) -> PortResult<Option<Capture>> {
        self.supervisor.capture_manual().await
    }
    pub async fn health_get(&self) -> PortResult<Vec<HealthWarning>> {
        self.supervisor.health().await
    }

    // ------------------------------------------------------------------
    // Reuniones
    // ------------------------------------------------------------------

    pub async fn meetings_list(&self, query: MeetingQuery) -> PortResult<Page<MeetingSummary>> {
        self.store.list_meetings(query).await
    }

    pub async fn meeting_get(&self, id: MeetingId) -> PortResult<MeetingDetail> {
        self.store
            .get_meeting_detail(id)
            .await?
            .ok_or_else(|| PortError::NotFound("No existe esa reunión.".into()))
    }

    pub async fn meeting_update(&self, id: MeetingId, title: String) -> PortResult<Meeting> {
        let title = title.trim().to_owned();
        if title.is_empty() {
            return Err(PortError::InvalidInput("El título no puede estar vacío.".into()));
        }
        let m = self
            .store
            .patch_meeting(id, MeetingPatch { title: Some(title), ..MeetingPatch::default() })
            .await?;
        self.emit(
            event_names::MEETING_UPDATED,
            &MeetingUpdated { meeting_id: id, status: m.status, title: m.title.clone() },
        );
        Ok(m)
    }

    fn recording_meeting(state: &SessionState) -> Option<MeetingId> {
        match state {
            SessionState::Recording(r) => Some(r.meeting_id),
            SessionState::Paused { recording, .. } => Some(recording.meeting_id),
            SessionState::Stopping { meeting_id, .. } => Some(*meeting_id),
            _ => None,
        }
    }

    /// Borra filas y la carpeta (audio, capturas...). No se puede borrar la
    /// reunión que se está grabando.
    pub async fn meeting_delete(&self, id: MeetingId) -> PortResult<()> {
        let snap = self.supervisor.snapshot().await?;
        if Self::recording_meeting(&snap.state) == Some(id) {
            return Err(PortError::InvalidInput("Para la grabación antes de borrarla.".into()));
        }
        self.store.delete_meeting(id).await?;
        match tokio::fs::remove_dir_all(self.layout.meeting_dir(id)).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn meeting_reprocess(&self, request: ReprocessRequest) -> PortResult<()> {
        if self.store.get_meeting(request.meeting_id).await?.is_none() {
            return Err(PortError::NotFound("No existe esa reunión.".into()));
        }
        self.supervisor.reprocess(request.meeting_id, request.steps)
    }

    pub async fn speaker_rename(
        &self,
        meeting_id: MeetingId,
        speaker_id: SpeakerId,
        display_name: String,
        remember: bool,
    ) -> PortResult<()> {
        rename_speaker(
            &self.layout,
            self.store.as_ref(),
            self.store.as_ref(),
            meeting_id,
            speaker_id,
            display_name,
            remember,
            self.clock.now(),
        )
        .await?;
        // Los chunks llevan el nombre: se reindexa en segundo plano.
        let store = self.store.clone();
        tokio::spawn(async move {
            if let Err(e) = store.index_meeting(meeting_id).await {
                tracing::warn!("reindexado tras renombrar: {e}");
            }
        });
        Ok(())
    }

    pub async fn action_item_set_done(&self, id: ActionItemId, done: bool) -> PortResult<()> {
        self.store.set_action_item_done(id, done).await
    }

    pub async fn capture_delete(&self, id: CaptureId) -> PortResult<()> {
        let capture = self
            .store
            .get_capture(id)
            .await?
            .ok_or_else(|| PortError::NotFound("No existe esa captura.".into()))?;
        self.store.delete_capture(id).await?;
        let path = self.layout.meeting_dir(capture.meeting_id).join(&capture.path);
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    // ------------------------------------------------------------------
    // Grupos
    // ------------------------------------------------------------------

    pub async fn groups_list(&self) -> PortResult<Vec<Group>> {
        self.store.list_groups().await
    }
    pub async fn group_create(&self, name: String, description: Option<String>) -> PortResult<Group> {
        self.store.create_group(name, description).await
    }
    pub async fn group_update(&self, id: GroupId, name: Option<String>, description: Option<String>) -> PortResult<Group> {
        self.store.update_group(id, name, description).await
    }
    pub async fn group_delete(&self, id: GroupId) -> PortResult<()> {
        self.store.delete_group(id).await
    }
    pub async fn group_add_meeting(&self, group_id: GroupId, meeting_id: MeetingId) -> PortResult<()> {
        GroupStore::add_meeting(self.store.as_ref(), group_id, meeting_id).await
    }
    pub async fn group_remove_meeting(&self, group_id: GroupId, meeting_id: MeetingId) -> PortResult<()> {
        GroupStore::remove_meeting(self.store.as_ref(), group_id, meeting_id).await
    }
    pub async fn group_suggestions_list(&self) -> PortResult<Vec<GroupSuggestion>> {
        self.store.list_suggestions().await
    }
    pub async fn group_suggestion_accept(&self, id: GroupId, name: Option<String>) -> PortResult<Group> {
        self.store.accept_suggestion(id, name).await
    }
    pub async fn group_suggestion_dismiss(&self, id: GroupId) -> PortResult<()> {
        self.store.dismiss_suggestion(id).await
    }

    /// Clustering + nombre con el LLM (si hay proveedor; si no, sin nombre).
    pub async fn group_suggestions_refresh(&self) -> PortResult<Vec<GroupSuggestion>> {
        let mut suggestions = self.store.suggest_groups().await?;
        let settings = self.settings();
        let namer = build_provider(&settings, self.factory.as_ref(), settings.llm.naming_provider.as_ref())
            .ok()
            .map(|(_, p)| LlmGroupNamer::new(p, settings.user.display_name.clone()));
        if let Some(namer) = namer {
            for s in &mut suggestions {
                let mut metas = Vec::new();
                for id in &s.meeting_ids {
                    let title = self.store.get_meeting(*id).await?.map(|m| m.title).unwrap_or_default();
                    let summary = self.store.get_minutes(*id).await?.map(|m| m.summary_md).unwrap_or_default();
                    metas.push((title, summary));
                }
                match namer.name_group(&metas).await {
                    Ok(n) => {
                        s.name = Some(n.name);
                        s.description = Some(n.description);
                    }
                    Err(e) => tracing::warn!("no se pudo nombrar un grupo sugerido: {e}"),
                }
            }
        }
        self.store.save_suggestions(suggestions).await?;
        self.store.list_suggestions().await
    }

    /// Tras procesar una reunión: reindexa las que quedaron sin vectores y
    /// refresca las sugerencias de grupos. Mejor esfuerzo.
    pub async fn after_processing(&self) {
        if let Ok(stale) = self.store.stale_meetings().await {
            for id in stale {
                if let Err(e) = self.store.index_meeting(id).await {
                    tracing::warn!(%id, "reindexado pendiente: {e}");
                }
            }
        }
        if let Err(e) = self.group_suggestions_refresh().await {
            tracing::warn!("sugerencias de grupos: {e}");
        }
    }

    // ------------------------------------------------------------------
    // Búsqueda y chat
    // ------------------------------------------------------------------

    pub async fn search(&self, query: SearchQuery) -> PortResult<Vec<SearchHit>> {
        self.store.search(query).await
    }
    pub async fn chat_threads_list(&self, scope: Option<ChatScope>) -> PortResult<Vec<ChatThread>> {
        self.store.list_threads(scope).await
    }

    pub async fn chat_thread_create(&self, scope: ChatScope) -> PortResult<ChatThread> {
        let title = match &scope {
            ChatScope::Meeting { meeting_id } => self
                .store
                .get_meeting(*meeting_id)
                .await?
                .map_or_else(|| "Reunión".to_owned(), |m| m.title),
            ChatScope::Group { group_id } => self
                .store
                .list_groups()
                .await?
                .into_iter()
                .find(|g| g.id == *group_id)
                .map_or_else(|| "Grupo".to_owned(), |g| g.name),
            ChatScope::All => "Todas las reuniones".to_owned(),
        };
        self.store.create_thread(scope, title).await
    }

    pub async fn chat_thread_delete(&self, thread_id: ChatThreadId) -> PortResult<()> {
        self.store.delete_thread(thread_id).await
    }
    pub async fn chat_messages_list(&self, thread_id: ChatThreadId) -> PortResult<Vec<ChatMessage>> {
        self.store.list_messages(thread_id).await
    }

    /// Guarda la pregunta, lanza la respuesta en streaming (`chat:delta`) y la
    /// guarda al terminar.
    pub async fn chat_send(&self, thread_id: ChatThreadId, text: String) -> PortResult<ChatSendResult> {
        let text = text.trim().to_owned();
        if text.is_empty() {
            return Err(PortError::InvalidInput("Escribe una pregunta.".into()));
        }
        let thread = self
            .store
            .list_threads(None)
            .await?
            .into_iter()
            .find(|t| t.id == thread_id)
            .ok_or_else(|| PortError::NotFound("No existe esa conversación.".into()))?;
        let history = self.store.list_messages(thread_id).await?;
        let settings = self.settings();
        let (cfg, provider) = build_provider(&settings, self.factory.as_ref(), settings.llm.chat_provider.as_ref())?;
        let user_message = ChatMessage {
            id: ChatMessageId::new(),
            thread_id,
            role: ChatRole::User,
            content: text.clone(),
            citations: vec![],
            provider: None,
            created_at: self.clock.now(),
        };
        self.store.append_message(user_message.clone()).await?;
        let engine = LlmChatEngine::new(provider, self.store.clone(), self.store.clone(), settings.user.clone());
        let assistant_message_id = ChatMessageId::new();
        let mut stream = engine.ask(&thread, &history, &text, assistant_message_id).await?;
        let store = self.store.clone();
        let emitter = self.emitter.clone();
        let clock = self.clock.clone();
        tokio::spawn(async move {
            let mut content = String::new();
            let mut citations = Vec::new();
            while let Some(delta) = stream.next().await {
                content.push_str(&delta.delta);
                let done = delta.done;
                if done {
                    citations = delta.citations.clone();
                }
                emitter.emit(event_names::CHAT_DELTA, to_json(&delta));
                if done {
                    break;
                }
            }
            if content.trim().is_empty() {
                return;
            }
            let msg = ChatMessage {
                id: assistant_message_id,
                thread_id,
                role: ChatRole::Assistant,
                content,
                citations,
                provider: Some(cfg.id),
                created_at: clock.now(),
            };
            if let Err(e) = store.append_message(msg).await {
                tracing::warn!("no se pudo guardar la respuesta del chat: {e}");
            }
        });
        Ok(ChatSendResult { user_message, assistant_message_id })
    }

    // ------------------------------------------------------------------
    // Huellas, ajustes, proveedores, secretos, modelos, permisos
    // ------------------------------------------------------------------

    pub async fn voiceprints_list(&self) -> PortResult<Vec<VoiceprintSummary>> {
        self.store.list_voiceprints().await
    }
    pub async fn voiceprint_delete(&self, id: VoiceprintId) -> PortResult<()> {
        self.store.delete_voiceprint(id).await
    }

    pub async fn settings_get(&self) -> PortResult<Settings> {
        Ok(self.settings())
    }

    pub async fn settings_update(&self, settings: Settings) -> PortResult<Settings> {
        use acta_core::library::SettingsStore;
        self.store.save_settings(settings.clone()).await?;
        *self.settings.write().unwrap_or_else(|e| e.into_inner()) = settings.clone();
        self.supervisor.update_settings(settings.clone())?;
        Ok(settings)
    }

    pub async fn llm_provider_test(&self, provider_id: ProviderId) -> PortResult<ProviderTestResult> {
        let settings = self.settings();
        let cfg = settings
            .llm
            .providers
            .iter()
            .find(|p| p.id == provider_id)
            .ok_or_else(|| PortError::NotFound(format!("No existe el proveedor «{provider_id}».")))?;
        match self.factory.build(cfg) {
            Ok(p) => Ok(test_provider(p.as_ref()).await),
            Err(e) => Ok(ProviderTestResult { ok: false, message: e.to_string(), latency_ms: None }),
        }
    }

    pub async fn llm_cli_detect(&self) -> PortResult<CliDetection> {
        let claude = detect_cli_any(&self.shell, "claude", &self.home).await?;
        let codex = detect_cli_any(&self.shell, "codex", &self.home).await?;
        Ok(CliDetection {
            claude: claude.as_ref().map(|d| d.path.to_string_lossy().into_owned()),
            codex: codex.as_ref().map(|d| d.path.to_string_lossy().into_owned()),
            claude_env: claude.map(|d| d.env).unwrap_or_default(),
            codex_env: codex.map(|d| d.env).unwrap_or_default(),
        })
    }

    pub async fn secret_set(&self, provider_id: ProviderId, value: String) -> PortResult<SecretRef> {
        let value = value.trim().to_owned();
        if value.is_empty() {
            return Err(PortError::InvalidInput("La clave está vacía.".into()));
        }
        let r = secret_ref_for_provider(&provider_id.0);
        self.secrets.set(&r, &value)?;
        Ok(r)
    }

    pub async fn secret_delete(&self, provider_id: ProviderId) -> PortResult<()> {
        self.secrets.delete(&secret_ref_for_provider(&provider_id.0))
    }

    pub async fn models_status(&self) -> PortResult<Vec<ModelStatus>> {
        self.native.models.status().await
    }

    /// Lanza la descarga; el progreso llega como `model:download`.
    pub async fn models_download(&self, name: String) -> PortResult<()> {
        if !matches!(name.as_str(), "asr" | "diarizer" | "vad") {
            return Err(PortError::InvalidInput(format!("Modelo desconocido: {name}")));
        }
        let mut stream = self.native.models.download(&name).await?;
        let emitter = self.emitter.clone();
        tokio::spawn(async move {
            while let Some(p) = stream.next().await {
                emitter.emit(event_names::MODEL_DOWNLOAD, to_json(&p));
            }
        });
        Ok(())
    }

    pub async fn audio_inputs_list(&self) -> PortResult<Vec<AudioInput>> {
        self.native.devices.inputs().await
    }

    pub async fn permissions_status(&self) -> PortResult<Vec<PermissionState>> {
        self.native.permissions.status().await
    }
    pub async fn permissions_request(&self, kind: PermissionKind) -> PortResult<PermissionStatus> {
        self.native.permissions.request(kind).await
    }

    pub fn app_info(&self) -> AppInfo {
        AppInfo {
            version: env!("CARGO_PKG_VERSION").into(),
            data_dir: self.layout.root().to_string_lossy().into_owned(),
            sidecar_version: self.native.sidecar_version.clone(),
            macos_version: self.native.macos_version.clone(),
        }
    }

    /// Cierre ordenado: para la grabación (se procesará al volver) y el sidecar.
    pub async fn shutdown(&self) {
        let _ = self.supervisor.shutdown().await;
        #[cfg(target_os = "macos")]
        if let Some(c) = &self.native.client {
            let _ = c.shutdown().await;
        }
    }
}
