//! Icono en la barra de menús. El menú refleja el estado de la sesión: en
//! reposo solo «Grabar ahora», grabando solo pausar/parar con el tiempo, etc.

use crate::commands::{Core, show_main};
use acta_core::api::SessionSnapshot;
use acta_core::recording::{PromptAnswer, SessionState};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

const TRAY_ID: &str = "acta";

/// Una entrada del menú que depende de la sesión.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayItem {
    pub id: &'static str,
    pub label: String,
    pub enabled: bool,
}

fn entry(id: &'static str, label: impl Into<String>, enabled: bool) -> TrayItem {
    TrayItem { id, label: label.into(), enabled }
}

/// mm:ss, o h:mm:ss a partir de la hora (igual que la pastilla).
fn clock(ms: u64) -> String {
    let s = ms / 1000;
    let (h, m, s) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m:02}:{s:02}") }
}

/// Entradas de sesión para un estado. Nunca ofrece a la vez grabar y parar.
pub fn session_items(state: &SessionState, elapsed_ms: u64) -> Vec<TrayItem> {
    let record = || entry("record", "Grabar ahora", true);
    let stop = || entry("stop", "Parar grabación", true);
    match state {
        SessionState::Idle | SessionState::Ready { .. } | SessionState::Failed { .. } => vec![record()],
        SessionState::Detected { app, .. } => vec![
            entry("status", format!("Reunión en {}", app.name), false),
            entry("accept", "Grabar", true),
            entry("decline", "Ignorar", true),
        ],
        SessionState::Recording(_) => {
            vec![entry("status", format!("Grabando · {}", clock(elapsed_ms)), false), entry("pause", "Pausar", true), stop()]
        }
        SessionState::Paused { .. } => {
            vec![entry("status", format!("En pausa · {}", clock(elapsed_ms)), false), entry("resume", "Reanudar", true), stop()]
        }
        SessionState::Stopping { .. } => vec![entry("status", "Parando…", false)],
        SessionState::Recovering { .. } => vec![entry("status", "Recuperando una grabación…", false)],
        // Procesar no bloquea una grabación nueva.
        SessionState::Processing { .. } => vec![entry("status", "Procesando…", false), record()],
    }
}

/// ¿Mismas entradas salvo el texto? Entonces basta con cambiar el texto (el
/// reloj corre cada segundo y rehacer el menú lo cerraría si está abierto).
pub fn same_shape(a: &[TrayItem], b: &[TrayItem]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.id == y.id && x.enabled == y.enabled)
}

/// Lo que hay ahora mismo en el menú, para actualizarlo sin rehacerlo.
#[derive(Default)]
struct TrayState {
    items: Vec<TrayItem>,
    handles: Vec<MenuItem<tauri::Wry>>,
}

fn build_menu(app: &AppHandle, items: &[TrayItem]) -> tauri::Result<(Menu<tauri::Wry>, Vec<MenuItem<tauri::Wry>>)> {
    let handles = items
        .iter()
        .map(|i| MenuItem::with_id(app, i.id, &i.label, i.enabled, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let menu = Menu::new(app)?;
    for h in &handles {
        menu.append(h)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "open", "Abrir acta", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Salir de acta", true, None::<&str>)?)?;
    Ok((menu, handles))
}

/// Pone el menú al día con el estado de la sesión. Llamar en cada `session:state`.
pub fn update(app: &AppHandle, snapshot: &SessionSnapshot) {
    let Some(state) = app.try_state::<Mutex<TrayState>>() else { return };
    let Ok(mut current) = state.lock() else { return };
    let items = session_items(&snapshot.state, snapshot.elapsed_ms);
    if items == current.items {
        return;
    }
    if same_shape(&items, &current.items) && items.len() == current.handles.len() {
        for ((new, old), handle) in items.iter().zip(&current.items).zip(&current.handles) {
            if new.label != old.label
                && let Err(e) = handle.set_text(&new.label)
            {
                tracing::warn!("texto del menú de la barra: {e}");
            }
        }
        current.items = items;
        return;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    match build_menu(app, &items).and_then(|(menu, handles)| tray.set_menu(Some(menu)).map(|()| handles)) {
        Ok(handles) => {
            current.items = items;
            current.handles = handles;
        }
        Err(e) => tracing::warn!("menú de la barra: {e}"),
    }
}

async fn run_action(app: AppHandle, id: String) {
    let core = app.state::<Core>().inner().clone();
    let result = match id.as_str() {
        "record" => core.session_start(None).await,
        "stop" => core.session_stop().await,
        "pause" => core.session_pause().await,
        "resume" => core.session_resume().await,
        "accept" | "decline" => match core.session_get_state().await {
            Ok(SessionSnapshot { state: SessionState::Detected { prompt, .. }, .. }) => {
                let answer = if id == "accept" { PromptAnswer::Accept } else { PromptAnswer::Decline };
                core.prompt_answer(prompt.id, answer).await
            }
            other => other,
        },
        _ => return,
    };
    if let Err(e) = result {
        tracing::warn!("acción «{id}» de la barra de menús: {e}");
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let items = session_items(&SessionState::Idle, 0);
    let (menu, handles) = build_menu(app, &items)?;
    app.manage(Mutex::new(TrayState { items, handles }));
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("acta")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let _ = show_main(app, None);
            }
            "quit" => app.exit(0),
            id => {
                tauri::async_runtime::spawn(run_action(app.clone(), id.to_owned()));
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).icon_as_template(false);
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use acta_core::detection::{MeetingApp, Platform};
    use acta_core::ids::{MeetingId, PromptId};
    use acta_core::processing::ProcessingStep;
    use acta_core::recording::{ActiveRecording, Prompt, PromptKind, SessionState, StopReason};
    use acta_core::time::UnixMs;

    fn ids(state: &SessionState, elapsed_ms: u64) -> Vec<(&'static str, String, bool)> {
        session_items(state, elapsed_ms).into_iter().map(|i| (i.id, i.label, i.enabled)).collect()
    }
    fn item(id: &'static str, label: &str, enabled: bool) -> (&'static str, String, bool) {
        (id, label.to_owned(), enabled)
    }
    fn recording() -> ActiveRecording {
        ActiveRecording { meeting_id: MeetingId::from_u128(1), app: None, started_at: UnixMs(0), stop_prompt: None }
    }
    fn teams() -> MeetingApp {
        MeetingApp {
            platform: Platform::Teams,
            bundle_id: "com.microsoft.teams2".into(),
            pid: 1,
            audio_pids: vec![],
            name: "Microsoft Teams".into(),
            title: None,
            url: None,
        }
    }

    /// El menú enseñaba «Grabar ahora» y «Parar grabación» a la vez.
    #[test]
    fn at_rest_only_offers_to_record() {
        let rest = vec![item("record", "Grabar ahora", true)];
        assert_eq!(ids(&SessionState::Idle, 0), rest);
        assert_eq!(ids(&SessionState::Ready { meeting_id: MeetingId::from_u128(1) }, 0), rest);
        assert_eq!(ids(&SessionState::Failed { meeting_id: None, error: "x".into() }, 0), rest);
    }

    #[test]
    fn while_recording_offers_pause_and_stop_with_the_elapsed_time() {
        assert_eq!(
            ids(&SessionState::Recording(recording()), 192_000),
            vec![item("status", "Grabando · 03:12", false), item("pause", "Pausar", true), item("stop", "Parar grabación", true)]
        );
        assert_eq!(
            ids(&SessionState::Paused { recording: recording(), paused_at: UnixMs(5) }, 3_725_000),
            vec![item("status", "En pausa · 1:02:05", false), item("resume", "Reanudar", true), item("stop", "Parar grabación", true)]
        );
    }

    #[test]
    fn a_detected_meeting_offers_to_record_or_ignore() {
        let prompt = Prompt { id: PromptId::from_u128(7), kind: PromptKind::StartRecording { app: teams() }, created_at: UnixMs(0) };
        assert_eq!(
            ids(&SessionState::Detected { prompt, app: teams() }, 0),
            vec![item("status", "Reunión en Microsoft Teams", false), item("accept", "Grabar", true), item("decline", "Ignorar", true)]
        );
    }

    #[test]
    fn busy_states_show_a_disabled_status() {
        let id = MeetingId::from_u128(1);
        assert_eq!(ids(&SessionState::Stopping { meeting_id: id, reason: StopReason::User }, 0), vec![item("status", "Parando…", false)]);
        assert_eq!(ids(&SessionState::Recovering { meeting_id: id }, 0), vec![item("status", "Recuperando una grabación…", false)]);
        // Procesar no bloquea una grabación nueva (la máquina acepta StartRequested).
        assert_eq!(
            ids(&SessionState::Processing { meeting_id: id, step: ProcessingStep::Transcribing }, 0),
            vec![item("status", "Procesando…", false), item("record", "Grabar ahora", true)]
        );
    }

    #[test]
    fn only_the_clock_changing_keeps_the_same_shape() {
        let a = session_items(&SessionState::Recording(recording()), 1_000);
        let b = session_items(&SessionState::Recording(recording()), 2_000);
        assert_ne!(a, b);
        assert!(same_shape(&a, &b));
        assert!(!same_shape(&a, &session_items(&SessionState::Idle, 0)));
    }
}
