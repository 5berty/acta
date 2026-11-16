//! Timeline derivado (no lo genera el LLM): escaleta + decisiones + tareas + capturas.

use acta_core::minutes::{ActionItem, Decision, Escaleta, Tema, TimelineEvent, TimelineKind};
use acta_core::screen::{Capture, CaptureReason};
use acta_core::time::MediaMs;

fn rank(k: TimelineKind) -> u8 {
    match k {
        TimelineKind::Topic => 0,
        TimelineKind::ScreenShare => 1,
        TimelineKind::Capture => 2,
        TimelineKind::Decision => 3,
        TimelineKind::ActionItem => 4,
    }
}

fn reason_label(r: CaptureReason) -> &'static str {
    match r {
        CaptureReason::SlideChange => "Cambio de diapositiva",
        CaptureReason::Keyword => "Palabra clave",
        CaptureReason::LlmPick => "Momento destacado",
        CaptureReason::Manual => "Captura manual",
        CaptureReason::Candidate => "Captura candidata",
    }
}

fn push_topics(temas: &[Tema], prefix: &str, out: &mut Vec<TimelineEvent>) {
    for (i, t) in temas.iter().enumerate() {
        let path = if prefix.is_empty() { format!("{}", i + 1) } else { format!("{prefix}.{}", i + 1) };
        out.push(TimelineEvent {
            at: MediaMs(t.inicio_ms),
            end: Some(MediaMs(t.fin_ms)),
            kind: TimelineKind::Topic,
            label: t.titulo.clone(),
            ref_id: Some(path.clone()),
        });
        push_topics(&t.subtemas, &path, out);
    }
}

/// Eventos ordenados por instante en la línea media. Las decisiones y tareas
/// sin instante no aparecen. `ref_id` de un tema es su ruta ("2.1").
pub fn derive_timeline(
    escaleta: &Escaleta,
    decisions: &[Decision],
    items: &[ActionItem],
    captures: &[Capture],
) -> Vec<TimelineEvent> {
    let mut out = Vec::new();
    push_topics(&escaleta.temas, "", &mut out);
    for d in decisions {
        if let Some(at) = d.at {
            out.push(TimelineEvent {
                at,
                end: None,
                kind: TimelineKind::Decision,
                label: d.text.clone(),
                ref_id: Some(d.id.to_string()),
            });
        }
    }
    for a in items {
        if let Some(at) = a.at {
            out.push(TimelineEvent {
                at,
                end: None,
                kind: TimelineKind::ActionItem,
                label: a.text.clone(),
                ref_id: Some(a.id.to_string()),
            });
        }
    }
    for c in captures {
        let label = match &c.keyword {
            Some(k) => format!("{}: {k}", reason_label(c.reason)),
            None => reason_label(c.reason).to_owned(),
        };
        out.push(TimelineEvent {
            at: c.at,
            end: None,
            kind: TimelineKind::Capture,
            label,
            ref_id: Some(c.id.to_string()),
        });
    }
    out.sort_by_key(|e| (e.at, rank(e.kind)));
    out
}
