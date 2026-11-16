//! Catálogo de modelos de un servidor y detección de los servidores locales
//! (Ollama y LM Studio). Lo usa Ajustes › Proveedores y la bienvenida para
//! ofrecer un desplegable en vez de pedir el nombre del modelo a mano.

use super::http::{map_reqwest, map_status};
use acta_core::{PortError, PortResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// Raíz del servidor de Ollama (su API nativa cuelga de `/api`).
pub const OLLAMA_HOST: &str = "http://127.0.0.1:11434";
/// Raíz del servidor local de LM Studio.
pub const LM_STUDIO_HOST: &str = "http://127.0.0.1:1234";
/// Lo que tarda en darse por «no está en marcha» un servidor local.
pub const LOCAL_PROBE_TIMEOUT: Duration = Duration::from_millis(1_500);

/// Un servidor local de modelos: si responde, qué URL usar y qué modelos tiene.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntime {
    pub running: bool,
    /// URL base compatible con OpenAI (`…/v1`), lista para un proveedor.
    pub base_url: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDetection {
    pub ollama: LocalRuntime,
    pub lm_studio: LocalRuntime,
}

/// Modelos que no sirven para escribir un acta (voz, imagen, embeddings…).
pub fn is_chat_model(id: &str) -> bool {
    const NOT_CHAT: [&str; 10] = ["embed", "whisper", "rerank", "kokoro", "tts", "flux", "image", "bge-", "speech", "diffusion"];
    let id = id.to_lowercase();
    !NOT_CHAT.iter().any(|needle| id.contains(needle))
}

async fn get_json(url: &str, api_key: Option<&str>, timeout: Duration) -> PortResult<Value> {
    let mut rb = reqwest::Client::new().get(url);
    if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
        rb = rb.bearer_auth(key);
    }
    let resp = tokio::time::timeout(timeout, rb.send())
        .await
        .map_err(|_| PortError::Timeout(format!("{url} no respondió en {timeout:?}")))?
        .map_err(|e| map_reqwest(url, e))?;
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        return Err(map_status(status, &resp.text().await.unwrap_or_default()));
    }
    resp.json().await.map_err(|e| PortError::InvalidResponse(format!("la lista de modelos de {url} no es JSON: {e}")))
}

/// Saca los nombres de `list[*][field]`: solo modelos de texto, sin repetir.
fn names(v: &Value, list: &str, field: &str, url: &str) -> PortResult<Vec<String>> {
    let items = v[list]
        .as_array()
        .ok_or_else(|| PortError::InvalidResponse(format!("{url} no devolvió una lista de modelos (`{list}`)")))?;
    let mut out: Vec<String> = Vec::new();
    for name in items.iter().filter_map(|m| m[field].as_str()) {
        if is_chat_model(name) && !out.iter().any(|n| n == name) {
            out.push(name.to_owned());
        }
    }
    Ok(out)
}

fn root(url: &str) -> PortResult<&str> {
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() {
        return Err(PortError::InvalidInput("la URL base del proveedor está vacía".into()));
    }
    Ok(url)
}

/// `GET {base_url}/models` de una API compatible con OpenAI (`data[].id`).
/// Devuelve solo modelos de texto, sin repetidos y en el orden del servidor.
pub async fn list_models(base_url: &str, api_key: Option<&str>, timeout: Duration) -> PortResult<Vec<String>> {
    let url = format!("{}/models", root(base_url)?);
    names(&get_json(&url, api_key, timeout).await?, "data", "id", &url)
}

/// `GET {host}/api/tags` de Ollama (`models[].name`).
pub async fn list_ollama_models(host: &str, timeout: Duration) -> PortResult<Vec<String>> {
    let url = format!("{}/api/tags", root(host)?);
    names(&get_json(&url, None, timeout).await?, "models", "name", &url)
}

fn runtime(host: &str, models: PortResult<Vec<String>>) -> LocalRuntime {
    let base_url = format!("{}/v1", host.trim().trim_end_matches('/'));
    match models {
        Ok(models) => LocalRuntime { running: true, base_url, models },
        Err(_) => LocalRuntime { running: false, base_url, models: Vec::new() },
    }
}

/// Pregunta a los dos servidores a la vez. Que uno no esté no es un error:
/// vuelve con `running: false`.
pub async fn detect_local_at(ollama_host: &str, lm_studio_host: &str, timeout: Duration) -> LocalDetection {
    let lm_base = format!("{}/v1", lm_studio_host.trim().trim_end_matches('/'));
    let (ollama, lm_studio) =
        tokio::join!(list_ollama_models(ollama_host, timeout), list_models(&lm_base, None, timeout));
    LocalDetection { ollama: runtime(ollama_host, ollama), lm_studio: runtime(lm_studio_host, lm_studio) }
}

/// Detección en los puertos por defecto de este Mac.
pub async fn detect_local() -> LocalDetection {
    detect_local_at(OLLAMA_HOST, LM_STUDIO_HOST, LOCAL_PROBE_TIMEOUT).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::*;
    use serde_json::json;

    const T: Duration = Duration::from_secs(5);

    #[tokio::test]
    async fn lists_openai_compatible_models_with_bearer_key() {
        let srv = MockServer::start(vec![Canned::json(json!({"object":"list","data":[
            {"id":"deepseek-v4-flash","object":"model"},
            {"id":"qwen3.6","object":"model"},
            {"id":"gemma4","object":"model"},
            {"id":"qwen3.6","object":"model"}
        ]}))])
        .await;
        let models = list_models(&format!("{}/v1/", srv.url), Some("sk-nan"), T).await.expect("models");
        assert_eq!(models, vec!["deepseek-v4-flash", "qwen3.6", "gemma4"]);
        let reqs = srv.requests();
        assert_eq!(reqs[0].method, "GET");
        assert_eq!(reqs[0].path, "/v1/models");
        assert_eq!(reqs[0].header("authorization"), Some("Bearer sk-nan"));
    }

    #[tokio::test]
    async fn no_key_sends_no_authorization_and_blank_key_counts_as_none() {
        let srv = MockServer::start(vec![Canned::json(json!({"data":[{"id":"llama3"}]}))]).await;
        list_models(&srv.url, None, T).await.expect("models");
        list_models(&srv.url, Some("  "), T).await.expect("models");
        assert!(srv.requests().iter().all(|r| r.header("authorization").is_none()));
    }

    #[tokio::test]
    async fn drops_models_that_cannot_write_minutes() {
        let srv = MockServer::start(vec![Canned::json(json!({"data":[
            {"id":"gemma4"},{"id":"whisper"},{"id":"qwen3-embedding"},{"id":"rerank"},
            {"id":"kokoro"},{"id":"flux-2-klein"},{"id":"qwen-image-2.1"},{"id":"text-embedding-nomic-embed-text-v1.5"}
        ]}))])
        .await;
        assert_eq!(list_models(&srv.url, None, T).await.expect("models"), vec!["gemma4"]);
    }

    #[tokio::test]
    async fn rejected_key_and_unreadable_body_are_explained() {
        let srv = MockServer::start(vec![Canned::status(401, "{\"error\":{\"message\":\"Invalid API key.\"}}")]).await;
        let e = list_models(&srv.url, Some("bad"), T).await.expect_err("err");
        assert!(matches!(&e, PortError::PermissionDenied(m) if m.contains("Invalid API key")), "{e}");
        let srv = MockServer::start(vec![Canned::json(json!({"hola": 1}))]).await;
        let e = list_models(&srv.url, None, T).await.expect_err("err");
        assert!(matches!(e, PortError::InvalidResponse(_)));
        let e = list_models(" ", None, T).await.expect_err("err");
        assert!(matches!(e, PortError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn lists_ollama_tags_by_name() {
        let srv = MockServer::start(vec![Canned::json(json!({"models":[
            {"name":"qwen2.5:14b","model":"qwen2.5:14b","size":8988124069u64},
            {"name":"llama3.2:latest"},
            {"name":"nomic-embed-text:latest"}
        ]}))])
        .await;
        let models = list_ollama_models(&srv.url, T).await.expect("models");
        assert_eq!(models, vec!["qwen2.5:14b", "llama3.2:latest"]);
        assert_eq!(srv.requests()[0].path, "/api/tags");
    }

    #[tokio::test]
    async fn detects_both_local_servers_and_their_openai_urls() {
        let ollama = MockServer::start(vec![Canned::json(json!({"models":[{"name":"qwen2.5:14b"}]}))]).await;
        let lms = MockServer::start(vec![Canned::json(json!({"data":[{"id":"google/gemma-3-12b"}]}))]).await;
        let d = detect_local_at(&ollama.url, &format!("{}/", lms.url), T).await;
        assert_eq!(d.ollama, LocalRuntime { running: true, base_url: format!("{}/v1", ollama.url), models: vec!["qwen2.5:14b".into()] });
        assert_eq!(d.lm_studio, LocalRuntime { running: true, base_url: format!("{}/v1", lms.url), models: vec!["google/gemma-3-12b".into()] });
        assert_eq!(lms.requests()[0].path, "/v1/models");
    }

    #[tokio::test]
    async fn a_server_that_is_not_running_is_not_an_error() {
        let d = detect_local_at("http://127.0.0.1:1", "http://127.0.0.1:1", Duration::from_millis(800)).await;
        assert!(!d.ollama.running && d.ollama.models.is_empty());
        assert!(!d.lm_studio.running && d.lm_studio.models.is_empty());
        assert_eq!(d.ollama.base_url, "http://127.0.0.1:1/v1");
    }

    #[tokio::test]
    async fn a_running_server_without_models_still_counts_as_running() {
        let srv = MockServer::start(vec![Canned::json(json!({"models":[]}))]).await;
        let d = detect_local_at(&srv.url, "http://127.0.0.1:1", T).await;
        assert!(d.ollama.running && d.ollama.models.is_empty());
    }

    #[test]
    fn detection_serializes_in_camel_case_for_the_ui() {
        let rt = LocalRuntime { running: true, base_url: "http://x/v1".into(), models: vec![] };
        let v = serde_json::to_value(LocalDetection { ollama: rt.clone(), lm_studio: rt }).expect("json");
        assert_eq!(v["lmStudio"]["baseUrl"], "http://x/v1");
        assert_eq!(v["ollama"]["running"], true);
    }
}
