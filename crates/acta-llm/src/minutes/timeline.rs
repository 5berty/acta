//! Línea de tiempo derivada (no la genera el LLM).

use acta_core::minutes::{MinutesOutput, Tema, TimelineEvent, TimelineKind};
use acta_core::screen::Capture;
use acta_core::time::MediaMs;

pub fn build_timeline(output: &MinutesOutput, captures: &[Capture]) -> Vec<TimelineEvent> {
    fn topics(temas: &[Tema], prefix: &str, out: &mut Vec<TimelineEvent>) {
        for (i, t) in temas.iter().enumerate() {
            let path = format!("{prefix}{}", i + 1);
            out.push(TimelineEvent {
                at: MediaMs(t.inicio_ms),
                end: Some(MediaMs(t.fin_ms)),
                kind: TimelineKind::Topic,
                label: t.titulo.clone(),
                ref_id: Some(path.clone()),
            });
            topics(&t.subtemas, &format!("{path}."), out);
        }
    }
    let mut ev = Vec::new();
    topics(&output.escaleta.temas, "", &mut ev);
    for d in &output.minutes.decisions {
        if let Some(at) = d.at {
            ev.push(TimelineEvent { at, end: None, kind: TimelineKind::Decision, label: d.text.clone(), ref_id: Some(d.id.to_string()) });
        }
    }
    for a in &output.minutes.action_items {
        if let Some(at) = a.at {
            ev.push(TimelineEvent { at, end: None, kind: TimelineKind::ActionItem, label: a.text.clone(), ref_id: Some(a.id.to_string()) });
        }
    }
    for c in captures {
        ev.push(TimelineEvent {
            at: c.at,
            end: None,
            kind: TimelineKind::Capture,
            label: c.keyword.clone().unwrap_or_else(|| "Captura".into()),
            ref_id: Some(c.id.to_string()),
        });
    }
    ev.sort_by_key(|e| e.at);
    ev
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minutes::convert::{ConvertCtx, convert};
    use crate::minutes::{DecisionV1, EscaletaV1, MinutesV1, TareaV1};
    use crate::testutil::sample_input;
    use acta_core::time::UnixMs;

    #[test]
    fn merges_topics_decisions_tasks_in_time_order() {
        let input = sample_input();
        let v = MinutesV1 {
            titulo_sugerido: None,
            resumen: "r".into(),
            decisiones: vec![DecisionV1 { texto: "D".into(), ts_ms: Some(50_000) }],
            tareas: vec![TareaV1 { texto: "T".into(), responsable: None, es_mia: false, fecha_limite: None, ts_ms: Some(20_000), capturas: vec![] }],
            escaleta: EscaletaV1 {
                temas: vec![Tema { titulo: "Tema".into(), resumen: String::new(), inicio_ms: 0, fin_ms: 100_000, subtemas: vec![], capturas: vec![] }],
            },
            momentos_clave: vec![],
        };
        let out = convert(&ConvertCtx { input: &input, provider: "p".into(), model: None, now: UnixMs(0) }, v);
        let tl = build_timeline(&out, &[]);
        let kinds: Vec<_> = tl.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, vec![TimelineKind::Topic, TimelineKind::ActionItem, TimelineKind::Decision]);
        assert_eq!(tl[0].ref_id.as_deref(), Some("1"));
    }
}
