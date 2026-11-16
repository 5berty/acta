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

use crate::recording::{Level, Levels, SessionEvent, StopReason};
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

/// Estado interno de la política. Pura: el tiempo llega en los argumentos.
#[derive(Debug, Clone)]
pub struct AutoStopPolicy {
    pub config: AutoStopConfig,
    recorded_ms: u64,
    silent_since: Option<UnixMs>,
    prompt_open_since: Option<UnixMs>,
    last_tick: Option<UnixMs>,
    paused: bool,
    /// ¿Se puede emitir `SilenceDetected`? Se desarma tras emitirlo o tras un
    /// "No", y se rearma cuando vuelve a haber voz (regla 4).
    armed: bool,
    max_fired: bool,
    auto_silence_fired: bool,
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
            armed: true,
            max_fired: false,
            auto_silence_fired: false,
        }
    }

    /// Tiempo grabado acumulado (sin pausas), en ms.
    pub fn recorded_ms(&self) -> u64 {
        self.recorded_ms
    }

    fn is_voice(&self, level: &Level) -> bool {
        !level.all_zero && level.rms_dbfs >= self.config.silence_threshold_dbfs
    }

    /// Niveles de ambas pistas (~10 Hz). Puede devolver un evento.
    pub fn on_levels(&mut self, levels: &Levels) -> Option<SessionEvent> {
        if self.paused {
            return None;
        }
        if self.is_voice(&levels.mic) || self.is_voice(&levels.system) {
            self.silent_since = None;
            self.armed = true;
            return None;
        }
        let since = *self.silent_since.get_or_insert(levels.at);
        match self.prompt_open_since {
            Some(opened) => {
                // Se cuenta desde que hay pregunta Y silencio a la vez.
                let from = since.max(opened);
                let waited = levels.at.since(from).max(0) as u64;
                if !self.auto_silence_fired && waited >= self.config.auto_stop_after_unanswered_ms {
                    self.auto_silence_fired = true;
                    return Some(SessionEvent::AutoStopDue {
                        reason: StopReason::AutoSilence,
                        at: levels.at,
                    });
                }
                None
            }
            None => {
                let silent_for = levels.at.since(since).max(0) as u64;
                if self.armed && silent_for >= self.config.silence_prompt_after_ms {
                    self.armed = false;
                    return Some(SessionEvent::SilenceDetected { at: levels.at });
                }
                None
            }
        }
    }

    /// Tick periódico (1 Hz) para el tope duro aunque no lleguen niveles.
    pub fn on_tick(&mut self, at: UnixMs) -> Option<SessionEvent> {
        if !self.paused
            && let Some(last) = self.last_tick
        {
            self.recorded_ms += at.since(last).max(0) as u64;
        }
        self.last_tick = Some(at);
        if !self.paused && !self.max_fired && self.recorded_ms >= self.config.max_duration_ms {
            self.max_fired = true;
            return Some(SessionEvent::AutoStopDue {
                reason: StopReason::MaxDuration,
                at,
            });
        }
        None
    }

    pub fn on_stop_prompt_opened(&mut self, at: UnixMs) {
        self.prompt_open_since = Some(at);
    }

    /// La pregunta se cerró con "No": no se vuelve a preguntar hasta que haya
    /// voz y después otra vez silencio.
    pub fn on_stop_prompt_closed(&mut self) {
        self.prompt_open_since = None;
        self.auto_silence_fired = false;
        self.armed = false;
    }

    pub fn on_paused(&mut self, at: UnixMs) {
        if !self.paused {
            if let Some(last) = self.last_tick {
                self.recorded_ms += at.since(last).max(0) as u64;
            }
            self.last_tick = Some(at);
        }
        self.paused = true;
    }

    pub fn on_resumed(&mut self, at: UnixMs) {
        self.paused = false;
        self.last_tick = Some(at);
        self.silent_since = None;
    }
}
