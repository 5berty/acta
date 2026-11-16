#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Favoritas (estrella en reuniones y grupos), su filtro y su alcance de
//! búsqueda, y los datos de uso para sugerir limpiezas.

mod common;

use acta_core::ids::*;
use acta_core::library::*;
use acta_core::minutes::*;
use acta_core::time::{MediaMs, UnixMs};
use acta_core::PortError;
use common::*;

fn query(text: &str, scope: SearchScope) -> SearchQuery {
    SearchQuery { text: text.into(), scope, limit: 10 }
}

#[tokio::test]
async fn migration_adds_favourite_and_usage_columns_with_safe_defaults() {
    let (s, _d, _c) = store();
    seed_meeting(&s, 1, "Daily", T0, &["hola"]).await;
    let m = s.get_meeting(mid(1)).await.unwrap().unwrap();
    assert!(!m.favourite);
    let f = &s.cleanup_facts().await.unwrap()[0];
    assert!(!f.favourite && !f.keep && f.last_opened_at.is_none() && f.last_used_at.is_none());
    assert!(!s.create_group("G".into(), None).await.unwrap().favourite);
}

#[tokio::test]
async fn starring_a_meeting_persists_and_shows_in_summary_and_detail() {
    let (s, _d, _c) = store();
    seed_meeting(&s, 1, "Daily", T0, &["hola"]).await;
    let m = s.set_meeting_favourite(mid(1), true).await.unwrap();
    assert!(m.favourite);
    assert!(s.list_meetings(MeetingQuery::default()).await.unwrap().items[0].favourite);
    assert!(s.get_meeting_detail(mid(1)).await.unwrap().unwrap().meeting.favourite);
    assert!(!s.set_meeting_favourite(mid(1), false).await.unwrap().favourite);
    assert!(matches!(s.set_meeting_favourite(mid(9), true).await, Err(PortError::NotFound(_))));
}

#[tokio::test]
async fn starring_a_group_persists_and_lists() {
    let (s, _d, _c) = store();
    let g = s.create_group("Proyecto".into(), None).await.unwrap();
    assert!(s.set_group_favourite(g.id, true).await.unwrap().favourite);
    assert!(s.list_groups().await.unwrap()[0].favourite);
    assert!(matches!(s.set_group_favourite(GroupId::from_u128(9), true).await, Err(PortError::NotFound(_))));
}

#[tokio::test]
async fn favourites_filter_lists_starred_meetings_and_meetings_of_starred_groups() {
    let (s, _d, _c) = store();
    seed_meeting(&s, 1, "Estrella", T0, &["a"]).await;
    seed_meeting(&s, 2, "En grupo con estrella", T0 + 1, &["b"]).await;
    seed_meeting(&s, 3, "En grupo normal", T0 + 2, &["c"]).await;
    seed_meeting(&s, 4, "Suelta", T0 + 3, &["d"]).await;
    s.set_meeting_favourite(mid(1), true).await.unwrap();
    let starred = s.create_group("Con estrella".into(), None).await.unwrap();
    let plain = s.create_group("Normal".into(), None).await.unwrap();
    s.set_group_favourite(starred.id, true).await.unwrap();
    GroupStore::add_meeting(&s, starred.id, mid(2)).await.unwrap();
    GroupStore::add_meeting(&s, plain.id, mid(3)).await.unwrap();

    let page = s.list_meetings(MeetingQuery { favourites_only: true, ..MeetingQuery::default() }).await.unwrap();
    let ids: Vec<MeetingId> = page.items.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![mid(2), mid(1)]);
    // La estrella de la fila es la suya, no la del grupo.
    assert!(!page.items[0].favourite && page.items[1].favourite);
    // Se combina con el texto.
    let page = s
        .list_meetings(MeetingQuery { favourites_only: true, text: Some("estrella".into()), ..MeetingQuery::default() })
        .await
        .unwrap();
    assert_eq!(page.items.len(), 2);
    let page = s
        .list_meetings(MeetingQuery { favourites_only: true, text: Some("suelta".into()), ..MeetingQuery::default() })
        .await
        .unwrap();
    assert!(page.items.is_empty());
}

#[tokio::test]
async fn search_scoped_to_favourites_covers_starred_meetings_and_starred_groups() {
    let (s, _d, _c) = store();
    for (n, title) in [(1, "Estrella"), (2, "Grupo estrella"), (3, "Suelta")] {
        seed_meeting(&s, n, title, T0 + n as i64, &["hablamos del presupuesto anual"]).await;
        s.index_meeting(mid(n)).await.unwrap();
    }
    assert!(s.search(query("presupuesto", SearchScope::Favourites)).await.unwrap().is_empty());
    s.set_meeting_favourite(mid(1), true).await.unwrap();
    let g = s.create_group("G".into(), None).await.unwrap();
    GroupStore::add_meeting(&s, g.id, mid(2)).await.unwrap();
    s.set_group_favourite(g.id, true).await.unwrap();

    let mut ids: Vec<MeetingId> =
        s.search(query("presupuesto", SearchScope::Favourites)).await.unwrap().iter().map(|h| h.meeting_id).collect();
    ids.sort();
    assert_eq!(ids, vec![mid(1), mid(2)]);
    assert_eq!(s.search(query("presupuesto", SearchScope::All)).await.unwrap().len(), 3);
}

#[tokio::test]
async fn favourites_scope_also_filters_vector_neighbours() {
    let e = TopicEmbedder::new(vec![vec!["presupuesto", "dinero"]]);
    let (s, _d, _c) = store_with_embedder(e);
    seed_meeting(&s, 1, "A", T0, &["revisamos el presupuesto"]).await;
    seed_meeting(&s, 2, "B", T0 + 1, &["revisamos el presupuesto"]).await;
    s.index_meeting(mid(1)).await.unwrap();
    s.index_meeting(mid(2)).await.unwrap();
    s.set_meeting_favourite(mid(2), true).await.unwrap();
    // "dinero" no está en el texto: solo lo encuentra el vector.
    let hits = s.search(query("dinero", SearchScope::Favourites)).await.unwrap();
    assert_eq!(hits.iter().map(|h| h.meeting_id).collect::<Vec<_>>(), vec![mid(2)]);
}

#[tokio::test]
async fn touching_a_meeting_records_last_opened_and_last_used() {
    let (s, _d, c) = store();
    seed_meeting(&s, 1, "Daily", T0, &["hola"]).await;
    c.advance_ms(60_000);
    s.touch_meeting(mid(1), MeetingTouch::Opened, UnixMs(T0 + 5)).await.unwrap();
    s.touch_meeting(mid(1), MeetingTouch::Used, UnixMs(T0 + 9)).await.unwrap();
    let f = &s.cleanup_facts().await.unwrap()[0];
    assert_eq!((f.last_opened_at, f.last_used_at), (Some(UnixMs(T0 + 5)), Some(UnixMs(T0 + 9))));
    // Un uso más antiguo no retrocede la marca y tocar no cambia `updated_at`.
    s.touch_meeting(mid(1), MeetingTouch::Opened, UnixMs(T0 + 1)).await.unwrap();
    assert_eq!(s.cleanup_facts().await.unwrap()[0].last_opened_at, Some(UnixMs(T0 + 5)));
    assert_eq!(s.get_meeting(mid(1)).await.unwrap().unwrap().updated_at, UnixMs(T0));
    // Tocar una reunión borrada no es un error (carrera con el borrado).
    s.touch_meeting(mid(9), MeetingTouch::Used, UnixMs(T0)).await.unwrap();
}

fn minutes_with_tasks(meeting: u128, mine_open: bool) -> MinutesOutput {
    let item = |n: u128, mine: bool, done: bool| ActionItem {
        id: ActionItemId::from_u128(meeting * 100 + n),
        meeting_id: mid(meeting),
        text: format!("tarea {n}"),
        owner_name: None,
        owner_speaker_id: None,
        is_mine: mine,
        due: None,
        done,
        at: None,
        capture_ids: vec![],
    };
    MinutesOutput {
        minutes: Minutes {
            meeting_id: mid(meeting),
            summary_md: "- r".into(),
            decisions: vec![],
            action_items: vec![item(1, true, !mine_open), item(2, false, false)],
            provider: "p".into(),
            model: None,
            generated_at: UnixMs(T0),
        },
        escaleta: Escaleta { temas: vec![] },
        key_moments: vec![],
        suggested_title: None,
    }
}

#[tokio::test]
async fn cleanup_facts_report_content_tasks_groups_and_keep() {
    let (s, _d, _c) = store();
    seed_meeting(&s, 1, "Vieja", T0, &["uno dos tres", "cuatro cinco"]).await;
    seed_meeting(&s, 2, "Nueva", T0 + 10, &[]).await;
    s.patch_meeting(mid(1), MeetingPatch { duration: Some(MediaMs(61_000)), status: Some(MeetingStatus::Ready), ..MeetingPatch::default() })
        .await
        .unwrap();
    s.save_minutes(minutes_with_tasks(1, true)).await.unwrap();
    let g = s.create_group("G".into(), None).await.unwrap();
    GroupStore::add_meeting(&s, g.id, mid(1)).await.unwrap();

    let facts = s.cleanup_facts().await.unwrap();
    assert_eq!(facts.iter().map(|f| f.id).collect::<Vec<_>>(), vec![mid(1), mid(2)], "de la más antigua a la más nueva");
    let f = &facts[0];
    assert_eq!((f.title.as_str(), f.duration, f.status), ("Vieja", MediaMs(61_000), MeetingStatus::Ready));
    assert_eq!((f.word_count, f.my_open_tasks, f.has_minutes), (5, 1, true));
    assert!(!f.in_favourite_group);
    assert_eq!((facts[1].word_count, facts[1].has_minutes), (0, false));

    s.set_group_favourite(g.id, true).await.unwrap();
    s.set_cleanup_keep(mid(2), true).await.unwrap();
    s.save_minutes(minutes_with_tasks(1, false)).await.unwrap();
    let facts = s.cleanup_facts().await.unwrap();
    assert!(facts[0].in_favourite_group && facts[0].my_open_tasks == 0);
    assert!(facts[1].keep);
    assert!(matches!(s.set_cleanup_keep(mid(9), true).await, Err(PortError::NotFound(_))));
}
