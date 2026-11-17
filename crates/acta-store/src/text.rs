//! Utilidades de texto: plegado de acentos y construcción de consultas FTS5.

/// Minúsculas y sin diacríticos (equivalente a `unicode61 remove_diacritics 2`
/// para el castellano y otras lenguas latinas habituales).
pub fn fold_text(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

fn tokens(s: &str) -> Vec<&str> {
    s.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()).collect()
}

fn quoted(s: &str) -> Vec<String> {
    tokens(s).into_iter().map(|t| format!("\"{t}\"")).collect()
}

/// Consulta FTS5 con los términos unidos por OR (recall alto; BM25 ordena).
/// Cada término va entre comillas, así que ningún operador del usuario se interpreta.
pub fn fts_or_query(s: &str) -> Option<String> {
    let q = quoted(s);
    (!q.is_empty()).then(|| q.join(" OR "))
}

/// Consulta FTS5 con AND implícito (todos los términos deben aparecer).
pub fn fts_and_query(s: &str) -> Option<String> {
    let q = quoted(s);
    (!q.is_empty()).then(|| q.join(" "))
}

/// Cada carácter plegado con el índice UTF-16 de su carácter original (más
/// uno final con la longitud), para devolver rangos que valgan en JS.
fn fold_with_map(s: &str) -> (Vec<char>, Vec<u32>) {
    let mut folded = Vec::new();
    let mut map = Vec::new();
    let mut at: u32 = 0;
    for ch in s.chars() {
        let mut buf = [0u8; 4];
        for f in fold_text(ch.encode_utf8(&mut buf)).chars() {
            folded.push(f);
            map.push(at);
        }
        at += ch.len_utf16() as u32;
    }
    map.push(at);
    (folded, map)
}

/// `meeting_search_transcript`: utterances que contienen `query` sin
/// distinguir acentos ni mayúsculas, con los rangos `[inicio, fin)` en
/// unidades UTF-16 del texto (como `String.slice` en JS).
pub fn search_utterances(utterances: &[acta_core::transcription::Utterance], query: &str) -> Vec<acta_core::api::TranscriptMatch> {
    let (q, _) = fold_with_map(query.trim());
    if q.is_empty() {
        return Vec::new();
    }
    let mut sorted: Vec<_> = utterances.iter().collect();
    sorted.sort_by_key(|u| (u.start, u.idx));
    sorted
        .into_iter()
        .filter_map(|u| {
            let (text, map) = fold_with_map(&u.text);
            let mut ranges = Vec::new();
            let mut i = 0;
            while i + q.len() <= text.len() {
                if text[i..i + q.len()] == q[..] {
                    ranges.push([map[i], map[i + q.len()]]);
                    i += q.len();
                } else {
                    i += 1;
                }
            }
            (!ranges.is_empty()).then(|| acta_core::api::TranscriptMatch { utterance_id: u.idx, start_ms: u.start.0, snippet: u.text.clone(), ranges })
        })
        .collect()
}

#[cfg(test)]
mod search_tests {
    use super::*;
    use acta_core::ids::SpeakerId;
    use acta_core::recording::Track;
    use acta_core::time::MediaMs;
    use acta_core::transcription::Utterance;

    fn utt(idx: u32, start: u64, text: &str) -> Utterance {
        Utterance { idx, speaker_id: SpeakerId::from_u128(1), track: Track::Mic, start: MediaMs(start), end: MediaMs(start + 1000), text: text.into(), confidence: None }
    }

    #[test]
    fn finds_every_match_ignoring_accents_and_case_with_utf16_ranges() {
        let us = vec![utt(2, 10_000, "La reunión de presupuesto y la REUNION final"), utt(0, 0, "Nada que ver")];
        let hits = search_utterances(&us, "reunion");
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].utterance_id, hits[0].start_ms), (2, 10_000));
        assert_eq!(hits[0].ranges, vec![[3, 10], [31, 38]]);
        assert_eq!(search_utterances(&us, "REUNIÓN")[0].ranges.len(), 2);
    }

    #[test]
    fn ranges_count_utf16_units_for_emoji_and_blank_queries_match_nothing() {
        let us = vec![utt(0, 0, "🎉 Ñandú listo")];
        assert_eq!(search_utterances(&us, "nandu")[0].ranges, vec![[3, 8]]);
        assert!(search_utterances(&us, "   ").is_empty());
    }

    #[test]
    fn results_follow_the_timeline() {
        let us = vec![utt(5, 9_000, "plazo dos"), utt(1, 1_000, "plazo uno")];
        assert_eq!(search_utterances(&us, "plazo").iter().map(|h| h.utterance_id).collect::<Vec<_>>(), vec![1, 5]);
    }
}
