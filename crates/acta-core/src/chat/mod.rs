//! Chat sobre una reunión (transcript completo en contexto) o sobre un grupo
//! (RAG híbrido con citas a reunión + minuto).

use crate::ids::{ChatMessageId, ChatThreadId, GroupId, MeetingId, ProviderId};
use crate::library::SearchScope;
use crate::time::{MediaMs, UnixMs};
use crate::{EventStream, PortResult};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ChatScope {
    #[serde(rename_all = "camelCase")]
    Meeting { meeting_id: MeetingId },
    #[serde(rename_all = "camelCase")]
    Group { group_id: GroupId },
    /// Todas las reuniones (RAG).
    All,
}

impl ChatScope {
    pub fn search_scope(&self) -> SearchScope {
        match self {
            ChatScope::Meeting { meeting_id } => SearchScope::Meeting {
                meeting_id: *meeting_id,
            },
            ChatScope::Group { group_id } => SearchScope::Group {
                group_id: *group_id,
            },
            ChatScope::All => SearchScope::All,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatRole {
    User,
    Assistant,
}

/// Cita: el modelo escribe `[n]` en el texto y `n` apunta aquí.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub n: u32,
    pub meeting_id: MeetingId,
    pub meeting_title: String,
    pub at: MediaMs,
    pub end: MediaMs,
    pub snippet: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: ChatMessageId,
    pub thread_id: ChatThreadId,
    pub role: ChatRole,
    pub content: String,
    pub citations: Vec<Citation>,
    pub provider: Option<ProviderId>,
    pub created_at: UnixMs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThread {
    pub id: ChatThreadId,
    pub scope: ChatScope,
    pub title: String,
    pub created_at: UnixMs,
    pub updated_at: UnixMs,
}

/// Trozo de respuesta en streaming.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDelta {
    pub thread_id: ChatThreadId,
    pub message_id: ChatMessageId,
    pub delta: String,
    pub done: bool,
    /// Solo en el último delta (`done = true`).
    pub citations: Vec<Citation>,
    pub error: Option<String>,
}

/// Chunk recuperado para el contexto del chat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievedChunk {
    pub chunk_id: i64,
    pub meeting_id: MeetingId,
    pub meeting_title: String,
    pub started_at: UnixMs,
    pub start: MediaMs,
    pub end: MediaMs,
    pub text: String,
    pub score: f32,
}

/// Recuperación híbrida para RAG. Impl: acta-store (WP2).
#[async_trait]
pub trait Retriever: Send + Sync {
    async fn retrieve(&self, query: &str, scope: &ChatScope, k: u32) -> PortResult<Vec<RetrievedChunk>>;
}

#[async_trait]
pub trait ChatStore: Send + Sync {
    async fn create_thread(&self, scope: ChatScope, title: String) -> PortResult<ChatThread>;
    async fn list_threads(&self, scope: Option<ChatScope>) -> PortResult<Vec<ChatThread>>;
    async fn append_message(&self, message: ChatMessage) -> PortResult<()>;
    async fn list_messages(&self, thread_id: ChatThreadId) -> PortResult<Vec<ChatMessage>>;
    async fn delete_thread(&self, thread_id: ChatThreadId) -> PortResult<()>;
}

/// Motor de chat. Impl: acta-llm (WP3), con `MeetingStore` + `Retriever`
/// inyectados. Devuelve deltas; el último lleva `done = true` y las citas.
/// El llamador persiste el mensaje del usuario y el de la respuesta.
#[async_trait]
pub trait ChatEngine: Send + Sync {
    async fn ask(
        &self,
        thread: &ChatThread,
        history: &[ChatMessage],
        question: &str,
        assistant_message_id: ChatMessageId,
    ) -> PortResult<EventStream<ChatDelta>>;
}
