//! Núcleo de la captura en curso: writer + watchdog + medidores.
//!
//! Los frames NO pasan por el bucle del supervisor: una tarea "bomba" lee el
//! stream del `AudioSource` y escribe directamente en el writer (bajo un
//! mutex que el supervisor solo toma un instante). Así, al parar, basta con
//! `AudioSource::stop()` + esperar a que la bomba vacíe el stream para no
//! perder los últimos frames.

use super::Msg;
use crate::levels::LevelMeter;
use crate::watchdog::Watchdog;
use crate::writer::SegmentWriter;
use acta_core::EventStream;
use acta_core::recording::{AudioEvent, Levels, TrackState};
use acta_core::time::{Clock, MediaMs, UnixMs};
use futures::StreamExt;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;

/// Frames entre dos emisiones de niveles (2 pistas × 100 ms → ≈10 Hz).
const FRAMES_PER_LEVELS: u32 = 2;

pub(crate) struct CaptureCore {
    pub writer: Option<SegmentWriter>,
    pub watchdog: Watchdog,
    meter: LevelMeter,
    last_frame_at: Option<UnixMs>,
    frames_since_levels: u32,
}

pub(crate) type SharedCore = Arc<Mutex<CaptureCore>>;

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl CaptureCore {
    pub fn new(writer: SegmentWriter, watchdog: Watchdog) -> Self {
        Self {
            writer: Some(writer),
            watchdog,
            meter: LevelMeter::default(),
            last_frame_at: None,
            frames_since_levels: 0,
        }
    }

    pub fn recorded_ms(&self) -> u64 {
        self.writer.as_ref().map_or(0, SegmentWriter::recorded_ms)
    }

    /// Instante de pared → posición media. Si cae en una pausa (o no hay
    /// writer), se usa lo grabado hasta ahora.
    pub fn wall_to_media(&self, t: UnixMs) -> MediaMs {
        self.writer
            .as_ref()
            .and_then(|w| w.manifest().wall_to_media(t))
            .unwrap_or(MediaMs(self.recorded_ms()))
    }

    /// Aplica un evento del audio. Devuelve niveles si toca emitirlos.
    pub fn on_audio(&mut self, event: &AudioEvent, now: UnixMs) -> Option<Levels> {
        match event {
            AudioEvent::Frame(frame) => {
                if let Some(w) = self.writer.as_mut() {
                    match w.push(frame) {
                        Ok(closed) => {
                            for f in closed {
                                self.watchdog.on_segment_finalized(f.track, now);
                            }
                        }
                        Err(e) => self.watchdog.on_write_failed(frame.track, e.to_string(), now),
                    }
                    for f in w.take_failures() {
                        self.watchdog.on_write_failed(f.track, f.message, now);
                    }
                }
                self.watchdog.on_frame(frame, now);
                self.meter.update(frame.track, &frame.samples, now);
                self.last_frame_at = Some(now);
                self.frames_since_levels += 1;
                if self.frames_since_levels >= FRAMES_PER_LEVELS {
                    self.frames_since_levels = 0;
                    return Some(self.meter.snapshot(now));
                }
                None
            }
            AudioEvent::Restarted { .. } => {
                let gap = self.last_frame_at.map_or(0, |t| now.since(t).max(0) as u64);
                if let Some(w) = self.writer.as_mut() {
                    w.mark_restart(gap);
                }
                self.watchdog.on_audio_event(event, now);
                None
            }
            other => {
                self.watchdog.on_audio_event(other, now);
                None
            }
        }
    }
}

/// Tarea que vacía el stream de audio en el núcleo. Termina cuando el stream
/// termina (tras `stop()` o un fallo irrecuperable) y lo avisa con `AudioEnded`.
pub(crate) fn spawn_pump(
    mut stream: EventStream<AudioEvent>,
    core: SharedCore,
    clock: Arc<dyn Clock>,
    tx: UnboundedSender<Msg>,
    gen_id: u64,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut error = None;
        while let Some(event) = stream.next().await {
            if let AudioEvent::TrackState {
                track,
                state: TrackState::Failed,
                message,
            } = &event
            {
                error = Some(format!(
                    "la pista {} falló: {}",
                    track.as_str(),
                    message.as_deref().unwrap_or("sin detalle")
                ));
            }
            let now = clock.now();
            let levels = lock(&core).on_audio(&event, now);
            if let Some(levels) = levels {
                let _ = tx.send(Msg::Levels { gen_id, levels });
            }
        }
        let _ = tx.send(Msg::AudioEnded { gen_id, error });
    })
}
