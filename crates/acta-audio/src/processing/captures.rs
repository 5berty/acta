//! Capturas tras el resumen: vínculo con la escaleta y poda de candidatas.

use crate::supervisor::files::reason_wire;
use acta_core::ids::{CaptureId, MeetingId};
use acta_core::layout::DataLayout;
use acta_core::library::MeetingStore;
use acta_core::minutes::{Escaleta, KeyMoment, MinutesOutput, Tema};
use acta_core::screen::{Capture, CaptureReason};
use acta_core::time::MediaMs;
use acta_core::PortResult;

/// Ventana (±) para promover una candidata a `llmPick`.
pub const PICK_WINDOW_MS: u64 = 15_000;

/// Ruta 1-based ("2" o "2.1") del tema MÁS PROFUNDO que contiene `at`.
pub fn topic_path_for(escaleta: &Escaleta, at: MediaMs) -> Option<String> {
    fn walk(temas: &[Tema], at: u64, prefix: &str) -> Option<String> {
        temas.iter().enumerate().find_map(|(i, t)| {
            (t.inicio_ms <= at && at <= t.fin_ms).then(|| {
                let path = format!("{prefix}{}", i + 1);
                walk(&t.subtemas, at, &format!("{path}.")).unwrap_or(path)
            })
        })
    }
    walk(&escaleta.temas, at.0, "")
}

/// Para cada momento clave, la candidata más cercana dentro de la ventana.
/// Cada candidata se promueve una sola vez.
pub fn pick_candidates(moments: &[KeyMoment], candidates: &[(CaptureId, MediaMs)], window_ms: u64) -> Vec<CaptureId> {
    let mut picked = Vec::new();
    for m in moments {
        let best = candidates
            .iter()
            .filter(|(id, _)| !picked.contains(id))
            .map(|(id, at)| (*id, at.0.abs_diff(m.at.0)))
            .filter(|(_, d)| *d <= window_ms)
            .min_by_key(|(_, d)| *d);
        if let Some((id, _)) = best {
            picked.push(id);
        }
    }
    picked
}

/// Promueve a `llmPick` las candidatas cercanas a `key_moments` (se mueven a
/// `captures/<media_ms>-llm_pick.jpg`) y, si `prune`, borra el resto.
pub async fn prune_candidates(
    layout: &DataLayout,
    store: &dyn MeetingStore,
    meeting_id: MeetingId,
    output: &MinutesOutput,
    prune: bool,
) -> PortResult<()> {
    let candidates: Vec<Capture> = store
        .list_captures(meeting_id)
        .await?
        .into_iter()
        .filter(|c| c.reason == CaptureReason::Candidate)
        .collect();
    let picked = pick_candidates(
        &output.key_moments,
        &candidates.iter().map(|c| (c.id, c.at)).collect::<Vec<_>>(),
        PICK_WINDOW_MS,
    );
    let dir = layout.meeting_dir(meeting_id);
    for mut c in candidates {
        let from = dir.join(&c.path);
        if picked.contains(&c.id) {
            let rel = DataLayout::capture_rel_path(c.at.0, reason_wire(CaptureReason::LlmPick));
            let to = dir.join(&rel);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if from.exists() {
                std::fs::rename(&from, &to)?;
            }
            c.path = rel;
            c.reason = CaptureReason::LlmPick;
            c.topic_path = topic_path_for(&output.escaleta, c.at);
            store.update_capture(c).await?;
        } else if prune {
            match std::fs::remove_file(&from) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
            store.delete_capture(c.id).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tema(a: u64, b: u64, sub: Vec<Tema>) -> Tema {
        Tema { titulo: "t".into(), resumen: String::new(), inicio_ms: a, fin_ms: b, subtemas: sub, capturas: vec![] }
    }

    #[test]
    fn deepest_topic_is_one_based() {
        let e = Escaleta { temas: vec![tema(0, 10, vec![]), tema(11, 100, vec![tema(11, 40, vec![]), tema(41, 100, vec![])])] };
        assert_eq!(topic_path_for(&e, MediaMs(5)).as_deref(), Some("1"));
        assert_eq!(topic_path_for(&e, MediaMs(50)).as_deref(), Some("2.2"));
        assert_eq!(topic_path_for(&e, MediaMs(500)), None);
    }

    #[test]
    fn each_moment_takes_the_closest_free_candidate_in_window() {
        let (a, b, c) = (CaptureId::from_u128(1), CaptureId::from_u128(2), CaptureId::from_u128(3));
        let cands = vec![(a, MediaMs(10_000)), (b, MediaMs(12_000)), (c, MediaMs(90_000))];
        let km = |at| KeyMoment { at: MediaMs(at), reason: "r".into(), topic: None };
        assert_eq!(pick_candidates(&[km(11_500), km(11_000), km(50_000)], &cands, PICK_WINDOW_MS), vec![b, a]);
    }
}
