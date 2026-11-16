//! Apertura de la base de datos y migraciones.

use acta_core::{PortError, PortResult};
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex, Once};

/// Migraciones en orden. La posición + 1 es el `user_version` resultante.
pub const MIGRATIONS: &[&str] = &[include_str!("../../migrations/0001_init.sql")];

/// Dimensión de los vectores en el esquema actual (multilingual-e5-small).
pub const EMBEDDING_DIMS: usize = 384;

static REGISTER_VEC: Once = Once::new();

/// Registra sqlite-vec como extensión automática para TODAS las conexiones
/// que se abran después en el proceso.
#[allow(unsafe_code)]
pub fn register_sqlite_vec() {
    REGISTER_VEC.call_once(|| {
        // SAFETY: `sqlite3_vec_init` es el punto de entrada de extensión de
        // sqlite-vec, enlazado estáticamente; `sqlite3_auto_extension` espera
        // exactamente esa firma (xEntryPoint). Se registra una sola vez.
        unsafe {
            type EntryPoint = unsafe extern "C" fn(
                *mut rusqlite::ffi::sqlite3,
                *mut *mut std::os::raw::c_char,
                *const rusqlite::ffi::sqlite3_api_routines,
            ) -> std::os::raw::c_int;
            let entry: EntryPoint = std::mem::transmute(sqlite_vec::sqlite3_vec_init as *const ());
            rusqlite::ffi::sqlite3_auto_extension(Some(entry));
        }
    });
}

fn map_err(e: rusqlite::Error) -> PortError {
    PortError::Io(format!("sqlite: {e}"))
}

/// Aplica las migraciones pendientes en una transacción cada una.
pub fn migrate(conn: &mut Connection) -> PortResult<u32> {
    let current: u32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(map_err)?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = i as u32 + 1;
        let tx = conn.transaction().map_err(map_err)?;
        tx.execute_batch(sql).map_err(map_err)?;
        tx.pragma_update(None, "user_version", version).map_err(map_err)?;
        tx.commit().map_err(map_err)?;
    }
    Ok(MIGRATIONS.len() as u32)
}

/// Abre (o crea) la base de datos con WAL, claves foráneas y sqlite-vec.
pub fn open(path: &Path) -> PortResult<Connection> {
    register_sqlite_vec();
    let mut conn = Connection::open(path).map_err(map_err)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )
    .map_err(map_err)?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Adaptador que implementará todos los puertos de almacenamiento (WP2).
#[derive(Clone)]
pub struct SqliteStore {
    pub(crate) conn: Arc<Mutex<Connection>>,
}

impl SqliteStore {
    pub fn open(path: &Path) -> PortResult<Self> {
        Ok(Self {
            conn: Arc::new(Mutex::new(open(path)?)),
        })
    }

    /// Ejecuta `f` con la conexión en un hilo de bloqueo.
    pub async fn with_conn<T, F>(&self, f: F) -> PortResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> PortResult<T> + Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| PortError::Internal("sqlite mutex poisoned".into()))?;
            f(&mut guard)
        })
        .await
        .map_err(|e| PortError::Internal(format!("join: {e}")))?
    }
}
