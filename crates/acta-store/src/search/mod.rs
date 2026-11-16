//! Indexado y búsqueda híbrida (FTS5 BM25 + sqlite-vec, fusión RRF).
//!
//! - `index_meeting`: trocea el transcript por turnos (`chunking`), guarda los
//!   chunks (FTS5 los indexa por trigger), sus vectores y el embedding medio
//!   de la reunión (para sugerir grupos).
//! - `search`/`retrieve`: BM25 top 50 + vectores top 50 -> RRF (k=60), filtrado
//!   por `SearchScope`. Sin embedder (o si falla) se degrada a solo FTS.

pub mod chunking;
pub mod rrf;

use crate::codec::*;
use crate::db::{SqliteStore, EMBEDDING_DIMS};
use crate::text::fts_or_query;
use crate::vectors::{normalize, vec_to_blob};
use acta_core::chat::{ChatScope, RetrievedChunk, Retriever};
use acta_core::ids::MeetingId;
use acta_core::library::*;
use acta_core::time::{MediaMs, UnixMs};
use acta_core::{PortError, PortResult};
use async_trait::async_trait;
use chunking::{chunk_utterances, ChunkUtterance};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

const CANDIDATES: usize = 50;
const RRF_K: f32 = 60.0;
/// Con filtro de alcance, sqlite-vec no filtra antes del KNN: se pide más y se filtra después.
const SCOPED_VEC_K: usize = 1000;
/// Un vecino a más distancia coseno que esto no cuenta como coincidencia semántica.
const VEC_MAX_DISTANCE: f32 = 0.6;
const SNIPPET_CHARS: usize = 240;

/// Borra chunks (y FTS por trigger), vectores de chunks y el embedding de la reunión.
/// sqlite-vec no tiene cascada: hay que limpiar a mano.
pub(crate) fn purge_index(conn: &Connection, meeting: MeetingId) -> PortResult<()> {
    let mid = meeting.to_string();
    let chunk_ids = conn
        .prepare("SELECT id FROM chunks WHERE meeting_id = ?1")
        .and_then(|mut st| st.query_map([&mid], |r| r.get::<_, i64>(0))?.collect::<Result<Vec<_>, _>>())
        .map_err(sql_err)?;
    for id in chunk_ids {
        conn.execute("DELETE FROM vec_chunks WHERE chunk_id = ?1", [id]).map_err(sql_err)?;
    }
    conn.execute("DELETE FROM chunks WHERE meeting_id = ?1", [&mid]).map_err(sql_err)?;
    let rowid: Option<i64> = conn.query_row("SELECT rowid_alias FROM meetings WHERE id = ?1", [&mid], |r| r.get(0)).optional().map_err(sql_err)?;
    if let Some(r) = rowid {
        conn.execute("DELETE FROM vec_meetings WHERE meeting_rowid = ?1", [r]).map_err(sql_err)?;
    }
    Ok(())
}

/// Fragmento SQL (sobre el alias `c` de `chunks`) para el alcance. Los ids son
/// UUID tipados, por lo que interpolarlos es seguro.
fn scope_sql(scope: &SearchScope) -> String {
    match scope {
        SearchScope::All => "1=1".into(),
        SearchScope::Meeting { meeting_id } => format!("c.meeting_id = '{meeting_id}'"),
        SearchScope::Group { group_id } => {
            format!("c.meeting_id IN (SELECT meeting_id FROM group_meetings WHERE group_id = '{group_id}')")
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ScoredChunk {
    pub chunk_id: i64,
    pub meeting_id: MeetingId,
    pub meeting_title: String,
    pub started_at: UnixMs,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub snippet: String,
    pub speaker: Option<String>,
    pub score: f32,
}

fn truncate_chars(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        return s.to_owned();
    }
    let cut: String = s.chars().take(n).collect();
    format!("{}…", cut.trim_end())
}

impl SqliteStore {
    pub(crate) async fn hybrid_chunks(&self, text: &str, scope: &SearchScope, k: usize) -> PortResult<Vec<ScoredChunk>> {
        let Some(fts) = fts_or_query(text) else { return Ok(vec![]) };
        let query_vec = match &self.embedder {
            Some(e) => match e.embed(vec![text.to_owned()], EmbedKind::Query).await {
                Ok(mut v) if v.len() == 1 && v[0].len() == EMBEDDING_DIMS => v.pop(),
                Ok(_) => {
                    tracing::warn!("embedder devolvió dimensiones inesperadas; solo FTS");
                    None
                }
                Err(e) => {
                    tracing::warn!("embedder no disponible ({e}); solo FTS");
                    None
                }
            },
            None => None,
        };
        let scope_clause = scope_sql(scope);
        let scoped = !matches!(scope, SearchScope::All);
        self.with_conn(move |conn| {
            // 1) BM25
            let mut snippets: HashMap<i64, String> = HashMap::new();
            let fts_rows: Vec<(i64, String)> = conn
                .prepare(&format!(
                    "SELECT c.id, snippet(chunks_fts, 0, '[', ']', '…', 16) FROM chunks_fts
                     JOIN chunks c ON c.id = chunks_fts.rowid
                     WHERE chunks_fts MATCH ?1 AND {scope_clause}
                     ORDER BY bm25(chunks_fts) LIMIT {CANDIDATES}"
                ))
                .and_then(|mut st| st.query_map([&fts], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>())
                .map_err(sql_err)?;
            let fts_ids: Vec<i64> = fts_rows.iter().map(|(i, _)| *i).collect();
            snippets.extend(fts_rows);

            // 2) vectores
            let mut vec_ids: Vec<i64> = Vec::new();
            if let Some(qv) = &query_vec {
                let kk = if scoped { SCOPED_VEC_K } else { CANDIDATES };
                let neighbours = conn
                    .prepare("SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ?1 AND k = ?2 ORDER BY distance")
                    .and_then(|mut st| st.query_map(params![vec_to_blob(qv), kk as i64], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)? as f32)))?.collect::<Result<Vec<_>, _>>())
                    .map_err(sql_err)?;
                for (id, dist) in neighbours {
                    if dist > VEC_MAX_DISTANCE || vec_ids.len() >= CANDIDATES {
                        continue;
                    }
                    if scoped {
                        let ok: bool = conn
                            .query_row(&format!("SELECT EXISTS(SELECT 1 FROM chunks c WHERE c.id = ?1 AND {scope_clause})"), [id], |r| r.get::<_, i64>(0))
                            .map_err(sql_err)?
                            != 0;
                        if !ok {
                            continue;
                        }
                    }
                    vec_ids.push(id);
                }
            }

            // 3) fusión + carga
            let fused = rrf::reciprocal_rank_fusion(&[fts_ids, vec_ids], RRF_K);
            let mut out = Vec::new();
            for (chunk_id, score) in fused.into_iter().take(k) {
                let row = conn
                    .query_row(
                        "SELECT c.meeting_id, m.title, m.started_at, c.start_ms, c.end_ms, c.text,
                                (SELECT COALESCE(s.display_name, s.label) FROM utterances u JOIN speakers s ON s.id = u.speaker_id
                                  WHERE u.meeting_id = c.meeting_id AND u.start_ms = c.start_ms ORDER BY u.idx LIMIT 1)
                         FROM chunks c JOIN meetings m ON m.id = c.meeting_id WHERE c.id = ?1",
                        [chunk_id],
                        |r| Ok((col_id::<MeetingId>(r, 0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, col_u64(r, 3)?, col_u64(r, 4)?, r.get::<_, String>(5)?, r.get::<_, Option<String>>(6)?)),
                    )
                    .optional()
                    .map_err(sql_err)?;
                let Some((meeting_id, meeting_title, started, start_ms, end_ms, text, speaker)) = row else { continue };
                let snippet = snippets.remove(&chunk_id).unwrap_or_else(|| truncate_chars(&text, SNIPPET_CHARS));
                out.push(ScoredChunk { chunk_id, meeting_id, meeting_title, started_at: UnixMs(started), start_ms, end_ms, text, snippet, speaker, score });
            }
            Ok(out)
        })
        .await
    }
}

#[async_trait]
impl SearchIndex for SqliteStore {
    async fn index_meeting(&self, meeting_id: MeetingId) -> PortResult<()> {
        // 1) leer y trocear
        let drafts = self
            .with_conn(move |conn| {
                if !exists(conn, "meetings", "id", &meeting_id.to_string())? {
                    return Err(PortError::NotFound(format!("meeting {meeting_id}")));
                }
                let utts = conn
                    .prepare(
                        "SELECT COALESCE(s.display_name, s.label), u.start_ms, u.end_ms, u.text
                         FROM utterances u JOIN speakers s ON s.id = u.speaker_id
                         WHERE u.meeting_id = ?1 ORDER BY u.idx",
                    )
                    .and_then(|mut st| {
                        st.query_map([meeting_id.to_string()], |r| {
                            Ok(ChunkUtterance { speaker: r.get(0)?, start_ms: col_u64(r, 1)?, end_ms: col_u64(r, 2)?, text: r.get(3)? })
                        })?
                        .collect::<Result<Vec<_>, _>>()
                    })
                    .map_err(sql_err)?;
                Ok(chunk_utterances(&utts))
            })
            .await?;

        // 2) embeddings (si hay modelo); si falla, quedan chunks + FTS y sin vectores
        let embedder_configured = self.embedder.is_some();
        let vectors: Option<Vec<Vec<f32>>> = match (&self.embedder, drafts.is_empty()) {
            (Some(e), false) => match e.embed(drafts.iter().map(|d| d.text.clone()).collect(), EmbedKind::Passage).await {
                Ok(v) => {
                    if v.len() != drafts.len() || v.iter().any(|x| x.len() != EMBEDDING_DIMS) {
                        return Err(PortError::InvalidResponse(format!("el embedder devolvió {} vectores de dims distintas de {EMBEDDING_DIMS}", v.len())));
                    }
                    Some(v)
                }
                Err(err) => {
                    tracing::warn!("embeddings no disponibles ({err}); se indexa solo FTS");
                    None
                }
            },
            _ => None,
        };
        let model = self.embedder.as_ref().map(|e| e.model_id().to_owned());

        // 3) escribir
        self.with_conn(move |conn| {
            let tx = conn.transaction().map_err(sql_err)?;
            purge_index(&tx, meeting_id)?;
            let mid = meeting_id.to_string();
            let mut sum = vec![0.0_f32; EMBEDDING_DIMS];
            for (i, d) in drafts.iter().enumerate() {
                tx.execute(
                    "INSERT INTO chunks(meeting_id,start_ms,end_ms,text) VALUES (?1,?2,?3,?4)",
                    params![mid, d.start_ms as i64, d.end_ms as i64, d.text],
                )
                .map_err(sql_err)?;
                let chunk_id = tx.last_insert_rowid();
                if let Some(vs) = &vectors {
                    tx.execute("INSERT INTO vec_chunks(chunk_id, embedding) VALUES (?1, ?2)", params![chunk_id, vec_to_blob(&vs[i])]).map_err(sql_err)?;
                    for (a, b) in sum.iter_mut().zip(&vs[i]) {
                        *a += b;
                    }
                }
            }
            if let (Some(vs), Some(model)) = (&vectors, &model) {
                let mean: Vec<f32> = sum.iter().map(|x| x / vs.len() as f32).collect();
                let rowid: i64 = tx.query_row("SELECT rowid_alias FROM meetings WHERE id = ?1", [&mid], |r| r.get(0)).map_err(sql_err)?;
                tx.execute("INSERT INTO vec_meetings(meeting_rowid, embedding) VALUES (?1, ?2)", params![rowid, vec_to_blob(&normalize(&mean))]).map_err(sql_err)?;
                for (k, v) in [("model", model.clone()), ("dims", EMBEDDING_DIMS.to_string())] {
                    tx.execute("INSERT INTO embedding_meta(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![k, v]).map_err(sql_err)?;
                }
            }
            // Stale = hay embedder configurado pero esta vez no hubo vectores.
            let stale = embedder_configured && !drafts.is_empty() && vectors.is_none();
            tx.execute("UPDATE meetings SET index_stale = ?2 WHERE id = ?1", params![mid, i64::from(stale)]).map_err(sql_err)?;
            tx.commit().map_err(sql_err)
        })
        .await
    }

    async fn stale_meetings(&self) -> PortResult<Vec<MeetingId>> {
        self.with_conn(|conn| {
            conn.prepare("SELECT id FROM meetings WHERE index_stale = 1 ORDER BY started_at, rowid_alias")
                .and_then(|mut st| st.query_map([], |r| col_id::<MeetingId>(r, 0))?.collect::<Result<Vec<_>, _>>())
                .map_err(sql_err)
        })
        .await
    }

    async fn unindex_meeting(&self, meeting_id: MeetingId) -> PortResult<()> {
        self.with_conn(move |conn| {
            let tx = conn.transaction().map_err(sql_err)?;
            purge_index(&tx, meeting_id)?;
            tx.commit().map_err(sql_err)
        })
        .await
    }

    async fn search(&self, query: SearchQuery) -> PortResult<Vec<SearchHit>> {
        let limit = if query.limit == 0 { 10 } else { query.limit as usize };
        let chunks = self.hybrid_chunks(&query.text, &query.scope, limit).await?;
        Ok(chunks
            .into_iter()
            .map(|c| SearchHit {
                meeting_id: c.meeting_id,
                meeting_title: c.meeting_title,
                started_at: c.started_at,
                at: MediaMs(c.start_ms),
                end: MediaMs(c.end_ms),
                speaker: c.speaker,
                snippet: c.snippet,
                score: c.score,
            })
            .collect())
    }
}

#[async_trait]
impl Retriever for SqliteStore {
    async fn retrieve(&self, query: &str, scope: &ChatScope, k: u32) -> PortResult<Vec<RetrievedChunk>> {
        let chunks = self.hybrid_chunks(query, &scope.search_scope(), k as usize).await?;
        Ok(chunks
            .into_iter()
            .map(|c| RetrievedChunk {
                chunk_id: c.chunk_id,
                meeting_id: c.meeting_id,
                meeting_title: c.meeting_title,
                started_at: c.started_at,
                start: MediaMs(c.start_ms),
                end: MediaMs(c.end_ms),
                text: c.text,
                score: c.score,
            })
            .collect())
    }
}
