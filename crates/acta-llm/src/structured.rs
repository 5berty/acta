//! Salida estructurada: limpieza de JSON (code fences, texto alrededor),
//! validación con serde + reglas semánticas y UN reintento de reparación.

use acta_core::llm::{LlmMessage, LlmProvider, LlmRequest, LlmResponse, Role};
use acta_core::{PortError, PortResult};
use serde::de::DeserializeOwned;

/// Quita ```json ... ``` si el modelo envolvió la respuesta.
pub fn strip_code_fences(text: &str) -> &str {
    let t = text.trim();
    let Some(rest) = t.strip_prefix("```") else {
        return t;
    };
    // Descarta la etiqueta del lenguaje hasta el primer salto de línea.
    let body = match rest.split_once('\n') {
        Some((_, b)) => b,
        None => rest,
    };
    body.trim_end().strip_suffix("```").unwrap_or(body).trim()
}

/// Intenta sacar un valor JSON de texto libre: directo, sin fences, o el
/// primer objeto/array balanceado que aparezca.
pub fn extract_json(text: &str) -> Option<serde_json::Value> {
    let cleaned = strip_code_fences(text);
    if let Ok(v) = serde_json::from_str(cleaned) {
        return Some(v);
    }
    for (open, close) in [('{', '}'), ('[', ']')] {
        if let (Some(s), Some(e)) = (cleaned.find(open), cleaned.rfind(close))
            && s < e
            && let Ok(v) = serde_json::from_str(&cleaned[s..=e])
        {
            return Some(v);
        }
    }
    None
}

fn parse<T: DeserializeOwned>(resp: &LlmResponse) -> Result<T, String> {
    let value = match &resp.json {
        Some(v) => v.clone(),
        None => extract_json(&resp.text).ok_or_else(|| "la respuesta no contiene JSON".to_string())?,
    };
    serde_json::from_value(value).map_err(|e| e.to_string())
}

/// Llama al proveedor, valida y, si falla, pide UNA reparación.
/// `validate` aplica reglas que el esquema no puede expresar.
pub async fn complete_structured<T, V>(
    provider: &dyn LlmProvider,
    request: LlmRequest,
    validate: V,
) -> PortResult<T>
where
    T: DeserializeOwned,
    V: Fn(&T) -> Result<(), String>,
{
    let first = provider.complete(request.clone()).await?;
    let err = match parse::<T>(&first).and_then(|v| validate(&v).map(|()| v)) {
        Ok(v) => return Ok(v),
        Err(e) => e,
    };
    let who = match &first.model {
        Some(m) => format!("«{}» ({m})", provider.id()),
        None => format!("«{}»", provider.id()),
    };
    tracing::warn!(provider = %who, error = %err, excerpt = %excerpt(&first.text), "salida estructurada inválida; reintento de reparación");

    let mut repair = request;
    repair.messages.push(LlmMessage {
        role: Role::Assistant,
        content: first.text.clone(),
    });
    repair.messages.push(LlmMessage {
        role: Role::User,
        content: format!(
            "Tu respuesta anterior no es válida: {err}\n\
             Repara este JSON y devuelve SOLO el objeto JSON corregido, que cumpla el esquema, \
             sin texto adicional ni bloques de código."
        ),
    });
    let second = provider.complete(repair).await?;
    parse::<T>(&second).and_then(|v| validate(&v).map(|()| v)).map_err(|e| {
        let text = excerpt(&second.text);
        let got = if text.is_empty() { String::new() } else { format!(". Respondió: «{text}»") };
        PortError::InvalidResponse(format!("{who} no devolvió un JSON válido ni al reintentar: {e}{got}"))
    })
}

/// Los primeros caracteres de una respuesta, en una línea (para logs y errores).
fn excerpt(text: &str) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out: String = one_line.chars().take(160).collect();
    if one_line.chars().count() > 160 {
        out.push('…');
    }
    out
}

#[cfg(test)]
pub(crate) mod testing {
    use acta_core::ids::ProviderId;
    use acta_core::llm::*;
    use acta_core::{EventStream, PortError, PortResult};
    use async_trait::async_trait;
    use std::sync::Mutex;

    /// Proveedor falso: responde con una cola de textos y guarda las peticiones.
    pub struct FakeProvider {
        id: ProviderId,
        pub context_tokens: u32,
        replies: Mutex<std::collections::VecDeque<Result<String, PortError>>>,
        pub requests: Mutex<Vec<LlmRequest>>,
    }

    impl FakeProvider {
        pub fn new(replies: Vec<&str>) -> Self {
            Self::with_results(replies.into_iter().map(|s| Ok(s.to_string())).collect())
        }
        pub fn with_results(replies: Vec<Result<String, PortError>>) -> Self {
            Self {
                id: "fake".into(),
                context_tokens: 100_000,
                replies: Mutex::new(replies.into()),
                requests: Mutex::new(vec![]),
            }
        }
        pub fn calls(&self) -> usize {
            self.requests.lock().unwrap().len()
        }
    }

    #[async_trait]
    impl LlmProvider for FakeProvider {
        fn id(&self) -> &ProviderId {
            &self.id
        }
        fn capabilities(&self) -> ProviderCapabilities {
            ProviderCapabilities {
                streaming: true,
                native_json_schema: true,
                context_tokens: self.context_tokens,
            }
        }
        async fn complete(&self, request: LlmRequest) -> PortResult<LlmResponse> {
            self.requests.lock().unwrap().push(request);
            let next = self.replies.lock().unwrap().pop_front();
            let text = next.unwrap_or_else(|| Err(PortError::Internal("sin respuestas".into())))?;
            Ok(LlmResponse { text, json: None, model: Some("fake-1".into()), usage: Usage::default() })
        }
        async fn stream(&self, request: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
            let r = self.complete(request).await?;
            // Dos trozos para probar el ensamblado.
            let mid = r.text.char_indices().nth(r.text.chars().count() / 2).map(|(i, _)| i).unwrap_or(0);
            let (a, b) = r.text.split_at(mid);
            let parts: Vec<PortResult<String>> = vec![Ok(a.to_string()), Ok(b.to_string())];
            Ok(Box::pin(futures::stream::iter(parts)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structured::testing::FakeProvider;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct Out {
        a: u32,
    }

    fn req() -> LlmRequest {
        LlmRequest { system: None, messages: vec![], json_schema: None, max_tokens: None, temperature: None }
    }

    #[test]
    fn strips_fences_with_and_without_language() {
        assert_eq!(strip_code_fences("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fences("```\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fences("  {\"a\":1} "), "{\"a\":1}");
    }

    #[test]
    fn extracts_json_surrounded_by_prose() {
        let v = extract_json("Aquí tienes:\n{\"a\": 2}\nEspero que sirva").expect("json");
        assert_eq!(v["a"], 2);
        assert!(extract_json("nada de json").is_none());
    }

    #[tokio::test]
    async fn valid_first_try_uses_one_call() {
        let p = FakeProvider::new(vec!["```json\n{\"a\":1}\n```"]);
        let out: Out = complete_structured(&p, req(), |_| Ok(())).await.expect("ok");
        assert_eq!(out, Out { a: 1 });
        assert_eq!(p.calls(), 1);
    }

    #[tokio::test]
    async fn invalid_json_is_repaired_once() {
        let p = FakeProvider::new(vec!["{\"a\": ", "{\"a\": 7}"]);
        let out: Out = complete_structured(&p, req(), |_| Ok(())).await.expect("ok");
        assert_eq!(out.a, 7);
        assert_eq!(p.calls(), 2);
        let reqs = p.requests.lock().unwrap();
        let last = reqs[1].messages.last().expect("msg");
        assert!(last.content.contains("Repara"));
        assert_eq!(reqs[1].messages.len(), 2); // respuesta mala + petición de reparación
    }

    #[tokio::test]
    async fn semantic_validation_failure_triggers_repair_then_errors() {
        let p = FakeProvider::new(vec!["{\"a\": 0}", "{\"a\": 0}"]);
        let err = complete_structured::<Out, _>(&p, req(), |o| {
            if o.a == 0 { Err("a debe ser > 0".into()) } else { Ok(()) }
        })
        .await
        .expect_err("fails");
        assert!(matches!(err, PortError::InvalidResponse(m) if m.contains("a debe ser")));
        assert_eq!(p.calls(), 2); // exactamente un reintento
    }

    #[tokio::test]
    async fn final_error_says_which_provider_and_model_failed_and_what_came_back() {
        let p = FakeProvider::new(vec!["Lo siento, no puedo", "Sigo sin poder"]);
        let err = complete_structured::<Out, _>(&p, req(), |_| Ok(())).await.expect_err("fails");
        let PortError::InvalidResponse(m) = err else { panic!("{err:?}") };
        assert!(m.contains("«fake»") && m.contains("fake-1") && m.contains("no contiene JSON") && m.contains("Sigo sin poder"), "{m}");
    }

    #[tokio::test]
    async fn provider_error_on_the_repair_names_the_provider() {
        let p = FakeProvider::with_results(vec![Ok("nada".into()), Err(PortError::InvalidResponse("respuesta cortada".into()))]);
        let err = complete_structured::<Out, _>(&p, req(), |_| Ok(())).await.expect_err("fails");
        assert!(matches!(&err, PortError::InvalidResponse(m) if m.contains("respuesta cortada")), "{err}");
    }

    #[tokio::test]
    async fn provider_error_is_not_retried() {
        let p = FakeProvider::with_results(vec![Err(PortError::Timeout("x".into()))]);
        let err = complete_structured::<Out, _>(&p, req(), |_| Ok(())).await.expect_err("err");
        assert!(matches!(err, PortError::Timeout(_)));
        assert_eq!(p.calls(), 1);
    }
}
