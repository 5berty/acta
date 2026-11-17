#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Ola 4 en `AppCore`: reintento con otro proveedor, proveedores elegibles,
//! búsqueda en el transcript, título de grupos y «Detener» del chat.

use acta_audio::supervisor::SupervisorConfig;
use acta_core::chat::ChatScope;
use acta_core::detection::Platform;
use acta_core::ids::*;
use acta_core::layout::DataLayout;
use acta_core::library::*;
use acta_core::llm::*;
use acta_core::processing::ProcessingStep;
use acta_core::recording::Track;
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

#[derive(Default)]
struct Events(Mutex<Vec<(String, serde_json::Value)>>);
impl Emit for Events {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        self.0.lock().unwrap().push((event.to_owned(), payload));
    }
}
impl Events {
    fn of(&self, name: &str) -> Vec<serde_json::Value> {
        self.0.lock().unwrap().iter().filter(|(n, _)| n == name).map(|(_, p)| p.clone()).collect()
    }
}

const MINUTES_JSON: &str = r#"{"titulo_sugerido":"Daily: subcuentas y LOPD","resumen":"- Se habló de las subcuentas.","decisiones":[],"tareas":[],"escaleta":{"temas":[{"titulo":"Subcuentas","resumen":"Estado","inicio_ms":0,"fin_ms":9000,"subtemas":[],"capturas":[]}]},"momentos_clave":[]}"#;

/// Qué hace el proveedor falso.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    /// Responde al instante (acta válida, nombre de grupo o texto).
    Ok,
    /// Falla siempre con una respuesta sin JSON.
    Garbage,
    /// Tarda 30 s (como un CLI que no termina).
    Hang,
}

struct Fake {
    id: ProviderId,
    model: Option<String>,
    mode: Mode,
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
        let text = match self.mode {
            Mode::Hang => {
                tokio::time::sleep(Duration::from_secs(30)).await;
                "tarde".to_owned()
            }
            Mode::Garbage => "Lo siento, no puedo".to_owned(),
            Mode::Ok if r.system.as_deref().unwrap_or_default().contains("acta.minutes") || r.system.as_deref().unwrap_or_default().contains("secretario") => MINUTES_JSON.to_owned(),
            Mode::Ok if r.system.as_deref().unwrap_or_default().contains("DURANTE una reunión") => "Sí, José preguntó por las subcuentas [00:01].".to_owned(),
            Mode::Ok if r.json_schema.is_some() => r#"{"nombre":"Daily del equipo","descripcion":"Seguimiento diario."}"#.to_owned(),
            Mode::Ok => "ok".to_owned(),
        };
        Ok(LlmResponse { text, json: None, model: self.model.clone(), usage: Usage::default() })
    }
    async fn stream(&self, r: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
        let text = self.complete(r).await?.text;
        Ok(Box::pin(futures::stream::iter(vec![Ok(text)])))
    }
}

/// Apunta cada proveedor que construye (id y modelo).
struct Factory {
    built: Mutex<Vec<(String, Option<String>)>>,
    modes: Mutex<std::collections::HashMap<String, Mode>>,
}
impl LlmProviderFactory for Factory {
    fn build(&self, config: &ProviderConfig) -> PortResult<Arc<dyn LlmProvider>> {
        let model = match &config.kind {
            ProviderKind::OpenAiCompatible { model, .. } => Some(model.clone()),
            ProviderKind::ClaudeCli { model, .. } => model.clone(),
            _ => None,
        };
        self.built.lock().unwrap().push((config.id.0.clone(), model.clone()));
        let mode = *self.modes.lock().unwrap().get(&config.id.0).unwrap_or(&Mode::Ok);
        Ok(Arc::new(Fake { id: config.id.clone(), model, mode }))
    }
}

struct Rig {
    _dir: tempfile::TempDir,
    core: AppCore,
    events: Arc<Events>,
    factory: Arc<Factory>,
}

async fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(dir.path());
    let store = Arc::new(SqliteStore::open(&layout.db_path()).unwrap().with_layout(layout.clone()));
    let events = Arc::new(Events::default());
    let factory = Arc::new(Factory { built: Mutex::default(), modes: Mutex::default() });
    let core = AppCore::start(CoreDeps {
        layout,
        clock: Arc::new(SystemClock),
        store,
        secrets: Arc::new(InMemorySecretStore::default()),
        factory: Some(factory.clone()),
        local_llm: None,
        native: NativePorts::unavailable("tests"),
        emitter: events.clone(),
        supervisor_config: SupervisorConfig { tick: Duration::from_millis(30), stop_drain: Duration::from_millis(200) },
    })
    .await
    .unwrap();
    // NaN Builders activado, además de claude (el de las actas por defecto).
    let mut s = core.settings_get().await.unwrap();
    s.llm.providers.push(ProviderConfig {
        id: "nan".into(),
        label: "NaN Builders".into(),
        enabled: true,
        kind: ProviderKind::OpenAiCompatible { base_url: "http://127.0.0.1:9/v1".into(), model: "deepseek-v4-pro".into(), api_key: None },
        timeout_s: 5,
    });
    s.llm.chat_provider = Some("nan".into());
    core.settings_update(s).await.unwrap();
    Rig { _dir: dir, core, events, factory }
}

async fn meeting_with_transcript(core: &AppCore, n: u128) -> MeetingId {
    let id = MeetingId::from_u128(n);
    core.store
        .create_meeting(NewMeeting { id, title: "Reunión de Teams".into(), platform: Platform::Teams, app_bundle_id: None, started_at: UnixMs(1_794_905_145_738), language: "es".into() })
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
                utt(0, 1_000, "José, ¿cómo está el tema de las subcuentas? ¿Tiramos para adelante?"),
                utt(1, 5_000, "Ayer arreglé el borrado de la LOPD para una persona, en la próxima reunión lo vemos."),
            ],
        })
        .await
        .unwrap();
    core.store.patch_meeting(id, MeetingPatch { status: Some(MeetingStatus::Failed), error: Some(Some("antes".into())), ..Default::default() }).await.unwrap();
    id
}

async fn wait_done(core: &AppCore, id: MeetingId) -> Meeting {
    let start = Instant::now();
    // Primero la cola lo coge (Processing) y luego termina.
    loop {
        let m = core.meeting_get(id).await.unwrap().meeting;
        if m.status == MeetingStatus::Processing || m.error.as_deref() != Some("antes") {
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(10), "la cola no cogió la reunión");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    loop {
        let m = core.meeting_get(id).await.unwrap().meeting;
        if matches!(m.status, MeetingStatus::Ready | MeetingStatus::Failed) {
            return m;
        }
        assert!(start.elapsed() < Duration::from_secs(20), "no terminó: {:?}", m.status);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test]
async fn retry_with_another_provider_and_model_is_one_off() {
    let r = rig().await;
    let id = meeting_with_transcript(&r.core, 1).await;
    r.core
        .meeting_retry(id, Some(vec![ProcessingStep::Summarizing]), Some("nan".into()), Some("qwen3.6".into()))
        .await
        .unwrap();
    let m = wait_done(&r.core, id).await;
    assert_eq!(m.status, MeetingStatus::Ready, "{:?}", m.error);
    assert!(r.factory.built.lock().unwrap().contains(&("nan".into(), Some("qwen3.6".into()))), "{:?}", r.factory.built.lock().unwrap());
    let s = r.core.settings_get().await.unwrap();
    assert_eq!(s.llm.minutes_provider.as_ref().map(|p| p.0.as_str()), Some("claude-cli"), "no cambia el proveedor por defecto");
    let nan = s.llm.providers.iter().find(|p| p.id.0 == "nan").unwrap();
    assert!(matches!(&nan.kind, ProviderKind::OpenAiCompatible { model, .. } if model == "deepseek-v4-pro"), "ni su modelo");
    assert_eq!(r.core.meeting_get(id).await.unwrap().minutes.unwrap().provider.0, "nan");
    assert!(matches!(r.core.meeting_retry(MeetingId::from_u128(99), None, None, None).await, Err(PortError::NotFound(_))));
    assert!(matches!(r.core.meeting_retry(id, None, Some("nadie".into()), None).await, Err(PortError::NotFound(_))));
}

#[tokio::test]
async fn a_failed_summary_names_the_provider_and_model_in_text_and_fields() {
    let r = rig().await;
    r.factory.modes.lock().unwrap().insert("nan".into(), Mode::Garbage);
    let id = meeting_with_transcript(&r.core, 2).await;
    r.core.meeting_retry(id, Some(vec![ProcessingStep::Summarizing]), Some("nan".into()), None).await.unwrap();
    let m = wait_done(&r.core, id).await;
    assert_eq!(m.status, MeetingStatus::Failed);
    let err = m.error.unwrap_or_default();
    assert!(err.contains("proveedor: nan") && err.contains("modelo: deepseek-v4-pro"), "{err}");
    assert_eq!((m.error_provider.as_deref(), m.error_model.as_deref()), (Some("nan"), Some("deepseek-v4-pro")));
    // Un reintento que sale bien limpia el error y los campos.
    r.factory.modes.lock().unwrap().insert("nan".into(), Mode::Ok);
    r.core.store.patch_meeting(id, MeetingPatch { error: Some(Some("antes".into())), ..Default::default() }).await.unwrap();
    r.core.meeting_retry(id, Some(vec![ProcessingStep::Summarizing]), Some("nan".into()), None).await.unwrap();
    let m = wait_done(&r.core, id).await;
    assert_eq!((m.status, m.error_provider), (MeetingStatus::Ready, None));
}

#[tokio::test]
async fn enabled_providers_are_listed_with_models_and_their_default_roles() {
    let r = rig().await;
    let list = r.core.llm_providers_available().await.unwrap();
    let ids: Vec<_> = list.iter().map(|p| p.provider_id.0.as_str()).collect();
    assert_eq!(ids, vec!["claude-cli", "nan"], "codex y ollama están desactivados");
    let claude = &list[0];
    assert!(claude.is_default && claude.default_for.contains(&"minutes".to_string()));
    assert!(claude.models.iter().any(|m| m == "sonnet"));
    let nan = &list[1];
    assert_eq!(nan.kind, "openAiCompatible");
    assert_eq!(nan.default_model.as_deref(), Some("deepseek-v4-pro"));
    assert!(nan.models.contains(&"deepseek-v4-pro".to_string()), "sin red, al menos el configurado");
    assert_eq!(nan.default_for, vec!["chat".to_string()]);
}

#[tokio::test]
async fn transcript_search_ignores_accents_and_marks_the_ranges() {
    let r = rig().await;
    let id = meeting_with_transcript(&r.core, 3).await;
    let hits = r.core.meeting_search_transcript(id, "LOPD".into()).await.unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!((hits[0].utterance_id, hits[0].start_ms), (1, 5_000));
    let hits = r.core.meeting_search_transcript(id, "reunion".into()).await.unwrap();
    let utf16: Vec<u16> = hits[0].snippet.encode_utf16().collect();
    let [a, b] = hits[0].ranges[0];
    assert_eq!(String::from_utf16_lossy(&utf16[a as usize..b as usize]), "reunión");
    assert!(r.core.meeting_search_transcript(MeetingId::from_u128(77), "x".into()).await.is_err());
}

#[tokio::test]
async fn a_group_title_is_suggested_from_its_meetings_without_renaming_it() {
    let r = rig().await;
    let id = meeting_with_transcript(&r.core, 4).await;
    let g = r.core.group_create("test".into(), None).await.unwrap();
    assert!(matches!(r.core.groups_suggest_title(g.id).await, Err(PortError::InvalidInput(_))), "sin reuniones no hay de qué hablar");
    r.core.group_add_meeting(g.id, id).await.unwrap();
    let s = r.core.groups_suggest_title(g.id).await.unwrap();
    assert_eq!(s.name, "Daily del equipo");
    assert_eq!(r.core.groups_list().await.unwrap()[0].name, "test");
}

#[tokio::test]
async fn stopping_a_chat_answer_kills_the_slow_provider_at_once() {
    let r = rig().await;
    r.factory.modes.lock().unwrap().insert("nan".into(), Mode::Hang);
    let id = meeting_with_transcript(&r.core, 5).await;
    let thread = r.core.chat_thread_create(ChatScope::Meeting { meeting_id: id }).await.unwrap();
    let started = Instant::now();
    let res = r.core.chat_send(thread.id, "¿Qué pasa con las subcuentas?".into()).await.unwrap();
    assert!(started.elapsed() < Duration::from_secs(2), "chat_send no espera a la respuesta");
    r.core.chat_cancel(res.assistant_message_id.to_string()).await.unwrap();
    loop {
        if r.events.of("chat:delta").iter().any(|d| d["done"] == true) {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(3), "no llegó el final tras «Detener»");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    // Cancelar algo que ya terminó (o no existe) no es un error.
    r.core.chat_cancel("nada".into()).await.unwrap();
}

fn live_session(core: &AppCore, id: MeetingId) {
    let session = acta_audio::live::LiveSession::new(id);
    {
        let mut tracks = session.tracks.lock().unwrap();
        let seg = |a, b, t: &str| AsrSegment { start_ms: a, end_ms: b, text: t.into(), confidence: None, words: vec![] };
        tracks[1].absorb(0, 10_000, true, vec![seg(1_000, 4_000, "José, ¿cómo están las subcuentas?"), seg(8_500, 9_800, "Y la LOPD")], &acta_audio::live::LiveConfig::default());
    }
    core.live_sessions.lock().unwrap().insert(id, session);
}

use acta_core::transcription::AsrSegment;

#[tokio::test]
async fn the_live_transcript_so_far_comes_from_the_session_or_from_disk() {
    let r = rig().await;
    let id = meeting_with_transcript(&r.core, 6).await;
    assert!(r.core.live_transcript_get(id).await.unwrap().segments.is_empty());
    live_session(&r.core, id);
    let t = r.core.live_transcript_get(id).await.unwrap();
    assert_eq!(t.session_id, id);
    assert_eq!(t.segments.iter().map(|s| (s.id.as_str(), s.is_final, s.speaker.as_str())).collect::<Vec<_>>(), vec![("system-0", true, "otros"), ("system-1", false, "otros")]);
    // Tras reiniciar la app (sin sesión en memoria), lo confirmado sigue en disco.
    r.core.live_sessions.lock().unwrap().clear();
    let state = acta_audio::live::LiveAsrState { covered_ms: 4_000, segments: vec![AsrSegment { start_ms: 1_000, end_ms: 4_000, text: "hola".into(), confidence: None, words: vec![] }] };
    let path = r.core.layout.live_asr_path(id, Track::Mic);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, serde_json::to_vec(&state).unwrap()).unwrap();
    let t = r.core.live_transcript_get(id).await.unwrap();
    assert_eq!(t.segments.len(), 1);
    assert_eq!((t.segments[0].speaker.as_str(), t.segments[0].start_ms), ("yo", 1_000));
    assert!(matches!(r.core.live_transcript_get(MeetingId::from_u128(404)).await, Err(PortError::NotFound(_))));
}

#[tokio::test]
async fn a_live_question_streams_an_answer_with_citations_and_can_be_stopped() {
    let r = rig().await;
    let id = meeting_with_transcript(&r.core, 7).await;
    live_session(&r.core, id);
    let request_id = r.core.live_ask(id, "¿Han hablado de subcuentas?".into(), None, None).await.unwrap();
    let start = Instant::now();
    let answers = loop {
        let a: Vec<_> = r.events.of("live:answer").into_iter().filter(|a| a["requestId"] == request_id.as_str()).collect();
        if a.iter().any(|x| x["done"] == true) {
            break a;
        }
        assert!(start.elapsed() < Duration::from_secs(5), "sin respuesta");
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    let text: String = answers.iter().filter_map(|a| a["delta"].as_str()).collect();
    assert!(text.contains("subcuentas"), "{text}");
    assert_eq!(answers.last().unwrap()["citations"], serde_json::json!([{"startMs": 1000}]));
    assert!(r.factory.built.lock().unwrap().iter().any(|(p, _)| p == "nan"), "sin proveedor: el del chat");
    assert!(matches!(r.core.live_ask(id, "  ".into(), None, None).await, Err(PortError::InvalidInput(_))));

    // «Detener» con un proveedor que no termina.
    r.factory.modes.lock().unwrap().insert("claude-cli".into(), Mode::Hang);
    let rid = r.core.live_ask(id, "¿Y la LOPD?".into(), Some("claude-cli".into()), Some("haiku".into())).await.unwrap();
    assert!(r.factory.built.lock().unwrap().contains(&("claude-cli".into(), Some("haiku".into()))));
    r.core.chat_cancel(rid.clone()).await.unwrap();
    let start = Instant::now();
    while !r.events.of("live:answer").iter().any(|a| a["requestId"] == rid.as_str() && a["done"] == true) {
        assert!(start.elapsed() < Duration::from_secs(3), "«Detener» no cortó la respuesta");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Al empezar a grabar se cargan ASR y diarizador (solo los descargados):
/// la primera carga en frío cuesta ≈25 s y no debe caer en el procesado.
#[tokio::test]
async fn warming_loads_only_the_downloaded_speech_models() {
    use acta_core::api::{ModelDownload, ModelStatus};
    use acta_desktop_lib::native::ModelManager;
    #[derive(Default)]
    struct Models(Mutex<Vec<String>>);
    #[async_trait]
    impl ModelManager for Models {
        async fn status(&self) -> PortResult<Vec<ModelStatus>> {
            Ok(vec![
                ModelStatus { name: "asr".into(), downloaded: true, bytes: None },
                ModelStatus { name: "diarizer".into(), downloaded: false, bytes: None },
                ModelStatus { name: "vad".into(), downloaded: true, bytes: None },
            ])
        }
        async fn download(&self, name: &str) -> PortResult<EventStream<ModelDownload>> {
            self.0.lock().unwrap().push(name.to_owned());
            Ok(Box::pin(futures::stream::iter(vec![ModelDownload { name: name.into(), fraction: 1.0, done: true, error: None }])))
        }
    }
    let r = rig().await;
    let models = Arc::new(Models::default());
    let mut core = r.core;
    core.native.models = models.clone();
    core.warm_models().await;
    assert_eq!(*models.0.lock().unwrap(), vec!["asr".to_string()]);
}
