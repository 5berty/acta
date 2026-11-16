//! Conversión entre filas SQLite y tipos de dominio.

use acta_core::PortError;
use rusqlite::types::Type;
use rusqlite::{Error as SqlError, Row};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::error::Error;
use std::str::FromStr;

/// Mapea errores de SQLite a `PortError`. Las violaciones de restricciones
/// (única, clave foránea...) son entradas inválidas, no fallos de E/S.
pub(crate) fn sql_err(e: SqlError) -> PortError {
    if let SqlError::SqliteFailure(f, _) = &e
        && f.code == rusqlite::ErrorCode::ConstraintViolation
    {
        return PortError::InvalidInput(format!("sqlite constraint: {e}"));
    }
    PortError::Io(format!("sqlite: {e}"))
}

/// Enum serde "de texto plano" -> string de columna.
pub(crate) fn enc<T: Serialize>(v: &T) -> String {
    match serde_json::to_value(v) {
        Ok(serde_json::Value::String(s)) => s,
        Ok(other) => other.to_string(),
        Err(_) => String::new(),
    }
}

fn conv_err(i: usize, e: Box<dyn Error + Send + Sync>) -> SqlError {
    SqlError::FromSqlConversionFailure(i, Type::Text, e)
}

pub(crate) fn dec_enum<T: DeserializeOwned>(i: usize, s: String) -> rusqlite::Result<T> {
    serde_json::from_value(serde_json::Value::String(s)).map_err(|e| conv_err(i, Box::new(e)))
}

pub(crate) fn col_enum<T: DeserializeOwned>(r: &Row<'_>, i: usize) -> rusqlite::Result<T> {
    dec_enum(i, r.get::<_, String>(i)?)
}

pub(crate) fn col_id<T: FromStr>(r: &Row<'_>, i: usize) -> rusqlite::Result<T>
where
    T::Err: Error + Send + Sync + 'static,
{
    r.get::<_, String>(i)?.parse::<T>().map_err(|e| conv_err(i, Box::new(e)))
}

pub(crate) fn col_id_opt<T: FromStr>(r: &Row<'_>, i: usize) -> rusqlite::Result<Option<T>>
where
    T::Err: Error + Send + Sync + 'static,
{
    match r.get::<_, Option<String>>(i)? {
        Some(s) => s.parse::<T>().map(Some).map_err(|e| conv_err(i, Box::new(e))),
        None => Ok(None),
    }
}

pub(crate) fn col_json<T: DeserializeOwned>(r: &Row<'_>, i: usize) -> rusqlite::Result<T> {
    serde_json::from_str(&r.get::<_, String>(i)?).map_err(|e| conv_err(i, Box::new(e)))
}

pub(crate) fn col_u64(r: &Row<'_>, i: usize) -> rusqlite::Result<u64> {
    Ok(r.get::<_, i64>(i)?.max(0) as u64)
}

pub(crate) fn col_bool(r: &Row<'_>, i: usize) -> rusqlite::Result<bool> {
    Ok(r.get::<_, i64>(i)? != 0)
}

pub(crate) fn exists(conn: &rusqlite::Connection, table: &str, id_col: &str, id: &str) -> Result<bool, PortError> {
    conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {id_col} = ?1)"), [id], |r| r.get::<_, i64>(0))
        .map(|n| n != 0)
        .map_err(sql_err)
}
