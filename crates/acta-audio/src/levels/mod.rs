//! Cálculo de niveles por frame.

use acta_core::recording::{Level, Levels, Track};
use acta_core::time::UnixMs;

/// Nivel de un bloque PCM s16 mono.
pub fn level_of(samples: &[i16]) -> Level {
    if samples.is_empty() || samples.iter().all(|&s| s == 0) {
        return Level::SILENT;
    }
    let mut peak: i32 = 0;
    let mut sum_sq: f64 = 0.0;
    for &s in samples {
        let v = s as i32;
        peak = peak.max(v.abs());
        sum_sq += (v as f64) * (v as f64);
    }
    let full = i16::MAX as f64;
    let rms = (sum_sq / samples.len() as f64).sqrt();
    let to_db = |x: f64| {
        if x <= 0.0 {
            -120.0
        } else {
            (20.0 * (x / full).log10()).max(-120.0) as f32
        }
    };
    Level {
        rms_dbfs: to_db(rms),
        peak_dbfs: to_db(peak as f64),
        all_zero: false,
    }
}

/// Medidores para la pastilla: último nivel de cada pista con caída suave si
/// una pista deja de entregar frames (así no se queda "pegada" en alto).
#[derive(Debug, Clone)]
pub struct LevelMeter {
    mic: (Level, UnixMs),
    system: (Level, UnixMs),
    /// Pasado este tiempo sin frames, la pista cuenta como silencio.
    pub stale_ms: u64,
}

impl Default for LevelMeter {
    fn default() -> Self {
        Self {
            mic: (Level::SILENT, UnixMs(0)),
            system: (Level::SILENT, UnixMs(0)),
            stale_ms: 300,
        }
    }
}

impl LevelMeter {
    pub fn update(&mut self, track: Track, samples: &[i16], at: UnixMs) {
        let slot = match track {
            Track::Mic => &mut self.mic,
            Track::System => &mut self.system,
        };
        *slot = (level_of(samples), at);
    }

    pub fn snapshot(&self, at: UnixMs) -> Levels {
        let pick = |(level, seen): (Level, UnixMs)| {
            if at.since(seen).max(0) as u64 > self.stale_ms {
                Level::SILENT
            } else {
                level
            }
        };
        Levels {
            mic: pick(self.mic),
            system: pick(self.system),
            at,
        }
    }
}

/// VAD de energía con tiempo de retención: "hay voz" mientras el nivel supere
/// el umbral y `hangover_ms` después, para no cortar las pausas entre palabras.
#[derive(Debug, Clone)]
pub struct EnergyVad {
    pub threshold_dbfs: f32,
    pub hangover_ms: u64,
    last_voice: Option<UnixMs>,
}

impl EnergyVad {
    pub fn new(threshold_dbfs: f32, hangover_ms: u64) -> Self {
        Self {
            threshold_dbfs,
            hangover_ms,
            last_voice: None,
        }
    }

    pub fn process(&mut self, level: &Level, at: UnixMs) -> bool {
        if !level.all_zero && level.rms_dbfs >= self.threshold_dbfs {
            self.last_voice = Some(at);
            return true;
        }
        self.last_voice
            .is_some_and(|t| at.since(t).max(0) as u64 <= self.hangover_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_zeros_are_flagged_as_all_zero() {
        let l = level_of(&[0; 1600]);
        assert!(l.all_zero);
    }

    #[test]
    fn full_scale_square_is_near_zero_dbfs() {
        let l = level_of(&[i16::MAX, -i16::MAX].repeat(800));
        assert!(!l.all_zero);
        assert!(l.rms_dbfs > -0.1, "{}", l.rms_dbfs);
    }

    #[test]
    fn half_scale_sine_reads_about_minus_nine_dbfs_rms() {
        let s: Vec<i16> = (0..1600)
            .map(|n| {
                ((n as f64 / 16_000.0 * 440.0 * std::f64::consts::TAU).sin() * 16_384.0) as i16
            })
            .collect();
        let l = level_of(&s);
        assert!((l.rms_dbfs + 9.0).abs() < 0.6, "{}", l.rms_dbfs);
        assert!((l.peak_dbfs + 6.0).abs() < 0.2, "{}", l.peak_dbfs);
    }

    #[test]
    fn meter_decays_when_track_goes_quiet() {
        let mut m = LevelMeter::default();
        m.update(Track::Mic, &[8_000; 1600], UnixMs(1_000));
        assert!(m.snapshot(UnixMs(1_100)).mic.rms_dbfs > -20.0);
        assert!(m.snapshot(UnixMs(1_100)).system.all_zero);
        assert!(m.snapshot(UnixMs(2_000)).mic.all_zero);
    }

    #[test]
    fn vad_holds_voice_for_hangover() {
        let loud = Level {
            rms_dbfs: -20.0,
            peak_dbfs: -10.0,
            all_zero: false,
        };
        let mut v = EnergyVad::new(-50.0, 300);
        assert!(!v.process(&Level::SILENT, UnixMs(0)));
        assert!(v.process(&loud, UnixMs(100)));
        assert!(v.process(&Level::SILENT, UnixMs(350)));
        assert!(!v.process(&Level::SILENT, UnixMs(500)));
    }
}
