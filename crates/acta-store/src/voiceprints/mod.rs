//! `VoiceprintStore`: SOLO embeddings (dato biométrico), borrables.
//!
//! Las coincidencias son *sugerencias*: nunca renombran a nadie. Con
//! `min_similarity` conservador (0.75 en §6.4) y siempre dentro del mismo
//! `model`, porque los embeddings de modelos distintos no son comparables.

use crate::codec::*;
use crate::db::SqliteStore;
use crate::vectors::{blob_to_vec, cosine, vec_to_blob};
use acta_core::ids::VoiceprintId;
use acta_core::time::UnixMs;
use acta_core::transcription::{Voiceprint, VoiceprintSummary};
use acta_core::library::VoiceprintStore;
use acta_core::{PortError, PortResult};
use async_trait::async_trait;
use rusqlite::{params, Row};

/// Umbral por defecto de similitud coseno para sugerir un nombre (§6.4).
pub const DEFAULT_MIN_SIMILARITY: f32 = 0.75;

fn voiceprint_from_row(r: &Row<'_>) -> rusqlite::Result<Option<Voiceprint>> {
    let blob: Vec<u8> = r.get(2)?;
    let Some(embedding) = blob_to_vec(&blob) else { return Ok(None) };
    Ok(Some(Voiceprint {
        id: col_id(r, 0)?,
        display_name: r.get(1)?,
        embedding,
        model: r.get(3)?,
        samples: r.get(4)?,
        created_at: UnixMs(r.get(5)?),
        updated_at: UnixMs(r.get(6)?),
    }))
}

impl SqliteStore {
    /// Huellas del mismo `model` ordenadas por similitud (desc), solo las que
    /// llegan a `min_similarity`, como mucho `limit`. Solo sugiere.
    pub async fn rank_voiceprints(
        &self,
        embedding: &[f32],
        model: &str,
        min_similarity: f32,
        limit: usize,
    ) -> PortResult<Vec<(Voiceprint, f32)>> {
        let (emb, model) = (embedding.to_vec(), model.to_owned());
        self.with_conn(move |conn| {
            let all = conn
                .prepare("SELECT id,display_name,embedding,model,samples,created_at,updated_at FROM voiceprints WHERE model = ?1")
                .and_then(|mut st| st.query_map([&model], voiceprint_from_row)?.collect::<Result<Vec<_>, _>>())
                .map_err(sql_err)?;
            let mut scored: Vec<(Voiceprint, f32)> = all
                .into_iter()
                .flatten()
                .filter(|v| v.embedding.len() == emb.len())
                .map(|v| {
                    let s = cosine(&emb, &v.embedding);
                    (v, s)
                })
                .filter(|(_, s)| *s >= min_similarity)
                .collect();
            scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.id.cmp(&b.0.id)));
            scored.truncate(limit);
            Ok(scored)
        })
        .await
    }
}

#[async_trait]
impl VoiceprintStore for SqliteStore {
    async fn list_voiceprints(&self) -> PortResult<Vec<VoiceprintSummary>> {
        self.with_conn(|conn| {
            conn.prepare(
                "SELECT v.id, v.display_name, v.samples, v.updated_at,
                        (SELECT count(DISTINCT s.meeting_id) FROM speakers s WHERE s.voiceprint_id = v.id)
                 FROM voiceprints v ORDER BY v.display_name COLLATE NOCASE, v.id",
            )
            .and_then(|mut st| {
                st.query_map([], |r| {
                    Ok(VoiceprintSummary {
                        id: col_id(r, 0)?,
                        display_name: r.get(1)?,
                        samples: r.get(2)?,
                        updated_at: UnixMs(r.get(3)?),
                        meetings: r.get(4)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()
            })
            .map_err(sql_err)
        })
        .await
    }

    async fn upsert_voiceprint(&self, v: Voiceprint) -> PortResult<()> {
        if v.embedding.is_empty() || v.embedding.iter().any(|x| !x.is_finite()) {
            return Err(PortError::InvalidInput("embedding vacío o no finito".into()));
        }
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO voiceprints(id,display_name,embedding,model,dims,samples,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, embedding=excluded.embedding,
                   model=excluded.model, dims=excluded.dims, samples=excluded.samples, updated_at=excluded.updated_at",
                params![v.id.to_string(), v.display_name, vec_to_blob(&v.embedding), v.model, v.embedding.len() as i64, v.samples, v.created_at.0, v.updated_at.0],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    async fn delete_voiceprint(&self, id: VoiceprintId) -> PortResult<()> {
        self.with_conn(move |conn| {
            let n = conn.execute("DELETE FROM voiceprints WHERE id=?1", [id.to_string()]).map_err(sql_err)?;
            if n == 0 {
                return Err(PortError::NotFound(format!("voiceprint {id}")));
            }
            Ok(())
        })
        .await
    }

    async fn nearest_voiceprint(&self, embedding: &[f32], model: &str, min_similarity: f32) -> PortResult<Option<(Voiceprint, f32)>> {
        Ok(self.rank_voiceprints(embedding, model, min_similarity, 1).await?.into_iter().next())
    }
}
