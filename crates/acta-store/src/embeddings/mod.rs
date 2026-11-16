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
pub use fast::{FastEmbedder, MODEL_FILES, hf_cache_repo, prefetch_hf_cache, prefetch_hf_cache_from};

#[cfg(feature = "local-embeddings")]
mod fast {
    use super::e5_prefixed;
    use crate::db::EMBEDDING_DIMS;
    use acta_core::library::{EmbedKind, Embedder};
    use acta_core::{PortError, PortResult};
    use async_trait::async_trait;
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    pub const MODEL_ID: &str = "intfloat/multilingual-e5-small";

    /// Ficheros que fastembed pide a hf-hub para este modelo.
    pub const MODEL_FILES: [&str; 5] =
        ["onnx/model.onnx", "tokenizer.json", "config.json", "special_tokens_map.json", "tokenizer_config.json"];
    /// Revisión que pide fastembed (`api.model(id)` = rama `main`).
    const REVISION: &str = "main";

    /// Carpeta de un fichero en la caché de hf-hub:
    /// `<cache>/models--intfloat--multilingual-e5-small/snapshots/<commit>/<file>`,
    /// con `refs/main` conteniendo `<commit>`. Si existe, hf-hub NO toca la red.
    pub fn hf_cache_repo(cache_dir: &Path) -> PathBuf {
        cache_dir.join(format!("models--{}", MODEL_ID.replace('/', "--")))
    }

    fn cached_snapshot(cache_dir: &Path) -> Option<PathBuf> {
        let repo = hf_cache_repo(cache_dir);
        let commit = std::fs::read_to_string(repo.join("refs").join(REVISION)).ok()?;
        let snap = repo.join("snapshots").join(commit.trim());
        MODEL_FILES.iter().all(|f| snap.join(f).is_file()).then_some(snap)
    }

    /// Descarga los ficheros del modelo con reqwest (TLS nativo de macOS, que
    /// confía en la CA corporativa del Llavero) y los deja en la caché de
    /// hf-hub. El cliente de hf-hub 0.5 hace la petición de metadatos con
    /// rustls + webpki-roots y falla tras un proxy TLS (`UnknownIssuer`).
    pub async fn prefetch_hf_cache(cache_dir: &Path) -> PortResult<()> {
        prefetch_hf_cache_from(cache_dir, "https://huggingface.co").await
    }

    pub async fn prefetch_hf_cache_from(cache_dir: &Path, endpoint: &str) -> PortResult<()> {
        if cached_snapshot(cache_dir).is_some() {
            return Ok(());
        }
        let net = |e: reqwest::Error| PortError::Unavailable(format!("descarga del modelo de búsqueda: {e}"));
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(net)?;
        let repo = hf_cache_repo(cache_dir);
        let commit = "acta";
        let snap = repo.join("snapshots").join(commit);
        for file in MODEL_FILES {
            let dest = snap.join(file);
            if dest.is_file() {
                continue;
            }
            let url = format!("{endpoint}/{MODEL_ID}/resolve/{REVISION}/{file}");
            let resp = client.get(&url).send().await.map_err(net)?;
            if !resp.status().is_success() {
                return Err(PortError::Unavailable(format!("descarga de {url}: HTTP {}", resp.status())));
            }
            let bytes = resp.bytes().await.map_err(net)?;
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            let tmp = dest.with_extension("part");
            tokio::fs::write(&tmp, &bytes).await?;
            tokio::fs::rename(&tmp, &dest).await?;
        }
        tokio::fs::create_dir_all(repo.join("refs")).await?;
        tokio::fs::write(repo.join("refs").join(REVISION), commit).await?;
        Ok(())
    }

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
            let loaded = model.lock().map_err(|_| PortError::Internal("embedder mutex poisoned".into()))?.is_some();
            if !loaded {
                prefetch_hf_cache(&dir).await?;
            }
            tokio::task::spawn_blocking(move || {
                let mut guard = model.lock().map_err(|_| PortError::Internal("embedder mutex poisoned".into()))?;
                if guard.is_none() {
                    let opts = InitOptions::new(EmbeddingModel::MultilingualE5Small)
                        .with_cache_dir(dir)
                        .with_show_download_progress(false);
                    *guard = Some(TextEmbedding::try_new(opts).map_err(|e| PortError::Unavailable(format!("fastembed init: {e:#}")))?);
                }
                let Some(m) = guard.as_mut() else {
                    return Err(PortError::Internal("embedder not initialised".into()));
                };
                m.embed(prefixed, None).map_err(|e| PortError::Unavailable(format!("fastembed embed: {e:#}")))
            })
            .await
            .map_err(|e| PortError::Internal(format!("join: {e}")))?
        }
    }
}
