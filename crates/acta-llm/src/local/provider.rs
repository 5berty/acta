//! `LlmProvider` del modelo local integrado: arranca el servidor cuando hace
//! falta y habla con él por su API compatible con OpenAI (`llama-server`
//! convierte `response_format: json_schema` en una gramática, así que el
//! JSON del acta sale válido también con un modelo pequeño).

use super::server::Lease;
use crate::providers::OpenAiCompatibleProvider;
use acta_core::ids::ProviderId;
use acta_core::llm::*;
use acta_core::{EventStream, PortResult};
use async_trait::async_trait;
use futures::StreamExt;
use std::sync::Arc;
use std::time::Duration;

/// Servidor listo para recibir peticiones.
#[derive(Debug)]
pub struct LocalEndpoint {
    /// `http://127.0.0.1:<puerto>` (sin `/v1`).
    pub base_url: String,
    /// Mantiene vivo el servidor mientras dura la petición.
    pub lease: Option<Lease>,
}

/// Quien sabe poner en marcha un modelo local. Impl: [`super::LocalLlm`].
#[async_trait]
pub trait LocalRuntime: Send + Sync {
    async fn acquire(&self, model_id: &str) -> PortResult<LocalEndpoint>;
    /// Contexto con el que se sirve ese modelo.
    fn context_tokens(&self, model_id: &str) -> u32;
}

pub struct BuiltInProvider {
    id: ProviderId,
    model_id: String,
    runtime: Arc<dyn LocalRuntime>,
    timeout: Duration,
}

impl BuiltInProvider {
    pub fn new(id: ProviderId, model_id: String, runtime: Arc<dyn LocalRuntime>, timeout: Duration) -> Self {
        Self { id, model_id, runtime, timeout }
    }

    async fn open(&self) -> PortResult<(OpenAiCompatibleProvider, Option<Lease>)> {
        let endpoint = self.runtime.acquire(&self.model_id).await?;
        let api = OpenAiCompatibleProvider::new(self.id.clone(), &format!("{}/v1", endpoint.base_url), self.model_id.clone(), None, self.timeout)
            .without_reasoning_headroom();
        Ok((api, endpoint.lease))
    }
}

#[async_trait]
impl LlmProvider for BuiltInProvider {
    fn id(&self) -> &ProviderId {
        &self.id
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities { streaming: true, native_json_schema: true, context_tokens: self.runtime.context_tokens(&self.model_id) }
    }

    async fn complete(&self, request: LlmRequest) -> PortResult<LlmResponse> {
        let (api, _lease) = self.open().await?;
        api.complete(request).await
    }

    async fn stream(&self, request: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
        let (api, lease) = self.open().await?;
        let stream = api.stream(request).await?;
        // El servidor no se para por inactividad hasta que el stream termina.
        Ok(Box::pin(stream.map(move |chunk| {
            let _alive = &lease;
            chunk
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;
    use acta_core::PortError;
    use serde_json::json;
    use std::sync::Mutex;

    struct FakeRuntime {
        url: Result<String, PortError>,
        asked: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl LocalRuntime for FakeRuntime {
        async fn acquire(&self, model_id: &str) -> PortResult<LocalEndpoint> {
            self.asked.lock().expect("lock").push(model_id.to_owned());
            self.url.clone().map(|base_url| LocalEndpoint { base_url, lease: None })
        }
        fn context_tokens(&self, _model_id: &str) -> u32 {
            16_384
        }
    }

    fn provider(url: Result<String, PortError>) -> (BuiltInProvider, Arc<FakeRuntime>) {
        let rt = Arc::new(FakeRuntime { url, asked: Mutex::default() });
        (BuiltInProvider::new("builtin".into(), "qwen3.5-2b-q4_k_m".into(), rt.clone(), Duration::from_secs(5)), rt)
    }

    fn request(schema: bool) -> LlmRequest {
        LlmRequest {
            system: Some("sys".into()),
            messages: vec![LlmMessage { role: Role::User, content: "hola".into() }],
            json_schema: schema.then(|| json!({"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"]})),
            max_tokens: Some(64),
            temperature: Some(0.2),
        }
    }

    #[tokio::test]
    async fn asks_the_runtime_for_its_model_and_sends_the_schema_as_a_grammar() {
        let body = json!({"model": "qwen", "choices": [{"message": {"role": "assistant", "content": "{\"a\": 7}"}}], "usage": {"prompt_tokens": 5, "completion_tokens": 4}});
        let srv = MockServer::start(vec![Canned::json(body)]).await;
        let (p, rt) = provider(Ok(srv.url.clone()));
        // No arranca nada hasta la primera petición.
        assert!(rt.asked.lock().expect("lock").is_empty());
        assert_eq!(p.capabilities(), ProviderCapabilities { streaming: true, native_json_schema: true, context_tokens: 16_384 });

        let r = p.complete(request(true)).await.expect("complete");
        assert_eq!(r.json.expect("json")["a"], 7);
        assert_eq!(r.usage.output_tokens, Some(4));
        assert_eq!(*rt.asked.lock().expect("lock"), vec!["qwen3.5-2b-q4_k_m".to_owned()]);
        let reqs = srv.requests();
        assert_eq!(reqs[0].path, "/v1/chat/completions");
        assert!(reqs[0].header("authorization").is_none(), "local: sin clave");
        let sent = reqs[0].json();
        assert_eq!(sent["model"], "qwen3.5-2b-q4_k_m");
        assert_eq!(sent["response_format"]["type"], "json_schema");
        assert_eq!(sent["response_format"]["json_schema"]["schema"]["required"][0], "a");
    }

    #[tokio::test]
    async fn streams_the_chat_through_the_local_server() {
        let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Ho\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"la\"}}]}\n\ndata: [DONE]\n\n";
        let srv = MockServer::start(vec![Canned::sse(sse)]).await;
        let (p, _rt) = provider(Ok(srv.url.clone()));
        let parts: Vec<String> = p.stream(request(false)).await.expect("stream").map(|c| c.expect("chunk")).collect().await;
        assert_eq!(parts.concat(), "Hola");
    }

    #[tokio::test]
    async fn a_model_that_is_not_downloaded_is_a_clear_error_and_no_request_is_sent() {
        let (p, _rt) = provider(Err(PortError::Unavailable("El modelo local no está descargado.".into())));
        let err = p.complete(request(false)).await.expect_err("err");
        assert!(matches!(err, PortError::Unavailable(m) if m.contains("no está descargado")));
    }
}
