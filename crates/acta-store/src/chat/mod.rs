//! `ChatStore`: hilos y mensajes (con citas en JSON).

use crate::codec::*;
use crate::db::SqliteStore;
use acta_core::chat::*;
use acta_core::ids::*;
use acta_core::time::UnixMs;
use acta_core::{PortError, PortResult};
use async_trait::async_trait;
use rusqlite::{params, Row};

fn scope_cols(scope: &ChatScope) -> (&'static str, Option<String>) {
    match scope {
        ChatScope::Meeting { meeting_id } => ("meeting", Some(meeting_id.to_string())),
        ChatScope::Group { group_id } => ("group", Some(group_id.to_string())),
        ChatScope::All => ("all", None),
    }
}

fn thread_from_row(r: &Row<'_>) -> rusqlite::Result<ChatThread> {
    let kind: String = r.get(1)?;
    let scope_id: Option<String> = r.get(2)?;
    let bad = |what: &str| rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, what.to_owned().into());
    let scope = match (kind.as_str(), scope_id) {
        ("meeting", Some(id)) => ChatScope::Meeting { meeting_id: id.parse().map_err(|_| bad("scope_id"))? },
        ("group", Some(id)) => ChatScope::Group { group_id: id.parse().map_err(|_| bad("scope_id"))? },
        ("all", _) => ChatScope::All,
        _ => return Err(bad("scope_kind")),
    };
    Ok(ChatThread { id: col_id(r, 0)?, scope, title: r.get(3)?, created_at: UnixMs(r.get(4)?), updated_at: UnixMs(r.get(5)?) })
}

const THREAD_COLS: &str = "id,scope_kind,scope_id,title,created_at,updated_at";

#[async_trait]
impl ChatStore for SqliteStore {
    async fn create_thread(&self, scope: ChatScope, title: String) -> PortResult<ChatThread> {
        let now = self.now();
        self.with_conn(move |conn| {
            let id = ChatThreadId::new();
            let (kind, sid) = scope_cols(&scope);
            conn.execute(
                "INSERT INTO chat_threads(id,scope_kind,scope_id,title,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",
                params![id.to_string(), kind, sid, title, now.0],
            )
            .map_err(sql_err)?;
            Ok(ChatThread { id, scope, title, created_at: now, updated_at: now })
        })
        .await
    }

    async fn list_threads(&self, scope: Option<ChatScope>) -> PortResult<Vec<ChatThread>> {
        self.with_conn(move |conn| {
            let order = "ORDER BY updated_at DESC, rowid DESC";
            match scope {
                None => conn
                    .prepare(&format!("SELECT {THREAD_COLS} FROM chat_threads {order}"))
                    .and_then(|mut st| st.query_map([], thread_from_row)?.collect::<Result<Vec<_>, _>>()),
                Some(s) => {
                    let (kind, sid) = scope_cols(&s);
                    conn.prepare(&format!("SELECT {THREAD_COLS} FROM chat_threads WHERE scope_kind = ?1 AND scope_id IS ?2 {order}"))
                        .and_then(|mut st| st.query_map(params![kind, sid], thread_from_row)?.collect::<Result<Vec<_>, _>>())
                }
            }
            .map_err(sql_err)
        })
        .await
    }

    async fn append_message(&self, m: ChatMessage) -> PortResult<()> {
        self.with_conn(move |conn| {
            if !exists(conn, "chat_threads", "id", &m.thread_id.to_string())? {
                return Err(PortError::NotFound(format!("thread {}", m.thread_id)));
            }
            let tx = conn.transaction().map_err(sql_err)?;
            tx.execute(
                "INSERT INTO chat_messages(id,thread_id,role,content,citations,provider,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![m.id.to_string(), m.thread_id.to_string(), enc(&m.role), m.content, serde_json::to_string(&m.citations)?, m.provider.as_ref().map(|p| p.0.clone()), m.created_at.0],
            )
            .map_err(sql_err)?;
            tx.execute("UPDATE chat_threads SET updated_at = max(updated_at, ?2) WHERE id = ?1", params![m.thread_id.to_string(), m.created_at.0]).map_err(sql_err)?;
            tx.commit().map_err(sql_err)
        })
        .await
    }

    async fn list_messages(&self, thread_id: ChatThreadId) -> PortResult<Vec<ChatMessage>> {
        self.with_conn(move |conn| {
            conn.prepare("SELECT id,thread_id,role,content,citations,provider,created_at FROM chat_messages WHERE thread_id = ?1 ORDER BY created_at, rowid")
                .and_then(|mut st| {
                    st.query_map([thread_id.to_string()], |r| {
                        Ok(ChatMessage {
                            id: col_id(r, 0)?,
                            thread_id: col_id(r, 1)?,
                            role: col_enum(r, 2)?,
                            content: r.get(3)?,
                            citations: col_json(r, 4)?,
                            provider: r.get::<_, Option<String>>(5)?.map(ProviderId),
                            created_at: UnixMs(r.get(6)?),
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()
                })
                .map_err(sql_err)
        })
        .await
    }

    async fn delete_thread(&self, thread_id: ChatThreadId) -> PortResult<()> {
        self.with_conn(move |conn| {
            let n = conn.execute("DELETE FROM chat_threads WHERE id=?1", [thread_id.to_string()]).map_err(sql_err)?;
            if n == 0 {
                return Err(PortError::NotFound(format!("thread {thread_id}")));
            }
            Ok(())
        })
        .await
    }
}
