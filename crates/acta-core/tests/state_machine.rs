#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Especificación ejecutable de la máquina de estados de la sesión.
//! Los `#[ignore]` son TODO de WP1 (política de autoparada, etc.).

use acta_core::detection::{MeetingApp, Platform};
use acta_core::ids::{MeetingId, PromptId};
use acta_core::processing::ProcessingStep;
use acta_core::recording::*;
use acta_core::time::UnixMs;
use pretty_assertions::assert_eq;

/// Ids deterministas: meeting = 100, 101...; prompt = 1, 2...
struct SeqIds {
    meeting: u128,
    prompt: u128,
}

impl SeqIds {
    fn new() -> Self {
        Self {
            meeting: 100,
            prompt: 1,
        }
    }
}

impl IdSource for SeqIds {
    fn meeting_id(&mut self) -> MeetingId {
        let id = MeetingId::from_u128(self.meeting);
        self.meeting += 1;
        id
    }
    fn prompt_id(&mut self) -> PromptId {
        let id = PromptId::from_u128(self.prompt);
        self.prompt += 1;
        id
    }
}

fn teams() -> MeetingApp {
    MeetingApp {
        platform: Platform::Teams,
        bundle_id: "com.microsoft.teams2".into(),
        pid: 4242,
        audio_pids: vec![4242],
        name: "Microsoft Teams".into(),
        title: Some("Daily".into()),
        url: None,
    }
}

const T0: UnixMs = UnixMs(1_700_000_000_000);
const M1: u128 = 100;

fn mid(n: u128) -> MeetingId {
    MeetingId::from_u128(n)
}
fn pid(n: u128) -> PromptId {
    PromptId::from_u128(n)
}

fn recording(stop_prompt: Option<Prompt>) -> SessionState {
    SessionState::Recording(ActiveRecording {
        meeting_id: mid(M1),
        app: Some(teams()),
        started_at: T0,
        stop_prompt,
    })
}

fn stop_prompt(id: u128, reason: StopPromptReason, at: UnixMs) -> Prompt {
    Prompt {
        id: pid(id),
        kind: PromptKind::StopRecording { reason },
        created_at: at,
    }
}

// ---------------------------------------------------------------------------
// Camino feliz: detectar → grabar → fin de llamada → parar → procesar → lista
// ---------------------------------------------------------------------------

#[test]
fn idle_meeting_detected_opens_start_prompt() {
    let mut ids = SeqIds::new();
    let t = SessionState::Idle
        .transition(
            SessionEvent::MeetingDetected {
                app: teams(),
                at: T0,
            },
            &mut ids,
        )
        .expect("valid");

    let prompt = Prompt {
        id: pid(1),
        kind: PromptKind::StartRecording { app: teams() },
        created_at: T0,
    };
    assert_eq!(
        t.next,
        SessionState::Detected {
            prompt: prompt.clone(),
            app: teams()
        }
    );
    assert_eq!(t.effects, vec![Effect::ShowPrompt { prompt }]);
}

#[test]
fn accepting_start_prompt_starts_capture() {
    let mut ids = SeqIds::new();
    let detected = SessionState::Idle
        .transition(SessionEvent::MeetingDetected { app: teams(), at: T0 }, &mut ids)
        .expect("valid")
        .next;
    let at = T0.plus_ms(2_000);
    let t = detected
        .transition(
            SessionEvent::PromptAnswered {
                prompt_id: pid(1),
                answer: PromptAnswer::Accept,
                at,
            },
            &mut ids,
        )
        .expect("valid");

    assert_eq!(
        t.next,
        SessionState::Recording(ActiveRecording {
            meeting_id: mid(M1),
            app: Some(teams()),
            started_at: at,
            stop_prompt: None,
        })
    );
    assert_eq!(
        t.effects,
        vec![
            Effect::ClosePrompt { prompt_id: pid(1) },
            Effect::StartCapture {
                meeting_id: mid(M1),
                app: Some(teams()),
                at
            },
        ]
    );
}

#[test]
fn declining_or_expired_or_ended_start_prompt_returns_to_idle() {
    for event in [
        SessionEvent::PromptAnswered {
            prompt_id: pid(1),
            answer: PromptAnswer::Decline,
            at: T0,
        },
        SessionEvent::PromptExpired {
            prompt_id: pid(1),
            at: T0,
        },
        SessionEvent::MeetingEnded { at: T0 },
    ] {
        let mut ids = SeqIds::new();
        let detected = SessionState::Idle
            .transition(SessionEvent::MeetingDetected { app: teams(), at: T0 }, &mut ids)
            .expect("valid")
            .next;
        let t = detected.transition(event, &mut ids).expect("valid");
        assert_eq!(t.next, SessionState::Idle);
        assert_eq!(t.effects, vec![Effect::ClosePrompt { prompt_id: pid(1) }]);
    }
}

#[test]
fn answer_for_a_stale_prompt_is_rejected() {
    let mut ids = SeqIds::new();
    let detected = SessionState::Idle
        .transition(SessionEvent::MeetingDetected { app: teams(), at: T0 }, &mut ids)
        .expect("valid")
        .next;
    let err = detected
        .transition(
            SessionEvent::PromptAnswered {
                prompt_id: pid(99),
                answer: PromptAnswer::Accept,
                at: T0,
            },
            &mut ids,
        )
        .expect_err("stale prompt");
    assert_eq!(err.state, "detected");
}

#[test]
fn manual_start_from_idle_records_without_app() {
    let mut ids = SeqIds::new();
    let t = SessionState::Idle
        .transition(SessionEvent::StartRequested { app: None, at: T0 }, &mut ids)
        .expect("valid");
    assert_eq!(
        t.next,
        SessionState::Recording(ActiveRecording {
            meeting_id: mid(M1),
            app: None,
            started_at: T0,
            stop_prompt: None,
        })
    );
    assert_eq!(
        t.effects,
        vec![Effect::StartCapture {
            meeting_id: mid(M1),
            app: None,
            at: T0
        }]
    );
}

#[test]
fn meeting_ended_while_recording_asks_to_stop() {
    let mut ids = SeqIds::new();
    let at = T0.plus_ms(60_000);
    let t = recording(None)
        .transition(SessionEvent::MeetingEnded { at }, &mut ids)
        .expect("valid");
    let prompt = stop_prompt(1, StopPromptReason::MeetingEnded, at);
    assert_eq!(t.next, recording(Some(prompt.clone())));
    assert_eq!(t.effects, vec![Effect::ShowPrompt { prompt }]);
}

#[test]
fn accepting_stop_prompt_stops_capture() {
    let mut ids = SeqIds::new();
    let prompt = stop_prompt(7, StopPromptReason::MeetingEnded, T0);
    let at = T0.plus_ms(5_000);
    let t = recording(Some(prompt))
        .transition(
            SessionEvent::PromptAnswered {
                prompt_id: pid(7),
                answer: PromptAnswer::Accept,
                at,
            },
            &mut ids,
        )
        .expect("valid");
    assert_eq!(
        t.next,
        SessionState::Stopping {
            meeting_id: mid(M1),
            reason: StopReason::MeetingEndedConfirmed
        }
    );
    assert_eq!(
        t.effects,
        vec![
            Effect::ClosePrompt { prompt_id: pid(7) },
            Effect::StopCapture {
                meeting_id: mid(M1),
                reason: StopReason::MeetingEndedConfirmed,
                at
            },
        ]
    );
}

#[test]
fn declining_stop_prompt_keeps_recording() {
    let mut ids = SeqIds::new();
    let prompt = stop_prompt(7, StopPromptReason::Silence, T0);
    let t = recording(Some(prompt))
        .transition(
            SessionEvent::PromptAnswered {
                prompt_id: pid(7),
                answer: PromptAnswer::Decline,
                at: T0,
            },
            &mut ids,
        )
        .expect("valid");
    assert_eq!(t.next, recording(None));
    assert_eq!(t.effects, vec![Effect::ClosePrompt { prompt_id: pid(7) }]);
}

#[test]
fn silence_detected_asks_once() {
    let mut ids = SeqIds::new();
    let t = recording(None)
        .transition(SessionEvent::SilenceDetected { at: T0 }, &mut ids)
        .expect("valid");
    let prompt = stop_prompt(1, StopPromptReason::Silence, T0);
    assert_eq!(t.next, recording(Some(prompt.clone())));

    // Con una pregunta ya abierta no se abre otra.
    let again = t
        .next
        .transition(SessionEvent::SilenceDetected { at: T0 }, &mut ids)
        .expect("valid");
    assert_eq!(again.next, recording(Some(prompt)));
    assert!(again.effects.is_empty());
}

#[test]
fn auto_stop_closes_open_prompt_and_stops() {
    let mut ids = SeqIds::new();
    let prompt = stop_prompt(3, StopPromptReason::MeetingEnded, T0);
    let at = T0.plus_ms(120_000);
    let t = recording(Some(prompt))
        .transition(
            SessionEvent::AutoStopDue {
                reason: StopReason::AutoSilence,
                at,
            },
            &mut ids,
        )
        .expect("valid");
    assert_eq!(
        t.next,
        SessionState::Stopping {
            meeting_id: mid(M1),
            reason: StopReason::AutoSilence
        }
    );
    assert_eq!(
        t.effects,
        vec![
            Effect::ClosePrompt { prompt_id: pid(3) },
            Effect::StopCapture {
                meeting_id: mid(M1),
                reason: StopReason::AutoSilence,
                at
            },
        ]
    );
}

#[test]
fn pause_and_resume_roundtrip() {
    let mut ids = SeqIds::new();
    let at = T0.plus_ms(10_000);
    let paused = recording(None)
        .transition(SessionEvent::PauseRequested { at }, &mut ids)
        .expect("valid");
    assert_eq!(
        paused.effects,
        vec![Effect::PauseCapture {
            meeting_id: mid(M1),
            at
        }]
    );
    let at2 = at.plus_ms(30_000);
    let resumed = paused
        .next
        .transition(SessionEvent::ResumeRequested { at: at2 }, &mut ids)
        .expect("valid");
    assert_eq!(resumed.next, recording(None));
    assert_eq!(
        resumed.effects,
        vec![Effect::ResumeCapture {
            meeting_id: mid(M1),
            at: at2
        }]
    );
}

#[test]
fn stop_from_paused_is_allowed() {
    let mut ids = SeqIds::new();
    let paused = recording(None)
        .transition(SessionEvent::PauseRequested { at: T0 }, &mut ids)
        .expect("valid")
        .next;
    let t = paused
        .transition(
            SessionEvent::StopRequested {
                reason: StopReason::User,
                at: T0,
            },
            &mut ids,
        )
        .expect("valid");
    assert_eq!(
        t.next,
        SessionState::Stopping {
            meeting_id: mid(M1),
            reason: StopReason::User
        }
    );
}

#[test]
fn fatal_while_recording_stops_and_keeps_audio() {
    let mut ids = SeqIds::new();
    let t = recording(None)
        .transition(
            SessionEvent::Fatal {
                error: "sidecar gone".into(),
                at: T0,
            },
            &mut ids,
        )
        .expect("valid");
    assert_eq!(
        t.next,
        SessionState::Stopping {
            meeting_id: mid(M1),
            reason: StopReason::Error
        }
    );
}

#[test]
fn stopping_then_finalized_then_processing_then_ready() {
    let mut ids = SeqIds::new();
    let stopping = SessionState::Stopping {
        meeting_id: mid(M1),
        reason: StopReason::User,
    };
    let t = stopping
        .transition(SessionEvent::CaptureFinalized { meeting_id: mid(M1) }, &mut ids)
        .expect("valid");
    assert_eq!(
        t.next,
        SessionState::Processing {
            meeting_id: mid(M1),
            step: ProcessingStep::Concatenating
        }
    );
    assert_eq!(t.effects, vec![Effect::StartProcessing { meeting_id: mid(M1) }]);

    let p = t
        .next
        .transition(
            SessionEvent::ProcessingProgress {
                meeting_id: mid(M1),
                step: ProcessingStep::Transcribing,
            },
            &mut ids,
        )
        .expect("valid");
    assert_eq!(
        p.next,
        SessionState::Processing {
            meeting_id: mid(M1),
            step: ProcessingStep::Transcribing
        }
    );

    let r = p
        .next
        .transition(SessionEvent::ProcessingFinished { meeting_id: mid(M1) }, &mut ids)
        .expect("valid");
    assert_eq!(r.next, SessionState::Ready { meeting_id: mid(M1) });

    let d = r.next.transition(SessionEvent::Dismiss, &mut ids).expect("valid");
    assert_eq!(d.next, SessionState::Idle);
}

#[test]
fn processing_does_not_block_a_new_meeting() {
    let mut ids = SeqIds::new();
    let processing = SessionState::Processing {
        meeting_id: mid(1),
        step: ProcessingStep::Summarizing,
    };
    let t = processing
        .transition(SessionEvent::MeetingDetected { app: teams(), at: T0 }, &mut ids)
        .expect("valid");
    assert!(matches!(t.next, SessionState::Detected { .. }));

    // El fin del procesado de la reunión anterior no altera el estado actual.
    let late = t
        .next
        .transition(SessionEvent::ProcessingFinished { meeting_id: mid(1) }, &mut ids)
        .expect("ignored, not an error");
    assert!(matches!(late.next, SessionState::Detected { .. }));
    assert!(late.effects.is_empty());
}

#[test]
fn recovery_flow() {
    let mut ids = SeqIds::new();
    let t = SessionState::Idle
        .transition(SessionEvent::RecoveryRequired { meeting_id: mid(5) }, &mut ids)
        .expect("valid");
    assert_eq!(t.next, SessionState::Recovering { meeting_id: mid(5) });
    assert_eq!(t.effects, vec![Effect::RunRecovery { meeting_id: mid(5) }]);

    let done = t
        .next
        .transition(SessionEvent::RecoveryFinished { meeting_id: mid(5) }, &mut ids)
        .expect("valid");
    assert_eq!(
        done.next,
        SessionState::Processing {
            meeting_id: mid(5),
            step: ProcessingStep::Concatenating
        }
    );
    assert_eq!(done.effects, vec![Effect::StartProcessing { meeting_id: mid(5) }]);
}

#[test]
fn processing_failure_goes_to_failed_and_dismiss_to_idle() {
    let mut ids = SeqIds::new();
    let processing = SessionState::Processing {
        meeting_id: mid(M1),
        step: ProcessingStep::Transcribing,
    };
    let t = processing
        .transition(
            SessionEvent::ProcessingFailed {
                meeting_id: mid(M1),
                error: "asr".into(),
            },
            &mut ids,
        )
        .expect("valid");
    assert_eq!(
        t.next,
        SessionState::Failed {
            meeting_id: Some(mid(M1)),
            error: "asr".into()
        }
    );
    assert_eq!(
        t.next.transition(SessionEvent::Dismiss, &mut ids).expect("valid").next,
        SessionState::Idle
    );
}

#[test]
fn invalid_events_are_rejected_without_changing_state() {
    let mut ids = SeqIds::new();
    let cases = [
        (SessionState::Idle, SessionEvent::PauseRequested { at: T0 }),
        (SessionState::Idle, SessionEvent::ResumeRequested { at: T0 }),
        (recording(None), SessionEvent::ResumeRequested { at: T0 }),
        (recording(None), SessionEvent::StartRequested { app: None, at: T0 }),
        (
            SessionState::Stopping {
                meeting_id: mid(M1),
                reason: StopReason::User,
            },
            SessionEvent::PauseRequested { at: T0 },
        ),
    ];
    for (state, event) in cases {
        let name = event.name();
        assert!(
            state.transition(event, &mut ids).is_err(),
            "{} should reject {}",
            state.name(),
            name
        );
    }
}

#[test]
fn meeting_detected_while_recording_is_a_noop() {
    let mut ids = SeqIds::new();
    let t = recording(None)
        .transition(SessionEvent::MeetingDetected { app: teams(), at: T0 }, &mut ids)
        .expect("noop");
    assert_eq!(t.next, recording(None));
    assert!(t.effects.is_empty());
}

#[test]
fn session_state_serializes_with_state_tag() {
    let json = serde_json::to_value(recording(None)).expect("json");
    assert_eq!(json["state"], "recording");
    assert_eq!(json["meetingId"], mid(M1).to_string());
    let back: SessionState = serde_json::from_value(json).expect("roundtrip");
    assert_eq!(back, recording(None));

    let paused = SessionState::Paused {
        recording: ActiveRecording {
            meeting_id: mid(M1),
            app: None,
            started_at: T0,
            stop_prompt: None,
        },
        paused_at: T0,
    };
    let json = serde_json::to_value(&paused).expect("json");
    assert_eq!(json["state"], "paused");
    assert_eq!(json["pausedAt"], T0.0);
    assert_eq!(serde_json::from_value::<SessionState>(json).expect("rt"), paused);
}

// ---------------------------------------------------------------------------
// TODO WP1: política de autoparada (recording::autostop)
// ---------------------------------------------------------------------------

#[test]
#[ignore = "WP1: implementar AutoStopPolicy regla 1 (tope duro)"]
fn autostop_max_duration_fires_without_prompt() {
    let cfg = AutoStopConfig {
        max_duration_ms: 1_000,
        ..AutoStopConfig::default()
    };
    let mut p = AutoStopPolicy::new(cfg);
    assert_eq!(p.on_tick(T0), None);
    assert_eq!(
        p.on_tick(T0.plus_ms(1_500)),
        Some(SessionEvent::AutoStopDue {
            reason: StopReason::MaxDuration,
            at: T0.plus_ms(1_500)
        })
    );
}

#[test]
#[ignore = "WP1: implementar AutoStopPolicy reglas 2-3 (silencio + pregunta sin respuesta)"]
fn autostop_silence_then_unanswered_prompt_stops() {
    let cfg = AutoStopConfig {
        silence_prompt_after_ms: 1_000,
        auto_stop_after_unanswered_ms: 1_000,
        ..AutoStopConfig::default()
    };
    let mut p = AutoStopPolicy::new(cfg);
    let silent = |at| Levels {
        mic: Level::SILENT,
        system: Level::SILENT,
        at,
    };
    assert_eq!(p.on_levels(&silent(T0)), None);
    assert_eq!(
        p.on_levels(&silent(T0.plus_ms(1_100))),
        Some(SessionEvent::SilenceDetected { at: T0.plus_ms(1_100) })
    );
    p.on_stop_prompt_opened(T0.plus_ms(1_100));
    assert_eq!(
        p.on_levels(&silent(T0.plus_ms(2_200))),
        Some(SessionEvent::AutoStopDue {
            reason: StopReason::AutoSilence,
            at: T0.plus_ms(2_200)
        })
    );
}

#[test]
#[ignore = "WP1: la voz reinicia el contador de silencio aunque haya pregunta abierta"]
fn autostop_speech_resets_silence_counter() {}
