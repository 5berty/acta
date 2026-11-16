//! `SidecarClient` (WP4). Ver docs/01-arquitectura.md §4.4 (supervisión).

use crate::protocol::{Command, EventEnvelope};
use acta_core::{PortError, PortResult};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct SidecarConfig {
    /// Ruta del binario. Bundle: `Contents/MacOS/acta-mac`; dev:
    /// `sidecars/acta-mac/.build/debug/acta-mac`. La resuelve WP6.
    pub binary: PathBuf,
    /// Fichero de log para el stderr del sidecar.
    pub log_file: Option<PathBuf>,
    /// Timeout por defecto de comandos cortos.
    pub command_timeout: Duration,
    /// Reinicios máximos en `restart_window` antes de rendirse.
    pub max_restarts: u32,
    pub restart_window: Duration,
}

impl Default for SidecarConfig {
    fn default() -> Self {
        Self {
            binary: PathBuf::from("acta-mac"),
            log_file: None,
            command_timeout: Duration::from_secs(10),
            max_restarts: 5,
            restart_window: Duration::from_secs(60),
        }
    }
}

/// Handle compartido (Clone) al sidecar.
#[derive(Clone)]
pub struct SidecarClient {
    _private: (),
}

impl SidecarClient {
    /// Lanza el sidecar, hace `hello` y verifica `protocol_version`.
    pub async fn start(config: SidecarConfig) -> PortResult<Self> {
        let _ = config;
        Err(PortError::NotImplemented("SidecarClient::start".into()))
    }

    /// Envía un comando y espera su respuesta (`result` como JSON).
    pub async fn call(&self, command: Command, timeout: Option<Duration>) -> PortResult<serde_json::Value> {
        let _ = (command, timeout);
        Err(PortError::NotImplemented("SidecarClient::call".into()))
    }

    /// Suscripción a TODOS los eventos del sidecar.
    pub fn events(&self) -> tokio::sync::broadcast::Receiver<EventEnvelope> {
        let (_tx, rx) = tokio::sync::broadcast::channel(1);
        rx
    }

    /// `shutdown` ordenado + kill + wait.
    pub async fn shutdown(&self) -> PortResult<()> {
        Err(PortError::NotImplemented("SidecarClient::shutdown".into()))
    }
}
