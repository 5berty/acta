//! Cálculo de niveles por frame.

use acta_core::recording::Level;

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
    let to_db = |x: f64| if x <= 0.0 { -120.0 } else { (20.0 * (x / full).log10()).max(-120.0) as f32 };
    Level {
        rms_dbfs: to_db(rms),
        peak_dbfs: to_db(peak as f64),
        all_zero: false,
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
}
