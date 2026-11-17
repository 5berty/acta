//! Idioma de las reuniones (`Settings.transcription.language`): `"auto"` o un
//! código ISO 639-1. Lógica pura: qué se le pasa al transcriptor y qué idioma
//! proponer a partir de los idiomas preferidos de macOS.

/// Que el transcriptor detecte el idioma y el acta se escriba en el que se habla.
pub const AUTO: &str = "auto";

/// Idiomas que transcribe Parakeet TDT v3 (códigos ISO 639-1).
pub const ASR_LANGUAGES: [&str; 25] = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it", "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru",
    "sk", "sl", "sv", "uk",
];

/// `"es-ES"`, `"ES"`, `"es_419"` → `"es"`. `None` si no empieza por un código de dos letras.
pub fn code_of(tag: &str) -> Option<String> {
    let head = tag.trim().split(['-', '_']).next().unwrap_or_default().to_lowercase();
    (head.len() == 2 && head.chars().all(|c| c.is_ascii_lowercase())).then_some(head)
}

/// El ajuste tal como se usa: `"auto"` (también para vacío o basura) o el código de dos letras.
pub fn normalize(setting: &str) -> String {
    code_of(setting).unwrap_or_else(|| AUTO.to_owned())
}

pub fn is_auto(setting: &str) -> bool {
    normalize(setting) == AUTO
}

/// Pista de idioma para el transcriptor. `None` = que lo detecte él: con
/// `"auto"` y con un idioma que el transcriptor no conoce.
pub fn asr_hint(setting: &str) -> Option<String> {
    code_of(setting).filter(|c| ASR_LANGUAGES.contains(&c.as_str()))
}

/// Idioma que se propone en la bienvenida: el primero de los preferidos de
/// macOS que el transcriptor sabe transcribir; si ninguno, `"auto"`.
pub fn meeting_language<S: AsRef<str>>(preferred: &[S]) -> String {
    preferred.iter().find_map(|tag| asr_hint(tag.as_ref())).unwrap_or_else(|| AUTO.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_preferred_language_the_transcriber_knows_wins() {
        assert_eq!(meeting_language(&["es-ES", "en-GB"]), "es");
        assert_eq!(meeting_language(&["en-GB", "es-ES"]), "en");
        assert_eq!(meeting_language(&["ja-JP"]), "auto", "el transcriptor no sabe japonés");
        assert_eq!(meeting_language(&["ja-JP", "ca-ES", "pt_BR"]), "pt", "se saltan los que no sabe");
        assert_eq!(meeting_language::<&str>(&[]), "auto");
        assert_eq!(meeting_language(&["", "zz", "english"]), "auto");
        assert_eq!(meeting_language(&["DE"]), "de");
    }

    #[test]
    fn auto_and_unknown_languages_leave_detection_to_the_transcriber() {
        assert_eq!(asr_hint("auto"), None);
        assert_eq!(asr_hint(""), None);
        assert_eq!(asr_hint("es"), Some("es".into()));
        assert_eq!(asr_hint("en-US"), Some("en".into()));
        assert_eq!(asr_hint("ja"), None, "idioma válido pero el transcriptor no lo conoce");
    }

    #[test]
    fn the_setting_normalises_to_auto_or_a_two_letter_code() {
        assert_eq!(normalize("ES"), "es");
        assert_eq!(normalize(" en-GB "), "en");
        assert_eq!(normalize("ja"), "ja", "otros ISO 639-1 se conservan: el acta se escribe en ese idioma");
        assert_eq!(normalize(""), "auto");
        assert_eq!(normalize("auto"), "auto");
        assert!(is_auto("Auto") && is_auto("") && !is_auto("es"));
    }
}
