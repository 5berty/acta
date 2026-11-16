//! `GroupStore`: grupos manuales y sugeridos.

use crate::codec::*;
use crate::db::SqliteStore;
use acta_core::ids::{GroupId, MeetingId};
use acta_core::library::*;
use acta_core::time::UnixMs;
use acta_core::{PortError, PortResult};
use async_trait::async_trait;
use rusqlite::{params, Connection, OptionalExtension, Row};

const GROUP_SELECT: &str = "SELECT g.id,g.name,g.description,g.kind,g.created_at,g.updated_at,
    (SELECT count(*) FROM group_meetings gm WHERE gm.group_id = g.id) FROM groups g";

fn group_from_row(r: &Row<'_>) -> rusqlite::Result<Group> {
    Ok(Group {
        id: col_id(r, 0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        kind: col_enum(r, 3)?,
        created_at: UnixMs(r.get(4)?),
        updated_at: UnixMs(r.get(5)?),
        meeting_count: r.get(6)?,
    })
}

fn load_group(conn: &Connection, id: GroupId) -> PortResult<Group> {
    conn.query_row(&format!("{GROUP_SELECT} WHERE g.id = ?1"), [id.to_string()], group_from_row)
        .optional()
        .map_err(sql_err)?
        .ok_or_else(|| PortError::NotFound(format!("group {id}")))
}

pub(crate) fn groups_for_meeting(conn: &Connection, meeting: MeetingId) -> PortResult<Vec<Group>> {
    conn.prepare(&format!(
        "{GROUP_SELECT} JOIN group_meetings x ON x.group_id = g.id WHERE x.meeting_id = ?1 ORDER BY x.added_at, g.id"
    ))
    .and_then(|mut st| st.query_map([meeting.to_string()], group_from_row)?.collect::<Result<Vec<_>, _>>())
    .map_err(sql_err)
}

#[async_trait]
impl GroupStore for SqliteStore {
    async fn list_groups(&self) -> PortResult<Vec<Group>> {
        self.with_conn(|conn| {
            conn.prepare(&format!("{GROUP_SELECT} ORDER BY g.updated_at DESC, g.id"))
                .and_then(|mut st| st.query_map([], group_from_row)?.collect::<Result<Vec<_>, _>>())
                .map_err(sql_err)
        })
        .await
    }

    async fn create_group(&self, name: String, description: Option<String>) -> PortResult<Group> {
        let now = self.now().0;
        self.with_conn(move |conn| {
            let id = GroupId::new();
            conn.execute(
                "INSERT INTO groups(id,name,description,kind,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",
                params![id.to_string(), name, description, enc(&GroupKind::Manual), now],
            )
            .map_err(sql_err)?;
            load_group(conn, id)
        })
        .await
    }

    async fn update_group(&self, id: GroupId, name: Option<String>, description: Option<String>) -> PortResult<Group> {
        let now = self.now().0;
        self.with_conn(move |conn| {
            let cur = load_group(conn, id)?;
            conn.execute(
                "UPDATE groups SET name=?2, description=?3, updated_at=?4 WHERE id=?1",
                params![id.to_string(), name.unwrap_or(cur.name), description.or(cur.description), now],
            )
            .map_err(sql_err)?;
            load_group(conn, id)
        })
        .await
    }

    async fn delete_group(&self, id: GroupId) -> PortResult<()> {
        self.with_conn(move |conn| {
            let n = conn.execute("DELETE FROM groups WHERE id=?1", [id.to_string()]).map_err(sql_err)?;
            if n == 0 {
                return Err(PortError::NotFound(format!("group {id}")));
            }
            Ok(())
        })
        .await
    }

    async fn add_meeting(&self, group_id: GroupId, meeting_id: MeetingId) -> PortResult<()> {
        let now = self.now().0;
        self.with_conn(move |conn| {
            if !exists(conn, "groups", "id", &group_id.to_string())? {
                return Err(PortError::NotFound(format!("group {group_id}")));
            }
            if !exists(conn, "meetings", "id", &meeting_id.to_string())? {
                return Err(PortError::NotFound(format!("meeting {meeting_id}")));
            }
            conn.execute(
                "INSERT OR IGNORE INTO group_meetings(group_id,meeting_id,added_at) VALUES (?1,?2,?3)",
                params![group_id.to_string(), meeting_id.to_string(), now],
            )
            .map_err(sql_err)?;
            conn.execute("UPDATE groups SET updated_at=?2 WHERE id=?1", params![group_id.to_string(), now]).map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    async fn remove_meeting(&self, group_id: GroupId, meeting_id: MeetingId) -> PortResult<()> {
        let now = self.now().0;
        self.with_conn(move |conn| {
            conn.execute("DELETE FROM group_meetings WHERE group_id=?1 AND meeting_id=?2", params![group_id.to_string(), meeting_id.to_string()]).map_err(sql_err)?;
            conn.execute("UPDATE groups SET updated_at=?2 WHERE id=?1", params![group_id.to_string(), now]).map_err(sql_err)?;
            Ok(())
        })
        .await
    }

    async fn save_suggestions(&self, suggestions: Vec<GroupSuggestion>) -> PortResult<()> {
        self.with_conn(move |conn| {
            let tx = conn.transaction().map_err(sql_err)?;
            tx.execute("DELETE FROM group_suggestions", []).map_err(sql_err)?;
            for s in &suggestions {
                tx.execute(
                    "INSERT INTO group_suggestions(id,name,description,meeting_ids,cohesion,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
                    params![s.id.to_string(), s.name, s.description, serde_json::to_string(&s.meeting_ids)?, f64::from(s.cohesion), s.created_at.0],
                )
                .map_err(sql_err)?;
            }
            tx.commit().map_err(sql_err)
        })
        .await
    }

    async fn list_suggestions(&self) -> PortResult<Vec<GroupSuggestion>> {
        self.with_conn(|conn| {
            conn.prepare("SELECT id,name,description,meeting_ids,cohesion,created_at FROM group_suggestions ORDER BY cohesion DESC, id")
                .and_then(|mut st| st.query_map([], suggestion_from_row)?.collect::<Result<Vec<_>, _>>())
                .map_err(sql_err)
        })
        .await
    }

    async fn accept_suggestion(&self, id: GroupId, name: Option<String>) -> PortResult<Group> {
        let now = self.now().0;
        self.with_conn(move |conn| {
            let s = conn
                .query_row("SELECT id,name,description,meeting_ids,cohesion,created_at FROM group_suggestions WHERE id=?1", [id.to_string()], suggestion_from_row)
                .optional()
                .map_err(sql_err)?
                .ok_or_else(|| PortError::NotFound(format!("suggestion {id}")))?;
            let name = name.or(s.name).filter(|n| !n.trim().is_empty()).ok_or_else(|| PortError::InvalidInput("la sugerencia no tiene nombre".into()))?;
            let tx = conn.transaction().map_err(sql_err)?;
            tx.execute(
                "INSERT INTO groups(id,name,description,kind,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)",
                params![id.to_string(), name, s.description, enc(&GroupKind::Suggested), now],
            )
            .map_err(sql_err)?;
            for m in &s.meeting_ids {
                // Reuniones borradas entre la sugerencia y la aceptación se omiten.
                tx.execute(
                    "INSERT OR IGNORE INTO group_meetings(group_id,meeting_id,added_at) SELECT ?1, id, ?3 FROM meetings WHERE id=?2",
                    params![id.to_string(), m.to_string(), now],
                )
                .map_err(sql_err)?;
            }
            tx.execute("DELETE FROM group_suggestions WHERE id=?1", [id.to_string()]).map_err(sql_err)?;
            tx.commit().map_err(sql_err)?;
            load_group(conn, id)
        })
        .await
    }

    async fn dismiss_suggestion(&self, id: GroupId) -> PortResult<()> {
        self.with_conn(move |conn| {
            let n = conn.execute("DELETE FROM group_suggestions WHERE id=?1", [id.to_string()]).map_err(sql_err)?;
            if n == 0 {
                return Err(PortError::NotFound(format!("suggestion {id}")));
            }
            Ok(())
        })
        .await
    }
}

fn suggestion_from_row(r: &Row<'_>) -> rusqlite::Result<GroupSuggestion> {
    Ok(GroupSuggestion {
        id: col_id(r, 0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        meeting_ids: col_json(r, 3)?,
        cohesion: r.get::<_, f64>(4)? as f32,
        created_at: UnixMs(r.get(5)?),
    })
}
