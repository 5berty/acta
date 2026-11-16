//! # acta-mac-bridge (WP4)
//!
//! Cliente del sidecar Swift `acta-mac` y adaptadores macOS de los puertos:
//!
//! | puerto (acta-core) | adaptador | comandos del sidecar |
//! |---|---|---|
//! | `AudioSource` | `audio::MacAudioSource` | `capture.*` + evento `audio.frame` |
//! | `MeetingDetector` | `detection::MacMeetingDetector` | `detect.*` + `detect.signal` (fusión aquí) |
//! | `SpeakerNameSource` | `speakers::MacSpeakerNames` | `speakers.*` |
//! | `ScreenCapturer` | `screen::MacScreenCapturer` | `screen.*` |
//! | `Transcriber`, `Diarizer`, `LiveTranscriber` | `transcription::*` | `asr.*`, `diarize.run` |
//! | `PermissionsProbe` | `permissions::MacPermissions` | `permissions.*` |
//!
//! `client::SidecarClient`: lanza el binario con `tokio::process`,
//! `kill_on_drop(true)`, lee stdout por líneas, correlaciona respuestas por
//! `id`, reenvía eventos por un `broadcast`, vuelca stderr a `tracing`, y
//! reinicia con backoff. SIEMPRE `wait()` al hijo: en parada ordenada
//! (`shutdown` → espera 2 s → `start_kill` → `wait`) y si muere solo.
#![deny(clippy::zombie_processes)]

pub mod audio;
pub mod client;
pub mod detection;
pub mod permissions;
pub mod protocol;
pub mod screen;
pub mod speakers;
pub mod transcription;
