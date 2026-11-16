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

#[derive(Debug, Clone)]
pub struct OpenAiCompatibleProvider {
    id: ProviderId,
    base_url: String,
    model: String,
    api_key: Option<String>,
    timeout: Duration,
    client: reqwest::Client,
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
        }
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
            body["max_tokens"] = json!(t);
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

pub fn parse_response(v: &Value, wants_json: bool) -> PortResult<LlmResponse> {
    let text = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| PortError::InvalidResponse("respuesta sin choices[0].message.content".into()))?
        .to_owned();
    let json = wants_json.then(|| crate::structured::extract_json(&text)).flatten();
    Ok(LlmResponse {
        text,
        json,
        model: v["model"].as_str().map(str::to_owned),
        usage: Usage {
            input_tokens: v["usage"]["prompt_tokens"].as_u64(),
            output_tokens: v["usage"]["completion_tokens"].as_u64(),
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
        parse_response(&v, request.json_schema.is_some())
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
