#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Especificación del SegmentWriter (WP1) + regresión del bug de Meetily.

use acta_audio::fileio::read_segment_samples;
use acta_audio::writer::{SegmentWriter, SegmentWriterConfig, read_manifest};
use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::recording::{AudioFormat, AudioFrame, ManifestStatus, StopReason, Track};
use acta_core::time::UnixMs;
use std::path::Path;

const FRAME: usize = 1600; // 100 ms a 16 kHz
const T0: UnixMs = UnixMs(5_000_000);

fn mid() -> MeetingId {
    MeetingId::from_u128(7)
}

fn cfg(root: &Path, segment_seconds: u32) -> SegmentWriterConfig {
    SegmentWriterConfig {
        layout: DataLayout::new(root),
        meeting_id: mid(),
        format: AudioFormat::WORKING,
        segment_seconds,
        flush_every_ms: 1_000,
    }
}

fn frame(track: Track, n: u64, value: i16) -> AudioFrame {
    AudioFrame {
        track,
        seq: n,
        pts_us: n * 100_000,
        sample_rate: 16_000,
        samples: vec![value; FRAME],
    }
}

fn push_n(w: &mut SegmentWriter, track: Track, from: u64, count: u64, value: i16) {
    for n in from..from + count {
        w.push(&frame(track, n, value)).unwrap();
    }
}

fn dir_names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

#[test]
fn create_makes_dirs_and_recording_manifest() {
    let root = tempfile::tempdir().unwrap();
    let w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    let layout = DataLayout::new(root.path());
    assert!(layout.track_dir(mid(), Track::Mic).is_dir());
    assert!(layout.track_dir(mid(), Track::System).is_dir());
    let m = read_manifest(&layout, mid()).unwrap();
    assert_eq!(m.status, ManifestStatus::Recording);
    assert_eq!(m.spans.len(), 1);
    assert_eq!(m.spans[0].wall_start, T0);
    assert_eq!(m.segment_seconds, 30);
    drop(w);
}

#[test]
fn rolls_segments_every_n_seconds_and_finalizes_atomically() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 2), T0).unwrap();
    let mut closed = Vec::new();
    for n in 0..55 {
        closed.extend(w.push(&frame(Track::Mic, n, 100)).unwrap());
    }
    // 5,5 s con segmentos de 2 s: 2 cerrados y 1 en curso.
    assert_eq!(closed.len(), 2);
    assert_eq!(closed[0].segment.index, 0);
    assert_eq!(closed[1].segment.index, 1);
    assert_eq!(closed[1].segment.media_start.0, 2_000);
    let names = dir_names(&layout.track_dir(mid(), Track::Mic));
    assert_eq!(
        names,
        vec!["seg-000000.wav", "seg-000001.wav", "seg-000002.wav.tmp"]
    );
    // El manifiesto en disco solo lista los FINALIZADOS.
    let m = read_manifest(&layout, mid()).unwrap();
    let mic = m.tracks.iter().find(|t| t.track == Track::Mic).unwrap();
    assert_eq!(mic.segments.len(), 2);
    assert_eq!(mic.segments[0].file, "audio/mic/seg-000000.wav");
    assert_eq!(mic.segments[0].samples, 32_000);
    assert!(
        !root
            .path()
            .join("meetings")
            .join(mid().to_string())
            .join("manifest.json.tmp")
            .exists()
    );
}

#[test]
fn finish_closes_everything_and_marks_stopped() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 2), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 55, 100);
    push_n(&mut w, Track::System, 0, 55, -100);
    let m = w.finish(StopReason::User, T0.plus_ms(5_500)).unwrap();
    assert_eq!(m.status, ManifestStatus::Stopped);
    assert_eq!(m.stop_reason, Some(StopReason::User));
    assert_eq!(m.spans[0].wall_end, Some(T0.plus_ms(5_500)));
    for t in &m.tracks {
        assert_eq!(t.segments.len(), 3, "{:?}", t.track);
        assert_eq!(t.segments.iter().map(|s| s.samples).sum::<u64>(), 88_000);
    }
    let names = dir_names(&layout.track_dir(mid(), Track::System));
    assert!(names.iter().all(|n| n.ends_with(".wav")), "{names:?}");
    let on_disk = read_manifest(&layout, mid()).unwrap();
    assert_eq!(on_disk, m);
    let s = read_segment_samples(&layout.segment_path(mid(), Track::System, 2)).unwrap();
    assert_eq!(s.len(), 24_000);
    assert!(s.iter().all(|&v| v == -100));
}

#[test]
fn gaps_are_padded_with_silence() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    // mic: 0-1 s, luego salta a 3 s (hueco de 2 s). system empieza a 0,5 s.
    push_n(&mut w, Track::Mic, 0, 10, 500);
    push_n(&mut w, Track::Mic, 30, 10, 500);
    push_n(&mut w, Track::System, 5, 35, 300);
    let m = w.finish(StopReason::User, T0.plus_ms(4_000)).unwrap();
    let total = |t: Track| {
        let tm = m.tracks.iter().find(|x| x.track == t).unwrap();
        (
            tm.segments.iter().map(|s| s.samples).sum::<u64>(),
            tm.segments.iter().map(|s| s.padded_samples).sum::<u64>(),
        )
    };
    let (mic_total, mic_pad) = total(Track::Mic);
    let (sys_total, sys_pad) = total(Track::System);
    assert_eq!(mic_total, 64_000, "ambas pistas alineadas a 4 s");
    assert_eq!(sys_total, 64_000);
    assert_eq!(mic_pad, 32_000, "hueco de 2 s");
    assert_eq!(sys_pad, 8_000, "arranque tardío de 0,5 s");
    let s = read_segment_samples(&layout.segment_path(mid(), Track::Mic, 0)).unwrap();
    assert!(s[16_000..48_000].iter().all(|&v| v == 0));
    assert!(s[..16_000].iter().all(|&v| v == 500) && s[48_000..].iter().all(|&v| v == 500));
}

#[test]
fn overlapping_frames_are_trimmed() {
    let root = tempfile::tempdir().unwrap();
    let mut w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 10, 1);
    // Reenvío de los frames 5..10 (solape de 0,5 s).
    push_n(&mut w, Track::Mic, 5, 10, 2);
    let m = w.finish(StopReason::User, T0.plus_ms(2_000)).unwrap();
    let mic = m.tracks.iter().find(|t| t.track == Track::Mic).unwrap();
    assert_eq!(mic.segments.iter().map(|s| s.samples).sum::<u64>(), 24_000);
}

#[test]
fn frames_at_other_sample_rate_are_resampled_to_16k() {
    let root = tempfile::tempdir().unwrap();
    let mut w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    for n in 0..10u64 {
        w.push(&AudioFrame {
            track: Track::Mic,
            seq: n,
            pts_us: n * 100_000,
            sample_rate: 48_000,
            samples: vec![700; 4_800],
        })
        .unwrap();
    }
    let m = w.finish(StopReason::User, T0.plus_ms(1_000)).unwrap();
    let mic = m.tracks.iter().find(|t| t.track == Track::Mic).unwrap();
    let n: u64 = mic.segments.iter().map(|s| s.samples).sum();
    assert!((n as i64 - 16_000).abs() <= 40, "{n}");
}

#[test]
fn pause_closes_segment_excludes_gap_and_keeps_tracks_aligned() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 20, 10);
    push_n(&mut w, Track::System, 0, 19, 10); // system va 100 ms por detrás
    w.pause(T0.plus_ms(2_000)).unwrap();
    let paused = read_manifest(&layout, mid()).unwrap();
    assert_eq!(paused.status, ManifestStatus::Paused);
    assert_eq!(paused.spans[0].wall_end, Some(T0.plus_ms(2_000)));
    // Frames en vuelo durante la pausa se descartan.
    w.push(&frame(Track::Mic, 21, 9)).unwrap();
    // Reanuda 60 s después; el reloj de captura sigue corriendo (pts 62 s).
    w.resume(T0.plus_ms(62_000)).unwrap();
    for n in 620..630 {
        w.push(&frame(Track::Mic, n, 20)).unwrap();
        w.push(&frame(Track::System, n, 20)).unwrap();
    }
    let m = w.finish(StopReason::User, T0.plus_ms(63_000)).unwrap();
    assert_eq!(m.spans.len(), 2);
    assert_eq!(m.spans[1].wall_start, T0.plus_ms(62_000));
    assert_eq!(m.spans[1].media_start.0, 2_000, "las pausas no cuentan");
    let totals: Vec<u64> = m
        .tracks
        .iter()
        .map(|t| t.segments.iter().map(|s| s.samples).sum())
        .collect();
    assert_eq!(totals, vec![48_000, 48_000]);
    // wall_to_media descarta la pausa.
    assert_eq!(
        m.wall_to_media(T0.plus_ms(62_500)).map(|x| x.0),
        Some(2_500)
    );
    assert_eq!(m.wall_to_media(T0.plus_ms(30_000)), None);
}

#[test]
fn exposes_manifest_and_recorded_ms_while_recording() {
    let root = tempfile::tempdir().unwrap();
    let mut w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 15, 1);
    push_n(&mut w, Track::System, 0, 10, 1);
    assert_eq!(w.recorded_ms(), 1_500);
    assert_eq!(w.meeting_id(), mid());
    assert_eq!(w.manifest().wall_to_media(T0.plus_ms(700)).map(|m| m.0), Some(700));
}

/// WP4: al reanudar, el reloj host del sidecar ha seguido corriendo (pts
/// saltan) y además la pista system puede llegar primero con un pts mayor.
/// El writer debe rebasar el origen, NO rellenar el salto con silencio.
#[test]
fn resume_rebases_pts_without_padding_even_if_tracks_arrive_out_of_order() {
    let root = tempfile::tempdir().unwrap();
    let mut w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 10, 3);
    push_n(&mut w, Track::System, 0, 10, 3);
    w.pause(T0.plus_ms(1_000)).unwrap();
    w.resume(T0.plus_ms(301_000)).unwrap();
    // 5 minutos después; system llega 40 ms "más tarde" en pts pero antes en orden.
    let base = 3_010u64;
    for n in 0..10 {
        let mut s = frame(Track::System, base + n, 4);
        s.pts_us += 40_000;
        w.push(&s).unwrap();
        w.push(&frame(Track::Mic, base + n, 4)).unwrap();
    }
    let m = w.finish(StopReason::User, T0.plus_ms(302_000)).unwrap();
    for t in &m.tracks {
        let padded: u64 = t.segments.iter().map(|s| s.padded_samples).sum();
        let total: u64 = t.segments.iter().map(|s| s.samples).sum();
        assert!(padded <= 1_600, "{:?} padded {padded}", t.track);
        assert!((total as i64 - 32_000).abs() <= 1_600, "{:?} total {total}", t.track);
    }
}

#[test]
fn restart_fills_the_hole_with_silence_and_rebases_pts() {
    let root = tempfile::tempdir().unwrap();
    let mut w = SegmentWriter::create(cfg(root.path(), 30), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 10, 5);
    w.mark_restart(500);
    push_n(&mut w, Track::Mic, 0, 10, 6); // pts vuelve a 0 tras reiniciar
    let m = w.finish(StopReason::User, T0.plus_ms(3_000)).unwrap();
    let mic = m.tracks.iter().find(|t| t.track == Track::Mic).unwrap();
    assert_eq!(
        mic.segments.iter().map(|s| s.samples).sum::<u64>(),
        16_000 + 8_000 + 16_000
    );
    assert_eq!(
        mic.segments.iter().map(|s| s.padded_samples).sum::<u64>(),
        8_000
    );
}

#[test]
fn rejects_invalid_config() {
    let root = tempfile::tempdir().unwrap();
    assert!(SegmentWriter::create(cfg(root.path(), 0), T0).is_err());
}

// ---------------------------------------------------------------------------
// Regresión Meetily (docs/referencia-meetily-zombis.md)
// ---------------------------------------------------------------------------

/// Un segmento que no se puede crear (el nombre ya existe) NO se reintenta en
/// bucle, el índice avanza, el audio sigue guardado (raw de emergencia), el
/// fichero ajeno no se toca y se informa del error una sola vez por segmento.
#[test]
fn failed_segment_never_reuses_name_nor_retries_in_loop() {
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 2), T0).unwrap();
    // El nombre del primer segmento ya existe (como el audio_chunk_011 de Meetily).
    let squatter = layout.segment_tmp_path(mid(), Track::Mic, 0);
    std::fs::write(&squatter, b"AJENO").unwrap();

    // 7 s = tres segmentos completos (0, 1, 2) y uno en curso (3).
    let mut closed = Vec::new();
    for n in 0..70 {
        closed.extend(w.push(&frame(Track::Mic, n, 321)).unwrap());
    }
    assert_eq!(
        std::fs::read(&squatter).unwrap(),
        b"AJENO",
        "no se sobreescribe nada"
    );

    let failures = w.take_failures();
    assert_eq!(
        failures.len(),
        1,
        "un fallo por segmento, sin bucle: {failures:?}"
    );
    assert_eq!(failures[0].segment_index, Some(0));
    assert_eq!(failures[0].track, Track::Mic);
    assert!(failures[0].raw_fallback.is_some(), "el audio no se pierde");

    // Los índices avanzan siempre: 0 (raw), 1, 2 (wav). Nunca se repite uno.
    let indices: Vec<u32> = closed.iter().map(|f| f.segment.index).collect();
    assert_eq!(indices, vec![0, 1, 2]);
    let names = dir_names(&layout.track_dir(mid(), Track::Mic));
    assert_eq!(
        names,
        vec![
            "seg-000000.raw",
            "seg-000000.wav.tmp",
            "seg-000001.wav",
            "seg-000002.wav",
            "seg-000003.wav.tmp"
        ]
    );
    let raw =
        read_segment_samples(&layout.track_dir(mid(), Track::Mic).join("seg-000000.raw")).unwrap();
    assert_eq!(raw.len(), 32_000);
    assert!(raw.iter().all(|&s| s == 321));

    // El manifiesto lista el segmento de emergencia: concat lo usará.
    let m = w.finish(StopReason::User, T0.plus_ms(7_000)).unwrap();
    let mic = m.tracks.iter().find(|t| t.track == Track::Mic).unwrap();
    assert_eq!(mic.segments.len(), 4);
    assert_eq!(mic.segments[0].file, "audio/mic/seg-000000.raw");
    assert_eq!(mic.segments.iter().map(|s| s.samples).sum::<u64>(), 112_000);
}

#[cfg(unix)]
#[test]
fn read_only_directory_does_not_loop_does_not_panic_and_reports_each_segment_once() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 1), T0).unwrap();
    let dir = layout.track_dir(mid(), Track::System);
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    if std::fs::File::create(dir.join("probe")).is_ok() {
        // Somos root o el FS ignora permisos: no se puede simular.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        return;
    }

    let mut closed = Vec::new();
    for n in 0..35 {
        closed.extend(w.push(&frame(Track::System, n, 77)).unwrap());
    }
    let failures = w.take_failures();
    assert_eq!(
        failures.len(),
        3,
        "3 segmentos completos = 3 fallos exactos: {failures:?}"
    );
    let idx: Vec<_> = failures.iter().map(|f| f.segment_index).collect();
    assert_eq!(idx, vec![Some(0), Some(1), Some(2)]);
    // Sin escribir en la carpeta de la pista, el audio acaba en la de la reunión.
    assert!(
        failures.iter().all(|f| f.raw_fallback.is_some()),
        "{failures:?}"
    );
    assert_eq!(closed.len(), 3);
    let meeting = layout.meeting_dir(mid());
    let lost: Vec<String> = dir_names(&meeting)
        .into_iter()
        .filter(|n| n.starts_with("lost-"))
        .collect();
    assert_eq!(lost.len(), 3, "{lost:?}");

    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// El crate no puede lanzar procesos: el bug de Meetily eran miles de hijos sin
/// `wait()`. Se vigila el código fuente (ffmpeg incluido).
#[test]
fn acta_audio_never_spawns_child_processes() {
    fn walk(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    let mut files = Vec::new();
    walk(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    assert!(files.len() > 5);
    let forbidden = [
        "process::Command",
        "tokio::process",
        "Command::new",
        ".spawn(",
        // Troceado para que `scripts/guards.sh` (que prohíbe la palabra en el
        // código) no confunda esta prohibición con un uso real.
        concat!("ff", "mpeg"),
        "zombie_processes)]",
    ];
    for f in files {
        let text = std::fs::read_to_string(&f).unwrap();
        for word in forbidden {
            if word == "zombie_processes)]" {
                continue;
            }
            // Las menciones en comentarios de documentación son legítimas.
            let hit = text
                .lines()
                .filter(|l| !l.trim_start().starts_with("//"))
                .any(|l| l.contains(word));
            assert!(!hit, "{} contiene `{word}`", f.display());
        }
    }
}

// ---------------------------------------------------------------------------
// Recuperación y concatenación
// ---------------------------------------------------------------------------

#[test]
fn recovery_repairs_tmp_segment() {
    use acta_audio::recovery::{recover, scan_incomplete};
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 2), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 45, 400); // 4,5 s: 2 segmentos cerrados + 0,5 s en curso
    push_n(&mut w, Track::System, 0, 45, 300);

    // "Crash": copiamos el estado de disco tal cual está AHORA a otro árbol.
    let crash = tempfile::tempdir().unwrap();
    let crash_layout = DataLayout::new(crash.path());
    for track in Track::ALL {
        std::fs::create_dir_all(crash_layout.track_dir(mid(), track)).unwrap();
        for name in dir_names(&layout.track_dir(mid(), track)) {
            std::fs::copy(
                layout.track_dir(mid(), track).join(&name),
                crash_layout.track_dir(mid(), track).join(&name),
            )
            .unwrap();
        }
    }
    std::fs::copy(
        layout.manifest_path(mid()),
        crash_layout.manifest_path(mid()),
    )
    .unwrap();
    // Un sample a medias al final del .tmp (corte en mitad de una escritura).
    {
        use std::io::Write;
        let tmp = crash_layout.segment_tmp_path(mid(), Track::Mic, 2);
        let mut f = std::fs::OpenOptions::new().append(true).open(tmp).unwrap();
        f.write_all(&[0x12]).unwrap();
    }
    drop(w);

    assert_eq!(scan_incomplete(&crash_layout).unwrap(), vec![mid()]);
    let m = recover(&crash_layout, mid()).unwrap();
    assert_eq!(m.status, ManifestStatus::Stopped);
    assert_eq!(m.stop_reason, Some(StopReason::Error));
    assert!(m.spans.iter().all(|s| s.wall_end.is_some()));
    let mic = m.tracks.iter().find(|t| t.track == Track::Mic).unwrap();
    assert_eq!(mic.segments.len(), 3);
    assert_eq!(mic.segments[2].index, 2);
    assert_eq!(mic.segments[2].media_start.0, 4_000);
    // Se pierde como mucho lo posterior al último flush (flush_every_ms = 1 s).
    let lost = 4_500 - (mic.segments.iter().map(|s| s.samples).sum::<u64>() * 1000 / 16_000);
    assert!(lost <= 1_000, "perdido {lost} ms");
    // El fichero reparado es un WAV válido y no queda ningún .tmp.
    let samples = read_segment_samples(&crash_layout.segment_path(mid(), Track::Mic, 2)).unwrap();
    assert_eq!(samples.len() as u64, mic.segments[2].samples);
    assert!(samples.iter().all(|&s| s == 400));
    assert!(
        dir_names(&crash_layout.track_dir(mid(), Track::Mic))
            .iter()
            .all(|n| !n.ends_with(".tmp"))
    );
    // Ya no está pendiente.
    assert!(scan_incomplete(&crash_layout).unwrap().is_empty());
}

#[test]
fn recovery_skips_truncated_tmp_and_keeps_orphan_finalized_segments() {
    use acta_audio::recovery::recover;
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 1), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 25, 9); // seg 0 y 1 cerrados, 2 en curso
    drop(w);
    let dir = layout.track_dir(mid(), Track::Mic);
    // .tmp con la cabecera sin terminar → truncado: se ignora.
    std::fs::write(layout.segment_tmp_path(mid(), Track::Mic, 7), [0u8; 10]).unwrap();
    // El manifiesto "olvida" el segmento 1 (crash entre rename y manifiesto).
    let mut m = acta_audio::writer::read_manifest(&layout, mid()).unwrap();
    m.tracks
        .iter_mut()
        .find(|t| t.track == Track::Mic)
        .unwrap()
        .segments
        .truncate(1);
    acta_audio::writer::write_manifest_atomic(&layout, &m).unwrap();

    let rec = recover(&layout, mid()).unwrap();
    let mic = rec.tracks.iter().find(|t| t.track == Track::Mic).unwrap();
    let indices: Vec<u32> = mic.segments.iter().map(|s| s.index).collect();
    assert!(indices.starts_with(&[0, 1]), "{indices:?}");
    assert!(!indices.contains(&7));
    assert!(
        dir.join("seg-000007.wav.tmp").exists(),
        "no se destruye lo que no se entiende"
    );
    // media_start encadenado.
    assert_eq!(mic.segments[1].media_start.0, 1_000);
}

#[test]
fn scan_incomplete_ignores_finished_sessions_and_empty_root() {
    use acta_audio::recovery::scan_incomplete;
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    assert!(scan_incomplete(&layout).unwrap().is_empty());
    let w = SegmentWriter::create(cfg(root.path(), 2), T0).unwrap();
    w.finish(StopReason::User, T0.plus_ms(1)).unwrap();
    assert!(scan_incomplete(&layout).unwrap().is_empty());
}

#[test]
fn concat_builds_aligned_track_wavs_and_limited_mix() {
    use acta_audio::concat::{concat_track, finalize_audio, mixdown};
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 1), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 25, 20_000);
    push_n(&mut w, Track::System, 0, 20, 20_000); // system 0,5 s más corta
    let m = w.finish(StopReason::User, T0.plus_ms(2_500)).unwrap();

    let mic = concat_track(&layout, &m, Track::Mic).unwrap();
    let sys = concat_track(&layout, &m, Track::System).unwrap();
    assert_eq!(mic, layout.track_wav(mid(), Track::Mic));
    let n = |p: &Path| hound::WavReader::open(p).unwrap().len();
    assert_eq!(n(&mic), 40_000);
    assert_eq!(
        n(&sys),
        40_000,
        "la pista corta se rellena hasta la longitud total"
    );
    assert_eq!(
        hound::WavReader::open(&mic).unwrap().spec().sample_rate,
        16_000
    );

    let mix = mixdown(&layout, &m).unwrap();
    let samples: Vec<i16> = hound::WavReader::open(&mix)
        .unwrap()
        .samples::<i16>()
        .map(Result::unwrap)
        .collect();
    assert_eq!(samples.len(), 40_000);
    assert!(
        samples[..32_000]
            .iter()
            .all(|&s| s > 30_000 && s < i16::MAX),
        "20000 + 20000 se limita sin recortar"
    );
    assert_eq!(
        samples[35_000], 20_000,
        "donde solo habla una pista no se toca"
    );
    assert!(
        dir_names(&layout.meeting_dir(mid()).join("audio"))
            .iter()
            .all(|n| !n.ends_with(".tmp"))
    );

    let fin = finalize_audio(&layout, mid()).unwrap();
    assert_eq!(fin.status, ManifestStatus::Finalized);
    assert_eq!(
        read_manifest(&layout, mid()).unwrap().status,
        ManifestStatus::Finalized
    );
}

#[test]
fn concat_fills_a_lost_segment_with_silence_to_keep_alignment() {
    use acta_audio::concat::concat_track;
    let root = tempfile::tempdir().unwrap();
    let layout = DataLayout::new(root.path());
    let mut w = SegmentWriter::create(cfg(root.path(), 1), T0).unwrap();
    push_n(&mut w, Track::Mic, 0, 30, 800);
    let m = w.finish(StopReason::User, T0.plus_ms(3_000)).unwrap();
    // Simula un segmento perdido del todo (ni wav ni raw).
    std::fs::remove_file(layout.segment_path(mid(), Track::Mic, 1)).unwrap();
    let out = concat_track(&layout, &m, Track::Mic).unwrap();
    let s: Vec<i16> = hound::WavReader::open(out)
        .unwrap()
        .samples::<i16>()
        .map(Result::unwrap)
        .collect();
    assert_eq!(s.len(), 48_000, "duración intacta");
    assert!(s[16_000..32_000].iter().all(|&v| v == 0));
    assert_eq!(s[40_000], 800);
}
