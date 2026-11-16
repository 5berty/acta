//! Fusión de rankings por Reciprocal Rank Fusion.

use std::collections::HashMap;

/// `score(id) = Σ 1 / (k + rank)` con rank empezando en 1. Orden descendente
/// por score; los empates se resuelven por id ascendente (determinista).
pub fn reciprocal_rank_fusion(lists: &[Vec<i64>], k: f32) -> Vec<(i64, f32)> {
    let mut scores: HashMap<i64, f32> = HashMap::new();
    for list in lists {
        for (i, id) in list.iter().enumerate() {
            *scores.entry(*id).or_insert(0.0) += 1.0 / (k + (i + 1) as f32);
        }
    }
    let mut out: Vec<(i64, f32)> = scores.into_iter().collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    out
}
