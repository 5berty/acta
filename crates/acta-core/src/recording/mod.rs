//! Grabación: pistas, segmentos, manifiesto recuperable, máquina de estados
//! de la sesión, política de autoparada y vigilancia de salud.
//!
//! Contrato: `model`, `ports` y los TIPOS de `machine` (estado, eventos,
//! efectos). WP1 es dueño de la lógica de `machine::transition`,
//! `autostop` y `health`.

pub mod autostop;
pub mod health;
pub mod machine;
pub mod model;
pub mod ports;

pub use autostop::*;
pub use health::*;
pub use machine::*;
pub use model::*;
pub use ports::*;
