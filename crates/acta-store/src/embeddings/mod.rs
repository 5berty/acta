//! `Embedder` local (WP2). Con la feature `local-embeddings`, fastembed-rs
//! con `intfloat/multilingual-e5-small` (384 dims). Prefijos e5:
//! "query: " para `EmbedKind::Query`, "passage: " para `EmbedKind::Passage`.
//! Caché de modelos en `DataLayout::models_dir()`.
