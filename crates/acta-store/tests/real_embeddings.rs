//! fastembed real (descarga de HuggingFace). Ignorado por defecto:
//! `cargo test -p acta-store --features local-embeddings --test real_embeddings -- --ignored`
#![cfg(feature = "local-embeddings")]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use acta_core::library::{EmbedKind, Embedder};
use acta_store::embeddings::FastEmbedder;

#[tokio::test]
#[ignore = "descarga multilingual-e5-small de HuggingFace"]
async fn real_fastembed_downloads_and_embeds_in_a_fresh_cache_dir() {
    let dir = tempfile::tempdir().unwrap();
    // La app pasa `models/fastembed`, que NO existe en una instalación nueva.
    let e = FastEmbedder::new(dir.path().join("models").join("fastembed"));
    let v = e.embed(vec!["hola mundo".into()], EmbedKind::Query).await.expect("embed");
    assert_eq!(v[0].len(), 384);
}
