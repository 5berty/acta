#![allow(clippy::unwrap_used, clippy::expect_used)]
//! `AppCore` (la lógica de los comandos) con el store real en un directorio
//! temporal, sidecar "no disponible" y un LLM falso.

use acta_audio::supervisor::SupervisorConfig;
use acta_core::chat::ChatScope;
use acta_core::detection::Platform;
use acta_core::ids::*;
use acta_core::layout::DataLayout;
use acta_core::library::*;
use acta_core::llm::*;
use acta_core::recording::SessionState;
use acta_core::screen::{Capture, CaptureReason};
use acta_core::time::{MediaMs, SystemClock, UnixMs};
use acta_core::{EventStream, PortError, PortResult};
use acta_desktop_lib::app::{AppCore, CoreDeps, Emit};
use acta_desktop_lib::native::NativePorts;
use acta_store::SqliteStore;
use acta_store::secrets::{InMemorySecretStore, SecretStore};
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct Events(Mutex<Vec<(String, serde_json::Value)>>);
impl Emit for Events {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        self.0.lock().unwrap().push((event.to_owned(), payload));
    }
}

struct EchoProvider(ProviderId);
#[async_trait]
impl LlmProvider for EchoProvider {
    fn id(&self) -> &ProviderId {
        &self.0
    }
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities { streaming: true, native_json_schema: false, context_tokens: 100_000 }
    }
    async fn complete(&self, _r: LlmRequest) -> PortResult<LlmResponse> {
        Ok(LlmResponse { text: "ok".into(), json: None, model: Some("echo".into()), usage: Usage::default() })
    }
    async fn stream(&self, _r: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
        Ok(Box::pin(futures::stream::iter(vec![Ok("Se decidió ".to_string()), Ok("el plan.".to_string())])))
    }
}

struct EchoFactory;
impl LlmProviderFactory for EchoFactory {
    fn build(&self, config: &ProviderConfig) -> PortResult<Arc<dyn LlmProvider>> {
        Ok(Arc::new(EchoProvider(config.id.clone())))
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    layout: DataLayout,
    core: AppCore,
    events: Arc<Events>,
    secrets: Arc<InMemorySecretStore>,
}

async fn rig() -> Rig {
    rig_with(NativePorts::unavailable("tests")).await
}

async fn rig_with(native: NativePorts) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(dir.path());
    let store = Arc::new(SqliteStore::open(&layout.db_path()).unwrap().with_layout(layout.clone()));
    let events = Arc::new(Events::default());
    let secrets = Arc::new(InMemorySecretStore::default());
    let core = AppCore::start(CoreDeps {
        layout: layout.clone(),
        clock: Arc::new(SystemClock),
        store,
        secrets: secrets.clone(),
        factory: Some(Arc::new(EchoFactory)),
        native,
        emitter: events.clone(),
        supervisor_config: SupervisorConfig { tick: Duration::from_millis(30), stop_drain: Duration::from_millis(200) },
    })
    .await
    .unwrap();
    Rig { _dir: dir, layout, core, events, secrets }
}

async fn meeting(core: &AppCore, n: u128) -> MeetingId {
    let id = MeetingId::from_u128(n);
    core.store
        .create_meeting(NewMeeting {
            id,
            title: "Daily".into(),
            platform: Platform::Teams,
            app_bundle_id: None,
            started_at: UnixMs(1_700_000_000_000),
            language: "es".into(),
        })
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn api_keys_go_to_the_secret_store_never_to_settings() {
    let r = rig().await;
    let sref = r.core.secret_set("openrouter".into(), "  sk-123 ".into()).await.unwrap();
    assert_eq!((sref.service.as_str(), sref.account.as_str()), ("acta", "provider:openrouter"));
    assert_eq!(r.secrets.get(&sref).unwrap().as_deref(), Some("sk-123"));
    assert!(!serde_json::to_string(&r.core.settings_get().await.unwrap()).unwrap().contains("sk-123"));
    r.core.secret_delete("openrouter".into()).await.unwrap();
    assert_eq!(r.secrets.get(&sref).unwrap(), None);
    assert!(matches!(r.core.secret_set("x".into(), " ".into()).await, Err(PortError::InvalidInput(_))));
}

#[tokio::test]
async fn settings_update_persists_and_is_used() {
    let r = rig().await;
    let mut s = r.core.settings_get().await.unwrap();
    s.detection.denylist = vec!["com.example.dictation".into()];
    if let ProviderKind::ClaudeCli { effort, extra_env, .. } = &mut s.llm.providers[0].kind {
        *effort = Some("high".into());
        extra_env.insert("CLAUDE_CONFIG_DIR".into(), "/Users/e/.claude-personal".into());
    }
    r.core.settings_update(s.clone()).await.unwrap();
    use acta_core::library::SettingsStore;
    assert_eq!(r.core.store.load_settings().await.unwrap(), s);
    assert_eq!(r.core.settings_get().await.unwrap(), s);
}

#[tokio::test]
async fn deleting_a_meeting_removes_rows_and_folder() {
    let r = rig().await;
    let id = meeting(&r.core, 1).await;
    let dir = r.layout.meeting_dir(id);
    std::fs::create_dir_all(dir.join("audio")).unwrap();
    std::fs::write(dir.join("audio/mix.wav"), b"x").unwrap();
    r.core.meeting_delete(id).await.unwrap();
    assert!(!dir.exists());
    assert!(matches!(r.core.meeting_get(id).await, Err(PortError::NotFound(_))));
}

#[tokio::test]
async fn deleting_a_capture_removes_its_file() {
    let r = rig().await;
    let id = meeting(&r.core, 2).await;
    let rel = "captures/000001000-manual.jpg";
    std::fs::create_dir_all(r.layout.captures_dir(id)).unwrap();
    std::fs::write(r.layout.meeting_dir(id).join(rel), b"jpg").unwrap();
    let cid = CaptureId::from_u128(9);
    r.core
        .store
        .add_capture(Capture {
            id: cid,
            meeting_id: id,
            at: MediaMs(1_000),
            at_wall: UnixMs(1),
            path: rel.into(),
            reason: CaptureReason::Manual,
            phash: "0".repeat(16),
            width: 1,
            height: 1,
            keyword: None,
            topic_path: None,
            action_item_ids: vec![],
        })
        .await
        .unwrap();
    r.core.capture_delete(cid).await.unwrap();
    assert!(!r.layout.meeting_dir(id).join(rel).exists());
    assert!(r.core.store.list_captures(id).await.unwrap().is_empty());
}

#[tokio::test]
async fn renaming_a_meeting_announces_it() {
    let r = rig().await;
    let id = meeting(&r.core, 3).await;
    let m = r.core.meeting_update(id, "  Retro  ".into()).await.unwrap();
    assert_eq!(m.title, "Retro");
    assert!(r.events.0.lock().unwrap().iter().any(|(n, p)| n == "meeting:updated" && p["title"] == "Retro"));
    assert!(matches!(r.core.meeting_update(id, " ".into()).await, Err(PortError::InvalidInput(_))));
}

#[tokio::test]
async fn chat_streams_deltas_and_saves_both_messages() {
    let r = rig().await;
    let id = meeting(&r.core, 4).await;
    let thread = r.core.chat_thread_create(ChatScope::Meeting { meeting_id: id }).await.unwrap();
    assert_eq!(thread.title, "Daily");
    let res = r.core.chat_send(thread.id, "¿Qué se decidió?".into()).await.unwrap();
    for _ in 0..100 {
        if r.core.chat_messages_list(thread.id).await.unwrap().len() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let msgs = r.core.chat_messages_list(thread.id).await.unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[1].id, res.assistant_message_id);
    assert!(msgs[1].content.contains("el plan"));
    let deltas: Vec<_> = r.events.0.lock().unwrap().iter().filter(|(n, _)| n == "chat:delta").cloned().collect();
    assert!(deltas.last().is_some_and(|(_, p)| p["done"] == true));
}

#[tokio::test]
async fn provider_test_and_unknown_provider() {
    let r = rig().await;
    let ok = r.core.llm_provider_test("claude-cli".into()).await.unwrap();
    assert!(ok.ok, "{}", ok.message);
    assert!(matches!(r.core.llm_provider_test("nope".into()).await, Err(PortError::NotFound(_))));
}

#[tokio::test]
async fn cli_detection_reads_alias_env_from_an_interactive_shell() {
    let mut r = rig().await;
    let dir = tempfile::tempdir().unwrap();
    let shell = dir.path().join("zsh");
    std::fs::write(
        &shell,
        "#!/bin/sh\nif [ \"$1\" = \"-ic\" ]; then case \"$2\" in *claude*) echo \"alias claude='CLAUDE_CONFIG_DIR=\\\"\\$HOME/.claude-personal\\\" /opt/homebrew/bin/claude'\";; *) exit 1;; esac; else exit 1; fi\n",
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    r.core.shell = shell;
    r.core.home = "/Users/edu".into();
    let d = r.core.llm_cli_detect().await.unwrap();
    assert_eq!(d.claude.as_deref(), Some("/opt/homebrew/bin/claude"));
    assert_eq!(d.claude_env.get("CLAUDE_CONFIG_DIR").map(String::as_str), Some("/Users/edu/.claude-personal"));
    assert_eq!(d.codex, None);
}

#[tokio::test]
async fn without_the_sidecar_recording_fails_cleanly_and_library_still_works() {
    let r = rig().await;
    let snap = r.core.session_start(None).await.unwrap();
    // El audio no arranca → se para con error y se intenta procesar lo que haya.
    assert!(!matches!(snap.state, SessionState::Recording(_)), "{:?}", snap.state);
    let mut failed = false;
    for _ in 0..200 {
        if matches!(r.core.session_get_state().await.unwrap().state, SessionState::Failed { .. }) {
            failed = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(failed, "acaba en failed");
    let page = r.core.meetings_list(MeetingQuery::default()).await.unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].status, MeetingStatus::Failed);
    assert!(matches!(r.core.models_status().await, Err(PortError::Unavailable(_))));
    assert!(matches!(r.core.models_download("bogus".into()).await, Err(PortError::InvalidInput(_))));
    assert!(r.core.app_info().data_dir.ends_with(r.layout.root().file_name().unwrap().to_str().unwrap()));
}

#[tokio::test]
async fn audio_inputs_need_the_sidecar_and_serialize_in_camel_case() {
    let r = rig().await;
    assert!(matches!(r.core.audio_inputs_list().await, Err(PortError::Unavailable(_))));
    let dto = acta_core::api::AudioInput { uid: "u".into(), name: "Logitech StreamCam".into(), is_default: false, transport: "usb".into() };
    assert_eq!(serde_json::to_value(&dto).unwrap(), serde_json::json!({"uid":"u","name":"Logitech StreamCam","isDefault":false,"transport":"usb"}));
    assert_eq!(acta_core::api::command_names::AUDIO_INPUTS_LIST, "audio_inputs_list");
}

// ---------------------------------------------------------------------------
// Permisos antes de grabar
// ---------------------------------------------------------------------------

use acta_core::permissions::{PermissionKind, PermissionState, PermissionStatus, PermissionsProbe};

/// TCC de mentira: estado inicial por permiso y qué contesta el usuario al diálogo.
struct FakeTcc {
    status: Vec<(PermissionKind, PermissionStatus)>,
    answer: PermissionStatus,
    requested: Mutex<Vec<PermissionKind>>,
}
#[async_trait]
impl PermissionsProbe for FakeTcc {
    async fn status(&self) -> PortResult<Vec<PermissionState>> {
        Ok(self.status.iter().map(|(kind, status)| PermissionState { kind: *kind, status: *status, target: None }).collect())
    }
    async fn request(&self, kind: PermissionKind) -> PortResult<PermissionStatus> {
        self.requested.lock().unwrap().push(kind);
        Ok(self.answer)
    }
}

async fn rig_with_tcc(status: Vec<(PermissionKind, PermissionStatus)>, answer: PermissionStatus) -> (Rig, Arc<FakeTcc>) {
    let tcc = Arc::new(FakeTcc { status, answer, requested: Mutex::default() });
    let mut native = NativePorts::unavailable("tests");
    native.permissions = tcc.clone();
    (rig_with(native).await, tcc)
}

/// Tras reinstalar, macOS vuelve a preguntar por el micro. La captura se
/// quedaba bloqueada en ese diálogo con la pastilla en «Grabando 00:00» y la
/// reunión acababa vacía: hay que preguntar ANTES de empezar la sesión.
#[tokio::test]
async fn recording_asks_for_undetermined_permissions_before_starting() {
    use PermissionKind::*;
    let (r, tcc) = rig_with_tcc(
        vec![(Microphone, PermissionStatus::NotDetermined), (SystemAudio, PermissionStatus::NotDetermined)],
        PermissionStatus::Denied,
    )
    .await;
    let err = r.core.session_start(None).await.unwrap_err();
    assert!(matches!(&err, PortError::PermissionDenied(m) if m.contains("Micrófono")), "{err:?}");
    assert_eq!(tcc.requested.lock().unwrap().clone(), vec![Microphone]);
    assert_eq!(r.core.session_get_state().await.unwrap().state, SessionState::Idle, "no se llega a empezar");
    assert!(r.core.meetings_list(MeetingQuery::default()).await.unwrap().items.is_empty());
}

#[tokio::test]
async fn granted_dialogs_let_the_recording_start() {
    use PermissionKind::*;
    let (r, tcc) = rig_with_tcc(
        vec![(Microphone, PermissionStatus::NotDetermined), (SystemAudio, PermissionStatus::NotDetermined)],
        PermissionStatus::Granted,
    )
    .await;
    // El audio es "no disponible" en este banco: basta con ver que se pasó de los permisos.
    let _ = r.core.session_start(None).await;
    assert_eq!(tcc.requested.lock().unwrap().clone(), vec![Microphone, SystemAudio]);
    assert_eq!(r.core.meetings_list(MeetingQuery::default()).await.unwrap().items.len(), 1);
}

#[tokio::test]
async fn a_denied_permission_fails_fast_and_granted_ones_never_prompt() {
    use PermissionKind::*;
    let (r, tcc) =
        rig_with_tcc(vec![(Microphone, PermissionStatus::Granted), (SystemAudio, PermissionStatus::Denied)], PermissionStatus::Granted).await;
    let err = r.core.session_start(None).await.unwrap_err();
    assert!(matches!(&err, PortError::PermissionDenied(m) if m.contains("Audio del sistema")), "{err:?}");
    assert!(tcc.requested.lock().unwrap().is_empty());

    let (r, tcc) =
        rig_with_tcc(vec![(Microphone, PermissionStatus::Granted), (SystemAudio, PermissionStatus::Unknown)], PermissionStatus::Denied).await;
    let _ = r.core.session_start(None).await;
    assert!(tcc.requested.lock().unwrap().is_empty());
    assert_eq!(r.core.meetings_list(MeetingQuery::default()).await.unwrap().items.len(), 1);
}

/// Los comandos de la pantalla de proveedores también están en el contrato.
#[test]
fn provider_ui_commands_are_in_the_contract() {
    use acta_core::api::command_names as c;
    assert_eq!(c::LLM_LIST_MODELS, "llm_list_models");
    assert_eq!(c::LLM_DETECT_LOCAL, "llm_detect_local");
    assert_eq!(c::OPEN_EXTERNAL_URL, "open_external_url");
}
