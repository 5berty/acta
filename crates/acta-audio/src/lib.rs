//! # acta-audio (WP1)
//!
//! Todo lo que garantiza que el audio NO se pierde:
//! - `writer`: `SegmentWriter` — WAV 16 kHz mono s16 por pista, un segmento
//!   cada 30 s, escribe en `.wav.tmp`, flush periódico, fsync + rename al
//!   cerrar, actualiza el manifiesto de forma atómica. Alinea pistas por
//!   `pts_us` y rellena huecos con silencio.
//! - `recovery`: al arrancar, repara `.tmp` (reescribe la cabecera WAV según
//!   el tamaño real) y deja el manifiesto en `Stopped`.
//! - `concat`: une segmentos con hound → `audio/mic.wav`, `audio/system.wav`,
//!   `audio/mix.wav`. NUNCA ffmpeg.
//! - `levels`: dBFS por frame (medidores + autoparada).
//! - `watchdog`: avisos de salud (`HealthWarning`).
//! - `supervisor`: ejecuta la máquina de estados de acta-core y sus efectos.
//! - `processing`: `DefaultPipeline` (impl de `ProcessingPipeline`).
//!
//! Este crate no lanza procesos; si alguna vez lo hace: `kill_on_drop(true)`
//! + `wait()` en TODOS los caminos.
#![deny(clippy::zombie_processes)]

pub mod concat;
pub mod fileio;
pub mod levels;
pub mod processing;
pub mod recovery;
pub mod resample;
pub mod supervisor;
pub mod watchdog;
pub mod writer;
