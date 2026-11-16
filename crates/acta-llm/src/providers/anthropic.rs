//! Anthropic Messages API. Salida estructurada vía herramienta forzada.
//! La clave se resuelve del Llavero fuera de este crate (`SecretResolver`).

use super::common::wire_schema;
use super::http::{map_reqwest, map_status};
use super::sse::text_stream;
use acta_core::ids::ProviderId;
use acta_core::llm::*;
use acta_core::{EventStream, PortError, PortResult};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::time::Duration;

pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
const API_VERSION: &str = "2023-06-01";
const TOOL_NAME: &str = "responder";

#[derive(Debug, Clone)]
pub struct AnthropicProvider {
    id: ProviderId,
    base_url: String,
    model: String,
    api_key: String,
    timeout: Duration,
    client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(id: ProviderId, model: String, api_key: String, timeout: Duration) -> Self {
        Self::with_base_url(id, DEFAULT_BASE_URL, model, api_key, timeout)
    }

    pub fn with_base_url(id: ProviderId, base_url: &str, model: String, api_key: String, timeout: Duration) -> Self {
        Self {
            id,
            base_url: base_url.trim_end_matches('/').to_owned(),
            model,
            api_key,
            timeout,
            client: reqwest::Client::new(),
        }
    }

    pub fn build_body(&self, request: &LlmRequest, stream: bool) -> Value {
        let messages: Vec<Value> = request
            .messages
            .iter()
            .map(|m| {
                let role = match m.role {
                    Role::User => "user",
                    Role::Assistant => "assistant",
                };
                json!({"role": role, "content": m.content})
            })
            .collect();
        let mut body = json!({
            "model": self.model,
            "max_tokens": request.max_tokens.unwrap_or(8192),
            "messages": messages,
            "stream": stream,
        });
        if let Some(sys) = &request.system {
            body["system"] = json!(sys);
        }
        if let Some(t) = request.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(schema) = &request.json_schema {
            body["tools"] = json!([{
                "name": TOOL_NAME,
                "description": "Devuelve la respuesta estructurada.",
                "input_schema": wire_schema(schema),
            }]);
            body["tool_choice"] = json!({"type": "tool", "name": TOOL_NAME});
        }
        body
    }

    async fn send(&self, body: &Value) -> PortResult<reqwest::Response> {
        let url = format!("{}/v1/messages", self.base_url);
        let rb = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .json(body);
        let resp = tokio::time::timeout(self.timeout, rb.send())
            .await
            .map_err(|_| PortError::Timeout(format!("{url} no respondió en {:?}", self.timeout)))?
            .map_err(|e| map_reqwest(&url, e))?;
        if resp.status().is_success() {
            return Ok(resp);
        }
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        Err(map_status(status, &text))
    }
}

fn delta_text(v: &Value) -> Option<String> {
    if v["type"] != "content_block_delta" {
        return None;
    }
    let d = &v["delta"];
    d["text"].as_str().or_else(|| d["partial_json"].as_str()).map(str::to_owned)
}

pub fn parse_response(v: &Value) -> PortResult<LlmResponse> {
    let blocks = v["content"]
        .as_array()
        .ok_or_else(|| PortError::InvalidResponse("respuesta sin `content`".into()))?;
    let tool_input = blocks.iter().find(|b| b["type"] == "tool_use").map(|b| b["input"].clone());
    let text = blocks
        .iter()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    let (text, json) = match tool_input {
        Some(input) => (input.to_string(), Some(input)),
        None => (text, None),
    };
    if text.is_empty() {
        return Err(PortError::InvalidResponse("respuesta vacía de Anthropic".into()));
    }
    Ok(LlmResponse {
        text,
        json,
        model: v["model"].as_str().map(str::to_owned),
        usage: Usage {
            input_tokens: v["usage"]["input_tokens"].as_u64(),
            output_tokens: v["usage"]["output_tokens"].as_u64(),
        },
    })
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn id(&self) -> &ProviderId {
        &self.id
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities { streaming: true, native_json_schema: true, context_tokens: 200_000 }
    }

    async fn complete(&self, request: LlmRequest) -> PortResult<LlmResponse> {
        let resp = self.send(&self.build_body(&request, false)).await?;
        let v: Value = resp
            .json()
            .await
            .map_err(|e| PortError::InvalidResponse(format!("JSON de Anthropic ilegible: {e}")))?;
        parse_response(&v)
    }

    async fn stream(&self, request: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
        let resp = self.send(&self.build_body(&request, true)).await?;
        Ok(text_stream(resp, delta_text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;
    use futures::StreamExt;

    fn provider(url: &str) -> AnthropicProvider {
        AnthropicProvider::with_base_url("anthropic".into(), url, "claude-sonnet".into(), "sk-ant-test".into(), Duration::from_secs(5))
    }

    fn req(schema: bool) -> LlmRequest {
        LlmRequest {
            system: Some("sys".into()),
            messages: vec![LlmMessage { role: Role::User, content: "hola".into() }],
            json_schema: schema.then(|| json!({"type":"object","properties":{"a":{"type":"integer"}}})),
            max_tokens: None,
            temperature: None,
        }
    }

    #[tokio::test]
    async fn structured_output_uses_forced_tool_and_headers() {
        let srv = MockServer::start(vec![Canned::json(json!({
            "model": "claude-sonnet",
            "content": [{"type":"tool_use","id":"t1","name":"responder","input":{"a": 9}}],
            "usage": {"input_tokens": 11, "output_tokens": 6}
        }))])
        .await;
        let r = provider(&srv.url).complete(req(true)).await.expect("complete");
        assert_eq!(r.json.expect("json")["a"], 9);
        assert_eq!(r.usage.output_tokens, Some(6));
        let rec = &srv.requests()[0];
        assert_eq!(rec.path, "/v1/messages");
        assert_eq!(rec.header("x-api-key"), Some("sk-ant-test"));
        assert_eq!(rec.header("anthropic-version"), Some("2023-06-01"));
        let b = rec.json();
        assert_eq!(b["tool_choice"], json!({"type":"tool","name":"responder"}));
        assert_eq!(b["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(b["system"], "sys");
        assert_eq!(b["max_tokens"], 8192);
    }

    #[test]
    fn tool_input_schema_never_carries_meta_schema() {
        let mut r = req(false);
        r.json_schema = Some(serde_json::json!({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"a":{"type":"integer"}}}));
        let b = provider("http://127.0.0.1:9").build_body(&r, false);
        assert!(!b.to_string().contains("$schema"), "{b}");
        assert_eq!(b["tools"][0]["input_schema"]["type"], "object");
    }

    #[tokio::test]
    async fn plain_text_joins_text_blocks() {
        let srv = MockServer::start(vec![Canned::json(json!({"content":[{"type":"text","text":"Ho"},{"type":"text","text":"la"}]}))]).await;
        let r = provider(&srv.url).complete(req(false)).await.expect("complete");
        assert_eq!(r.text, "Hola");
        assert!(srv.requests()[0].json().get("tools").is_none());
    }

    #[tokio::test]
    async fn errors_map_to_spanish_port_errors() {
        let srv = MockServer::start(vec![Canned::status(401, "{\"error\":{\"message\":\"invalid x-api-key\"}}")]).await;
        let e = provider(&srv.url).complete(req(false)).await.expect_err("err");
        assert!(matches!(e, PortError::PermissionDenied(m) if m.contains("invalid x-api-key")));
    }

    #[tokio::test]
    async fn streams_text_deltas_and_ignores_other_events() {
        let sse = "event: message_start\ndata: {\"type\":\"message_start\"}\n\n\
                   event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Bue\"}}\n\n\
                   event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"nas\"}}\n\n\
                   event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
        let srv = MockServer::start(vec![Canned::sse(sse)]).await;
        let stream = provider(&srv.url).stream(req(false)).await.expect("stream");
        let parts: Vec<String> = stream.map(|r| r.expect("chunk")).collect().await;
        assert_eq!(parts, vec!["Bue", "nas"]);
        assert_eq!(srv.requests()[0].json()["stream"], true);
    }
}
