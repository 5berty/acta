//! # acta-store (WP2)
//!
//! Adaptador SQLite de los puertos de `acta_core::library`, `chat` y
//! `settings`. Una sola conexión de escritura (WAL) detrás de un mutex,
//! accesos vía `tokio::task::spawn_blocking`.
//!
//! Módulos por funcionalidad:
//! - `db`: apertura, registro de sqlite-vec, migraciones (`PRAGMA user_version`).
//! - `meetings`: `MeetingStore` (+ timeline derivado).
//! - `groups`: `GroupStore`. `clustering`: `GroupSuggester`.
//! - `voiceprints`: `VoiceprintStore`.
//! - `search`: `SearchIndex` + `chat::Retriever` (BM25 + vectores, RRF).
//! - `chat`: `ChatStore`. `settings`: `SettingsStore`.
//! - `embeddings`: `Embedder` con fastembed (feature `local-embeddings`).
#![deny(clippy::zombie_processes)]

pub mod chat;
pub(crate) mod codec;
pub mod clustering;
pub mod db;
pub mod embeddings;
pub mod groups;
pub mod meetings;
pub mod search;
pub mod secrets;
pub mod settings;
pub mod text;
pub mod vectors;
pub mod voiceprints;

pub use db::SqliteStore;
