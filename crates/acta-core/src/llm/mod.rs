//! Proveedores LLM detrás de un puerto. Ver docs/01-arquitectura.md §7.

pub mod model;
pub mod ports;

pub use model::*;
pub use ports::*;
