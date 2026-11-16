//! Formato del transcript para los prompts (WP3).
//! Línea: `[mm:ss|<ms>] <Nombre>: <texto>`; el usuario como "<Nombre> (yo)".
//! Incluye estimación de tokens y troceo para map-reduce.

use acta_core::time::{MediaMs, UnixMs};
use acta_core::transcription::{Speaker, Utterance};
use std::collections::HashMap;

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

/// `mm:ss` (o `h:mm:ss`) sin corchetes ni ms. Para citas y capturas.
pub fn mmss(at: MediaMs) -> String {
    let total_s = at.0 / 1000;
    let (h, m, s) = (total_s / 3600, (total_s / 60) % 60, total_s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

/// Aproximación barata de tokens (castellano ≈ 3,2 chars/token, por exceso).
pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(3) + 1
}

/// Una línea ya formateada con su instante, para poder trocear.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub at_ms: u64,
    pub text: String,
}

/// Nombre con el que aparece un hablante en el prompt. `me_name` es el
/// nombre del usuario (los hablantes `is_me` salen como "Edu (yo)").
pub fn speaker_label(speaker: &Speaker, me_name: &str) -> String {
    if speaker.is_me {
        format!("{me_name} (yo)")
    } else {
        speaker.shown_name().to_owned()
    }
}

/// Utterances → líneas `[mm:ss|ms] Nombre: texto`, en orden temporal.
pub fn render_lines(speakers: &[Speaker], utterances: &[Utterance], me_name: &str) -> Vec<Line> {
    let names: HashMap<_, _> = speakers
        .iter()
        .map(|s| (s.id, speaker_label(s, me_name)))
        .collect();
    let mut sorted: Vec<&Utterance> = utterances.iter().collect();
    sorted.sort_by_key(|u| (u.start, u.idx));
    sorted
        .into_iter()
        .filter(|u| !u.text.trim().is_empty())
        .map(|u| {
            let who = names.get(&u.speaker_id).map(String::as_str).unwrap_or("Desconocido");
            Line {
                at_ms: u.start.0,
                text: format!("{} {}: {}", stamp(u.start), who, u.text.trim()),
            }
        })
        .collect()
}

pub fn join_lines(lines: &[Line]) -> String {
    lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n")
}

/// Trocea en bloques de como mucho `max_tokens` y `max_span_ms` de duración
/// (≈ 20 min por defecto en el generador). Nunca parte una línea; una línea
/// enorme va sola en su bloque.
pub fn split_lines(lines: &[Line], max_tokens: usize, max_span_ms: u64) -> Vec<Vec<Line>> {
    let mut blocks: Vec<Vec<Line>> = Vec::new();
    let mut cur: Vec<Line> = Vec::new();
    let mut cur_tokens = 0usize;
    let mut cur_start = 0u64;
    for line in lines {
        let t = estimate_tokens(&line.text) + 1;
        let over_tokens = !cur.is_empty() && cur_tokens + t > max_tokens;
        let over_span = !cur.is_empty() && line.at_ms.saturating_sub(cur_start) > max_span_ms;
        if over_tokens || over_span {
            blocks.push(std::mem::take(&mut cur));
            cur_tokens = 0;
        }
        if cur.is_empty() {
            cur_start = line.at_ms;
        }
        cur_tokens += t;
        cur.push(line.clone());
    }
    if !cur.is_empty() {
        blocks.push(cur);
    }
    blocks
}

/// Sustituye `{{clave}}` por su valor. Las claves no pasadas se dejan tal cual.
pub fn render_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = template.to_owned();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

/// Fecha UTC `YYYY-MM-DD HH:MM` (sin dependencias de calendario).
pub fn format_date(at: UnixMs) -> String {
    let secs = at.0.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Algoritmo civil_from_days (H. Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}", rem / 3600, (rem / 60) % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use acta_core::ids::{MeetingId, SpeakerId};
    use acta_core::recording::Track;
    use acta_core::transcription::NameSource;

    fn speaker(n: u128, is_me: bool, name: Option<&str>) -> Speaker {
        Speaker {
            id: SpeakerId::from_u128(n),
            meeting_id: MeetingId::from_u128(1),
            label: format!("Speaker {n}"),
            display_name: name.map(str::to_owned),
            is_me,
            track: if is_me { Track::Mic } else { Track::System },
            diarization_label: None,
            name_source: NameSource::Generic,
            confirmed: false,
            voiceprint_id: None,
        }
    }

    fn utt(idx: u32, sp: u128, start: u64, text: &str) -> Utterance {
        Utterance {
            idx,
            speaker_id: SpeakerId::from_u128(sp),
            track: Track::System,
            start: MediaMs(start),
            end: MediaMs(start + 1000),
            text: text.into(),
            confidence: None,
        }
    }

    #[test]
    fn stamps_minutes_and_hours() {
        assert_eq!(stamp(MediaMs(65_432)), "[01:05|65432]");
        assert_eq!(stamp(MediaMs(3_725_000)), "[1:02:05|3725000]");
        assert_eq!(mmss(MediaMs(65_432)), "01:05");
        assert_eq!(mmss(MediaMs(3_725_000)), "1:02:05");
    }

    #[test]
    fn renders_lines_with_me_marker_and_fallback_label() {
        let speakers = vec![speaker(1, true, None), speaker(2, false, Some("Ana")), speaker(3, false, None)];
        let utts = vec![
            utt(1, 2, 5_000, "Hola Edu"),
            utt(0, 1, 1_000, "Buenas"),
            utt(2, 3, 9_000, "  Qué tal  "),
            utt(3, 3, 10_000, "   "),
        ];
        let lines = render_lines(&speakers, &utts, "Edu");
        let texts: Vec<_> = lines.iter().map(|l| l.text.as_str()).collect();
        assert_eq!(
            texts,
            vec![
                "[00:01|1000] Edu (yo): Buenas",
                "[00:05|5000] Ana: Hola Edu",
                "[00:09|9000] Speaker 3: Qué tal",
            ]
        );
    }

    #[test]
    fn splits_by_token_budget_without_breaking_lines() {
        let lines: Vec<Line> = (0..10)
            .map(|i| Line { at_ms: i * 1000, text: "x".repeat(300) })
            .collect();
        let blocks = split_lines(&lines, 250, u64::MAX);
        assert!(blocks.len() >= 4, "got {}", blocks.len());
        assert_eq!(blocks.iter().map(Vec::len).sum::<usize>(), 10);
        assert!(blocks.iter().all(|b| !b.is_empty()));
    }

    #[test]
    fn splits_by_time_span() {
        let lines: Vec<Line> = (0..6)
            .map(|i| Line { at_ms: i * 10 * 60_000, text: "hola".into() })
            .collect();
        let blocks = split_lines(&lines, 100_000, 20 * 60_000);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].len(), 3);
    }

    #[test]
    fn oversized_line_goes_alone() {
        let lines = vec![
            Line { at_ms: 0, text: "a".into() },
            Line { at_ms: 1, text: "b".repeat(10_000) },
            Line { at_ms: 2, text: "c".into() },
        ];
        let blocks = split_lines(&lines, 100, u64::MAX);
        assert_eq!(blocks.len(), 3);
    }

    #[test]
    fn template_substitution() {
        assert_eq!(render_template("Hola {{a}} y {{b}} {{c}}", &[("a", "X"), ("b", "Y")]), "Hola X y Y {{c}}");
    }

    #[test]
    fn formats_utc_date() {
        // 2026-11-16 09:30:00 UTC
        assert_eq!(format_date(UnixMs(1_794_821_400_000)), "2026-11-16 09:30");
        assert_eq!(format_date(UnixMs(0)), "1970-01-01 00:00");
    }
}
