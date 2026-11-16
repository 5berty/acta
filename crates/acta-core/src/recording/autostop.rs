//! Política de autoparada (WP1). Pura: recibe niveles, ticks y respuestas, y
//! devuelve eventos para la máquina de estados.
//!
//! Reglas (valores por defecto en `settings::AutoStopSettings`):
//! 1. Tope duro: al llegar a `max_duration_ms` desde el inicio →
//!    `AutoStopDue { reason: MaxDuration }` sin preguntar.
//! 2. Silencio en AMBAS pistas (`rms_dbfs < silence_threshold_dbfs`) durante
//!    `silence_prompt_after_ms` y sin pregunta abierta → `SilenceDetected`
//!    (la máquina abre "¿Parar?").
//! 3. Con una pregunta "¿Parar?" abierta (por `MeetingEnded` o por silencio):
//!    si sigue sin respuesta Y hay silencio en ambas pistas durante
//!    `auto_stop_after_unanswered_ms` → `AutoStopDue { reason: AutoSilence }`.
//!    Si alguien habla, el contador de silencio se reinicia (no se para en
//!    mitad de una conversación aunque Teams diga que terminó).
//! 4. Si el usuario responde "No" a "¿Parar?", no se vuelve a preguntar por
//!    silencio hasta que haya habido voz y otra vez `silence_prompt_after_ms`
//!    de silencio.
//! 5. Las pausas no cuentan como silencio ni para el tope (el tope cuenta
//!    tiempo grabado).

use crate::recording::{Levels, SessionEvent};
use crate::time::UnixMs;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStopConfig {
    pub silence_threshold_dbfs: f32,
    pub silence_prompt_after_ms: u64,
    pub auto_stop_after_unanswered_ms: u64,
    pub max_duration_ms: u64,
}

impl Default for AutoStopConfig {
    fn default() -> Self {
        Self {
            silence_threshold_dbfs: -50.0,
            silence_prompt_after_ms: 3 * 60_000,
            auto_stop_after_unanswered_ms: 2 * 60_000,
            max_duration_ms: 4 * 60 * 60_000,
        }
    }
}

/// Estado interno de la política. WP1 completa la implementación.
#[derive(Debug, Clone)]
pub struct AutoStopPolicy {
    pub config: AutoStopConfig,
    recorded_ms: u64,
    silent_since: Option<UnixMs>,
    prompt_open_since: Option<UnixMs>,
    last_tick: Option<UnixMs>,
    paused: bool,
}

impl AutoStopPolicy {
    pub fn new(config: AutoStopConfig) -> Self {
        Self {
            config,
            recorded_ms: 0,
            silent_since: None,
            prompt_open_since: None,
            last_tick: None,
            paused: false,
        }
    }

    /// Niveles de ambas pistas (~10 Hz). Puede devolver un evento.
    pub fn on_levels(&mut self, levels: &Levels) -> Option<SessionEvent> {
        // TODO(WP1): reglas 2-4.
        let _ = (levels, &self.silent_since, &self.prompt_open_since);
        None
    }

    /// Tick periódico (1 Hz) para el tope duro aunque no lleguen niveles.
    pub fn on_tick(&mut self, at: UnixMs) -> Option<SessionEvent> {
        // TODO(WP1): regla 1 (acumular recorded_ms solo si !paused).
        let _ = (at, self.last_tick, self.recorded_ms, self.paused);
        None
    }

    pub fn on_stop_prompt_opened(&mut self, at: UnixMs) {
        self.prompt_open_since = Some(at);
    }

    pub fn on_stop_prompt_closed(&mut self) {
        self.prompt_open_since = None;
    }

    pub fn on_paused(&mut self, _at: UnixMs) {
        self.paused = true;
    }

    pub fn on_resumed(&mut self, _at: UnixMs) {
        self.paused = false;
        self.silent_since = None;
    }
}
