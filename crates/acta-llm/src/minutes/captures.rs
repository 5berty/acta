//! Capturas: vínculo con temas de la escaleta y promoción de candidatas.

use acta_core::ids::CaptureId;
use acta_core::minutes::{Escaleta, KeyMoment, Tema};
use acta_core::screen::Capture;
use acta_core::time::MediaMs;

/// Ventana (±) para promover una candidata a `llmPick`.
pub const PICK_WINDOW_MS: u64 = 15_000;

/// Ruta ("2" o "2.1") del tema MÁS PROFUNDO que contiene `at`.
pub fn topic_path_for(escaleta: &Escaleta, at: MediaMs) -> Option<String> {
    fn walk(temas: &[Tema], at: u64, prefix: &str) -> Option<String> {
        for (i, t) in temas.iter().enumerate() {
            if t.inicio_ms <= at && at <= t.fin_ms {
                let path = format!("{prefix}{}", i + 1);
                return walk(&t.subtemas, at, &format!("{path}.")).or(Some(path));
            }
        }
        None
    }
    walk(&escaleta.temas, at.0, "")
}

/// Ruta del tema cuyo `capturas` (ids ya traducidos) contiene la captura.
fn topic_path_listing(escaleta: &Escaleta, id: CaptureId) -> Option<String> {
    fn walk(temas: &[Tema], id: &str, prefix: &str) -> Option<String> {
        for (i, t) in temas.iter().enumerate() {
            let path = format!("{prefix}{}", i + 1);
            if let Some(p) = walk(&t.subtemas, id, &format!("{path}.")) {
                return Some(p);
            }
            if t.capturas.iter().any(|c| c == id) {
                return Some(path);
            }
        }
        None
    }
    walk(&escaleta.temas, &id.to_string(), "")
}

/// `topic_path` para cada captura: primero lo que listó el LLM, si no por tiempo.
pub fn link_captures(escaleta: &Escaleta, captures: &[Capture]) -> Vec<(CaptureId, Option<String>)> {
    captures
        .iter()
        .map(|c| {
            let path = topic_path_listing(escaleta, c.id).or_else(|| topic_path_for(escaleta, c.at));
            (c.id, path)
        })
        .collect()
}

/// Para cada momento clave, la candidata más cercana dentro de `window_ms`.
/// Una candidata se promueve una sola vez. `candidates` = (id, instante).
pub fn promote_candidates(
    moments: &[KeyMoment],
    candidates: &[(CaptureId, MediaMs)],
    window_ms: u64,
) -> Vec<CaptureId> {
    let mut picked: Vec<CaptureId> = Vec::new();
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

#[cfg(test)]
mod tests {
    use super::*;
    use acta_core::ids::MeetingId;
    use acta_core::screen::CaptureReason;

    fn tema(t: &str, a: u64, b: u64, sub: Vec<Tema>, caps: Vec<String>) -> Tema {
        Tema { titulo: t.into(), resumen: String::new(), inicio_ms: a, fin_ms: b, subtemas: sub, capturas: caps }
    }

    fn esc() -> Escaleta {
        Escaleta {
            temas: vec![
                tema("Intro", 0, 60_000, vec![], vec![]),
                tema(
                    "Plan",
                    60_000,
                    600_000,
                    vec![tema("Fechas", 100_000, 200_000, vec![], vec![CaptureId::from_u128(5).to_string()])],
                    vec![],
                ),
            ],
        }
    }

    fn cap(n: u128, at: u64) -> Capture {
        Capture {
            id: CaptureId::from_u128(n),
            meeting_id: MeetingId::from_u128(1),
            at: MediaMs(at),
            at_wall: acta_core::time::UnixMs(0),
            path: "captures/x.jpg".into(),
            reason: CaptureReason::SlideChange,
            phash: "0".repeat(16),
            width: 1,
            height: 1,
            keyword: None,
            topic_path: None,
            action_item_ids: vec![],
        }
    }

    #[test]
    fn deepest_topic_path_by_time() {
        let e = esc();
        assert_eq!(topic_path_for(&e, MediaMs(30_000)).as_deref(), Some("1"));
        assert_eq!(topic_path_for(&e, MediaMs(150_000)).as_deref(), Some("2.1"));
        assert_eq!(topic_path_for(&e, MediaMs(300_000)).as_deref(), Some("2"));
        assert_eq!(topic_path_for(&e, MediaMs(900_000)), None);
    }

    #[test]
    fn llm_listing_wins_over_time() {
        // c5 listada en 2.1 aunque su instante (30 s) cae en el tema 1.
        let links = link_captures(&esc(), &[cap(5, 30_000), cap(6, 30_000)]);
        assert_eq!(links[0].1.as_deref(), Some("2.1"));
        assert_eq!(links[1].1.as_deref(), Some("1"));
    }

    #[test]
    fn promotes_nearest_candidate_within_window_once() {
        let m = |at| KeyMoment { at: MediaMs(at), reason: String::new(), topic: None };
        let cands = vec![
            (CaptureId::from_u128(1), MediaMs(95_000)),
            (CaptureId::from_u128(2), MediaMs(104_000)),
            (CaptureId::from_u128(3), MediaMs(500_000)),
        ];
        let picked = promote_candidates(&[m(100_000), m(101_000), m(300_000)], &cands, PICK_WINDOW_MS);
        // 1.º: la 2 (4 s); 2.º: la 1 (6 s, la 2 ya está usada); 3.º: nada a ±15 s.
        assert_eq!(picked, vec![CaptureId::from_u128(2), CaptureId::from_u128(1)]);
    }
}
