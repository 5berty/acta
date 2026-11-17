//! OpenAI-compatible (`/chat/completions`): OpenAI, Ollama, LM Studio, OpenRouter.

use super::common::*;
use super::http::{map_reqwest, map_status};
use super::sse::text_stream;
use acta_core::ids::ProviderId;
use acta_core::llm::*;
use acta_core::{EventStream, PortError, PortResult};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::time::Duration;

/// Tokens extra sobre el presupuesto de la RESPUESTA: los modelos de
/// razonamiento (deepseek-v4-pro, qwen3.6, gemma4 en NaN Builders) gastan
/// `max_tokens` pensando antes de escribir (`reasoning_content`) y, con un
/// límite justo, devuelven la respuesta vacía o cortada. Solo se cobra lo
/// que se genera, así que el margen no cuesta nada si no se usa.
pub const REASONING_HEADROOM: u32 = 16_384;
/// Tope del `max_tokens` enviado (los servidores rechazan valores enormes).
pub const MAX_TOKENS_CAP: u32 = 32_768;

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleProvider {
    id: ProviderId,
    base_url: String,
    model: String,
    api_key: Option<String>,
    timeout: Duration,
    client: reqwest::Client,
    reasoning_headroom: u32,
}

impl OpenAiCompatibleProvider {
    pub fn new(id: ProviderId, base_url: &str, model: String, api_key: Option<String>, timeout: Duration) -> Self {
        Self {
            id,
            base_url: base_url.trim_end_matches('/').to_owned(),
            model,
            api_key,
            timeout,
            client: reqwest::Client::new(),
            reasoning_headroom: REASONING_HEADROOM,
        }
    }

    /// Sin margen de razonamiento: el modelo integrado arranca con
    /// `--reasoning-budget 0` y su contexto es pequeño.
    pub fn without_reasoning_headroom(mut self) -> Self {
        self.reasoning_headroom = 0;
        self
    }

    pub fn build_body(&self, request: &LlmRequest, stream: bool, native_schema: bool) -> Value {
        let mut messages: Vec<Value> = Vec::new();
        if let Some(sys) = system_with_schema(request, !native_schema) {
            messages.push(json!({"role": "system", "content": sys}));
        }
        for m in &request.messages {
            let role = match m.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            messages.push(json!({"role": role, "content": m.content}));
        }
        let mut body = json!({"model": self.model, "messages": messages, "stream": stream});
        if let Some(t) = request.max_tokens {
            body["max_tokens"] = json!(t.saturating_add(self.reasoning_headroom).min(MAX_TOKENS_CAP).max(t));
        }
        if let Some(t) = request.temperature {
            body["temperature"] = json!(t);
        }
        if native_schema && let Some(schema) = &request.json_schema {
            body["response_format"] = json!({
                "type": "json_schema",
                "json_schema": {"name": "acta_output", "strict": true, "schema": wire_schema(schema)}
            });
        }
        body
    }

    async fn post(&self, body: &Value) -> PortResult<reqwest::Response> {
        let url = format!("{}/chat/completions", self.base_url);
        let mut rb = self.client.post(&url).json(body);
        if let Some(k) = &self.api_key {
            rb = rb.bearer_auth(k);
        }
        // Timeout hasta tener cabeceras (en streaming no cubre el cuerpo).
        let resp = tokio::time::timeout(self.timeout, rb.send())
            .await
            .map_err(|_| PortError::Timeout(format!("{url} no respondió en {:?}", self.timeout)))?
            .map_err(|e| map_reqwest(&url, e))?;
        Ok(resp)
    }

    /// Envía; si el servidor rechaza el esquema nativo, reintenta con el esquema en el prompt.
    async fn send(&self, request: &LlmRequest, stream: bool) -> PortResult<reqwest::Response> {
        let native = request.json_schema.is_some();
        let resp = self.post(&self.build_body(request, stream, native)).await?;
        if native && matches!(resp.status().as_u16(), 400 | 422) {
            tracing::warn!("el servidor rechazó response_format json_schema; reintento con esquema en el prompt");
            return self.check(self.post(&self.build_body(request, stream, false)).await?).await;
        }
        self.check(resp).await
    }

    async fn check(&self, resp: reqwest::Response) -> PortResult<reqwest::Response> {
        if resp.status().is_success() {
            return Ok(resp);
        }
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        Err(map_status(status, &body))
    }
}

fn delta_text(v: &Value) -> Option<String> {
    v["choices"][0]["delta"]["content"].as_str().map(str::to_owned)
}

/// Interpreta `/chat/completions`. `provider` solo sirve para que el error
/// diga QUIÉN falló (Ajustes enseña el mensaje tal cual).
pub fn parse_response(v: &Value, wants_json: bool, provider: &str) -> PortResult<LlmResponse> {
    let choice = &v["choices"][0];
    let message = &choice["message"];
    let model = v["model"].as_str().map(str::to_owned);
    let who = match &model {
        Some(m) => format!("«{provider}» ({m})"),
        None => format!("«{provider}»"),
    };
    let content = message["content"].as_str().unwrap_or_default().trim().to_owned();
    let reasoning = message["reasoning_content"].as_str().or_else(|| message["reasoning"].as_str()).unwrap_or_default();
    let truncated = choice["finish_reason"].as_str() == Some("length");
    let reasoning_tokens = v["usage"]["completion_tokens_details"]["reasoning_tokens"].as_u64();
    let output_tokens = v["usage"]["completion_tokens"].as_u64();
    if choice.is_null() {
        return Err(PortError::InvalidResponse(format!("{who}: respuesta sin choices[0]")));
    }

    let mut json = wants_json.then(|| crate::structured::extract_json(&content)).flatten();
    // Algunos modelos de razonamiento dejan el JSON en el campo de razonamiento.
    if wants_json && json.is_none() && content.is_empty() {
        json = crate::structured::extract_json(reasoning);
    }
    let text = match (&json, content.is_empty()) {
        (Some(j), true) => j.to_string(),
        _ => content,
    };
    let answered = if wants_json { json.is_some() } else { !text.is_empty() };
    if !answered && truncated {
        let spent = match (reasoning_tokens, output_tokens) {
            (Some(r), Some(o)) => format!(" ({r} de {o} tokens razonando)"),
            _ => String::new(),
        };
        return Err(PortError::InvalidResponse(if text.is_empty() {
            format!("{who} agotó el límite de tokens razonando sin llegar a responder{spent}")
        } else {
            format!("{who}: respuesta cortada por el límite de tokens{spent}")
        }));
    }
    if text.is_empty() {
        return Err(PortError::InvalidResponse(format!("{who} devolvió una respuesta vacía")));
    }
    Ok(LlmResponse {
        text,
        json,
        model,
        usage: Usage {
            input_tokens: v["usage"]["prompt_tokens"].as_u64(),
            output_tokens,
        },
    })
}

#[async_trait]
impl LlmProvider for OpenAiCompatibleProvider {
    fn id(&self) -> &ProviderId {
        &self.id
    }

    fn capabilities(&self) -> ProviderCapabilities {
        // Conservador: modelos locales (Ollama/LM Studio) suelen tener 8-32k.
        ProviderCapabilities { streaming: true, native_json_schema: true, context_tokens: 32_000 }
    }

    async fn complete(&self, request: LlmRequest) -> PortResult<LlmResponse> {
        let resp = self.send(&request, false).await?;
        let v: Value = resp
            .json()
            .await
            .map_err(|e| PortError::InvalidResponse(format!("JSON de la API ilegible: {e}")))?;
        parse_response(&v, request.json_schema.is_some(), &self.id.0)
    }

    async fn stream(&self, request: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
        let resp = self.send(&request, true).await?;
        Ok(text_stream(resp, delta_text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;
    use futures::StreamExt;

    fn req(schema: bool) -> LlmRequest {
        LlmRequest {
            system: Some("sys".into()),
            messages: vec![LlmMessage { role: Role::User, content: "hola".into() }],
            json_schema: schema.then(|| json!({"type":"object","properties":{"a":{"type":"integer"}}})),
            max_tokens: Some(100),
            temperature: Some(0.2),
        }
    }

    fn provider(url: &str, key: Option<&str>) -> OpenAiCompatibleProvider {
        OpenAiCompatibleProvider::new("ollama".into(), &format!("{url}/v1/"), "llama3".into(), key.map(str::to_owned), Duration::from_secs(5))
    }

    fn ok_body(content: &str) -> Value {
        json!({"model":"llama3","choices":[{"message":{"role":"assistant","content":content}}],"usage":{"prompt_tokens":7,"completion_tokens":3}})
    }

    #[test]
    fn schema_never_carries_meta_schema_native_or_in_prompt() {
        let mut r = req(false);
        r.json_schema = Some(serde_json::json!({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"a":{"type":"integer"}}}));
        let p = provider("http://127.0.0.1:9", None);
        for native in [true, false] {
            let b = p.build_body(&r, false, native);
            assert!(!b.to_string().contains("$schema"), "{b}");
        }
    }

    #[tokio::test]
    async fn complete_sends_schema_key_and_parses_usage() {
        let srv = MockServer::start(vec![Canned::json(ok_body("{\"a\": 1}"))]).await;
        let r = provider(&srv.url, Some("sk-test")).complete(req(true)).await.expect("complete");
        assert_eq!(r.json.expect("json")["a"], 1);
        assert_eq!(r.usage.input_tokens, Some(7));
        assert_eq!(r.model.as_deref(), Some("llama3"));
        let reqs = srv.requests();
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].path, "/v1/chat/completions");
        assert_eq!(reqs[0].header("authorization"), Some("Bearer sk-test"));
        let b = reqs[0].json();
        assert_eq!(b["response_format"]["type"], "json_schema");
        assert_eq!(b["response_format"]["json_schema"]["strict"], true);
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][0]["content"], "sys");
        assert_eq!(b["stream"], false);
    }

    #[tokio::test]
    async fn no_key_means_no_authorization_header() {
        let srv = MockServer::start(vec![Canned::json(ok_body("hola"))]).await;
        provider(&srv.url, None).complete(req(false)).await.expect("complete");
        assert!(srv.requests()[0].header("authorization").is_none());
        assert!(srv.requests()[0].json().get("response_format").is_none());
    }

    #[tokio::test]
    async fn retries_without_response_format_when_server_rejects_it() {
        let srv = MockServer::start(vec![
            Canned::status(400, "{\"error\":\"response_format unsupported\"}"),
            Canned::json(ok_body("{\"a\": 2}")),
        ])
        .await;
        let r = provider(&srv.url, None).complete(req(true)).await.expect("complete");
        assert_eq!(r.json.expect("json")["a"], 2);
        let reqs = srv.requests();
        assert_eq!(reqs.len(), 2);
        assert!(reqs[1].json().get("response_format").is_none());
        assert!(reqs[1].json()["messages"][0]["content"].as_str().expect("sys").contains("JSON Schema"));
    }

    #[tokio::test]
    async fn auth_and_server_errors_are_mapped() {
        let srv = MockServer::start(vec![Canned::status(401, "{\"error\":\"bad key\"}")]).await;
        let e = provider(&srv.url, Some("x")).complete(req(false)).await.expect_err("err");
        assert!(matches!(e, PortError::PermissionDenied(_)));
        let srv = MockServer::start(vec![Canned::status(500, "boom")]).await;
        let e = provider(&srv.url, None).complete(req(false)).await.expect_err("err");
        assert!(matches!(e, PortError::Unavailable(m) if m.contains("500") && m.contains("boom")));
    }

    #[tokio::test]
    async fn connection_refused_is_unavailable_with_url() {
        let e = provider("http://127.0.0.1:1", None).complete(req(false)).await.expect_err("err");
        assert!(matches!(e, PortError::Unavailable(m) if m.contains("127.0.0.1:1")));
    }

    #[tokio::test]
    async fn slow_server_times_out() {
        let mut slow = Canned::json(ok_body("x"));
        slow.delay_ms = 1_500;
        let srv = MockServer::start(vec![slow]).await;
        let mut p = provider(&srv.url, None);
        p.timeout = Duration::from_millis(200);
        let e = p.complete(req(false)).await.expect_err("err");
        assert!(matches!(e, PortError::Timeout(_)));
    }

    #[test]
    fn reasoning_models_get_headroom_over_the_answer_budget() {
        let p = provider("http://127.0.0.1:9", None);
        let mut r = req(false);
        r.max_tokens = Some(16);
        let b = p.build_body(&r, false, false);
        assert!(b["max_tokens"].as_u64().expect("max") >= 16 + REASONING_HEADROOM as u64, "{b}");
        r.max_tokens = Some(8_000);
        assert!(p.build_body(&r, false, false)["max_tokens"].as_u64().expect("max") <= MAX_TOKENS_CAP as u64);
        let local = provider("http://127.0.0.1:9", None).without_reasoning_headroom();
        assert_eq!(local.build_body(&r, false, false)["max_tokens"], 8_000);
    }

    fn reasoning_body(content: Value, reasoning: &str, finish: &str) -> Value {
        json!({"model":"deepseek-v4-pro","choices":[{"finish_reason":finish,"message":{"role":"assistant","content":content,"reasoning_content":reasoning}}],
               "usage":{"prompt_tokens":5,"completion_tokens":300,"completion_tokens_details":{"reasoning_tokens":290}}})
    }

    #[test]
    fn json_only_in_the_reasoning_field_is_used() {
        let v = reasoning_body(Value::Null, "Pienso… {\"a\": 3}", "stop");
        let r = parse_response(&v, true, "nan").expect("ok");
        assert_eq!(r.json.expect("json")["a"], 3);
    }

    #[test]
    fn running_out_of_tokens_while_reasoning_says_who_and_why() {
        let e = parse_response(&reasoning_body(Value::Null, "Here's a thinking process", "length"), false, "nan").expect_err("err");
        assert!(matches!(&e, PortError::InvalidResponse(m) if m.contains("nan") && m.contains("deepseek-v4-pro") && m.contains("razonando") && m.contains("290")), "{e}");
        let e = parse_response(&reasoning_body(json!("{\"titulo\": \"Daily"), "…", "length"), true, "nan").expect_err("err");
        assert!(matches!(&e, PortError::InvalidResponse(m) if m.contains("cortada") && m.contains("deepseek-v4-pro")), "{e}");
    }

    #[test]
    fn empty_answer_names_the_provider_and_model() {
        let e = parse_response(&reasoning_body(json!(""), "", "stop"), false, "nan").expect_err("err");
        assert!(matches!(&e, PortError::InvalidResponse(m) if m.contains("nan") && m.contains("deepseek-v4-pro") && m.contains("vacía")), "{e}");
    }

    #[tokio::test]
    async fn streams_sse_deltas() {
        let sse = "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n\
                   data: {\"choices\":[{\"delta\":{\"content\":\"Ho\"}}]}\n\n\
                   data: {\"choices\":[{\"delta\":{\"content\":\"la\"}}]}\n\n\
                   data: [DONE]\n\n";
        let srv = MockServer::start(vec![Canned::sse(sse)]).await;
        let stream = provider(&srv.url, None).stream(req(false)).await.expect("stream");
        let parts: Vec<String> = stream.map(|r| r.expect("chunk")).collect().await;
        assert_eq!(parts, vec!["Ho", "la"]);
        assert_eq!(srv.requests()[0].json()["stream"], true);
    }
}
