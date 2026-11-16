//! Concatenación final con hound (WP1). Nada de ffmpeg.
//!
//! Cada pista se reconstruye sobre la línea `MediaMs`: si falta un segmento
//! (perdido o ilegible) se rellena con silencio para que las dos pistas sigan
//! alineadas, y la pista corta se completa hasta la duración total.

use crate::fileio::{fsync_dir, read_segment_samples};
use crate::writer::{read_manifest, write_manifest_atomic};
use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::recording::{ManifestStatus, SegmentInfo, SessionManifest, Track};
use acta_core::{PortError, PortResult};
use std::fs::OpenOptions;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

fn spec(rate: u32) -> hound::WavSpec {
    hound::WavSpec {
        channels: 1,
        sample_rate: rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    }
}

fn segment_start_samples(seg: &SegmentInfo, rate: u64) -> u64 {
    seg.media_start.0 * rate / 1000
}

/// Duración total de la sesión en muestras (la pista más larga manda).
pub fn total_samples(manifest: &SessionManifest) -> u64 {
    let rate = u64::from(manifest.format.sample_rate);
    manifest
        .tracks
        .iter()
        .flat_map(|t| t.segments.iter())
        .map(|s| segment_start_samples(s, rate) + s.samples)
        .max()
        .unwrap_or(0)
}

/// Escribe un WAV a `path` vía `.tmp` + fsync + rename. `fill` recibe el writer.
fn write_wav_atomic(
    path: &Path,
    rate: u32,
    fill: impl FnOnce(&mut hound::WavWriter<BufWriter<std::fs::File>>) -> PortResult<()>,
) -> PortResult<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let result = (|| -> PortResult<()> {
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        let sync = file.try_clone()?;
        let mut w = hound::WavWriter::new(BufWriter::new(file), spec(rate)).map_err(io_err)?;
        fill(&mut w)?;
        w.finalize().map_err(io_err)?;
        sync.sync_all()?;
        std::fs::rename(&tmp, path)?;
        if let Some(dir) = path.parent() {
            fsync_dir(dir)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn io_err(e: hound::Error) -> PortError {
    PortError::Io(e.to_string())
}

fn write_zeros(w: &mut hound::WavWriter<BufWriter<std::fs::File>>, mut n: u64) -> PortResult<()> {
    while n > 0 {
        w.write_sample(0i16).map_err(io_err)?;
        n -= 1;
    }
    Ok(())
}

/// Resuelve la ruta de un segmento del manifiesto (relativa a la reunión).
fn segment_file(layout: &DataLayout, manifest: &SessionManifest, seg: &SegmentInfo) -> PathBuf {
    layout.meeting_dir(manifest.meeting_id).join(&seg.file)
}

/// Une los segmentos de una pista en `audio/<track>.wav` (vía `.tmp` + rename).
pub fn concat_track(
    layout: &DataLayout,
    manifest: &SessionManifest,
    track: Track,
) -> PortResult<PathBuf> {
    let rate = manifest.format.sample_rate;
    let rate64 = u64::from(rate);
    let total = total_samples(manifest);
    let mut segments: Vec<&SegmentInfo> = manifest
        .tracks
        .iter()
        .filter(|t| t.track == track)
        .flat_map(|t| t.segments.iter())
        .collect();
    segments.sort_by_key(|s| (s.media_start, s.index));
    let out = layout.track_wav(manifest.meeting_id, track);
    // Un milisegundo de holgura: `media_start` solo tiene precisión de ms.
    let tolerance = rate64 / 1000;

    write_wav_atomic(&out, rate, |w| {
        let mut pos: u64 = 0;
        for seg in segments {
            let start = segment_start_samples(seg, rate64);
            if start > pos + tolerance {
                write_zeros(w, start - pos)?;
                pos = start;
            }
            match read_segment_samples(&segment_file(layout, manifest, seg)) {
                Ok(samples) => {
                    for s in &samples {
                        w.write_sample(*s).map_err(io_err)?;
                    }
                    pos += samples.len() as u64;
                }
                Err(e) => {
                    // Segmento ilegible/perdido: silencio, y se sigue.
                    tracing::warn!(index = seg.index, error = %e, "segment unreadable, padding with silence");
                    write_zeros(w, seg.samples)?;
                    pos += seg.samples;
                }
            }
        }
        if total > pos {
            write_zeros(w, total - pos)?;
        }
        Ok(())
    })?;
    Ok(out)
}

/// Limitador suave: transparente hasta 0,8 de fondo de escala y compresión
/// tanh por encima, sin recorte duro.
fn soft_limit(x: f32) -> f32 {
    const KNEE: f32 = 0.8;
    let a = x.abs();
    if a <= KNEE {
        x
    } else {
        x.signum() * (KNEE + (1.0 - KNEE) * ((a - KNEE) / (1.0 - KNEE)).tanh())
    }
}

/// Mezcla mono `audio/mix.wav` (suma con limitador) para reproducir.
/// Requiere `audio/<track>.wav` (ver `concat_track`).
pub fn mixdown(layout: &DataLayout, manifest: &SessionManifest) -> PortResult<PathBuf> {
    let rate = manifest.format.sample_rate;
    let id = manifest.meeting_id;
    let open = |t: Track| hound::WavReader::open(layout.track_wav(id, t)).map_err(io_err);
    let mut mic = open(Track::Mic)?;
    let mut sys = open(Track::System)?;
    let out = layout.mix_wav(id);
    write_wav_atomic(&out, rate, |w| {
        let mut a = mic.samples::<i16>();
        let mut b = sys.samples::<i16>();
        loop {
            let (x, y) = (
                a.next().transpose().map_err(io_err)?,
                b.next().transpose().map_err(io_err)?,
            );
            if x.is_none() && y.is_none() {
                break;
            }
            let sum = (f32::from(x.unwrap_or(0)) + f32::from(y.unwrap_or(0))) / 32768.0;
            let v = (soft_limit(sum) * 32768.0).round().clamp(-32768.0, 32767.0) as i16;
            w.write_sample(v).map_err(io_err)?;
        }
        Ok(())
    })?;
    Ok(out)
}

/// Paso `concatenating` completo: pistas + mezcla, y manifiesto en `Finalized`.
/// No borra segmentos (eso lo decide `Settings.recording.delete_segments_after_concat`
/// con [`remove_segments`], solo si esto terminó bien).
pub fn finalize_audio(layout: &DataLayout, meeting_id: MeetingId) -> PortResult<SessionManifest> {
    let mut manifest = read_manifest(layout, meeting_id)?;
    for track in Track::ALL {
        concat_track(layout, &manifest, track)?;
    }
    mixdown(layout, &manifest)?;
    manifest.status = ManifestStatus::Finalized;
    write_manifest_atomic(layout, &manifest)?;
    Ok(manifest)
}

/// Borra los segmentos ya concatenados (llamar solo tras `finalize_audio` correcto).
pub fn remove_segments(layout: &DataLayout, manifest: &SessionManifest) -> PortResult<()> {
    for seg in manifest.tracks.iter().flat_map(|t| t.segments.iter()) {
        match std::fs::remove_file(segment_file(layout, manifest, seg)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}
