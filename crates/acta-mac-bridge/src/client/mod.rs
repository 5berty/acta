//! `SidecarClient` (WP4). Ver docs/01-arquitectura.md §4.4 (supervisión).
//!
//! Una tarea supervisora es la ÚNICA dueña del `Child`:
//! - escribe en stdin (los `call` le pasan la línea por un `mpsc`),
//! - espera al hijo con `wait()` en TODOS los caminos (muerte, parada,
//!   fallo del `hello`, handles soltados),
//! - si muere solo, lo reinicia con backoff exponencial y como mucho
//!   `max_restarts` veces en `restart_window`; luego se rinde (`GaveUp`).
//!
//! Una tarea lectora parsea stdout (líneas ≤ 1 MiB), resuelve las respuestas
//! por `id` y publica los eventos en un `broadcast`. El orden en el broadcast
//! es el de stdout y `Restarted` llega SIEMPRE después del último evento del
//! hijo anterior (la supervisora espera a la lectora antes de relanzar).

mod lines;
mod locate;

pub use locate::{SIDECAR_ENV, locate_sidecar};

use crate::protocol::{
    Command, ErrorCode, EventEnvelope, HelloArgs, HelloResult, Incoming, MAX_LINE_BYTES,
    PROTOCOL_VERSION, Request, Response,
};
use acta_core::time::{Clock, SystemClock, UnixMs};
use acta_core::{PortError, PortResult};
use lines::{Line, next_line};
use serde::de::DeserializeOwned;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::io::BufReader;
use tokio::task::JoinHandle;

#[derive(Debug, Clone)]
pub struct SidecarConfig {
    /// Ruta del binario. Ver [`locate_sidecar`].
    pub binary: PathBuf,
    pub args: Vec<String>,
    /// Fichero de log para el stderr del sidecar (`logs/acta-mac.log`).
    pub log_file: Option<PathBuf>,
    /// Timeout por defecto de comandos cortos.
    pub command_timeout: Duration,
    /// Timeout del `hello` inicial (y tras cada reinicio).
    pub hello_timeout: Duration,
    /// Reinicios máximos en `restart_window` antes de rendirse.
    pub max_restarts: u32,
    pub restart_window: Duration,
    /// Backoff del primer reinicio; se dobla en cada intento (tope 8 s).
    pub restart_backoff: Duration,
    /// Espera tras `shutdown` antes de `start_kill()`.
    pub shutdown_grace: Duration,
    /// Capacidad del broadcast de eventos (≈20 frames/s de audio).
    pub event_capacity: usize,
}

impl Default for SidecarConfig {
    fn default() -> Self {
        Self {
            binary: PathBuf::from("acta-mac"),
            args: Vec::new(),
            log_file: None,
            command_timeout: Duration::from_secs(10),
            hello_timeout: Duration::from_secs(10),
            max_restarts: 5,
            restart_window: Duration::from_secs(60),
            restart_backoff: Duration::from_millis(500),
            shutdown_grace: Duration::from_secs(2),
            event_capacity: 8192,
        }
    }
}

const MAX_BACKOFF: Duration = Duration::from_secs(8);
/// Tiempo máximo para drenar stdout/stderr tras matar al hijo.
const PIPE_DRAIN: Duration = Duration::from_secs(1);

/// Lo que publica el cliente: eventos del sidecar y su ciclo de vida.
#[derive(Debug, Clone, PartialEq)]
pub enum SidecarMessage {
    Event(EventEnvelope),
    /// El sidecar murió y se relanzó (ya respondió a `hello`). Los adaptadores
    /// deben repetir sus comandos de estado (`capture.start`, `detect.start`...).
    Restarted { at: UnixMs, restarts: u32 },
    /// Se agotó el presupuesto de reinicios. Todas las llamadas fallan.
    GaveUp { message: String },
}

enum Ctl {
    Send { id: u64, line: String },
    Shutdown(oneshot::Sender<()>),
}

struct Shared {
    config: SidecarConfig,
    tx: broadcast::Sender<SidecarMessage>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Response>>>,
    next_id: AtomicU64,
    hello: Mutex<Option<HelloResult>>,
    pid: Mutex<Option<u32>>,
}

impl Shared {
    fn take_pending(&self, id: u64) -> Option<oneshot::Sender<Response>> {
        lock(&self.pending).remove(&id)
    }

    /// Suelta todos los `oneshot`: los `call` en curso ven `Unavailable`.
    fn fail_all_pending(&self) {
        lock(&self.pending).clear();
    }

    fn publish(&self, msg: SidecarMessage) {
        // Sin suscriptores no es un error.
        let _ = self.tx.send(msg);
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Handle compartido (Clone) al sidecar. Cuando se sueltan TODOS los handles,
/// la supervisora cierra el sidecar (shutdown → kill → wait).
#[derive(Clone)]
pub struct SidecarClient {
    shared: Arc<Shared>,
    ctl: mpsc::Sender<Ctl>,
}

impl std::fmt::Debug for SidecarClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SidecarClient")
            .field("binary", &self.shared.config.binary)
            .field("pid", &self.pid())
            .finish()
    }
}

impl SidecarClient {
    /// Lanza el sidecar, hace `hello` y verifica `protocol_version`.
    pub async fn start(config: SidecarConfig) -> PortResult<Self> {
        let (tx, _) = broadcast::channel(config.event_capacity.max(16));
        let shared = Arc::new(Shared {
            config,
            tx,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            hello: Mutex::new(None),
            pid: Mutex::new(None),
        });
        let proc = spawn_and_hello(&shared).await?;
        let (ctl, ctl_rx) = mpsc::channel(256);
        tokio::spawn(supervise(shared.clone(), ctl_rx, proc));
        Ok(Self { shared, ctl })
    }

    /// Envía un comando y espera su respuesta (`result` como JSON; `{}` si no
    /// trae). `timeout = None` usa `command_timeout`.
    pub async fn call(&self, command: Command, timeout: Option<Duration>) -> PortResult<serde_json::Value> {
        let id = self.shared.next_id.fetch_add(1, Ordering::Relaxed);
        let name = command_name(&command);
        let mut line = serde_json::to_string(&Request { id, command })
            .map_err(|e| PortError::InvalidInput(format!("{name}: {e}")))?;
        if line.len() >= MAX_LINE_BYTES {
            return Err(PortError::InvalidInput(format!("{name}: request line too long")));
        }
        line.push('\n');
        let (tx, rx) = oneshot::channel();
        lock(&self.shared.pending).insert(id, tx);
        if self.ctl.send(Ctl::Send { id, line }).await.is_err() {
            self.shared.take_pending(id);
            return Err(PortError::Unavailable(format!("{name}: sidecar is shut down")));
        }
        let wait = timeout.unwrap_or(self.shared.config.command_timeout);
        match tokio::time::timeout(wait, rx).await {
            Err(_) => {
                self.shared.take_pending(id);
                Err(PortError::Timeout(format!("{name} after {wait:?}")))
            }
            Ok(Err(_)) => Err(PortError::Unavailable(format!("{name}: sidecar exited"))),
            Ok(Ok(resp)) => response_into_result(name, resp),
        }
    }

    /// `call` + deserialización del `result`.
    pub async fn call_typed<T: DeserializeOwned>(&self, command: Command, timeout: Option<Duration>) -> PortResult<T> {
        let value = self.call(command, timeout).await?;
        serde_json::from_value(value).map_err(|e| PortError::InvalidResponse(e.to_string()))
    }

    /// Suscripción a TODOS los eventos del sidecar y a su ciclo de vida.
    pub fn subscribe(&self) -> broadcast::Receiver<SidecarMessage> {
        self.shared.tx.subscribe()
    }

    /// Resultado del último `hello` (versión, capacidades).
    pub fn hello_info(&self) -> Option<HelloResult> {
        lock(&self.shared.hello).clone()
    }

    /// PID del sidecar vivo (None si está caído o cerrado).
    pub fn pid(&self) -> Option<u32> {
        *lock(&self.shared.pid)
    }

    /// `shutdown` ordenado + espera `shutdown_grace` + kill + wait.
    pub async fn shutdown(&self) -> PortResult<()> {
        let (tx, rx) = oneshot::channel();
        if self.ctl.send(Ctl::Shutdown(tx)).await.is_err() {
            return Ok(()); // ya cerrado
        }
        let _ = rx.await;
        Ok(())
    }
}

fn command_name(command: &Command) -> String {
    serde_json::to_value(command)
        .ok()
        .and_then(|v| v.get("cmd").and_then(|c| c.as_str()).map(str::to_owned))
        .unwrap_or_else(|| "command".into())
}

fn response_into_result(name: String, resp: Response) -> PortResult<serde_json::Value> {
    if resp.ok {
        return Ok(resp.result.unwrap_or_else(|| serde_json::json!({})));
    }
    let Some(err) = resp.error else {
        return Err(PortError::InvalidResponse(format!("{name}: ok=false without error")));
    };
    let msg = err.message;
    Err(match err.code {
        ErrorCode::PermissionDenied => PortError::PermissionDenied(msg),
        ErrorCode::NotFound => PortError::NotFound(msg),
        ErrorCode::Unsupported => PortError::Unavailable(format!("{name} unsupported: {msg}")),
        ErrorCode::InvalidArgs => PortError::InvalidInput(msg),
        ErrorCode::Busy => PortError::Unavailable(format!("{name} busy: {msg}")),
        ErrorCode::Cancelled => PortError::Cancelled,
        ErrorCode::Internal => PortError::Internal(msg),
    })
}

// ---------------------------------------------------------------------------
// Proceso hijo
// ---------------------------------------------------------------------------

struct Proc {
    child: Child,
    stdin: Option<ChildStdin>,
    reader: JoinHandle<()>,
    stderr: JoinHandle<()>,
    /// Se resuelve cuando la lectora ve EOF en stdout.
    stdout_closed: oneshot::Receiver<()>,
}

impl Proc {
    /// Mata y espera. Se llama en TODOS los caminos que abandonan un hijo.
    async fn kill_and_reap(mut self) {
        drop(self.stdin.take());
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
        // Un nieto podría heredar los pipes y no dar nunca EOF: espera acotada.
        for task in [&mut self.reader, &mut self.stderr] {
            if tokio::time::timeout(PIPE_DRAIN, &mut *task).await.is_err() {
                task.abort();
            }
        }
    }

    /// `shutdown` + espera + kill + wait.
    async fn graceful(mut self, shared: &Shared) {
        if let Some(mut stdin) = self.stdin.take() {
            let id = shared.next_id.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut line) = serde_json::to_string(&Request {
                id,
                command: Command::Shutdown,
            }) {
                line.push('\n');
                let _ = stdin.write_all(line.as_bytes()).await;
                let _ = stdin.flush().await;
            }
            // Cerrar stdin = EOF: el sidecar sale también por ahí.
            drop(stdin);
        }
        if tokio::time::timeout(shared.config.shutdown_grace, self.child.wait())
            .await
            .is_err()
        {
            tracing::warn!("acta-mac ignored shutdown; killing");
        }
        self.kill_and_reap().await;
    }
}

async fn spawn_proc(shared: &Arc<Shared>) -> PortResult<Proc> {
    let cfg = &shared.config;
    let mut child = tokio::process::Command::new(&cfg.binary)
        .args(&cfg.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| PortError::Unavailable(format!("cannot spawn {}: {e}", cfg.binary.display())))?;
    let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Err(PortError::Internal("child pipes missing".into()));
    };
    let (closed_tx, stdout_closed) = oneshot::channel();
    let reader = tokio::spawn(read_stdout(shared.clone(), stdout, closed_tx));
    let stderr = tokio::spawn(read_stderr(stderr, cfg.log_file.clone()));
    *lock(&shared.pid) = child.id();
    Ok(Proc {
        child,
        stdin: Some(stdin),
        reader,
        stderr,
        stdout_closed,
    })
}

async fn spawn_and_hello(shared: &Arc<Shared>) -> PortResult<Proc> {
    let mut proc = spawn_proc(shared).await?;
    match hello(shared, &mut proc).await {
        Ok(info) => {
            *lock(&shared.hello) = Some(info);
            Ok(proc)
        }
        Err(e) => {
            *lock(&shared.pid) = None;
            proc.kill_and_reap().await;
            Err(e)
        }
    }
}

async fn hello(shared: &Arc<Shared>, proc: &mut Proc) -> PortResult<HelloResult> {
    let id = shared.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    lock(&shared.pending).insert(id, tx);
    let mut line = serde_json::to_string(&Request {
        id,
        command: Command::Hello(HelloArgs {
            protocol_version: PROTOCOL_VERSION,
        }),
    })?;
    line.push('\n');
    let stdin = proc.stdin.as_mut().ok_or_else(|| PortError::Internal("no stdin".into()))?;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| PortError::Unavailable(format!("hello write: {e}")))?;
    let _ = stdin.flush().await;
    let resp = match tokio::time::timeout(shared.config.hello_timeout, rx).await {
        Err(_) => {
            shared.take_pending(id);
            return Err(PortError::Unavailable("sidecar did not answer hello".into()));
        }
        Ok(Err(_)) => return Err(PortError::Unavailable("sidecar exited during hello".into())),
        Ok(Ok(r)) => r,
    };
    let value = response_into_result("hello".into(), resp)?;
    let info: HelloResult =
        serde_json::from_value(value).map_err(|e| PortError::InvalidResponse(format!("hello: {e}")))?;
    if info.protocol_version != PROTOCOL_VERSION {
        return Err(PortError::Unavailable(format!(
            "sidecar protocol {} != {PROTOCOL_VERSION}",
            info.protocol_version
        )));
    }
    Ok(info)
}

async fn read_stdout(shared: Arc<Shared>, stdout: tokio::process::ChildStdout, closed: oneshot::Sender<()>) {
    let mut reader = BufReader::with_capacity(64 * 1024, stdout);
    let mut buf = Vec::with_capacity(8 * 1024);
    loop {
        let line = match next_line(&mut reader, &mut buf, MAX_LINE_BYTES).await {
            Ok(Some(Line::Text(l))) => l,
            Ok(Some(Line::TooLong(n))) => {
                tracing::warn!("acta-mac: stdout line of {n} bytes (> 1 MiB) dropped");
                continue;
            }
            Ok(None) => break,
            Err(e) => {
                tracing::warn!("acta-mac: stdout read error: {e}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Incoming>(&line) {
            Ok(Incoming::Response(resp)) => match shared.take_pending(resp.id) {
                Some(tx) => {
                    let _ = tx.send(resp);
                }
                None => tracing::debug!("acta-mac: response for unknown id {}", resp.id),
            },
            Ok(Incoming::Event(env)) => shared.publish(SidecarMessage::Event(env)),
            Err(e) => {
                let preview: String = line.chars().take(120).collect();
                tracing::warn!("acta-mac: bad stdout line ({e}): {preview}");
            }
        }
    }
    // Un hijo sin stdout no contesta: que nadie espere en balde.
    shared.fail_all_pending();
    let _ = closed.send(());
}

async fn read_stderr(stderr: tokio::process::ChildStderr, log_file: Option<PathBuf>) {
    let mut file = match &log_file {
        Some(path) => {
            if let Some(dir) = path.parent() {
                let _ = tokio::fs::create_dir_all(dir).await;
            }
            tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .await
                .ok()
        }
        None => None,
    };
    let mut reader = BufReader::new(stderr);
    let mut buf = Vec::new();
    while let Ok(Some(item)) = next_line(&mut reader, &mut buf, 64 * 1024).await {
        let Line::Text(line) = item else { continue };
        tracing::debug!(target: "acta_mac", "{line}");
        if let Some(f) = file.as_mut() {
            let stamped = format!("{} {line}\n", SystemClock.now().0);
            if f.write_all(stamped.as_bytes()).await.is_err() {
                file = None;
            }
        }
    }
    if let Some(mut f) = file {
        let _ = f.flush().await;
    }
}

// ---------------------------------------------------------------------------
// Supervisora
// ---------------------------------------------------------------------------

enum Outcome {
    Died,
    Shutdown(oneshot::Sender<()>),
    ClientsGone,
}

async fn run_child(shared: &Shared, ctl_rx: &mut mpsc::Receiver<Ctl>, proc: &mut Proc) -> Outcome {
    loop {
        tokio::select! {
            status = proc.child.wait() => {
                tracing::warn!("acta-mac exited: {status:?}");
                return Outcome::Died;
            }
            _ = &mut proc.stdout_closed => {
                tracing::warn!("acta-mac closed stdout");
                return Outcome::Died;
            }
            msg = ctl_rx.recv() => match msg {
                Some(Ctl::Send { id, line }) => {
                    let ok = match proc.stdin.as_mut() {
                        Some(stdin) => stdin.write_all(line.as_bytes()).await.is_ok() && stdin.flush().await.is_ok(),
                        None => false,
                    };
                    if !ok {
                        shared.take_pending(id);
                    }
                }
                Some(Ctl::Shutdown(reply)) => return Outcome::Shutdown(reply),
                None => return Outcome::ClientsGone,
            },
        }
    }
}

async fn supervise(shared: Arc<Shared>, mut ctl_rx: mpsc::Receiver<Ctl>, mut proc: Proc) {
    let mut history: VecDeque<Instant> = VecDeque::new();
    let mut restarts: u32 = 0;
    loop {
        match run_child(&shared, &mut ctl_rx, &mut proc).await {
            Outcome::Shutdown(reply) => {
                *lock(&shared.pid) = None;
                proc.graceful(&shared).await;
                shared.fail_all_pending();
                let _ = reply.send(());
                return;
            }
            Outcome::ClientsGone => {
                *lock(&shared.pid) = None;
                proc.graceful(&shared).await;
                return;
            }
            Outcome::Died => {
                *lock(&shared.pid) = None;
                proc.kill_and_reap().await;
                shared.fail_all_pending();
            }
        }
        // Reinicio con backoff y presupuesto acotado.
        let mut attempt: u32 = 0;
        proc = loop {
            let now = Instant::now();
            while history
                .front()
                .is_some_and(|t| now.duration_since(*t) > shared.config.restart_window)
            {
                history.pop_front();
            }
            if history.len() as u32 >= shared.config.max_restarts {
                let message = format!(
                    "acta-mac crashed {} times in {:?}; giving up",
                    history.len(),
                    shared.config.restart_window
                );
                tracing::error!("{message}");
                shared.publish(SidecarMessage::GaveUp { message });
                dead_mode(&shared, &mut ctl_rx).await;
                return;
            }
            let backoff = shared
                .config
                .restart_backoff
                .saturating_mul(2u32.saturating_pow(attempt))
                .min(MAX_BACKOFF);
            if let Some(stop) = sleep_serving(&shared, &mut ctl_rx, backoff).await {
                if let Some(reply) = stop {
                    let _ = reply.send(());
                }
                return;
            }
            history.push_back(Instant::now());
            attempt += 1;
            match spawn_and_hello(&shared).await {
                Ok(p) => break p,
                Err(e) => tracing::warn!("acta-mac restart failed: {e}"),
            }
        };
        restarts += 1;
        tracing::info!("acta-mac restarted ({restarts})");
        shared.publish(SidecarMessage::Restarted {
            at: SystemClock.now(),
            restarts,
        });
    }
}

/// Duerme `d` respondiendo `Unavailable` a los comandos que lleguen. Devuelve
/// `Some(reply?)` si hay que terminar (shutdown o clientes soltados).
async fn sleep_serving(
    shared: &Shared,
    ctl_rx: &mut mpsc::Receiver<Ctl>,
    d: Duration,
) -> Option<Option<oneshot::Sender<()>>> {
    let sleep = tokio::time::sleep(d);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            _ = &mut sleep => return None,
            msg = ctl_rx.recv() => match msg {
                Some(Ctl::Send { id, .. }) => { shared.take_pending(id); }
                Some(Ctl::Shutdown(reply)) => return Some(Some(reply)),
                None => return Some(None),
            },
        }
    }
}

/// Tras rendirse: todo falla rápido hasta `shutdown` o hasta soltar los handles.
async fn dead_mode(shared: &Shared, ctl_rx: &mut mpsc::Receiver<Ctl>) {
    while let Some(msg) = ctl_rx.recv().await {
        match msg {
            Ctl::Send { id, .. } => {
                shared.take_pending(id);
            }
            Ctl::Shutdown(reply) => {
                let _ = reply.send(());
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ProtocolError;

    #[test]
    fn command_names_come_from_the_wire_tag() {
        assert_eq!(command_name(&Command::CaptureStop), "capture.stop");
        assert_eq!(
            command_name(&Command::Hello(HelloArgs { protocol_version: 1 })),
            "hello"
        );
    }

    #[test]
    fn ok_without_result_is_empty_object() {
        let r = Response {
            id: 1,
            ok: true,
            result: None,
            error: None,
        };
        assert_eq!(response_into_result("x".into(), r).unwrap(), serde_json::json!({}));
    }

    #[test]
    fn invalid_args_maps_to_invalid_input() {
        let r = Response {
            id: 1,
            ok: false,
            result: None,
            error: Some(ProtocolError {
                code: ErrorCode::InvalidArgs,
                message: "bad".into(),
            }),
        };
        assert_eq!(
            response_into_result("x".into(), r),
            Err(PortError::InvalidInput("bad".into()))
        );
    }
}
