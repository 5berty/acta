//! Fusión de señales crudas (`detect.signal`) en eventos de dominio
//! (docs/01-arquitectura.md §4.5). Lógica pura: el tiempo entra por argumento.
//!
//! | Plataforma | Empieza | Termina |
//! |---|---|---|
//! | App nativa (Teams...) | mic + ventana de reunión mantenidos `debounce_ms` → `High`; solo mic durante `debounce_ms + low_grace_ms` → `Low` | todas las señales relevantes apagadas `debounce_ms`, o una apagada `end_single_ms` |
//! | Navegador (Meet) | pestaña de Meet + mic del navegador mantenidos `debounce_ms` → `High` (nunca solo mic) | igual |
//!
//! "Relevantes" = el mic y, si se vio durante la reunión, la ventana/pestaña.
//! Así una reunión `Low` (sin AX) no termina a los 10 s por una ventana que
//! nunca se vio. Solo cuentan las apps de la lista blanca (`rules`).

use crate::protocol::{AppInfoWire, DetectSignalEvent, SignalName};
use acta_core::detection::{AppRule, Confidence, DetectionEvent, MeetingApp};
use acta_core::time::UnixMs;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FusionTiming {
    pub debounce_ms: i64,
    /// Una sola señal apagada este tiempo termina la reunión.
    pub end_single_ms: i64,
    /// Espera extra a la ventana (AX) antes de arrancar con confianza `Low`.
    pub low_grace_ms: i64,
}

impl FusionTiming {
    pub fn new(debounce_ms: u32) -> Self {
        Self {
            debounce_ms: debounce_ms as i64,
            end_single_ms: 10_000,
            low_grace_ms: 5_000,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Flag {
    on: bool,
    since: UnixMs,
}

impl Flag {
    fn off(at: UnixMs) -> Self {
        Self { on: false, since: at }
    }
    fn set(&mut self, on: bool, at: UnixMs) {
        if self.on != on {
            self.on = on;
            self.since = at;
        }
    }
    fn held_on(&self, now: UnixMs, ms: i64) -> bool {
        self.on && now.since(self.since) >= ms
    }
    fn held_off(&self, now: UnixMs, ms: i64) -> bool {
        !self.on && now.since(self.since) >= ms
    }
}

#[derive(Debug, Clone)]
struct AppState {
    rule: AppRule,
    info: AppInfoWire,
    mic: Flag,
    /// Ventana de reunión (nativa) o pestaña de Meet (navegador).
    context: Flag,
    title: Option<String>,
    url: Option<String>,
    active: Option<MeetingApp>,
    context_seen: bool,
}

#[derive(Debug, Clone)]
pub struct DetectionFusion {
    timing: FusionTiming,
    rules: Vec<AppRule>,
    apps: BTreeMap<String, AppState>,
}

impl DetectionFusion {
    pub fn new(rules: Vec<AppRule>, timing: FusionTiming) -> Self {
        Self {
            timing,
            rules,
            apps: BTreeMap::new(),
        }
    }

    /// Hay alguna reunión en curso.
    pub fn active_apps(&self) -> Vec<MeetingApp> {
        self.apps.values().filter_map(|a| a.active.clone()).collect()
    }

    /// El sidecar se reinició: no sabemos el estado real. Apagamos todo "desde
    /// ahora"; el sidecar nuevo reemite las señales encendidas en < `poll_ms`,
    /// mucho antes de que venza ningún plazo de fin.
    pub fn reset_signals(&mut self, now: UnixMs) {
        for app in self.apps.values_mut() {
            app.mic = Flag::off(now);
            app.context = Flag::off(now);
        }
    }

    pub fn on_signal(&mut self, sig: &DetectSignalEvent, now: UnixMs) -> Vec<DetectionEvent> {
        let Some(rule) = self
            .rules
            .iter()
            .find(|r| r.bundle_id == sig.app.bundle_id)
            .cloned()
        else {
            return Vec::new(); // fuera de la lista blanca (Typeless, Orca...)
        };
        let state = self
            .apps
            .entry(sig.app.bundle_id.clone())
            .or_insert_with(|| AppState {
                rule,
                info: sig.app.clone(),
                mic: Flag::off(now),
                context: Flag::off(now),
                title: None,
                url: None,
                active: None,
                context_seen: false,
            });
        let mut out = Vec::new();
        let pids_changed = state.info.audio_pids != sig.app.audio_pids || state.info.pid != sig.app.pid;
        state.info = sig.app.clone();
        match sig.signal {
            SignalName::MicInUse => state.mic.set(true, now),
            SignalName::MicReleased => state.mic.set(false, now),
            SignalName::MeetingWindowOpen | SignalName::MeetTabOpen => {
                state.context.set(true, now);
                if sig.window_title.is_some() {
                    state.title = sig.window_title.clone();
                }
                if sig.url.is_some() {
                    state.url = sig.url.clone();
                }
            }
            SignalName::MeetingWindowClosed | SignalName::MeetTabClosed => state.context.set(false, now),
            SignalName::AudioPidsChanged => {}
        }
        if state.context.on
            && let Some(active) = state.active.as_mut() {
                state.context_seen = true;
                active.title = state.title.clone().or(active.title.take());
                active.url = state.url.clone().or(active.url.take());
            }
        if pids_changed
            && let Some(active) = state.active.as_mut() {
                active.pid = state.info.pid;
                active.audio_pids = state.info.audio_pids.clone();
                out.push(DetectionEvent::AudioPidsChanged {
                    app: active.clone(),
                    at: now,
                });
            }
        out.extend(Self::evaluate(self.timing, state, now));
        out
    }

    pub fn tick(&mut self, now: UnixMs) -> Vec<DetectionEvent> {
        let timing = self.timing;
        self.apps
            .values_mut()
            .flat_map(|s| Self::evaluate(timing, s, now))
            .collect()
    }

    fn evaluate(t: FusionTiming, s: &mut AppState, now: UnixMs) -> Option<DetectionEvent> {
        match &s.active {
            None => {
                let both_since = s.mic.since.max(s.context.since);
                let both = s.mic.on && s.context.on && now.since(both_since) >= t.debounce_ms;
                let confidence = if both {
                    Confidence::High
                } else if !s.rule.is_browser && !s.context.on && s.mic.held_on(now, t.debounce_ms + t.low_grace_ms)
                {
                    Confidence::Low
                } else {
                    return None;
                };
                let app = MeetingApp {
                    platform: s.rule.platform,
                    bundle_id: s.info.bundle_id.clone(),
                    pid: s.info.pid,
                    audio_pids: if s.info.audio_pids.is_empty() {
                        vec![s.info.pid]
                    } else {
                        s.info.audio_pids.clone()
                    },
                    name: s.info.name.clone(),
                    title: s.context.on.then(|| s.title.clone()).flatten(),
                    url: s.context.on.then(|| s.url.clone()).flatten(),
                };
                s.context_seen = s.context.on;
                s.active = Some(app.clone());
                Some(DetectionEvent::MeetingStarted {
                    app,
                    confidence,
                    at: now,
                })
            }
            Some(app) => {
                let mic_gone = s.mic.held_off(now, t.end_single_ms);
                let ctx_gone = s.context_seen && s.context.held_off(now, t.end_single_ms);
                let all_off = !s.mic.on && (!s.context_seen || !s.context.on);
                let all_off_since = if s.context_seen {
                    s.mic.since.max(s.context.since)
                } else {
                    s.mic.since
                };
                let ended = mic_gone || ctx_gone || (all_off && now.since(all_off_since) >= t.debounce_ms);
                if !ended {
                    return None;
                }
                let app = app.clone();
                s.active = None;
                s.context_seen = false;
                Some(DetectionEvent::MeetingEnded { app, at: now })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use acta_core::detection::Platform;
    use pretty_assertions::assert_eq;

    const TEAMS: &str = "com.microsoft.teams2";
    const CHROME: &str = "com.google.Chrome";

    fn rules() -> Vec<AppRule> {
        vec![
            AppRule {
                bundle_id: TEAMS.into(),
                platform: Platform::Teams,
                is_browser: false,
            },
            AppRule {
                bundle_id: CHROME.into(),
                platform: Platform::Meet,
                is_browser: true,
            },
        ]
    }

    fn fusion() -> DetectionFusion {
        DetectionFusion::new(rules(), FusionTiming::new(3_000))
    }

    fn sig(bundle: &str, signal: SignalName) -> DetectSignalEvent {
        DetectSignalEvent {
            signal,
            app: AppInfoWire {
                pid: 100,
                bundle_id: bundle.into(),
                name: "App".into(),
                audio_pids: vec![100, 101],
            },
            window_title: matches!(signal, SignalName::MeetingWindowOpen | SignalName::MeetTabOpen)
                .then(|| "Daily | Microsoft Teams".to_string()),
            url: (signal == SignalName::MeetTabOpen).then(|| "https://meet.google.com/abc-defg-hij".to_string()),
        }
    }

    fn ms(v: i64) -> UnixMs {
        UnixMs(v)
    }

    fn started(events: &[DetectionEvent]) -> Option<Confidence> {
        events.iter().find_map(|e| match e {
            DetectionEvent::MeetingStarted { confidence, .. } => Some(*confidence),
            _ => None,
        })
    }

    fn ended(events: &[DetectionEvent]) -> bool {
        events.iter().any(|e| matches!(e, DetectionEvent::MeetingEnded { .. }))
    }

    #[test]
    fn teams_mic_and_window_held_for_debounce_is_high() {
        let mut f = fusion();
        assert!(f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0)).is_empty());
        assert!(f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(500)).is_empty());
        assert!(f.tick(ms(3_400)).is_empty(), "window not yet held 3 s");
        let ev = f.tick(ms(3_500));
        assert_eq!(started(&ev), Some(Confidence::High));
        match &ev[0] {
            DetectionEvent::MeetingStarted { app, .. } => {
                assert_eq!(app.platform, Platform::Teams);
                assert_eq!(app.audio_pids, vec![100, 101]);
                assert_eq!(app.title.as_deref(), Some("Daily | Microsoft Teams"));
            }
            other => panic!("{other:?}"),
        }
        assert!(f.tick(ms(10_000)).is_empty(), "only ONE MeetingStarted per meeting");
    }

    #[test]
    fn short_mic_blip_never_starts() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(0));
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(100));
        f.on_signal(&sig(TEAMS, SignalName::MicReleased), ms(2_000));
        assert!(f.tick(ms(20_000)).is_empty());
    }

    #[test]
    fn teams_mic_only_starts_low_after_grace() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0));
        assert!(f.tick(ms(7_999)).is_empty());
        assert_eq!(started(&f.tick(ms(8_000))), Some(Confidence::Low));
    }

    #[test]
    fn low_meeting_ends_when_mic_released_for_debounce() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0));
        f.tick(ms(8_000));
        f.on_signal(&sig(TEAMS, SignalName::MicReleased), ms(60_000));
        assert!(f.tick(ms(62_999)).is_empty());
        assert!(ended(&f.tick(ms(63_000))));
    }

    #[test]
    fn teams_ends_when_both_released_after_debounce() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(0));
        f.tick(ms(3_000));
        f.on_signal(&sig(TEAMS, SignalName::MicReleased), ms(100_000));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowClosed), ms(100_500));
        assert!(f.tick(ms(103_400)).is_empty());
        assert!(ended(&f.tick(ms(103_500))));
    }

    #[test]
    fn teams_ends_when_only_window_closes_for_ten_seconds() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(0));
        f.tick(ms(3_000));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowClosed), ms(50_000));
        assert!(f.tick(ms(59_999)).is_empty());
        assert!(ended(&f.tick(ms(60_000))));
    }

    #[test]
    fn browser_needs_meet_tab_never_mic_only() {
        let mut f = fusion();
        f.on_signal(&sig(CHROME, SignalName::MicInUse), ms(0));
        assert!(f.tick(ms(60_000)).is_empty(), "browser mic alone is not a meeting");
        f.on_signal(&sig(CHROME, SignalName::MeetTabOpen), ms(60_000));
        let ev = f.tick(ms(63_000));
        assert_eq!(started(&ev), Some(Confidence::High));
        match &ev[0] {
            DetectionEvent::MeetingStarted { app, .. } => {
                assert_eq!(app.platform, Platform::Meet);
                assert_eq!(app.url.as_deref(), Some("https://meet.google.com/abc-defg-hij"));
            }
            other => panic!("{other:?}"),
        }
        f.on_signal(&sig(CHROME, SignalName::MeetTabClosed), ms(70_000));
        assert!(ended(&f.tick(ms(80_000))));
    }

    #[test]
    fn apps_outside_the_allowlist_are_ignored() {
        let mut f = fusion();
        for bundle in ["com.typeless.app", "com.stablygames.orca", "com.electron.wispr-flow"] {
            f.on_signal(&sig(bundle, SignalName::MicInUse), ms(0));
            f.on_signal(&sig(bundle, SignalName::MeetingWindowOpen), ms(0));
        }
        assert!(f.tick(ms(60_000)).is_empty());
    }

    #[test]
    fn audio_pids_change_during_meeting_is_reported() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(0));
        f.tick(ms(3_000));
        let mut s = sig(TEAMS, SignalName::AudioPidsChanged);
        s.app.audio_pids = vec![100, 101, 102];
        let ev = f.on_signal(&s, ms(4_000));
        assert!(matches!(&ev[..], [DetectionEvent::AudioPidsChanged { app, .. }] if app.audio_pids == vec![100, 101, 102]));
    }

    #[test]
    fn restart_reset_does_not_end_meeting_if_signals_come_back() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(0));
        f.tick(ms(3_000));
        f.reset_signals(ms(10_000));
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(11_000));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(11_000));
        assert!(f.tick(ms(30_000)).is_empty());
        assert_eq!(f.active_apps().len(), 1);
    }

    #[test]
    fn a_new_meeting_can_start_after_the_previous_ended() {
        let mut f = fusion();
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(0));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(0));
        f.tick(ms(3_000));
        f.on_signal(&sig(TEAMS, SignalName::MicReleased), ms(5_000));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowClosed), ms(5_000));
        assert!(ended(&f.tick(ms(8_000))));
        f.on_signal(&sig(TEAMS, SignalName::MicInUse), ms(100_000));
        f.on_signal(&sig(TEAMS, SignalName::MeetingWindowOpen), ms(100_000));
        assert_eq!(started(&f.tick(ms(103_000))), Some(Confidence::High));
    }
}
