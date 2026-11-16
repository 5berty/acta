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
