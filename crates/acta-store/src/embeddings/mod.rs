//! `Embedder` local (WP2).
//!
//! - `FastEmbedder` (feature `local-embeddings`): fastembed-rs con
//!   `intfloat/multilingual-e5-small` (384 dims), carga perezosa (el modelo se
//!   descarga/abre en la primera llamada) y caché en `DataLayout::models_dir()/fastembed`.
//! - `HashEmbedder`: bolsa de palabras hasheada, determinista y sin modelo.
//!   Es el embedder de tests (y un fallback degradado si el modelo no está).
//!
//! Prefijos e5: "query: " para `EmbedKind::Query`, "passage: " para `EmbedKind::Passage`.

use crate::db::EMBEDDING_DIMS;
use crate::text::fold_text;
use crate::vectors::normalize;
use acta_core::library::{EmbedKind, Embedder};
use acta_core::PortResult;
use async_trait::async_trait;

/// Aplica el prefijo que exige e5 según el uso.
pub fn e5_prefixed(kind: EmbedKind, text: &str) -> String {
    match kind {
        EmbedKind::Query => format!("query: {text}"),
        EmbedKind::Passage => format!("passage: {text}"),
    }
}

/// Embedder determinista sin modelo: cada palabra (sin acentos) suma ±1 en una
/// de 384 posiciones; el resultado se normaliza. Textos con palabras en común
/// quedan cerca.
#[derive(Debug, Clone, Copy, Default)]
pub struct HashEmbedder;

fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

impl HashEmbedder {
    fn embed_one(text: &str) -> Vec<f32> {
        let mut v = vec![0.0_f32; EMBEDDING_DIMS];
        for tok in fold_text(text).split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()) {
            let h = fnv1a(tok);
            let sign = if (h >> 40) & 1 == 0 { 1.0 } else { -1.0 };
            v[(h % EMBEDDING_DIMS as u64) as usize] += sign;
        }
        normalize(&v)
    }
}

#[async_trait]
impl Embedder for HashEmbedder {
    fn model_id(&self) -> &str {
        "hash-bow-384"
    }
    fn dims(&self) -> usize {
        EMBEDDING_DIMS
    }
    async fn embed(&self, texts: Vec<String>, _kind: EmbedKind) -> PortResult<Vec<Vec<f32>>> {
        Ok(texts.iter().map(|t| Self::embed_one(t)).collect())
    }
}

#[cfg(feature = "local-embeddings")]
pub use fast::FastEmbedder;

#[cfg(feature = "local-embeddings")]
mod fast {
    use super::e5_prefixed;
    use crate::db::EMBEDDING_DIMS;
    use acta_core::library::{EmbedKind, Embedder};
    use acta_core::{PortError, PortResult};
    use async_trait::async_trait;
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    pub const MODEL_ID: &str = "intfloat/multilingual-e5-small";

    /// fastembed-rs con carga perezosa. `Clone` comparte el mismo modelo.
    #[derive(Clone)]
    pub struct FastEmbedder {
        cache_dir: PathBuf,
        model: Arc<Mutex<Option<TextEmbedding>>>,
    }

    impl FastEmbedder {
        /// `cache_dir`: normalmente `DataLayout::models_dir().join("fastembed")`.
        pub fn new(cache_dir: impl Into<PathBuf>) -> Self {
            Self { cache_dir: cache_dir.into(), model: Arc::new(Mutex::new(None)) }
        }
    }

    #[async_trait]
    impl Embedder for FastEmbedder {
        fn model_id(&self) -> &str {
            MODEL_ID
        }
        fn dims(&self) -> usize {
            EMBEDDING_DIMS
        }
        async fn embed(&self, texts: Vec<String>, kind: EmbedKind) -> PortResult<Vec<Vec<f32>>> {
            let prefixed: Vec<String> = texts.iter().map(|t| e5_prefixed(kind, t)).collect();
            let model = self.model.clone();
            let dir = self.cache_dir.clone();
            tokio::task::spawn_blocking(move || {
                let mut guard = model.lock().map_err(|_| PortError::Internal("embedder mutex poisoned".into()))?;
                if guard.is_none() {
                    let opts = InitOptions::new(EmbeddingModel::MultilingualE5Small)
                        .with_cache_dir(dir)
                        .with_show_download_progress(false);
                    *guard = Some(TextEmbedding::try_new(opts).map_err(|e| PortError::Unavailable(format!("fastembed init: {e}")))?);
                }
                let Some(m) = guard.as_mut() else {
                    return Err(PortError::Internal("embedder not initialised".into()));
                };
                m.embed(prefixed, None).map_err(|e| PortError::Unavailable(format!("fastembed embed: {e}")))
            })
            .await
            .map_err(|e| PortError::Internal(format!("join: {e}")))?
        }
    }
}
