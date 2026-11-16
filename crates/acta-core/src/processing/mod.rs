//! Procesado tras la reunión: concatenar → transcribir → diarizar → nombrar
//! hablantes → acta (LLM) → indexar → podar capturas.
//!
//! El procesado corre en una COLA DE FONDO: no bloquea una grabación nueva.
//! Contrato aquí; implementación en acta-audio (WP1).

pub mod model;
pub mod pipeline;

pub use model::*;
pub use pipeline::*;
