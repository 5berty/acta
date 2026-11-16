//! Utilidades compartidas por los proveedores.

use acta_core::llm::{LlmMessage, LlmRequest, Role};
use acta_core::{EventStream, PortError, PortResult};
use std::path::Path;

/// Aplana el historial a un único prompt de texto (CLI, que reciben stdin).
/// Un único mensaje de usuario va tal cual.
pub fn flatten_messages(messages: &[LlmMessage]) -> String {
    if let [only] = messages
        && only.role == Role::User
    {
        return only.content.clone();
    }
    messages
        .iter()
        .map(|m| {
            let who = match m.role {
                Role::User => "Usuario",
                Role::Assistant => "Asistente",
            };
            format!("[{who}]\n{}", m.content)
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Texto que describe el esquema para proveedores sin salida estructurada nativa.
pub fn schema_instruction(schema: &serde_json::Value) -> String {
    format!(
        "Responde SOLO con un objeto JSON que cumpla este JSON Schema, sin texto adicional ni bloques de código:\n{}",
        serde_json::to_string_pretty(schema).unwrap_or_default()
    )
}

/// `system` + (opcional) instrucción de esquema.
pub fn system_with_schema(request: &LlmRequest, include_schema: bool) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(s) = &request.system {
        parts.push(s.clone());
    }
    if include_schema && let Some(schema) = &request.json_schema {
        parts.push(schema_instruction(schema));
    }
    if parts.is_empty() { None } else { Some(parts.join("\n\n")) }
}

/// Un único trozo (proveedores sin streaming real).
pub fn single_chunk(text: String) -> EventStream<PortResult<String>> {
    Box::pin(futures::stream::iter(vec![Ok(text)]))
}

/// Comprueba que el binario existe ANTES de lanzar, con mensaje claro.
pub async fn ensure_binary(path: &Path, name: &str) -> PortResult<()> {
    match tokio::fs::metadata(path).await {
        Ok(m) if m.is_file() => Ok(()),
        _ => Err(PortError::Unavailable(format!(
            "{name} no encontrado en {}. Revisa la ruta en Ajustes > IA.",
            path.display()
        ))),
    }
}

/// Últimas líneas de stderr para mensajes de error.
pub fn tail(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    let s = s.trim();
    let n = s.chars().count();
    if n > 600 {
        format!("…{}", s.chars().skip(n - 600).collect::<String>())
    } else {
        s.to_owned()
    }
}

pub fn temp_dir() -> PortResult<tempfile::TempDir> {
    tempfile::tempdir().map_err(|e| PortError::Io(format!("directorio temporal: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(role: Role, c: &str) -> LlmMessage {
        LlmMessage { role, content: c.into() }
    }

    #[test]
    fn single_user_message_is_verbatim() {
        assert_eq!(flatten_messages(&[m(Role::User, "hola")]), "hola");
    }

    #[test]
    fn multi_turn_is_labelled() {
        let s = flatten_messages(&[m(Role::User, "a"), m(Role::Assistant, "b"), m(Role::User, "c")]);
        assert_eq!(s, "[Usuario]\na\n\n[Asistente]\nb\n\n[Usuario]\nc");
    }

    #[tokio::test]
    async fn missing_binary_has_clear_spanish_message() {
        let err = ensure_binary(Path::new("/no/existe/claude"), "claude").await.expect_err("err");
        assert!(matches!(&err, PortError::Unavailable(m) if m.starts_with("claude no encontrado en /no/existe/claude")));
    }
}
