//! Formato del transcript para los prompts (WP3).
//! Línea: `[mm:ss|<ms>] <Nombre>: <texto>`; el usuario como "<Nombre> (yo)".

use acta_core::time::MediaMs;

/// `[mm:ss|ms]` (horas si hace falta: `[h:mm:ss|ms]`).
pub fn stamp(at: MediaMs) -> String {
    let total_s = at.0 / 1000;
    let (h, m, s) = (total_s / 3600, (total_s / 60) % 60, total_s % 60);
    if h > 0 {
        format!("[{h}:{m:02}:{s:02}|{}]", at.0)
    } else {
        format!("[{m:02}:{s:02}|{}]", at.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_minutes_and_hours() {
        assert_eq!(stamp(MediaMs(65_432)), "[01:05|65432]");
        assert_eq!(stamp(MediaMs(3_725_000)), "[1:02:05|3725000]");
    }
}
