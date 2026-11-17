//! `SegmentWriter` (WP1). Contrato de comportamiento: docs/01-arquitectura.md §5.
//!
//! Reglas NO negociables (lecciones de Meetily):
//! - Un fallo al escribir un segmento NO se reintenta en bucle con el mismo
//!   nombre: el índice SIEMPRE avanza y el buffer SIEMPRE se vacía.
//! - Si un segmento falla, el audio se vuelca UNA vez a un `.raw` de
//!   emergencia (PCM s16le) y se informa en [`WriteFailure`]
//!   (→ `HealthIssue::WriteFailed`); se sigue con el siguiente segmento.
//! - El nombre del fichero nunca se reutiliza: los `.tmp` se crean con
//!   `create_new`, así que jamás se pisa un fichero existente.
//! - Este módulo no lanza procesos.

use crate::fileio::{fsync_dir, samples_to_le_bytes, write_atomic};
use crate::resample::Resampler;
use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::recording::{
    AudioFormat, AudioFrame, ManifestStatus, RecordingSpan, SegmentInfo, SessionManifest,
    StopReason, Track, TrackManifest,
};
use acta_core::time::{MediaMs, UnixMs};
use acta_core::{PortError, PortResult};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

/// Desfases de pts menores que esto no se corrigen (jitter del reloj host).
const GAP_TOLERANCE_MS: u64 = 20;

#[derive(Debug, Clone)]
pub struct SegmentWriterConfig {
    pub layout: DataLayout,
    pub meeting_id: MeetingId,
    pub format: AudioFormat,
    pub segment_seconds: u32,
    /// Cada cuánto se hace flush del `.tmp` (para perder ≤ esto en un crash).
    pub flush_every_ms: u32,
}

/// Segmento cerrado durante un `push`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finalized {
    pub track: Track,
    pub segment: SegmentInfo,
}

/// Un segmento (o el manifiesto) que no se pudo escribir con normalidad.
/// El supervisor lo convierte en `HealthIssue::WriteFailed`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteFailure {
    pub track: Track,
    /// `None` = fallo al escribir el manifiesto.
    pub segment_index: Option<u32>,
    pub message: String,
    /// Ruta relativa a la reunión del `.raw` de emergencia, si se pudo guardar.
    pub raw_fallback: Option<String>,
}

enum Sink {
    Wav {
        writer: hound::WavWriter<BufWriter<File>>,
        file: File,
    },
    /// No hay fichero WAV utilizable; el audio vive en `buf` hasta el cierre.
    Failed,
}

struct OpenSegment {
    index: u32,
    media_start: u64,
    buf: Vec<i16>,
    padded: u64,
    sink: Sink,
    /// Primer error (si lo hubo): el segmento ya no irá por el camino normal.
    error: Option<String>,
    /// ¿El `.tmp` lo creamos nosotros? Solo entonces lo podemos borrar.
    created_tmp: bool,
    since_flush: u64,
}

struct TrackWriter {
    track: Track,
    resampler: Option<(u32, Resampler)>,
    /// Muestras de la pista en la línea media (incluye relleno).
    position: u64,
    next_index: u32,
    cur: Option<OpenSegment>,
    seen: bool,
}

pub struct SegmentWriter {
    config: SegmentWriterConfig,
    manifest: SessionManifest,
    tracks: Vec<TrackWriter>,
    /// Posición media (muestras) donde empieza el tramo actual.
    base: u64,
    /// `pts_us` que corresponde a `base`. `None` = el siguiente frame lo fija.
    origin_pts_us: Option<u64>,
    paused: bool,
    failures: Vec<WriteFailure>,
    seg_samples: u64,
    flush_samples: u64,
    /// Copia para la transcripción en vivo (`crate::live`).
    tap: Option<std::sync::Arc<crate::live::LiveTap>>,
}

impl SegmentWriter {
    /// Crea carpetas y el manifiesto inicial (status Recording).
    pub fn create(config: SegmentWriterConfig, started_at: UnixMs) -> PortResult<Self> {
        if config.segment_seconds == 0 {
            return Err(PortError::InvalidInput(
                "segment_seconds must be > 0".into(),
            ));
        }
        if config.format.channels != 1 || config.format.sample_rate == 0 {
            return Err(PortError::InvalidInput(
                "working format must be mono".into(),
            ));
        }
        for track in Track::ALL {
            std::fs::create_dir_all(config.layout.track_dir(config.meeting_id, track))?;
        }
        let manifest = SessionManifest {
            version: SessionManifest::VERSION,
            meeting_id: config.meeting_id,
            status: ManifestStatus::Recording,
            created_at: started_at,
            updated_at: started_at,
            app: None,
            format: config.format,
            segment_seconds: config.segment_seconds,
            spans: vec![RecordingSpan {
                wall_start: started_at,
                wall_end: None,
                media_start: MediaMs(0),
            }],
            tracks: Track::ALL
                .iter()
                .map(|&track| TrackManifest {
                    track,
                    segments: vec![],
                })
                .collect(),
            stop_reason: None,
        };
        write_manifest_atomic(&config.layout, &manifest)?;
        let rate = u64::from(config.format.sample_rate);
        Ok(Self {
            seg_samples: u64::from(config.segment_seconds) * rate,
            flush_samples: (u64::from(config.flush_every_ms.max(1)) * rate / 1000).max(1),
            tracks: Track::ALL
                .iter()
                .map(|&track| TrackWriter {
                    track,
                    resampler: None,
                    position: 0,
                    next_index: 0,
                    cur: None,
                    seen: false,
                })
                .collect(),
            config,
            manifest,
            base: 0,
            origin_pts_us: Some(0),
            paused: false,
            failures: Vec::new(),
            tap: None,
        })
    }

    /// Todo lo que se escriba (también el relleno de huecos) se copia aquí,
    /// con su posición media, para la transcripción en vivo.
    pub fn set_live_tap(&mut self, tap: std::sync::Arc<crate::live::LiveTap>) {
        self.tap = Some(tap);
    }

    /// Apunta la app de la reunión en el manifiesto (se guarda en el próximo cierre).
    pub fn set_app(&mut self, app: Option<acta_core::detection::MeetingApp>) {
        self.manifest.app = app;
    }

    pub fn meeting_id(&self) -> MeetingId {
        self.config.meeting_id
    }

    /// Manifiesto en memoria (tramos al día): sirve para `wall_to_media`
    /// durante la grabación (capturas, señales en vivo).
    pub fn manifest(&self) -> &SessionManifest {
        &self.manifest
    }

    /// Tiempo grabado (sin pausas) en ms: la pista más larga.
    pub fn recorded_ms(&self) -> u64 {
        self.max_position() * 1000 / self.rate()
    }

    /// Fallos acumulados desde la última llamada.
    pub fn take_failures(&mut self) -> Vec<WriteFailure> {
        std::mem::take(&mut self.failures)
    }

    fn rate(&self) -> u64 {
        u64::from(self.config.format.sample_rate)
    }

    fn idx(track: Track) -> usize {
        match track {
            Track::Mic => 0,
            Track::System => 1,
        }
    }

    /// Añade un frame. Devuelve los segmentos que se hayan cerrado.
    pub fn push(&mut self, frame: &AudioFrame) -> PortResult<Vec<Finalized>> {
        if self.paused || frame.samples.is_empty() {
            return Ok(Vec::new());
        }
        let rate = self.config.format.sample_rate;
        let ti = Self::idx(frame.track);

        // Remuestreo a 16 kHz mono si el dispositivo entrega otra frecuencia.
        let samples: Vec<i16> = if frame.sample_rate == rate || frame.sample_rate == 0 {
            frame.samples.clone()
        } else {
            let tw = &mut self.tracks[ti];
            match &mut tw.resampler {
                Some((from, r)) if *from == frame.sample_rate => r.process(&frame.samples),
                slot => {
                    let mut r = Resampler::new(frame.sample_rate, rate);
                    let out = r.process(&frame.samples);
                    *slot = Some((frame.sample_rate, r));
                    out
                }
            }
        };

        let origin = *self.origin_pts_us.get_or_insert(frame.pts_us);
        let rel_us = frame.pts_us.saturating_sub(origin);
        let target = self.base + rel_us * self.rate() / 1_000_000;
        let tol = GAP_TOLERANCE_MS * self.rate() / 1000;
        let position = self.tracks[ti].position;
        self.tracks[ti].seen = true;

        let mut closed = Vec::new();
        if target > position + tol {
            self.append(
                ti,
                &vec![0i16; (target - position) as usize],
                true,
                &mut closed,
            );
        }
        let position = self.tracks[ti].position;
        let skip = if position > target + tol {
            (position - target) as usize
        } else {
            0
        };
        if skip < samples.len() {
            self.append(ti, &samples[skip..], false, &mut closed);
        }
        Ok(closed)
    }

    /// Escribe `data` en la pista, partiendo en segmentos de `seg_samples`.
    fn append(&mut self, ti: usize, mut data: &[i16], padded: bool, closed: &mut Vec<Finalized>) {
        while !data.is_empty() {
            if self.tracks[ti].cur.is_none() {
                self.open_segment(ti);
            }
            let flush_samples = self.flush_samples;
            let seg_samples = self.seg_samples;
            let tw = &mut self.tracks[ti];
            let Some(seg) = tw.cur.as_mut() else { return };
            let room = (seg_samples - seg.buf.len() as u64) as usize;
            let n = room.min(data.len());
            let (chunk, rest) = data.split_at(n);
            if let Some(tap) = &self.tap {
                tap.append(tw.track, tw.position, chunk);
            }
            if let Sink::Wav { writer, .. } = &mut seg.sink {
                let res = chunk.iter().try_for_each(|&s| writer.write_sample(s));
                if let Err(e) = res {
                    seg.error.get_or_insert(format!("write: {e}"));
                    seg.sink = Sink::Failed;
                }
            }
            seg.buf.extend_from_slice(chunk);
            if padded {
                seg.padded += n as u64;
            }
            seg.since_flush += n as u64;
            tw.position += n as u64;
            if seg.since_flush >= flush_samples {
                seg.since_flush = 0;
                if let Sink::Wav { writer, .. } = &mut seg.sink
                    && let Err(e) = writer.flush()
                {
                    seg.error.get_or_insert(format!("flush: {e}"));
                    seg.sink = Sink::Failed;
                }
            }
            let full = seg.buf.len() as u64 >= seg_samples;
            data = rest;
            if full && let Some(f) = self.close_segment(ti) {
                closed.push(f);
            }
        }
    }

    /// Abre el siguiente segmento. El índice se consume SIEMPRE, salga bien o mal.
    fn open_segment(&mut self, ti: usize) {
        let layout = self.config.layout.clone();
        let id = self.config.meeting_id;
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: self.config.format.sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let seg_samples = self.seg_samples as usize;
        let tw = &mut self.tracks[ti];
        let index = tw.next_index;
        tw.next_index += 1;
        let tmp = layout.segment_tmp_path(id, tw.track, index);
        let mut error = None;
        let mut created_tmp = false;
        let sink = (|| -> std::io::Result<Sink> {
            if let Some(dir) = tmp.parent() {
                std::fs::create_dir_all(dir)?;
            }
            // create_new: si el nombre ya existe, falla en vez de pisarlo.
            let file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
            created_tmp = true;
            let clone = file.try_clone()?;
            let writer = hound::WavWriter::new(BufWriter::new(file), spec)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            Ok(Sink::Wav {
                writer,
                file: clone,
            })
        })()
        .unwrap_or_else(|e| {
            error = Some(format!("open {}: {e}", tmp.display()));
            Sink::Failed
        });
        tw.cur = Some(OpenSegment {
            index,
            media_start: tw.position,
            buf: Vec::with_capacity(seg_samples),
            padded: 0,
            sink,
            error,
            created_tmp,
            since_flush: 0,
        });
    }

    /// Cierra el segmento en curso: fsync + rename, o volcado de emergencia.
    /// Nunca reintenta: un único intento por camino.
    fn close_segment(&mut self, ti: usize) -> Option<Finalized> {
        let seg = self.tracks[ti].cur.take()?;
        let track = self.tracks[ti].track;
        let layout = self.config.layout.clone();
        let id = self.config.meeting_id;
        let rate = self.rate();
        let tmp = layout.segment_tmp_path(id, track, seg.index);
        let final_path = layout.segment_path(id, track, seg.index);
        let OpenSegment {
            index,
            media_start,
            buf,
            padded,
            sink,
            mut error,
            created_tmp,
            ..
        } = seg;
        if buf.is_empty() {
            if let Sink::Wav { writer, .. } = sink {
                drop(writer);
            }
            if created_tmp {
                let _ = std::fs::remove_file(&tmp);
            }
            return None;
        }

        let mut file_rel = format!("audio/{}/seg-{index:06}.wav", track.as_str());
        match sink {
            Sink::Wav { writer, file } if error.is_none() => {
                let res = (|| -> std::io::Result<()> {
                    writer
                        .finalize()
                        .map_err(|e| std::io::Error::other(e.to_string()))?;
                    file.sync_all()?;
                    if final_path.exists() {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::AlreadyExists,
                            format!("{} already exists", final_path.display()),
                        ));
                    }
                    std::fs::rename(&tmp, &final_path)?;
                    fsync_dir(final_path.parent().unwrap_or(Path::new(".")))
                })();
                if let Err(e) = res {
                    error = Some(format!("finalize: {e}"));
                }
            }
            Sink::Wav { writer, .. } => drop(writer),
            Sink::Failed => {}
        }

        if let Some(message) = error {
            // El audio del segmento sigue en memoria: se vuelca una sola vez.
            let raw_fallback = self.dump_raw(track, index, &buf);
            if created_tmp {
                let _ = std::fs::remove_file(&tmp); // restos parciales nuestros
            }
            if let Some(rel) = &raw_fallback {
                file_rel = rel.clone();
            }
            tracing::error!(track = track.as_str(), index, %message, ?raw_fallback, "segment write failed");
            self.failures.push(WriteFailure {
                track,
                segment_index: Some(index),
                message,
                raw_fallback: raw_fallback.clone(),
            });
            // Sin ningún sitio donde guardarlo: perdido (ya avisado arriba).
            raw_fallback?;
        }

        let info = SegmentInfo {
            index,
            file: file_rel,
            media_start: MediaMs(media_start * 1000 / rate),
            samples: buf.len() as u64,
            padded_samples: padded,
        };
        self.manifest.updated_at = self
            .manifest
            .created_at
            .plus_ms((self.tracks[ti].position * 1000 / rate) as i64);
        self.manifest.tracks[ti].segments.push(info.clone());
        self.persist_manifest(track);
        Some(Finalized {
            track,
            segment: info,
        })
    }

    /// Volcado de emergencia: primero junto a la pista, luego en la carpeta de
    /// la reunión. `create_new` en ambos; un intento por sitio.
    fn dump_raw(&self, track: Track, index: u32, samples: &[i16]) -> Option<String> {
        let layout = &self.config.layout;
        let id = self.config.meeting_id;
        let candidates = [
            (
                layout
                    .track_dir(id, track)
                    .join(format!("seg-{index:06}.raw")),
                format!("audio/{}/seg-{index:06}.raw", track.as_str()),
            ),
            (
                layout
                    .meeting_dir(id)
                    .join(format!("lost-{}-seg-{index:06}.raw", track.as_str())),
                format!("lost-{}-seg-{index:06}.raw", track.as_str()),
            ),
        ];
        let bytes = samples_to_le_bytes(samples);
        for (path, rel) in candidates {
            let res = (|| -> std::io::Result<()> {
                let mut f = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)?;
                f.write_all(&bytes)?;
                f.sync_all()
            })();
            match res {
                Ok(()) => return Some(rel),
                Err(e) => {
                    tracing::error!(path = %path.display(), error = %e, "raw fallback failed");
                }
            }
        }
        None
    }

    fn persist_manifest(&mut self, track: Track) {
        if let Err(e) = write_manifest_atomic(&self.config.layout, &self.manifest) {
            tracing::error!(error = %e, "manifest write failed");
            self.failures.push(WriteFailure {
                track,
                segment_index: None,
                message: format!("manifest: {e}"),
                raw_fallback: None,
            });
        }
    }

    fn max_position(&self) -> u64 {
        self.tracks.iter().map(|t| t.position).max().unwrap_or(0)
    }

    /// Rellena con silencio las pistas con datos hasta la longitud máxima:
    /// las dos pistas terminan siempre alineadas.
    fn equalize(&mut self, closed: &mut Vec<Finalized>) {
        let max = self.max_position();
        for ti in 0..self.tracks.len() {
            let tw = &self.tracks[ti];
            if tw.seen && tw.position < max {
                let pad = vec![0i16; (max - tw.position) as usize];
                self.append(ti, &pad, true, closed);
            }
        }
    }

    fn close_all(&mut self, closed: &mut Vec<Finalized>) {
        for ti in 0..self.tracks.len() {
            if let Some(f) = self.close_segment(ti) {
                closed.push(f);
            }
        }
    }

    fn close_span(&mut self, at: UnixMs) {
        if let Some(span) = self.manifest.spans.last_mut()
            && span.wall_end.is_none()
        {
            span.wall_end = Some(at);
        }
    }

    pub fn pause(&mut self, at: UnixMs) -> PortResult<()> {
        if self.paused {
            return Ok(());
        }
        let mut closed = Vec::new();
        self.equalize(&mut closed);
        self.close_all(&mut closed);
        self.close_span(at);
        self.paused = true;
        self.base = self.max_position();
        self.manifest.status = ManifestStatus::Paused;
        self.manifest.updated_at = at;
        write_manifest_atomic(&self.config.layout, &self.manifest)
    }

    pub fn resume(&mut self, at: UnixMs) -> PortResult<()> {
        if !self.paused {
            return Ok(());
        }
        self.paused = false;
        self.origin_pts_us = None; // el primer frame tras reanudar fija el origen
        for t in &mut self.tracks {
            t.resampler = None;
        }
        self.manifest.spans.push(RecordingSpan {
            wall_start: at,
            wall_end: None,
            media_start: MediaMs(self.base * 1000 / self.rate()),
        });
        self.manifest.status = ManifestStatus::Recording;
        self.manifest.updated_at = at;
        write_manifest_atomic(&self.config.layout, &self.manifest)
    }

    /// El adaptador reinició la captura (`AudioEvent::Restarted`): los `pts_us`
    /// vuelven a empezar. Se tapa el hueco con `gap_ms` de silencio y se
    /// rebasa el origen.
    pub fn mark_restart(&mut self, gap_ms: u64) {
        let mut closed = Vec::new();
        self.equalize(&mut closed);
        let pad = vec![0i16; (gap_ms * self.rate() / 1000) as usize];
        if !pad.is_empty() {
            for ti in 0..self.tracks.len() {
                if self.tracks[ti].seen {
                    self.append(ti, &pad, true, &mut closed);
                }
            }
        }
        self.base = self.max_position();
        self.origin_pts_us = None;
        for t in &mut self.tracks {
            t.resampler = None;
        }
    }

    /// Cierra todo (fsync + rename) y deja el manifiesto en `Stopped`.
    pub fn finish(self, reason: StopReason, at: UnixMs) -> PortResult<SessionManifest> {
        self.finish_reporting(reason, at).map(|(m, _)| m)
    }

    /// Como `finish`, pero devuelve también los fallos del cierre.
    pub fn finish_reporting(
        mut self,
        reason: StopReason,
        at: UnixMs,
    ) -> PortResult<(SessionManifest, Vec<WriteFailure>)> {
        let mut closed = Vec::new();
        if !self.paused {
            self.equalize(&mut closed);
        }
        self.close_all(&mut closed);
        self.close_span(at);
        self.manifest.status = ManifestStatus::Stopped;
        self.manifest.stop_reason = Some(reason);
        self.manifest.updated_at = at;
        for t in &mut self.manifest.tracks {
            t.segments.sort_by_key(|s| s.index);
        }
        write_manifest_atomic(&self.config.layout, &self.manifest)?;
        Ok((self.manifest, self.failures))
    }
}

/// Escribe el manifiesto de forma atómica: `manifest.json.tmp` → fsync → rename → fsync del directorio.
pub fn write_manifest_atomic(layout: &DataLayout, manifest: &SessionManifest) -> PortResult<()> {
    let path: PathBuf = layout.manifest_path(manifest.meeting_id);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec_pretty(manifest)?;
    write_atomic(&path, &bytes)?;
    Ok(())
}

pub fn read_manifest(layout: &DataLayout, meeting_id: MeetingId) -> PortResult<SessionManifest> {
    let path = layout.manifest_path(meeting_id);
    let bytes = std::fs::read(&path)?;
    Ok(serde_json::from_slice(&bytes)?)
}
