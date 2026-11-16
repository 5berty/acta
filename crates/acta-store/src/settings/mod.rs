//! `SettingsStore`: `settings['app']` guarda el JSON de `Settings`.
//!
//! Los proveedores LLM solo llevan `SecretRef` (servicio + cuenta del
//! Llavero); el valor de la clave nunca pasa por aquí (ver `crate::secrets`).

use crate::codec::sql_err;
use crate::db::SqliteStore;
use acta_core::library::SettingsStore;
use acta_core::settings::Settings;
use acta_core::{PortError, PortResult};
use async_trait::async_trait;
use rusqlite::{params, OptionalExtension};

const KEY: &str = "app";

#[async_trait]
impl SettingsStore for SqliteStore {
    async fn load_settings(&self) -> PortResult<Settings> {
        self.with_conn(|conn| {
            let raw: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |r| r.get(0)).optional().map_err(sql_err)?;
            match raw {
                None => Ok(Settings::default()),
                Some(s) => serde_json::from_str(&s).map_err(|e| PortError::InvalidResponse(format!("settings: {e}"))),
            }
        })
        .await
    }

    async fn save_settings(&self, settings: Settings) -> PortResult<()> {
        let json = serde_json::to_string(&settings)?;
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO settings(key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![KEY, json],
            )
            .map_err(sql_err)?;
            Ok(())
        })
        .await
    }
}
