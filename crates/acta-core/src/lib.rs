//! # acta-core
//!
//! Dominio y puertos de acta (arquitectura hexagonal, carpetas por funcionalidad).
//!
//! - Este crate NO hace I/O: ni ficheros, ni red, ni procesos. Solo tipos,
//!   traits (puertos) y lógica pura (máquina de estados, políticas).
//! - Los adaptadores viven fuera: `acta-audio`, `acta-store`, `acta-llm`,
//!   `acta-mac-bridge` y la app Tauri.
//!
//! ## Contrato congelado
//! Los módulos `model`/`ports` de cada funcionalidad, `api`, `ids`, `time`,
//! `error` y `layout` son el CONTRATO entre los work packages. Cambiarlos
//! requiere acuerdo con el orquestador (ver `docs/01-arquitectura.md` §12).
//! WP1 es dueño de la implementación de `recording::machine`,
//! `recording::autostop` y `recording::health`.
#![deny(clippy::zombie_processes)]

pub mod api;
pub mod chat;
pub mod detection;
pub mod error;
pub mod ids;
pub mod layout;
pub mod library;
pub mod llm;
pub mod minutes;
pub mod permissions;
pub mod processing;
pub mod recording;
pub mod screen;
pub mod settings;
pub mod time;
pub mod transcription;

/// Stream "boxed" usado por todos los puertos que emiten eventos.
pub type EventStream<T> = futures::stream::BoxStream<'static, T>;

pub use error::{PortError, PortResult};
