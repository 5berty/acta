use super::model::*;
use crate::ids::ProviderId;
use crate::{EventStream, PortResult};
use async_trait::async_trait;

/// Un proveedor LLM concreto (ya configurado). Impl: acta-llm (WP3).
#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn id(&self) -> &ProviderId;
    fn capabilities(&self) -> ProviderCapabilities;
    async fn complete(&self, request: LlmRequest) -> PortResult<LlmResponse>;
    /// Texto incremental. Los proveedores sin streaming emiten un único trozo.
    async fn stream(&self, request: LlmRequest) -> PortResult<EventStream<PortResult<String>>>;
}

/// Construye proveedores a partir de la configuración. Impl: acta-llm.
pub trait LlmProviderFactory: Send + Sync {
    fn build(&self, config: &ProviderConfig) -> PortResult<std::sync::Arc<dyn LlmProvider>>;
}
