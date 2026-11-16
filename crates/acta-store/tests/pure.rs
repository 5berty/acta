#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Lógica pura: texto/FTS, vectores, troceado, RRF, clustering y timeline.

use acta_core::ids::{ActionItemId, CaptureId, DecisionId, MeetingId};
use acta_core::minutes::{ActionItem, Decision, Escaleta, Tema, TimelineKind};
use acta_core::screen::{Capture, CaptureReason, ScreenShare};
use acta_core::time::{MediaMs, UnixMs};
use acta_store::clustering::agglomerative;
use acta_store::meetings::timeline::derive_timeline;
use acta_store::search::chunking::{chunk_utterances, estimate_tokens, ChunkUtterance, MAX_TOKENS, TARGET_TOKENS};
use acta_store::search::rrf::reciprocal_rank_fusion;
use acta_store::text::{fold_text, fts_and_query, fts_or_query};
use acta_store::vectors::{blob_to_vec, cosine, normalize, vec_to_blob};

// ---------- texto ----------

#[test]
fn fold_removes_spanish_diacritics_and_lowercases() {
    assert_eq!(fold_text("Reunión de PLANIFICACIÓN, ñandú"), "reunion de planificacion, nandu");
}

#[test]
fn fts_queries_quote_tokens_and_drop_operators() {
    assert_eq!(fts_or_query("¿Qué plazo, OR \"x\" (acordamos)?").unwrap(), "\"Qué\" OR \"plazo\" OR \"OR\" OR \"x\" OR \"acordamos\"");
    assert_eq!(fts_and_query("plazo entrega").unwrap(), "\"plazo\" \"entrega\"");
    assert!(fts_or_query("  ?!  ").is_none());
}

// ---------- vectores ----------

#[test]
fn blob_roundtrip_and_bad_length() {
    let v = vec![1.0_f32, -2.5, 0.125];
    assert_eq!(blob_to_vec(&vec_to_blob(&v)).unwrap(), v);
    assert!(blob_to_vec(&[1, 2, 3]).is_none());
}

#[test]
fn cosine_basics() {
    assert!((cosine(&[1.0, 0.0], &[2.0, 0.0]) - 1.0).abs() < 1e-6);
    assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
    assert!((cosine(&[1.0, 0.0], &[-1.0, 0.0]) + 1.0).abs() < 1e-6);
    // dims distintas o vector nulo: 0, nunca NaN.
    assert_eq!(cosine(&[1.0], &[1.0, 2.0]), 0.0);
    assert_eq!(cosine(&[0.0, 0.0], &[1.0, 2.0]), 0.0);
}

#[test]
fn normalize_gives_unit_norm() {
    let n = normalize(&[3.0, 4.0]);
    assert!((n[0] - 0.6).abs() < 1e-6 && (n[1] - 0.8).abs() < 1e-6);
    assert_eq!(normalize(&[0.0, 0.0]), vec![0.0, 0.0]);
}

// ---------- chunking ----------

fn utt(speaker: &str, start: u64, end: u64, text: &str) -> ChunkUtterance {
    ChunkUtterance { speaker: speaker.into(), start_ms: start, end_ms: end, text: text.into() }
}

#[test]
fn short_meeting_is_one_chunk_with_name_prefixed_lines() {
    let chunks = chunk_utterances(&[utt("Yo", 0, 1000, "Hola a todos"), utt("Ana", 1000, 2500, "Buenas")]);
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].start_ms, 0);
    assert_eq!(chunks[0].end_ms, 2500);
    assert_eq!(chunks[0].text, "Yo: Hola a todos\nAna: Buenas");
}

#[test]
fn empty_and_blank_utterances_yield_nothing() {
    assert!(chunk_utterances(&[]).is_empty());
    assert!(chunk_utterances(&[utt("Yo", 0, 10, "   ")]).is_empty());
}

#[test]
fn chunks_close_at_target_on_speaker_turns_and_never_exceed_max() {
    // ~100 tokens por intervención, alternando hablantes.
    let sentence = "palabra ".repeat(50);
    let utts: Vec<_> = (0..20)
        .map(|i| utt(if i % 2 == 0 { "Yo" } else { "Ana" }, i * 1000, i * 1000 + 900, &sentence))
        .collect();
    let chunks = chunk_utterances(&utts);
    assert!(chunks.len() > 1);
    for c in &chunks {
        let t = estimate_tokens(&c.text);
        assert!(t <= MAX_TOKENS, "chunk de {t} tokens");
    }
    // Todos menos el último alcanzan el objetivo.
    for c in &chunks[..chunks.len() - 1] {
        assert!(estimate_tokens(&c.text) >= TARGET_TOKENS);
    }
    // Orden temporal y sin perder intervenciones.
    assert!(chunks.windows(2).all(|w| w[0].end_ms <= w[1].start_ms));
    let lines: usize = chunks.iter().map(|c| c.text.lines().count()).sum();
    assert_eq!(lines, 20);
}

#[test]
fn single_giant_utterance_is_split_within_max_and_keeps_time_bounds() {
    let giant = "palabra ".repeat(1500);
    let chunks = chunk_utterances(&[utt("Ana", 10_000, 70_000, &giant)]);
    assert!(chunks.len() >= 3);
    assert_eq!(chunks.first().unwrap().start_ms, 10_000);
    assert_eq!(chunks.last().unwrap().end_ms, 70_000);
    assert!(chunks.iter().all(|c| estimate_tokens(&c.text) <= MAX_TOKENS));
    assert!(chunks.windows(2).all(|w| w[0].end_ms <= w[1].start_ms));
}

// ---------- RRF ----------

#[test]
fn rrf_rewards_items_present_in_both_lists() {
    let fused = reciprocal_rank_fusion(&[vec![1, 2, 3], vec![3, 4, 1]], 60.0);
    let ids: Vec<i64> = fused.iter().map(|(i, _)| *i).collect();
    // 1: 1/61+1/63, 3: 1/63+1/61 (empate) -> desempata el id menor; luego 2 y 4 (1/62 y 1/62).
    assert_eq!(ids, vec![1, 3, 2, 4]);
    assert!((fused[0].1 - (1.0 / 61.0 + 1.0 / 63.0)).abs() < 1e-6);
}

#[test]
fn rrf_handles_empty_inputs() {
    assert!(reciprocal_rank_fusion(&[], 60.0).is_empty());
    assert_eq!(reciprocal_rank_fusion(&[vec![], vec![7]], 60.0).len(), 1);
}

// ---------- clustering ----------

fn near(axis: usize, dims: usize, wobble: f32) -> Vec<f32> {
    let mut v = vec![0.0; dims];
    v[axis] = 1.0;
    v[(axis + 1) % dims] = wobble;
    v
}

#[test]
fn agglomerative_groups_close_vectors_and_drops_small_clusters() {
    let embs = vec![
        near(0, 4, 0.05),
        near(0, 4, 0.10),
        near(0, 4, 0.02),
        near(2, 4, 0.05),
        near(2, 4, 0.08),
        near(3, 4, 0.0),
    ];
    let clusters = agglomerative(&embs, 0.80, 2);
    let mut members: Vec<Vec<usize>> = clusters.iter().map(|c| c.members.clone()).collect();
    members.sort();
    assert_eq!(members, vec![vec![0, 1, 2], vec![3, 4]]);
    assert!(clusters.iter().all(|c| c.cohesion >= 0.80 && c.cohesion <= 1.0 + 1e-6));
}

#[test]
fn agglomerative_min_size_filters_and_is_deterministic() {
    let embs = vec![near(0, 4, 0.05), near(0, 4, 0.10), near(2, 4, 0.0), near(2, 4, 0.01)];
    let a = agglomerative(&embs, 0.80, 3);
    assert!(a.is_empty());
    let b = agglomerative(&embs, 0.80, 2);
    let c = agglomerative(&embs, 0.80, 2);
    assert_eq!(b.iter().map(|x| x.members.clone()).collect::<Vec<_>>(), c.iter().map(|x| x.members.clone()).collect::<Vec<_>>());
    assert_eq!(b.len(), 2);
}

// ---------- timeline ----------

fn tema(titulo: &str, ini: u64, fin: u64, sub: Vec<Tema>) -> Tema {
    Tema { titulo: titulo.into(), resumen: String::new(), inicio_ms: ini, fin_ms: fin, subtemas: sub, capturas: vec![] }
}

#[test]
fn timeline_merges_topics_decisions_tasks_and_captures_in_media_order() {
    let m = MeetingId::from_u128(1);
    let esc = Escaleta { temas: vec![tema("Presupuesto", 0, 60_000, vec![tema("Capex", 10_000, 30_000, vec![])]), tema("Plazos", 60_000, 90_000, vec![])] };
    let decisions = vec![
        Decision { id: DecisionId::from_u128(2), text: "Aprobado".into(), at: Some(MediaMs(45_000)) },
        Decision { id: DecisionId::from_u128(3), text: "Sin momento".into(), at: None },
    ];
    let items = vec![ActionItem {
        id: ActionItemId::from_u128(4),
        meeting_id: m,
        text: "Enviar informe".into(),
        owner_name: None,
        owner_speaker_id: None,
        is_mine: true,
        due: None,
        done: false,
        at: Some(MediaMs(60_000)),
        capture_ids: vec![],
    }];
    let captures = vec![Capture {
        id: CaptureId::from_u128(5),
        meeting_id: m,
        at: MediaMs(10_000),
        at_wall: UnixMs(0),
        path: "captures/x.jpg".into(),
        reason: CaptureReason::Keyword,
        phash: "0".repeat(16),
        width: 1,
        height: 1,
        keyword: Some("deadline".into()),
        topic_path: None,
        action_item_ids: vec![],
    }];
    let tl = derive_timeline(&esc, &decisions, &items, &captures, &[]);
    let kinds: Vec<_> = tl.iter().map(|e| (e.at.0, e.kind)).collect();
    assert_eq!(
        kinds,
        vec![
            (0, TimelineKind::Topic),
            (10_000, TimelineKind::Topic),
            (10_000, TimelineKind::Capture),
            (45_000, TimelineKind::Decision),
            (60_000, TimelineKind::Topic),
            (60_000, TimelineKind::ActionItem),
        ]
    );
    assert_eq!(tl[1].label, "Capex");
    assert_eq!(tl[1].end, Some(MediaMs(30_000)));
    assert_eq!(tl[1].ref_id.as_deref(), Some("1.1"));
    assert_eq!(tl[2].ref_id.as_deref(), Some(CaptureId::from_u128(5).to_string().as_str()));
    assert!(tl[2].label.contains("deadline"));
}

#[test]
fn timeline_includes_screen_shares_with_presenter_labels() {
    let shares = vec![
        ScreenShare { start: MediaMs(5_000), end: Some(MediaMs(9_000)), presenter: None },
        ScreenShare { start: MediaMs(1_000), end: None, presenter: Some("Ana".into()) },
    ];
    let tl = derive_timeline(&Escaleta::default(), &[], &[], &[], &shares);
    assert_eq!(tl.len(), 2);
    assert_eq!((tl[0].at, tl[0].end, tl[0].kind), (MediaMs(1_000), None, TimelineKind::ScreenShare));
    assert_eq!(tl[0].label, "Comparte: Ana");
    assert_eq!(tl[0].ref_id, None);
    assert_eq!((tl[1].at, tl[1].end), (MediaMs(5_000), Some(MediaMs(9_000))));
    assert_eq!(tl[1].label, "Pantalla compartida");
}
