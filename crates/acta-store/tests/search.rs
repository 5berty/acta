#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Indexado, búsqueda híbrida, Retriever, embeddings falsos y sugerencia de grupos.

mod common;

use acta_core::chat::{ChatScope, Retriever};
use acta_core::library::*;
use acta_core::time::MediaMs;
use acta_store::embeddings::{e5_prefixed, HashEmbedder};
use common::*;
use pretty_assertions::assert_eq;

fn topics() -> Vec<Vec<&'static str>> {
    vec![vec!["presupuesto", "dinero", "coste"], vec!["contratacion", "fichar", "candidato"], vec!["vacaciones", "descanso"]]
}

fn query(text: &str, scope: SearchScope) -> SearchQuery {
    SearchQuery { text: text.into(), scope, limit: 10 }
}

async fn count(s: &acta_store::SqliteStore, table: &'static str) -> i64 {
    s.with_conn(move |c| Ok(c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)).unwrap())).await.unwrap()
}

#[test]
fn e5_prefixes() {
    assert_eq!(e5_prefixed(EmbedKind::Query, "hola"), "query: hola");
    assert_eq!(e5_prefixed(EmbedKind::Passage, "hola"), "passage: hola");
}

#[tokio::test]
async fn hash_embedder_is_deterministic_normalized_and_overlap_aware() {
    let e = HashEmbedder;
    assert_eq!((e.dims(), e.model_id()), (384, "hash-bow-384"));
    let v = e.embed(vec!["el presupuesto anual".into(), "el presupuesto anual".into(), "paella valenciana".into()], EmbedKind::Passage).await.unwrap();
    assert_eq!(v[0], v[1]);
    let n: f32 = v[0].iter().map(|x| x * x).sum();
    assert!((n - 1.0).abs() < 1e-4);
    assert!(acta_store::vectors::cosine(&v[0], &v[1]) > acta_store::vectors::cosine(&v[0], &v[2]));
}

#[tokio::test]
async fn index_creates_chunks_with_citable_timestamps_and_vectors() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    seed_meeting(&s, 1, "Planificación", T0, &["Hablemos del presupuesto", "De acuerdo"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    assert_eq!(count(&s, "chunks").await, 1);
    assert_eq!(count(&s, "vec_chunks").await, 1);
    assert_eq!(count(&s, "vec_meetings").await, 1);

    let (start, end): (i64, i64) = s.with_conn(|c| Ok(c.query_row("SELECT start_ms, end_ms FROM chunks", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap())).await.unwrap();
    assert_eq!((start, end), (0, 19_000));

    // Reindexar reemplaza, no duplica.
    s.index_meeting(mid(1)).await.unwrap();
    assert_eq!((count(&s, "chunks").await, count(&s, "vec_chunks").await, count(&s, "vec_meetings").await), (1, 1, 1));
    let meta: String = s.with_conn(|c| Ok(c.query_row("SELECT value FROM embedding_meta WHERE key='model'", [], |r| r.get(0)).unwrap())).await.unwrap();
    assert_eq!(meta, "fake-topics");

    assert!(matches!(s.index_meeting(mid(9)).await, Err(acta_core::PortError::NotFound(_))));
}

#[tokio::test]
async fn embedder_receives_passage_for_index_and_query_for_search() {
    let e = TopicEmbedder::new(topics());
    let (s, _d, _c) = store_with_embedder(e.clone());
    seed_meeting(&s, 1, "R", T0, &["presupuesto"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    s.search(query("presupuesto", SearchScope::All)).await.unwrap();
    assert_eq!(*e.seen.lock().unwrap(), vec![EmbedKind::Passage, EmbedKind::Query]);
}

#[tokio::test]
async fn fts_search_is_accent_insensitive_and_returns_citation_data() {
    let (s, _d, _c) = store(); // sin embedder: solo BM25
    seed_meeting(&s, 1, "Planificación Q4", T0, &["Revisamos la planificación del trimestre", "Sí, de acuerdo"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    let hits = s.search(query("planificacion", SearchScope::All)).await.unwrap();
    assert_eq!(hits.len(), 1);
    let h = &hits[0];
    assert_eq!((h.meeting_id, h.meeting_title.as_str(), h.started_at.0), (mid(1), "Planificación Q4", T0));
    assert_eq!((h.at, h.end), (MediaMs(0), MediaMs(19_000)));
    assert_eq!(h.speaker.as_deref(), Some("Yo"));
    assert!(h.snippet.to_lowercase().contains("planificación"));
    assert!(h.score > 0.0);
}

#[tokio::test]
async fn hybrid_finds_semantic_matches_that_fts_cannot() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    seed_meeting(&s, 1, "Finanzas", T0, &["Tenemos que cerrar el presupuesto anual"]).await;
    seed_meeting(&s, 2, "RRHH", T0 + 1000, &["Abrimos la contratación de un candidato"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    s.index_meeting(mid(2)).await.unwrap();

    // "dinero" no aparece en ningún texto: solo el vector lo relaciona con "presupuesto".
    let hits = s.search(query("dinero", SearchScope::All)).await.unwrap();
    assert_eq!(hits[0].meeting_id, mid(1));
}

#[tokio::test]
async fn hybrid_ranks_chunk_present_in_both_signals_first() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    // Solo texto (otro tema semántico) vs. texto + semántica.
    seed_meeting(&s, 1, "A", T0, &["El coste del descanso es alto"]).await; // "coste" -> eje presupuesto + "descanso" -> eje vacaciones
    seed_meeting(&s, 2, "B", T0 + 1, &["Hablemos del presupuesto y del coste"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    s.index_meeting(mid(2)).await.unwrap();
    let hits = s.search(query("presupuesto coste", SearchScope::All)).await.unwrap();
    assert_eq!(hits[0].meeting_id, mid(2));
}

#[tokio::test]
async fn scopes_restrict_results() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    seed_meeting(&s, 1, "A", T0, &["presupuesto de marketing"]).await;
    seed_meeting(&s, 2, "B", T0 + 1, &["presupuesto de ingeniería"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    s.index_meeting(mid(2)).await.unwrap();
    let g = s.create_group("G".into(), None).await.unwrap();
    s.add_meeting(g.id, mid(2)).await.unwrap();

    assert_eq!(s.search(query("presupuesto", SearchScope::All)).await.unwrap().len(), 2);
    let by_meeting = s.search(query("presupuesto", SearchScope::Meeting { meeting_id: mid(1) })).await.unwrap();
    assert!(by_meeting.iter().all(|h| h.meeting_id == mid(1)) && !by_meeting.is_empty());
    let by_group = s.search(query("presupuesto", SearchScope::Group { group_id: g.id })).await.unwrap();
    assert!(by_group.iter().all(|h| h.meeting_id == mid(2)) && !by_group.is_empty());
}

#[tokio::test]
async fn embedder_failure_degrades_to_fts_and_blank_query_is_empty() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::failing());
    seed_meeting(&s, 1, "A", T0, &["hablemos del presupuesto"]).await;
    // Sin vectores disponibles, index_meeting sigue dejando chunks + FTS.
    s.index_meeting(mid(1)).await.unwrap();
    assert_eq!(count(&s, "chunks").await, 1);
    assert_eq!(count(&s, "vec_chunks").await, 0);
    assert_eq!(s.search(query("presupuesto", SearchScope::All)).await.unwrap().len(), 1);
    assert!(s.search(query("  ?? ", SearchScope::All)).await.unwrap().is_empty());
}

#[tokio::test]
async fn search_limit_is_respected() {
    let (s, _d, _c) = store();
    for n in 1..=4u128 {
        seed_meeting(&s, n, &format!("R{n}"), T0 + n as i64, &["presupuesto"]).await;
        s.index_meeting(mid(n)).await.unwrap();
    }
    let hits = s.search(SearchQuery { text: "presupuesto".into(), scope: SearchScope::All, limit: 2 }).await.unwrap();
    assert_eq!(hits.len(), 2);
}

#[tokio::test]
async fn remove_and_delete_clean_up_vectors_and_fts() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    seed_meeting(&s, 1, "A", T0, &["presupuesto"]).await;
    seed_meeting(&s, 2, "B", T0, &["presupuesto"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    s.index_meeting(mid(2)).await.unwrap();

    SearchIndex::unindex_meeting(&s, mid(1)).await.unwrap();
    assert_eq!((count(&s, "chunks").await, count(&s, "vec_chunks").await, count(&s, "vec_meetings").await), (1, 1, 1));
    // La reunión sigue existiendo, solo se quitó del índice.
    assert!(s.get_meeting(mid(1)).await.unwrap().is_some());

    s.delete_meeting(mid(2)).await.unwrap();
    assert_eq!((count(&s, "chunks").await, count(&s, "vec_chunks").await, count(&s, "vec_meetings").await), (0, 0, 0));
    assert!(s.search(query("presupuesto", SearchScope::All)).await.unwrap().is_empty());
}

#[tokio::test]
async fn retriever_returns_full_chunks_for_chat_scope() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    seed_meeting(&s, 1, "Finanzas", T0, &["Cerramos el presupuesto", "Perfecto, presupuesto aprobado"]).await;
    seed_meeting(&s, 2, "RRHH", T0 + 1, &["Hablamos de vacaciones"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    s.index_meeting(mid(2)).await.unwrap();

    let got = s.retrieve("presupuesto", &ChatScope::All, 12).await.unwrap();
    assert_eq!(got[0].meeting_id, mid(1));
    assert_eq!(got[0].meeting_title, "Finanzas");
    assert!(got[0].text.contains("Yo: Cerramos el presupuesto"));
    assert!(got[0].text.contains("Speaker 1: Perfecto"));
    assert_eq!((got[0].start, got[0].end), (MediaMs(0), MediaMs(19_000)));
    assert_eq!(got[0].started_at.0, T0);
    assert!(got[0].chunk_id > 0 && got[0].score > 0.0);

    let only2 = s.retrieve("vacaciones", &ChatScope::Meeting { meeting_id: mid(2) }, 5).await.unwrap();
    assert!(only2.iter().all(|c| c.meeting_id == mid(2)));
    assert_eq!(s.retrieve("presupuesto", &ChatScope::All, 1).await.unwrap().len(), 1);
}

// ---------- sugerencia de grupos ----------

#[tokio::test]
async fn suggest_groups_clusters_by_meeting_embedding_excluding_manual_groups() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    for n in 1..=4u128 {
        seed_meeting(&s, n, &format!("Fin {n}"), T0 + n as i64, &["revisión del presupuesto"]).await;
        s.index_meeting(mid(n)).await.unwrap();
    }
    for n in 5..=7u128 {
        seed_meeting(&s, n, &format!("RRHH {n}"), T0 + n as i64, &["abrir contratación de candidato"]).await;
        s.index_meeting(mid(n)).await.unwrap();
    }
    seed_meeting(&s, 8, "Suelta", T0, &["vacaciones de verano"]).await;
    s.index_meeting(mid(8)).await.unwrap();

    // La 4 ya está en un grupo manual: no entra en sugerencias.
    let manual = s.create_group("Manual".into(), None).await.unwrap();
    s.add_meeting(manual.id, mid(4)).await.unwrap();

    let sugg = s.suggest_groups().await.unwrap();
    assert_eq!(sugg.len(), 2);
    assert!(sugg.iter().all(|g| g.name.is_none() && g.description.is_none() && g.cohesion > 0.99));
    let mut sets: Vec<Vec<_>> = sugg.iter().map(|g| { let mut v = g.meeting_ids.clone(); v.sort(); v }).collect();
    sets.sort();
    assert_eq!(sets, vec![vec![mid(1), mid(2), mid(3)], vec![mid(5), mid(6), mid(7)]]);

    // Determinista salvo ids provisionales.
    let again = s.suggest_groups().await.unwrap();
    assert_eq!(again.iter().map(|g| g.meeting_ids.clone()).collect::<Vec<_>>(), sugg.iter().map(|g| g.meeting_ids.clone()).collect::<Vec<_>>());
}

/// Aceptar una sugerencia crea un grupo: esas reuniones no se vuelven a proponer.
#[tokio::test]
async fn meetings_of_an_accepted_suggestion_are_not_suggested_again() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    for n in 1..=3u128 {
        seed_meeting(&s, n, &format!("Fin {n}"), T0 + n as i64, &["revisión del presupuesto"]).await;
        s.index_meeting(mid(n)).await.unwrap();
    }
    let sugg = s.suggest_groups().await.unwrap();
    assert_eq!(sugg.len(), 1);
    s.save_suggestions(sugg.clone()).await.unwrap();
    s.accept_suggestion(sugg[0].id, Some("Finanzas".into())).await.unwrap();
    assert!(s.suggest_groups().await.unwrap().is_empty(), "ya están en el grupo aceptado");
}

#[tokio::test]
async fn suggest_groups_needs_embeddings_and_enough_meetings() {
    let (s, _d, _c) = store();
    assert!(s.suggest_groups().await.unwrap().is_empty());
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    for n in 1..=2u128 {
        seed_meeting(&s, n, "x", T0, &["presupuesto"]).await;
        s.index_meeting(mid(n)).await.unwrap();
    }
    assert!(s.suggest_groups().await.unwrap().is_empty()); // mínimo 3
}

#[tokio::test]
async fn stale_meetings_tracks_embedding_failures() {
    // Embedder configurado pero roto: queda marcada.
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::failing());
    seed_meeting(&s, 2, "B", T0 + 2, &["presupuesto"]).await;
    seed_meeting(&s, 1, "A", T0 + 1, &["presupuesto"]).await;
    s.index_meeting(mid(2)).await.unwrap();
    s.index_meeting(mid(1)).await.unwrap();
    assert_eq!(s.stale_meetings().await.unwrap(), vec![mid(1), mid(2)]);

    // Sin embedder: FTS-only es el estado esperado, no es stale.
    let (s, _d, _c) = store();
    seed_meeting(&s, 1, "A", T0, &["presupuesto"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    assert!(s.stale_meetings().await.unwrap().is_empty());

    // Embedder sano: no stale.
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    seed_meeting(&s, 1, "A", T0, &["presupuesto"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    assert!(s.stale_meetings().await.unwrap().is_empty());
}

#[tokio::test]
async fn reindex_success_clears_stale_flag() {
    let (s, _d, _c) = store_with_embedder(TopicEmbedder::new(topics()));
    seed_meeting(&s, 1, "A", T0, &["presupuesto"]).await;
    s.with_conn(|c| Ok(c.execute("UPDATE meetings SET index_stale = 1", []).unwrap())).await.unwrap();
    assert_eq!(s.stale_meetings().await.unwrap(), vec![mid(1)]);
    s.index_meeting(mid(1)).await.unwrap();
    assert!(s.stale_meetings().await.unwrap().is_empty());
}
