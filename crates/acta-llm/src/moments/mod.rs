//! `ImportantMomentDetector` (WP3): normaliza (minúsculas, NFD sin diacríticos)
//! y busca las palabras clave de `Settings.screen.keywords` como palabra
//! completa o prefijo ("apuntad" → "apuntadlo"). Antirrebote: misma palabra
//! no dispara más de una vez cada 20 s.
//!
//! Las palabras clave pueden ser frases ("esto es clave", "ojo con"): los
//! tokens previos deben coincidir exactos y el último puede ser prefijo.

use acta_core::minutes::{ImportantMomentDetector, KeywordHit};
use acta_core::recording::Track;
use acta_core::time::UnixMs;
use std::collections::HashMap;
use std::sync::Mutex;
use unicode_normalization::UnicodeNormalization;

/// Antirrebote por defecto (ms).
pub const DEFAULT_DEBOUNCE_MS: i64 = 20_000;

/// Frases ES/EN que se añaden siempre a las de `Settings.screen.keywords`.
pub const EXTRA_KEYWORDS: &[&str] = &[
    "importante",
    "apuntad",
    "apunta esto",
    "apuntalo",
    "esto es clave",
    "ojo con",
    "deadline",
    "fecha limite",
    "para el lunes",
    "para el martes",
    "para el miercoles",
    "para el jueves",
    "para el viernes",
    "action item",
    "important",
    "key point",
    "take note",
    "due date",
    "write this down",
    "heads up",
];

/// Minúsculas + NFD sin marcas diacríticas.
pub fn normalize(text: &str) -> String {
    text.nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

/// Tokens alfanuméricos normalizados.
fn tokens(text: &str) -> Vec<String> {
    normalize(text)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
        .collect()
}

#[derive(Debug)]
pub struct KeywordMomentDetector {
    /// (texto original, tokens normalizados). Más largas primero.
    keywords: Vec<(String, Vec<String>)>,
    debounce_ms: i64,
    last_hit: Mutex<HashMap<String, UnixMs>>,
}

impl KeywordMomentDetector {
    /// Solo las palabras dadas.
    pub fn new(keywords: impl IntoIterator<Item = String>, debounce_ms: i64) -> Self {
        let mut seen = std::collections::HashSet::new();
        let mut list: Vec<(String, Vec<String>)> = keywords
            .into_iter()
            .map(|k| {
                let toks = tokens(&k);
                (k, toks)
            })
            .filter(|(_, toks)| !toks.is_empty())
            .filter(|(_, toks)| seen.insert(toks.join(" ")))
            .collect();
        list.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(b.0.len().cmp(&a.0.len())));
        Self {
            keywords: list,
            debounce_ms,
            last_hit: Mutex::new(HashMap::new()),
        }
    }

    /// `Settings.screen.keywords` + las frases ES/EN integradas.
    pub fn with_defaults(settings_keywords: &[String]) -> Self {
        Self::new(
            settings_keywords
                .iter()
                .cloned()
                .chain(EXTRA_KEYWORDS.iter().map(|s| s.to_string())),
            DEFAULT_DEBOUNCE_MS,
        )
    }

    fn matches(kw: &[String], text: &[String]) -> bool {
        if kw.len() > text.len() {
            return false;
        }
        let last = kw.len() - 1;
        text.windows(kw.len()).any(|w| {
            w.iter().zip(kw).enumerate().all(|(i, (t, k))| {
                if i == last { t.starts_with(k.as_str()) } else { t == k }
            })
        })
    }
}

impl ImportantMomentDetector for KeywordMomentDetector {
    fn detect(&self, text: &str, track: Track, at: UnixMs) -> Option<KeywordHit> {
        let toks = tokens(text);
        if toks.is_empty() {
            return None;
        }
        let mut last = self.last_hit.lock().unwrap_or_else(|p| p.into_inner());
        let matched: Vec<&(String, Vec<String>)> = self
            .keywords
            .iter()
            .filter(|(_, kw)| Self::matches(kw, &toks))
            .collect();
        let debounced = |key: &str| {
            last.get(key)
                .is_some_and(|prev| (0..self.debounce_ms).contains(&at.since(*prev)))
        };
        let pick = matched.iter().find(|(_, kw)| !debounced(&kw.join(" "))).copied();
        let (original, _) = pick?;
        let original = original.clone();
        // Todas las coincidentes ("importante" e "important" a la vez) se
        // marcan, para que variantes solapadas no esquiven el antirrebote.
        for (_, kw) in &matched {
            last.insert(kw.join(" "), at);
        }
        Some(KeywordHit {
            keyword: original,
            track,
            at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn det() -> KeywordMomentDetector {
        KeywordMomentDetector::with_defaults(&["clave".to_string(), "fecha".to_string()])
    }

    fn hit(d: &KeywordMomentDetector, text: &str, t: i64) -> Option<String> {
        d.detect(text, Track::System, UnixMs(t)).map(|h| h.keyword)
    }

    #[test]
    fn matches_spanish_keyword_ignoring_case_and_accents() {
        let d = det();
        assert_eq!(hit(&d, "Esto es IMPORTANTE, chicos", 0).as_deref(), Some("importante"));
        let d = det();
        assert_eq!(hit(&d, "la fecha LÍMITE es el viernes", 0).as_deref(), Some("fecha limite"));
    }

    #[test]
    fn matches_english_keywords() {
        let d = det();
        assert_eq!(hit(&d, "This is important for the launch", 0).as_deref(), Some("important"));
        let d = det();
        assert_eq!(hit(&d, "new action item for you", 0).as_deref(), Some("action item"));
    }

    #[test]
    fn prefix_match_on_last_token() {
        let d = det();
        assert_eq!(hit(&d, "apuntadlo por favor", 0).as_deref(), Some("apuntad"));
        let d = det();
        assert!(hit(&d, "apunta esto en el acta", 0).is_some());
    }

    #[test]
    fn phrase_needs_all_tokens_in_order() {
        let d = KeywordMomentDetector::new(["esto es clave".to_string()], 20_000);
        assert!(hit(&d, "esto es clave para el proyecto", 0).is_some());
        let d = KeywordMomentDetector::new(["esto es clave".to_string()], 20_000);
        assert!(hit(&d, "clave esto es", 0).is_none());
        assert!(hit(&d, "esto es muy importante", 0).is_none());
    }

    #[test]
    fn does_not_match_inside_other_words() {
        let d = KeywordMomentDetector::new(["key".to_string(), "ojo".to_string()], 20_000);
        assert!(hit(&d, "monkey business", 0).is_none());
        assert!(hit(&d, "me he hecho un abrojo", 0).is_none());
    }

    #[test]
    fn debounces_same_keyword_for_20s() {
        let d = det();
        assert!(hit(&d, "importante lo primero", 1_000).is_some());
        assert!(hit(&d, "otra vez importante", 10_000).is_none());
        assert!(hit(&d, "y de nuevo importante", 21_000).is_some());
    }

    #[test]
    fn different_keyword_not_debounced() {
        let d = det();
        assert!(hit(&d, "importante", 0).is_some());
        assert!(hit(&d, "deadline el lunes", 1_000).is_some());
    }

    #[test]
    fn no_hit_on_plain_text() {
        let d = det();
        assert!(hit(&d, "vale, seguimos con el siguiente punto", 0).is_none());
        assert!(hit(&d, "", 0).is_none());
    }

    #[test]
    fn hit_carries_track_and_time() {
        let d = det();
        let h = d.detect("ojo con el presupuesto", Track::Mic, UnixMs(42)).expect("hit");
        assert_eq!(h.track, Track::Mic);
        assert_eq!(h.at, UnixMs(42));
        assert_eq!(h.keyword, "ojo con");
    }

    #[test]
    fn settings_keywords_are_used() {
        let d = KeywordMomentDetector::with_defaults(&["presupuesto".to_string()]);
        assert!(hit(&d, "hablemos del presupuesto", 0).is_some());
    }
}
