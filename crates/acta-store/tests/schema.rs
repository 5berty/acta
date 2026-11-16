#![allow(clippy::expect_used, clippy::unwrap_used)]
//! La migración inicial aplica limpia, con FTS5 y sqlite-vec disponibles.

use acta_store::db;

#[test]
fn initial_migration_applies_with_fts5_and_vec() {
    let dir = tempfile::tempdir().expect("tmp");
    let conn = db::open(&dir.path().join("acta.db")).expect("open + migrate");

    let version: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).expect("v");
    assert_eq!(version as usize, db::MIGRATIONS.len());

    let vec_version: String = conn.query_row("SELECT vec_version()", [], |r| r.get(0)).expect("vec");
    assert!(vec_version.starts_with('v'), "{vec_version}");

    // FTS5 sin acentos.
    conn.execute_batch(
        "INSERT INTO meetings(id,title,platform,started_at,status,created_at,updated_at)
           VALUES ('m1','Daily','teams',0,'ready',0,0);
         INSERT INTO speakers(id,meeting_id,label,track,name_source) VALUES ('s1','m1','Yo','mic','me');
         INSERT INTO utterances(meeting_id,idx,speaker_id,track,start_ms,end_ms,text)
           VALUES ('m1',0,'s1','mic',0,1000,'La reunión de planificación');",
    )
    .expect("insert");
    let hits: i64 = conn
        .query_row("SELECT count(*) FROM utterances_fts WHERE utterances_fts MATCH 'reunion'", [], |r| r.get(0))
        .expect("fts");
    assert_eq!(hits, 1);
}

#[test]
fn migrate_is_idempotent() {
    let dir = tempfile::tempdir().expect("tmp");
    let path = dir.path().join("acta.db");
    drop(db::open(&path).expect("first"));
    drop(db::open(&path).expect("second"));
}

#[test]
fn migration_two_adds_flags_and_screen_shares() {
    let dir = tempfile::tempdir().expect("tmp");
    let conn = db::open(&dir.path().join("acta.db")).expect("open");
    assert!(db::MIGRATIONS.len() >= 2);
    conn.execute_batch(
        "INSERT INTO meetings(id,title,platform,started_at,status,created_at,updated_at) VALUES ('m1','D','teams',0,'ready',0,0);
         INSERT INTO screen_shares(meeting_id,start_ms,end_ms,presenter) VALUES ('m1',0,NULL,NULL);",
    )
    .expect("insert");
    let (te, st): (i64, i64) = conn.query_row("SELECT title_edited, index_stale FROM meetings", [], |r| Ok((r.get(0)?, r.get(1)?))).expect("flags");
    assert_eq!((te, st), (0, 0));
}
