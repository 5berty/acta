//! El acta habla de la reunión, nunca de cómo se grabó o se transcribió.
//!
//! Bug real (16-nov-2026): el resumen de una grabación de 17 s incluía «La
//! transcripción no marca al hablante como "Edu (yo)", así que la tarea no se
//! atribuye a Edu» y «Grabación muy breve (17 segundos) con un único
//! hablante…». El prompt lo prohíbe, pero un modelo pequeño no siempre
//! obedece: aquí se quitan esas frases de forma determinista, sea cual sea el
//! proveedor (CLI, API o el modelo local integrado).

use super::MinutesV1;
use crate::moments::normalize;
use regex::Regex;
use std::sync::LazyLock;

/// Lo único que dice el resumen cuando no hay nada que resumir.
pub const EMPTY_SUMMARY: &str = "- Reunión muy breve, sin contenido que resumir.";

/// Con menos palabras que estas no se llama al LLM: no hay reunión que resumir.
pub const MIN_TRANSCRIPT_WORDS: usize = 8;

/// Frases sobre la grabación, la transcripción, las etiquetas de hablante o
/// la herramienta. Se comparan con el texto en minúsculas y sin acentos, y son
/// estrechas a propósito: una reunión puede HABLAR de transcripciones.
static META: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"\(yo\)",
        r"\btranscripcion\b[^.]{0,40}\b(no (marca|indica|identifica|etiqueta|distingue|permite|incluye|contiene|recoge|refleja|aporta)|es (muy|demasiado|tan) (breve|corta)|esta (incompleta|cortada|vacia)|apenas|carece)",
        r"\b(grabacion|reunion|transcripcion|audio)\b (es |fue |resulta )?(muy |demasiado |extremadamente |tan )(breve|corta|corto)\b[^.]{0,60}\b(segundos?|hablante|sin |por lo que|asi que)",
        r"\bgrabacion (muy |demasiado |extremadamente )?(breve|corta) \(",
        r"\b(un )?(unico|solo) hablante\b",
        r"\bno (se )?(marca|identifica|etiqueta|distingue)n? (a |al |a los |el |los )?(hablante|participante)s?",
        r"\b(la tarea|la accion|el compromiso|la decision)[^.]{0,30}\bno (se )?(puede )?(atribu|asign)",
        r"\b(calidad|errores|fallos|limitaciones) de(l| la)? (transcripcion|audio|grabacion|reconocimiento)",
        r"\bsin (suficiente )?(contenido|contexto|informacion)( suficiente)? (para|que) (resumir|extraer|elaborar|generar)",
        r"\bno hay capturas( de pantalla)?( disponibles)?\b[^.]{0,40}\b(por lo que|asi que|no se)",
        r"\bdiarizacion\b",
        r"\b(segun|en) (las|los) (marcas|etiquetas) de (tiempo|hablante)",
    ]
    .iter()
    .filter_map(|p| Regex::new(p).ok())
    .collect()
});

/// ¿La frase comenta la grabación o la herramienta en vez de la reunión?
pub fn is_meta_commentary(text: &str) -> bool {
    let n = normalize(text);
    META.iter().any(|r| r.is_match(&n))
}

/// Quita del Markdown las viñetas (o líneas) que son metacomentario. Si no
/// queda nada, devuelve [`EMPTY_SUMMARY`].
pub fn clean_summary(md: &str) -> String {
    let kept: Vec<&str> = md.lines().filter(|l| !is_meta_commentary(l)).collect();
    let text = kept.join("\n");
    if text.chars().any(char::is_alphanumeric) { text.trim().to_owned() } else { EMPTY_SUMMARY.to_owned() }
}

/// Limpia un acta recién devuelta por el LLM.
pub fn strip_meta(mut v: MinutesV1) -> MinutesV1 {
    v.resumen = clean_summary(&v.resumen);
    v.decisiones.retain(|d| !is_meta_commentary(&d.texto));
    v.tareas.retain(|t| !is_meta_commentary(&t.texto));
    v
}

/// Acta de una grabación sin contenido: una línea neutra y nada más.
pub fn empty_minutes() -> MinutesV1 {
    MinutesV1 {
        titulo_sugerido: None,
        resumen: EMPTY_SUMMARY.to_owned(),
        decisiones: vec![],
        tareas: vec![],
        escaleta: super::EscaletaV1 { temas: vec![] },
        momentos_clave: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/minutes_meta_commentary.json");

    #[test]
    fn the_real_smoke_test_summary_loses_its_meta_bullets_and_keeps_the_content() {
        let v: MinutesV1 = serde_json::from_str(FIXTURE).expect("fixture");
        let out = strip_meta(v);
        assert_eq!(
            out.resumen,
            "- Se confirma la publicación de la versión nueva para el lunes.\n- Queda pendiente enviar el informe de pruebas al equipo."
        );
        assert_eq!(out.decisiones.len(), 1);
        assert_eq!(out.decisiones[0].texto, "Publicar la versión nueva el lunes");
        assert_eq!(out.tareas.len(), 1);
    }

    #[test]
    fn a_summary_that_is_only_meta_becomes_one_neutral_line() {
        let md = "- Grabación muy breve (17 segundos) con un único hablante.\n- La transcripción no identifica a los hablantes.";
        assert_eq!(clean_summary(md), EMPTY_SUMMARY);
        assert_eq!(clean_summary("  \n"), EMPTY_SUMMARY);
    }

    #[test]
    fn meetings_that_talk_about_recordings_and_transcripts_are_not_censored() {
        for ok in [
            "- Se revisa la grabación del anuncio y se aprueba el montaje.",
            "- acta mejorará la transcripción en español con un modelo nuevo.",
            "- Ana enviará la transcripción de la entrevista el viernes.",
            "- La reunión fue breve: solo se confirmó la fecha de entrega.",
            "- El audio del vídeo promocional se regraba la semana que viene.",
            "- Edu se encarga de la calidad del producto.",
        ] {
            assert!(!is_meta_commentary(ok), "{ok}");
        }
    }

    #[test]
    fn typical_tooling_remarks_are_caught() {
        for bad in [
            "- La transcripción no marca al hablante como \"Edu (yo)\", así que la tarea no se atribuye a Edu.",
            "- Grabación muy breve (17 segundos) con un único hablante, sin decisiones.",
            "- La transcripción es demasiado corta para extraer conclusiones.",
            "- No se identifica al hablante, por lo que la tarea no se puede asignar.",
            "- Posibles errores de transcripción en los nombres propios.",
            "- Sin contenido suficiente para elaborar una escaleta.",
            "- La diarización solo detecta una voz.",
        ] {
            assert!(is_meta_commentary(bad), "{bad}");
        }
    }
}
