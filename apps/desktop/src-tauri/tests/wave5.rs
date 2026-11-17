#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Ola 5 en `AppCore`: proveedor/modelo por mensaje en el chat, perfil del
//! sistema, apps instaladas y una instalación nueva (sin nombre ni proveedores).

mod support;

use acta_audio::supervisor::SupervisorConfig;
use acta_core::api::InstalledApp;
use acta_core::chat::ChatScope;
use acta_core::detection::Platform;
use acta_core::ids::*;
use acta_core::layout::DataLayout;
use acta_core::library::*;
use acta_core::llm::*;
use acta_core::processing::ProcessingStep;
use acta_core::recording::Track;
use acta_core::settings::Settings;
use acta_core::time::{MediaMs, SystemClock, UnixMs};
use acta_core::transcription::{NameSource, Speaker, Transcript, Utterance};
use acta_core::{EventStream, PortError, PortResult};
use acta_desktop_lib::app::{AppCore, CoreDeps, Emit};
use acta_desktop_lib::native::NativePorts;
use acta_store::SqliteStore;
use acta_store::secrets::InMemorySecretStore;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use support::FakeSystem;

#[derive(Default)]
struct Events(Mutex<Vec<(String, serde_json::Value)>>);
impl Emit for Events {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        self.0.lock().unwrap().push((event.to_owned(), payload));
    }
}

/// Contesta con el system prompt que recibió (para ver idioma y nombre).
struct Fake {
    id: ProviderId,
    model: Option<String>,
}
#[async_trait]
impl LlmProvider for Fake {
    fn id(&self) -> &ProviderId {
        &self.id
    }
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities { streaming: true, native_json_schema: true, context_tokens: 100_000 }
    }
    async fn complete(&self, r: LlmRequest) -> PortResult<LlmResponse> {
        Ok(LlmResponse { text: format!("SYS<{}>", r.system.unwrap_or_default()), json: None, model: self.model.clone(), usage: Usage::default() })
    }
    async fn stream(&self, r: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
        let text = self.complete(r).await?.text;
        Ok(Box::pin(futures::stream::iter(vec![Ok(text)])))
    }
}

/// Apunta cada proveedor que construye (id y modelo).
#[derive(Default)]
struct Factory {
    built: Mutex<Vec<(String, Option<String>)>>,
}
impl LlmProviderFactory for Factory {
    fn build(&self, config: &ProviderConfig) -> PortResult<Arc<dyn LlmProvider>> {
        let model = match &config.kind {
            ProviderKind::OpenAiCompatible { model, .. } => Some(model.clone()),
            ProviderKind::ClaudeCli { model, .. } => model.clone(),
            _ => None,
        };
        self.built.lock().unwrap().push((config.id.0.clone(), model.clone()));
        Ok(Arc::new(Fake { id: config.id.clone(), model }))
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    layout: DataLayout,
    core: AppCore,
    factory: Arc<Factory>,
}

/// `settings: None` = instalación nueva (los ajustes de fábrica, sin tocar).
async fn rig_with(settings: Option<Settings>, native: NativePorts, embedder: Option<Arc<dyn Embedder>>) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(dir.path());
    let mut store = SqliteStore::open(&layout.db_path()).unwrap().with_layout(layout.clone());
    if let Some(e) = embedder {
        store = store.with_embedder(e);
    }
    let factory = Arc::new(Factory::default());
    let core = AppCore::start(CoreDeps {
        layout: layout.clone(),
        clock: Arc::new(SystemClock),
        store: Arc::new(store),
        secrets: Arc::new(InMemorySecretStore::default()),
        factory: Some(factory.clone()),
        local_llm: None,
        native,
        emitter: Arc::new(Events::default()),
        supervisor_config: SupervisorConfig { tick: Duration::from_millis(30), stop_drain: Duration::from_millis(200) },
    })
    .await
    .unwrap();
    if let Some(s) = settings {
        core.settings_update(s).await.unwrap();
    }
    Rig { _dir: dir, layout, core, factory }
}

/// Configurada: `claude-cli` para todo, «rapido» activado y «apagado» desactivado.
async fn configured() -> Rig {
    let mut s = support::configured_settings();
    s.llm.providers.push(support::openai_compatible("rapido", "Rápido", "modelo-a", true));
    s.llm.providers.push(support::openai_compatible("apagado", "Apagado", "modelo-z", false));
    rig_with(Some(s), NativePorts::unavailable("tests"), None).await
}

async fn fresh_install() -> Rig {
    rig_with(None, NativePorts::unavailable("tests"), None).await
}

async fn meeting_with_transcript(core: &AppCore, n: u128) -> MeetingId {
    let id = MeetingId::from_u128(n);
    core.store
        .create_meeting(NewMeeting { id, title: "Daily".into(), platform: Platform::Teams, app_bundle_id: None, started_at: UnixMs(1_794_905_145_738 + n as i64), language: "es".into() })
        .await
        .unwrap();
    let me = SpeakerId::from_u128(n * 10);
    let speaker = Speaker { id: me, meeting_id: id, label: "Yo".into(), display_name: None, is_me: true, track: Track::Mic, diarization_label: None, name_source: NameSource::Me, confirmed: false, voiceprint_id: None };
    let utt = |idx: u32, start: u64, text: &str| Utterance { idx, speaker_id: me, track: Track::Mic, start: MediaMs(start), end: MediaMs(start + 2_000), text: text.into(), confidence: None };
    core.store
        .save_transcript(Transcript {
            meeting_id: id,
            speakers: vec![speaker],
            utterances: vec![
                utt(0, 1_000, "José, ¿cómo está el tema de las subcuentas? ¿Tiramos para adelante con el plan de siempre?"),
                utt(1, 5_000, "Ayer arreglé el borrado de la LOPD para una persona, en la próxima reunión lo vemos con calma."),
            ],
        })
        .await
        .unwrap();
    id
}

/// Espera la respuesta guardada del chat (el segundo mensaje nuevo del hilo).
async fn answer(core: &AppCore, thread: ChatThreadId, id: ChatMessageId) -> acta_core::chat::ChatMessage {
    let start = Instant::now();
    loop {
        if let Some(m) = core.chat_messages_list(thread).await.unwrap().into_iter().find(|m| m.id == id) {
            return m;
        }
        assert!(start.elapsed() < Duration::from_secs(5), "la respuesta del chat no se guardó");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

// ---------------------------------------------------------------------------
// A. chat_send con proveedor/modelo por mensaje
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_chat_message_can_pick_its_own_provider_and_model() {
    let r = configured().await;
    let id = meeting_with_transcript(&r.core, 1).await;
    let thread = r.core.chat_thread_create(ChatScope::Meeting { meeting_id: id }).await.unwrap();
    let before = r.core.settings_get().await.unwrap();

    // Sin elegir nada: el proveedor del chat de Ajustes.
    let res = r.core.chat_send(thread.id, "¿Qué se decidió?".into(), None, None).await.unwrap();
    let msg = answer(&r.core, thread.id, res.assistant_message_id).await;
    assert_eq!(msg.provider, Some("claude-cli".into()));
    assert_eq!(r.factory.built.lock().unwrap().last().cloned(), Some(("claude-cli".into(), None)));

    // Con proveedor y modelo: solo para esta respuesta.
    let res = r.core.chat_send(thread.id, "¿Y la LOPD?".into(), Some("rapido".into()), Some("modelo-b".into())).await.unwrap();
    let msg = answer(&r.core, thread.id, res.assistant_message_id).await;
    assert_eq!(msg.provider, Some("rapido".into()), "se guarda el proveedor que contestó de verdad");
    assert_eq!(r.factory.built.lock().unwrap().last().cloned(), Some(("rapido".into(), Some("modelo-b".into()))));

    // Solo proveedor (modelo vacío): su modelo configurado.
    let res = r.core.chat_send(thread.id, "¿Algo más?".into(), Some("rapido".into()), Some("  ".into())).await.unwrap();
    answer(&r.core, thread.id, res.assistant_message_id).await;
    assert_eq!(r.factory.built.lock().unwrap().last().cloned(), Some(("rapido".into(), Some("modelo-a".into()))));

    assert_eq!(r.core.settings_get().await.unwrap(), before, "los ajustes no cambian");
    use acta_core::library::SettingsStore;
    assert_eq!(r.core.store.load_settings().await.unwrap(), before, "ni lo guardado");
}

#[tokio::test]
async fn a_chat_message_with_an_unknown_or_disabled_provider_fails_clearly() {
    let r = configured().await;
    let id = meeting_with_transcript(&r.core, 1).await;
    let thread = r.core.chat_thread_create(ChatScope::Meeting { meeting_id: id }).await.unwrap();

    let err = r.core.chat_send(thread.id, "¿Qué?".into(), Some("nadie".into()), None).await.unwrap_err();
    assert!(matches!(&err, PortError::NotFound(m) if m == "No existe el proveedor «nadie»."), "{err:?}");
    let err = r.core.chat_send(thread.id, "¿Qué?".into(), Some("apagado".into()), None).await.unwrap_err();
    assert!(matches!(&err, PortError::Unavailable(m) if m.contains("«Apagado» está desactivado") && m.contains("Ajustes")), "{err:?}");
    assert!(r.core.chat_messages_list(thread.id).await.unwrap().is_empty(), "una pregunta que no se puede contestar no se guarda");
    assert!(r.factory.built.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_chat_answers_in_the_meeting_language_of_the_settings() {
    let r = configured().await;
    let id = meeting_with_transcript(&r.core, 1).await;
    let thread = r.core.chat_thread_create(ChatScope::Meeting { meeting_id: id }).await.unwrap();
    let res = r.core.chat_send(thread.id, "¿Qué se decidió?".into(), None, None).await.unwrap();
    let msg = answer(&r.core, thread.id, res.assistant_message_id).await;
    assert!(msg.content.contains("de Ana") && msg.content.contains("castellano de España"), "{}", msg.content);

    let mut s = r.core.settings_get().await.unwrap();
    s.transcription.language = "en".into();
    r.core.settings_update(s).await.unwrap();
    let res = r.core.chat_send(thread.id, "What was decided?".into(), None, None).await.unwrap();
    let msg = answer(&r.core, thread.id, res.assistant_message_id).await;
    assert!(msg.content.contains("Respondes en inglés"), "{}", msg.content);
}

// ---------------------------------------------------------------------------
// B. Instalación nueva: sin nombre ni proveedores
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_fresh_install_has_no_name_no_providers_and_explains_what_is_missing() {
    let r = fresh_install().await;
    let s = r.core.settings_get().await.unwrap();
    assert!(s.user.display_name.is_empty() && s.llm.providers.is_empty() && s.transcription.language == "auto");
    assert!(r.core.llm_providers_available().await.unwrap().is_empty());

    let id = meeting_with_transcript(&r.core, 1).await;
    let thread = r.core.chat_thread_create(ChatScope::Meeting { meeting_id: id }).await.unwrap();
    let err = r.core.chat_send(thread.id, "¿Qué se decidió?".into(), None, None).await.unwrap_err();
    assert!(matches!(&err, PortError::Unavailable(m) if m.contains("No hay ningún proveedor") && m.contains("Ajustes")), "{err:?}");

    // Resumir sin proveedor: la reunión falla con el motivo y conserva el transcript.
    r.core.meeting_retry(id, Some(vec![ProcessingStep::Summarizing]), None, None).await.unwrap();
    let start = Instant::now();
    let m = loop {
        let m = r.core.meeting_get(id).await.unwrap().meeting;
        if m.status == MeetingStatus::Failed {
            break m;
        }
        assert!(start.elapsed() < Duration::from_secs(20), "no terminó: {:?}", m.status);
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    let error = m.error.unwrap_or_default();
    assert!(error.contains("Resumen") && error.contains("No hay ningún proveedor"), "{error}");
    assert_eq!(r.core.meeting_get(id).await.unwrap().transcript.utterances.len(), 2);

    // Grupos: sin proveedor no hay nombre automático, pero se dice por qué.
    let g = r.core.group_create("".into(), None).await.unwrap();
    r.core.group_add_meeting(g.id, id).await.unwrap();
    let err = r.core.groups_suggest_title(g.id).await.unwrap_err();
    assert!(matches!(&err, PortError::Unavailable(m) if m.contains("No hay ningún proveedor")), "{err:?}");
    assert!(r.core.group_suggestions_refresh().await.unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// C. system_profile
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_system_profile_proposes_the_account_name_and_a_meeting_language() {
    let mut native = NativePorts::unavailable("tests");
    native.system = Arc::new(FakeSystem { full_name: Some("Ana García".into()), languages: vec!["ca-ES".into(), "es-ES".into(), "en-GB".into()], ..Default::default() });
    let r = rig_with(None, native, None).await;
    let p = r.core.system_profile().await.unwrap();
    assert_eq!(
        serde_json::to_value(&p).unwrap(),
        serde_json::json!({"fullName": "Ana García", "preferredLanguages": ["ca-ES", "es-ES", "en-GB"], "meetingLanguage": "es"})
    );
    assert_eq!(r.core.settings_get().await.unwrap().user.display_name, "", "solo se propone: no se aplica");
}

#[tokio::test]
async fn the_system_profile_never_fails() {
    // Sin componente nativo.
    let r = fresh_install().await;
    let p = r.core.system_profile().await.unwrap();
    assert_eq!(serde_json::to_value(&p).unwrap(), serde_json::json!({"fullName": null, "preferredLanguages": [], "meetingLanguage": "auto"}));
    // Con el componente nativo fallando.
    let mut native = NativePorts::unavailable("tests");
    native.system = Arc::new(FakeSystem { fail: true, ..Default::default() });
    let r = rig_with(None, native, None).await;
    assert_eq!(r.core.system_profile().await.unwrap().meeting_language, "auto");
}

// ---------------------------------------------------------------------------
// D. apps_list
// ---------------------------------------------------------------------------

fn app(bundle_id: &str, name: &str, running: bool, icon: Option<&str>) -> InstalledApp {
    InstalledApp { bundle_id: bundle_id.into(), name: name.into(), path: format!("/Applications/{name}.app"), running, icon_path: icon.map(str::to_owned) }
}

#[tokio::test]
async fn installed_apps_come_sorted_without_repeats_and_with_icons_in_the_data_dir() {
    let system = Arc::new(FakeSystem {
        apps: vec![app("com.z", "zoom.us", false, None), app("com.s", "Safari", true, Some("/x/com.s.png")), app("com.a", "arc", false, None), app("com.s", "Safari", false, None)],
        ..Default::default()
    });
    let mut native = NativePorts::unavailable("tests");
    native.system = system.clone();
    let r = rig_with(None, native, None).await;
    let apps = r.core.apps_list().await.unwrap();
    assert_eq!(apps.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["arc", "Safari", "zoom.us"]);
    assert!(apps[1].running && apps[1].icon_path.is_some());
    let icons = r.layout.app_icons_dir();
    assert_eq!(system.icon_dirs.lock().unwrap().clone(), vec![icons.clone()]);
    assert!(icons.is_dir(), "la carpeta de iconos se crea antes de pedirlos");
    assert!(icons.starts_with(r.layout.root()), "dentro de la carpeta de datos (scope del asset protocol)");
}

#[tokio::test]
async fn installed_apps_need_the_native_component_and_say_so() {
    let r = fresh_install().await;
    let err = r.core.apps_list().await.unwrap_err();
    assert!(matches!(&err, PortError::Unavailable(m) if m.contains("componente nativo")), "{err:?}");
}

/// Los iconos se cargan por el asset protocol: su carpeta tiene que estar en el scope.
#[test]
fn the_asset_protocol_scope_covers_the_icon_cache() {
    let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let scope = conf["app"]["security"]["assetProtocol"]["scope"].as_array().unwrap();
    assert!(scope.iter().any(|s| s == "$HOME/Library/Application Support/acta/**"), "{scope:?}");
    let icons = DataLayout::new("/Users/x/Library/Application Support/acta").app_icons_dir();
    assert!(icons.starts_with("/Users/x/Library/Application Support/acta"));
}

// ---------------------------------------------------------------------------
// F. Sugerencias de grupos: un fallo de verdad no es «no hay sugerencias»
// ---------------------------------------------------------------------------

/// Modelo de búsqueda que no se pudo cargar (p. ej. sin conexión la primera vez).
struct BrokenEmbedder;
#[async_trait]
impl Embedder for BrokenEmbedder {
    fn model_id(&self) -> &str {
        "roto"
    }
    fn dims(&self) -> usize {
        384
    }
    async fn embed(&self, _texts: Vec<String>, _kind: EmbedKind) -> PortResult<Vec<Vec<f32>>> {
        Err(PortError::Unavailable("sin conexión".into()))
    }
}

#[tokio::test]
async fn suggestions_that_cannot_be_computed_are_an_error_not_an_empty_list() {
    let r = rig_with(Some(support::configured_settings()), NativePorts::unavailable("tests"), Some(Arc::new(BrokenEmbedder))).await;
    // Sin reuniones no hay nada que falle: lista vacía.
    assert!(r.core.group_suggestions_refresh().await.unwrap().is_empty());
    for n in 1..=3 {
        let id = meeting_with_transcript(&r.core, n).await;
        r.core.store.index_meeting(id).await.unwrap();
    }
    let err = r.core.group_suggestions_refresh().await.unwrap_err();
    assert!(matches!(&err, PortError::Unavailable(m) if m.contains("3 reuniones") && m.contains("grupos")), "{err:?}");
}
