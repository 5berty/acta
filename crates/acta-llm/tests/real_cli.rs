//! Pruebas contra el `claude` REAL del usuario (ignoradas por defecto).
//!
//! ```bash
//! ACTA_REAL_CLAUDE=/opt/homebrew/bin/claude CLAUDE_CONFIG_DIR=$HOME/.claude-personal \
//!   cargo test -p acta-llm --test real_cli -- --ignored --nocapture
//! ```
//! Reproducen el bug del 16-nov-2026: `--json-schema` con `$schema` 2020-12
//! hacía fallar el paso «Resumen» con código 1.

use acta_core::ids::{CaptureId, MeetingId, SpeakerId};
use acta_core::minutes::{UserIdentity, CaptureRef, GroupNamer, MinutesGenerator, MinutesInput};
use acta_core::detection::Platform;
use acta_core::recording::Track;
use acta_core::screen::CaptureReason;

use acta_core::time::{MediaMs, SystemClock, UnixMs};
use acta_core::transcription::{NameSource, Speaker, Utterance};
use acta_llm::minutes::LlmMinutesGenerator;
use acta_llm::naming::LlmGroupNamer;
use acta_llm::providers::claude::ClaudeCliProvider;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

fn provider() -> Option<Arc<ClaudeCliProvider>> {
    let bin = std::env::var("ACTA_REAL_CLAUDE").ok()?;
    let mut env = BTreeMap::new();
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        env.insert("CLAUDE_CONFIG_DIR".to_string(), dir);
    }
    Some(Arc::new(ClaudeCliProvider::new("claude-cli".into(), bin.into(), None, env, Duration::from_secs(300))))
}

fn speaker(n: u128, is_me: bool) -> Speaker {
    Speaker {
        id: SpeakerId::from_u128(n),
        meeting_id: MeetingId::from_u128(1),
        label: if is_me { "Yo".into() } else { format!("Speaker {}", n - 1) },
        display_name: None,
        is_me,
        track: if is_me { Track::Mic } else { Track::System },
        diarization_label: None,
        name_source: NameSource::Generic,
        confirmed: false,
        voiceprint_id: None,
    }
}

fn utt(idx: u32, sp: u128, start_ms: u64, text: &str) -> Utterance {
    Utterance {
        idx,
        speaker_id: SpeakerId::from_u128(sp),
        track: if sp == 1 { Track::Mic } else { Track::System },
        start: MediaMs(start_ms),
        end: MediaMs(start_ms + 3_000),
        text: text.into(),
        confidence: None,
    }
}

#[tokio::test]
#[ignore = "usa el claude real; ACTA_REAL_CLAUDE=<ruta>"]
async fn real_claude_generates_minutes_with_shipped_schema() {
    let Some(p) = provider() else { return };
    let input = MinutesInput {
        meeting_id: MeetingId::from_u128(1),
        title: "Reunión".into(),
        platform: Platform::Other,
        started_at: UnixMs(1_794_821_400_000),
        duration: MediaMs(20_000),
        me: UserIdentity { display_name: "Edu".into(), aliases: vec![] },
        speakers: vec![speaker(1, true), speaker(2, false)],
        utterances: vec![
            utt(0, 1, 1_000, "Vale, decidimos lanzar la beta el viernes."),
            utt(1, 2, 5_000, "Yo preparo las notas de versión para el jueves."),
            utt(2, 1, 10_000, "Y yo envío el presupuesto a finanzas mañana."),
        ],
        captures: vec![CaptureRef { ref_id: "c1".into(), capture_id: CaptureId::from_u128(9), at: MediaMs(6_000), reason: CaptureReason::SlideChange }],
        language: "es".into(),
    };
    let out = LlmMinutesGenerator::new(p, Arc::new(SystemClock)).generate(input).await.expect("acta real");
    eprintln!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
    assert!(!out.minutes.summary_md.trim().is_empty());
    assert!(!out.minutes.action_items.is_empty());
    assert!(out.minutes.action_items.iter().any(|a| a.is_mine));
    assert!(!out.escaleta.temas.is_empty());
}

#[tokio::test]
#[ignore = "usa el claude real; ACTA_REAL_CLAUDE=<ruta>"]
async fn real_claude_names_a_group() {
    let Some(p) = provider() else { return };
    let meetings = vec![
        ("Presupuesto 2027".to_string(), "Revisión de partidas de marketing".to_string()),
        ("Cierre trimestral".to_string(), "Facturas pendientes y previsión".to_string()),
    ];
    let name = LlmGroupNamer::new(p, "Edu").name_group(&meetings).await.expect("nombre real");
    eprintln!("{name:?}");
    assert!(!name.name.trim().is_empty());
}
