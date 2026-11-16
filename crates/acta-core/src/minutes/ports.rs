use super::model::*;
use crate::PortResult;
use crate::recording::Track;
use crate::time::UnixMs;
use async_trait::async_trait;

/// Genera el acta completa con un LLM. Impl: acta-llm (WP3).
#[async_trait]
pub trait MinutesGenerator: Send + Sync {
    async fn generate(&self, input: MinutesInput) -> PortResult<MinutesOutput>;
}

/// Pone nombre a un grupo sugerido. Impl: acta-llm (WP3).
#[async_trait]
pub trait GroupNamer: Send + Sync {
    /// `meetings` = (título, resumen) de cada reunión del cluster.
    async fn name_group(&self, meetings: &[(String, String)]) -> PortResult<GroupName>;
}

/// Detector de momentos importantes en texto en vivo (palabras clave ES/EN:
/// "importante", "apuntad", "esto es clave", "deadline", "fecha"...).
/// Puro y síncrono. Impl: acta-llm (WP3).
pub trait ImportantMomentDetector: Send + Sync {
    fn detect(&self, text: &str, track: Track, at: UnixMs) -> Option<KeywordHit>;
}
