//! Clustering aglomerativo (enlace medio, coseno) y `GroupSuggester`.

#[derive(Debug, Clone, PartialEq)]
pub struct Cluster {
    /// Índices (ordenados) en la lista de entrada.
    pub members: Vec<usize>,
    /// Similitud coseno media entre pares del cluster.
    pub cohesion: f32,
}

/// Enlace medio con actualización Lance-Williams. Fusiona mientras la mejor
/// similitud entre clusters sea ≥ `threshold`. Determinista: los empates se
/// resuelven por el par de índices más bajo. Devuelve solo clusters con
/// al menos `min_size` miembros, ordenados por tamaño desc y primer miembro.
pub fn agglomerative(embeddings: &[Vec<f32>], threshold: f32, min_size: usize) -> Vec<Cluster> {
    let n = embeddings.len();
    let mut sim = vec![vec![0.0_f32; n]; n];
    for i in 0..n {
        for j in (i + 1)..n {
            let s = crate::vectors::cosine(&embeddings[i], &embeddings[j]);
            sim[i][j] = s;
            sim[j][i] = s;
        }
    }
    let mut members: Vec<Option<Vec<usize>>> = (0..n).map(|i| Some(vec![i])).collect();
    loop {
        let mut best: Option<(usize, usize, f32)> = None;
        for i in 0..n {
            if members[i].is_none() {
                continue;
            }
            for j in (i + 1)..n {
                if members[j].is_none() {
                    continue;
                }
                let s = sim[i][j];
                if s >= threshold && best.is_none_or(|(_, _, b)| s > b) {
                    best = Some((i, j, s));
                }
            }
        }
        let Some((a, b, _)) = best else { break };
        let (sa, sb) = (members[a].as_ref().map_or(0, Vec::len) as f32, members[b].as_ref().map_or(0, Vec::len) as f32);
        for k in 0..n {
            if k == a || k == b || members[k].is_none() {
                continue;
            }
            let s = (sa * sim[a][k] + sb * sim[b][k]) / (sa + sb);
            sim[a][k] = s;
            sim[k][a] = s;
        }
        if let Some(mut moved) = members[b].take()
            && let Some(into) = members[a].as_mut()
        {
            into.append(&mut moved);
        }
    }
    let mut out: Vec<Cluster> = members
        .into_iter()
        .flatten()
        .filter(|m| m.len() >= min_size.max(1))
        .map(|mut m| {
            m.sort_unstable();
            let cohesion = mean_pairwise(embeddings, &m);
            Cluster { members: m, cohesion }
        })
        .collect();
    out.sort_by(|a, b| b.members.len().cmp(&a.members.len()).then(a.members[0].cmp(&b.members[0])));
    out
}

fn mean_pairwise(embeddings: &[Vec<f32>], m: &[usize]) -> f32 {
    if m.len() < 2 {
        return 1.0;
    }
    let (mut sum, mut count) = (0.0_f32, 0u32);
    for (x, &i) in m.iter().enumerate() {
        for &j in &m[x + 1..] {
            sum += crate::vectors::cosine(&embeddings[i], &embeddings[j]);
            count += 1;
        }
    }
    sum / count as f32
}

// ---------------------------------------------------------------------------
// GroupSuggester sobre SqliteStore
// ---------------------------------------------------------------------------

use crate::codec::{col_id, sql_err};
use crate::db::SqliteStore;
use crate::vectors::blob_to_vec;
use acta_core::ids::{GroupId, MeetingId};
use acta_core::library::{GroupSuggester, GroupSuggestion};
use acta_core::PortResult;
use async_trait::async_trait;
use std::collections::HashMap;

/// Parámetros del clustering (§9). La regla que ve el usuario: hace falta un
/// mínimo de 3 reuniones parecidas (similitud coseno media ≥ 0,80 entre sus
/// embeddings) que estén indexadas y no pertenezcan ya a ningún grupo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClusterConfig {
    pub threshold: f32,
    pub min_size: usize,
    /// Solo se agrupan las N reuniones más recientes (el algoritmo es O(n^3)).
    pub max_meetings: usize,
}

impl Default for ClusterConfig {
    fn default() -> Self {
        Self { threshold: 0.80, min_size: 3, max_meetings: 600 }
    }
}

impl SqliteStore {
    /// Como `GroupSuggester::suggest_groups` pero con parámetros propios.
    pub async fn suggest_groups_with(&self, cfg: ClusterConfig) -> PortResult<Vec<GroupSuggestion>> {
        let now = self.now();
        let rows: Vec<(MeetingId, Vec<f32>)> = self
            .with_conn(move |conn| {
                let vectors: HashMap<i64, Vec<f32>> = conn
                    .prepare("SELECT meeting_rowid, embedding FROM vec_meetings")
                    .and_then(|mut st| {
                        st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)))?.collect::<Result<Vec<_>, _>>()
                    })
                    .map_err(sql_err)?
                    .into_iter()
                    .filter_map(|(id, b)| blob_to_vec(&b).map(|v| (id, v)))
                    .collect();
                // Solo las que no están en NINGÚN grupo (creado a mano o aceptado
                // de una sugerencia): si no, lo aceptado se volvía a proponer.
                let meetings = conn
                    .prepare(
                        "SELECT rowid_alias, id FROM meetings
                         WHERE id NOT IN (SELECT meeting_id FROM group_meetings)
                         ORDER BY started_at DESC, rowid_alias DESC",
                    )
                    .and_then(|mut st| st.query_map([], |r| Ok((r.get::<_, i64>(0)?, col_id::<MeetingId>(r, 1)?)))?.collect::<Result<Vec<_>, _>>())
                    .map_err(sql_err)?;
                Ok(meetings
                    .into_iter()
                    .filter_map(|(rowid, id)| vectors.get(&rowid).map(|v| (id, v.clone())))
                    .take(cfg.max_meetings)
                    .collect())
            })
            .await?;
        let embs: Vec<Vec<f32>> = rows.iter().map(|(_, v)| v.clone()).collect();
        Ok(agglomerative(&embs, cfg.threshold, cfg.min_size)
            .into_iter()
            .map(|c| {
                let mut ids: Vec<MeetingId> = c.members.iter().map(|&i| rows[i].0).collect();
                ids.sort();
                GroupSuggestion {
                    id: GroupId::new(),
                    name: None,
                    description: None,
                    meeting_ids: ids,
                    cohesion: c.cohesion,
                    created_at: now,
                }
            })
            .collect())
    }
}

#[async_trait]
impl GroupSuggester for SqliteStore {
    async fn suggest_groups(&self) -> PortResult<Vec<GroupSuggestion>> {
        self.suggest_groups_with(ClusterConfig::default()).await
    }
}
