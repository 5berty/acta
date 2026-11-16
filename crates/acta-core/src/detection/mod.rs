//! Detección de reuniones y nombres de hablantes en vivo.
//!
//! El adaptador (macOS: `acta-mac-bridge`) fusiona señales crudas del sistema
//! (mic en uso por proceso, ventana de reunión por AX, URL de Meet por
//! AppleScript) y emite eventos de dominio ya limpios: [`DetectionEvent`].

pub mod model;
pub mod ports;

pub use model::*;
pub use ports::*;
