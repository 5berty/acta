use crate::time::UnixMs;
use serde::{Deserialize, Serialize};

/// Plataforma de reunión reconocida.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Platform {
    Teams,
    Meet,
    Zoom,
    Slack,
    /// Grabación manual o app no reconocida.
    Other,
}

/// La app concreta donde ocurre la reunión.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingApp {
    pub platform: Platform,
    /// p. ej. `com.microsoft.teams2`, `com.google.Chrome`.
    pub bundle_id: String,
    /// Proceso principal. Puede haber más PIDs de audio (helpers) en `audio_pids`.
    pub pid: i32,
    /// PIDs cuyo audio hay que capturar con el process tap (incluye `pid`).
    pub audio_pids: Vec<i32>,
    pub name: String,
    /// Título de la ventana de reunión (Teams) o de la pestaña (Meet).
    pub title: Option<String>,
    /// Solo navegador: URL de la reunión (p. ej. `https://meet.google.com/abc-defg-hij`).
    pub url: Option<String>,
}

/// Confianza de la detección. `High` = varias señales coinciden
/// (mic en uso + ventana de reunión); `Low` = solo mic en uso en una app
/// de la lista blanca.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Confidence {
    Low,
    Medium,
    High,
}

/// Evento de dominio ya fusionado y con antirrebote.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DetectionEvent {
    /// Empieza una reunión. Se emite UNA vez por reunión.
    MeetingStarted {
        app: MeetingApp,
        confidence: Confidence,
        at: UnixMs,
    },
    /// La reunión ha terminado (mic liberado + ventana cerrada, o pestaña cerrada).
    MeetingEnded { app: MeetingApp, at: UnixMs },
    /// Cambian los PIDs de audio de la app (Teams lanza helpers nuevos).
    AudioPidsChanged { app: MeetingApp, at: UnixMs },
}

/// Regla de lista blanca: qué apps cuentan como reunión.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRule {
    pub bundle_id: String,
    pub platform: Platform,
    /// Si es navegador, solo cuenta si hay pestaña con una URL que encaje.
    pub is_browser: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionConfig {
    pub rules: Vec<AppRule>,
    /// Patrones (subcadena) de URL de reunión, p. ej. `meet.google.com/`.
    pub meet_url_patterns: Vec<String>,
    /// Intervalo de sondeo de señales que no tienen notificación (ms).
    pub poll_ms: u32,
    /// Antirrebote: la señal debe mantenerse este tiempo antes de emitir (ms).
    pub debounce_ms: u32,
}

/// Participante visto en la UI de la app (Teams vía AX).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub name: String,
    /// La app lo marca como "tú" (el usuario).
    pub is_self: bool,
}

/// Señales de nombres de hablante en vivo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SpeakerSignal {
    /// Lista completa de participantes (se reemite al cambiar).
    Roster {
        participants: Vec<Participant>,
        at: UnixMs,
    },
    /// Hablante(s) activo(s) según la UI. Lista vacía = nadie habla.
    Active { names: Vec<String>, at: UnixMs },
}
