//! Descarga reanudable con verificación SHA-256.
//!
//! - Escribe en `<destino>.part`; si ya hay un trozo, pide el resto con
//!   `Range: bytes=<n>-`. Si el servidor ignora el rango (200), empieza de cero.
//! - Al terminar calcula el SHA-256 del fichero entero. Si no coincide, borra
//!   el `.part` (no se puede reanudar algo corrupto) y falla.
//! - Solo con el hash correcto se renombra a `<destino>`: un fichero con el
//!   nombre final está siempre completo y verificado.
//! - Cancelar deja el `.part` para reanudar después.

use crate::providers::http::{map_reqwest, map_status};
use acta_core::{PortError, PortResult};
use futures::StreamExt;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

/// Sin un solo byte en este tiempo, la descarga se da por caída (el `.part` queda).
pub const STALL_TIMEOUT: Duration = Duration::from_secs(60);
const PROGRESS_EVERY: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadSpec {
    pub url: String,
    pub dest: PathBuf,
    /// Hex en minúsculas.
    pub sha256: String,
    /// Tamaño esperado, si se conoce de antemano.
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub received: u64,
    /// 0 si el servidor no dijo el tamaño.
    pub total: u64,
    /// Ya está todo en disco y se está calculando el SHA-256.
    pub verifying: bool,
}

/// Bandera de cancelación compartida entre la descarga y quien la pide.
#[derive(Debug, Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// `<destino>.part`.
pub fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    dest.with_file_name(name)
}

/// SHA-256 (hex) de un fichero, leyendo por bloques.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

async fn file_len(path: &Path) -> u64 {
    tokio::fs::metadata(path).await.map_or(0, |m| m.len())
}

/// Inicio del rango que devuelve el servidor: `bytes 100-199/200` → 100.
fn content_range_start(resp: &reqwest::Response) -> Option<u64> {
    let v = resp.headers().get(reqwest::header::CONTENT_RANGE)?.to_str().ok()?;
    v.trim().strip_prefix("bytes ")?.split('-').next()?.trim().parse().ok()
}

/// Descarga `spec.url` en `spec.dest`. Devuelve `Ok` solo con el fichero
/// completo y verificado. `PortError::Cancelled` si se canceló.
pub async fn download(
    client: &reqwest::Client,
    spec: &DownloadSpec,
    cancel: &CancelFlag,
    progress: &(dyn Fn(Progress) + Send + Sync),
) -> PortResult<()> {
    if tokio::fs::metadata(&spec.dest).await.is_ok() {
        return Ok(());
    }
    if let Some(dir) = spec.dest.parent() {
        tokio::fs::create_dir_all(dir).await?;
    }
    let part = part_path(&spec.dest);
    let mut existing = file_len(&part).await;
    if spec.size_bytes.is_some_and(|size| existing > size) {
        tokio::fs::remove_file(&part).await?;
        existing = 0;
    }
    let complete = spec.size_bytes.is_some_and(|size| size > 0 && existing == size);
    if !complete {
        fetch(client, spec, &part, existing, cancel, progress).await?;
    }

    let total = file_len(&part).await;
    progress(Progress { received: total, total, verifying: true });
    let to_hash = part.clone();
    let actual = tokio::task::spawn_blocking(move || sha256_file(&to_hash))
        .await
        .map_err(|e| PortError::Internal(format!("join: {e}")))??;
    if !actual.eq_ignore_ascii_case(spec.sha256.trim()) {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(PortError::InvalidResponse(format!(
            "la descarga está dañada (el SHA-256 no coincide: esperado {}, obtenido {actual}). Se ha borrado; vuelve a descargar.",
            spec.sha256
        )));
    }
    tokio::fs::rename(&part, &spec.dest).await?;
    Ok(())
}

async fn fetch(
    client: &reqwest::Client,
    spec: &DownloadSpec,
    part: &Path,
    mut existing: u64,
    cancel: &CancelFlag,
    progress: &(dyn Fn(Progress) + Send + Sync),
) -> PortResult<()> {
    let url = spec.url.as_str();
    let send = |from: u64| {
        let mut rb = client.get(url);
        if from > 0 {
            rb = rb.header(reqwest::header::RANGE, format!("bytes={from}-"));
        }
        async move {
            tokio::time::timeout(STALL_TIMEOUT, rb.send())
                .await
                .map_err(|_| PortError::Timeout(format!("{url} no respondió a tiempo")))?
                .map_err(|e| map_reqwest(url, e))
        }
    };
    let mut resp = send(existing).await?;
    if resp.status().as_u16() == 416 {
        // El trozo no vale para este fichero: de cero.
        existing = 0;
        resp = send(0).await?;
    }
    let status = resp.status().as_u16();
    let append = match status {
        206 if content_range_start(&resp) == Some(existing) => true,
        200 | 206 => false,
        _ => {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_status(status, &body));
        }
    };
    if !append {
        if status == 206 {
            // Rango inesperado: se pide el fichero entero.
            resp = send(0).await?;
            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                return Err(map_status(status, &resp.text().await.unwrap_or_default()));
            }
        }
        existing = 0;
    }
    let total = resp.content_length().map(|len| existing + len).or(spec.size_bytes).unwrap_or(0);

    let mut file = tokio::fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(part).await?;
    let mut received = existing;
    progress(Progress { received, total, verifying: false });
    let mut last_report = Instant::now();
    let mut stream = resp.bytes_stream();
    let result: PortResult<()> = loop {
        if cancel.is_cancelled() {
            break Err(PortError::Cancelled);
        }
        let chunk = match tokio::time::timeout(STALL_TIMEOUT, stream.next()).await {
            Err(_) => break Err(PortError::Timeout(format!("la descarga de {url} se quedó parada"))),
            Ok(None) => break Ok(()),
            Ok(Some(Err(e))) => break Err(PortError::Unavailable(format!("la descarga se cortó: {e}. Se reanudará donde se quedó."))),
            Ok(Some(Ok(c))) => c,
        };
        if let Err(e) = file.write_all(&chunk).await {
            break Err(e.into());
        }
        received += chunk.len() as u64;
        if last_report.elapsed() >= PROGRESS_EVERY {
            last_report = Instant::now();
            progress(Progress { received, total, verifying: false });
        }
    };
    // Lo escrito queda en disco pase lo que pase: es lo que se reanuda.
    file.flush().await?;
    file.sync_all().await?;
    drop(file);
    result?;
    progress(Progress { received, total, verifying: false });
    if total > 0 && received != total {
        return Err(PortError::Unavailable(format!(
            "la descarga se cortó ({received} de {total} bytes). Se reanudará donde se quedó."
        )));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod testing {
    //! Servidor de ficheros de mentira con soporte de `Range`.
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[derive(Debug, Clone, Default)]
    pub struct FileServerOptions {
        /// La PRIMERA petición corta la conexión tras enviar estos bytes de cuerpo.
        pub cut_first_after: Option<usize>,
        /// Ignora `Range` y responde siempre 200 con el fichero entero.
        pub ignore_range: bool,
        /// Responde siempre este estado.
        pub status: Option<u16>,
        /// Pausa entre trozos de 16 KiB (para cancelar a mitad).
        pub chunk_delay_ms: u64,
    }

    pub struct FileServer {
        pub url: String,
        /// Valor de `Range` de cada petición (`None` si no lo llevaba).
        pub ranges: Arc<Mutex<Vec<Option<String>>>>,
    }

    impl FileServer {
        pub async fn start(body: Vec<u8>, opts: FileServerOptions) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
            let url = format!("http://{}/file.bin", listener.local_addr().expect("addr"));
            let ranges: Arc<Mutex<Vec<Option<String>>>> = Arc::default();
            let rec = ranges.clone();
            let body = Arc::new(body);
            tokio::spawn(async move {
                loop {
                    let Ok((mut sock, _)) = listener.accept().await else { break };
                    let (rec, body, opts) = (rec.clone(), body.clone(), opts.clone());
                    tokio::spawn(async move {
                        let mut buf = Vec::new();
                        let mut tmp = [0u8; 4096];
                        while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                            match sock.read(&mut tmp).await {
                                Ok(n) if n > 0 => buf.extend_from_slice(&tmp[..n]),
                                _ => return,
                            }
                        }
                        let head = String::from_utf8_lossy(&buf).to_lowercase();
                        let range = head.lines().find_map(|l| l.strip_prefix("range:")).map(|v| v.trim().to_owned());
                        let first = {
                            let mut r = rec.lock().expect("lock");
                            r.push(range.clone());
                            r.len() == 1
                        };
                        if let Some(status) = opts.status {
                            let _ = sock.write_all(format!("HTTP/1.1 {status} X\r\ncontent-length: 4\r\nconnection: close\r\n\r\nnope").as_bytes()).await;
                            return;
                        }
                        let from = range
                            .as_deref()
                            .filter(|_| !opts.ignore_range)
                            .and_then(|r| r.strip_prefix("bytes=")?.trim_end_matches('-').parse::<usize>().ok());
                        let (status_line, slice, extra) = match from {
                            Some(f) if f >= body.len() => ("416 Range Not Satisfiable", &body[..0], format!("content-range: bytes */{}\r\n", body.len())),
                            Some(f) => ("206 Partial Content", &body[f..], format!("content-range: bytes {f}-{}/{}\r\n", body.len() - 1, body.len())),
                            None => ("200 OK", &body[..], String::new()),
                        };
                        let head = format!("HTTP/1.1 {status_line}\r\ncontent-length: {}\r\n{extra}connection: close\r\n\r\n", slice.len());
                        if sock.write_all(head.as_bytes()).await.is_err() {
                            return;
                        }
                        let limit = if first { opts.cut_first_after.unwrap_or(usize::MAX) } else { usize::MAX };
                        let mut sent = 0usize;
                        for chunk in slice.chunks(16 * 1024) {
                            if sent >= limit {
                                return; // corta sin terminar el cuerpo
                            }
                            let take = chunk.len().min(limit - sent);
                            if sock.write_all(&chunk[..take]).await.is_err() {
                                return;
                            }
                            let _ = sock.flush().await;
                            sent += take;
                            if opts.chunk_delay_ms > 0 {
                                tokio::time::sleep(std::time::Duration::from_millis(opts.chunk_delay_ms)).await;
                            }
                        }
                        let _ = sock.shutdown().await;
                    });
                }
            });
            Self { url, ranges }
        }

        pub fn ranges(&self) -> Vec<Option<String>> {
            self.ranges.lock().expect("lock").clone()
        }
    }

    /// Bytes deterministas que no se repiten cada pocos KiB.
    pub fn payload(len: usize) -> Vec<u8> {
        (0..len).map(|i| ((i * 31 + i / 251) % 256) as u8).collect()
    }

    pub fn sha256_hex(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;
    use std::sync::Mutex;

    struct Rig {
        _dir: tempfile::TempDir,
        spec: DownloadSpec,
        body: Vec<u8>,
        seen: Arc<Mutex<Vec<Progress>>>,
    }

    fn rig(url: &str, body: &[u8]) -> Rig {
        let dir = tempfile::tempdir().expect("tmp");
        let spec = DownloadSpec {
            url: url.to_owned(),
            dest: dir.path().join("models").join("m.gguf"),
            sha256: sha256_hex(body),
            size_bytes: Some(body.len() as u64),
        };
        Rig { _dir: dir, spec, body: body.to_vec(), seen: Arc::default() }
    }

    async fn run(r: &Rig, cancel: &CancelFlag) -> PortResult<()> {
        let seen = r.seen.clone();
        download(&reqwest::Client::new(), &r.spec, cancel, &move |p| seen.lock().expect("lock").push(p)).await
    }

    #[tokio::test]
    async fn downloads_verifies_and_renames() {
        let body = payload(300_000);
        let srv = FileServer::start(body.clone(), FileServerOptions::default()).await;
        let r = rig(&srv.url, &body);
        run(&r, &CancelFlag::default()).await.expect("download");
        assert_eq!(std::fs::read(&r.spec.dest).expect("dest"), r.body);
        assert!(!part_path(&r.spec.dest).exists());
        assert_eq!(srv.ranges(), vec![None]);
        let seen = r.seen.lock().expect("lock");
        assert_eq!(seen.first().copied(), Some(Progress { received: 0, total: 300_000, verifying: false }));
        assert_eq!(seen.last().copied(), Some(Progress { received: 300_000, total: 300_000, verifying: true }));
        assert!(seen.windows(2).all(|w| w[0].received <= w[1].received));
    }

    #[tokio::test]
    async fn a_finished_file_is_not_downloaded_again() {
        let srv = FileServer::start(vec![], FileServerOptions { status: Some(500), ..Default::default() }).await;
        let r = rig(&srv.url, b"hola");
        std::fs::create_dir_all(r.spec.dest.parent().expect("dir")).expect("mkdir");
        std::fs::write(&r.spec.dest, b"hola").expect("write");
        run(&r, &CancelFlag::default()).await.expect("download");
        assert!(srv.ranges().is_empty());
    }

    #[tokio::test]
    async fn a_dropped_connection_keeps_the_part_and_the_next_run_resumes_with_range() {
        let body = payload(400_000);
        let srv = FileServer::start(body.clone(), FileServerOptions { cut_first_after: Some(100_000), ..Default::default() }).await;
        let r = rig(&srv.url, &body);
        let err = run(&r, &CancelFlag::default()).await.expect_err("cut");
        assert!(matches!(&err, PortError::Unavailable(m) if m.contains("Se reanudará")), "{err}");
        let part = part_path(&r.spec.dest);
        let kept = std::fs::metadata(&part).expect("part").len();
        assert!(kept > 0 && kept < 400_000, "{kept}");
        assert!(!r.spec.dest.exists());

        run(&r, &CancelFlag::default()).await.expect("resume");
        assert_eq!(std::fs::read(&r.spec.dest).expect("dest"), r.body);
        assert_eq!(srv.ranges(), vec![None, Some(format!("bytes={kept}-"))]);
        // El progreso de la reanudación empieza donde se quedó, no en cero.
        let resumed_from = r.seen.lock().expect("lock").iter().rev().find(|p| p.received == kept).copied();
        assert_eq!(resumed_from.map(|p| p.total), Some(400_000));
    }

    #[tokio::test]
    async fn a_server_without_range_support_starts_over() {
        let body = payload(120_000);
        let srv = FileServer::start(body.clone(), FileServerOptions { ignore_range: true, ..Default::default() }).await;
        let r = rig(&srv.url, &body);
        std::fs::create_dir_all(r.spec.dest.parent().expect("dir")).expect("mkdir");
        std::fs::write(part_path(&r.spec.dest), vec![0xAA; 50_000]).expect("part");
        run(&r, &CancelFlag::default()).await.expect("download");
        assert_eq!(std::fs::read(&r.spec.dest).expect("dest"), r.body);
        assert_eq!(srv.ranges(), vec![Some("bytes=50000-".into())]);
    }

    #[tokio::test]
    async fn a_complete_part_is_only_verified() {
        let body = payload(50_000);
        let srv = FileServer::start(body.clone(), FileServerOptions { status: Some(500), ..Default::default() }).await;
        let r = rig(&srv.url, &body);
        std::fs::create_dir_all(r.spec.dest.parent().expect("dir")).expect("mkdir");
        std::fs::write(part_path(&r.spec.dest), &body).expect("part");
        run(&r, &CancelFlag::default()).await.expect("verify only");
        assert!(srv.ranges().is_empty() && r.spec.dest.exists());
    }

    #[tokio::test]
    async fn a_part_bigger_than_the_file_is_discarded() {
        let body = payload(20_000);
        let srv = FileServer::start(body.clone(), FileServerOptions::default()).await;
        let r = rig(&srv.url, &body);
        std::fs::create_dir_all(r.spec.dest.parent().expect("dir")).expect("mkdir");
        std::fs::write(part_path(&r.spec.dest), vec![1u8; 30_000]).expect("part");
        run(&r, &CancelFlag::default()).await.expect("download");
        assert_eq!(std::fs::read(&r.spec.dest).expect("dest"), r.body);
        assert_eq!(srv.ranges(), vec![None]);
    }

    #[tokio::test]
    async fn a_bad_checksum_deletes_the_download_and_never_leaves_a_final_file() {
        let body = payload(80_000);
        let srv = FileServer::start(body.clone(), FileServerOptions::default()).await;
        let mut r = rig(&srv.url, &body);
        r.spec.sha256 = "0".repeat(64);
        let err = run(&r, &CancelFlag::default()).await.expect_err("checksum");
        assert!(matches!(&err, PortError::InvalidResponse(m) if m.contains("SHA-256")), "{err}");
        assert!(!r.spec.dest.exists());
        assert!(!part_path(&r.spec.dest).exists(), "un fichero corrupto no se reanuda");
    }

    #[tokio::test]
    async fn a_corrupt_resumed_part_fails_the_checksum_and_then_downloads_clean() {
        let body = payload(90_000);
        let srv = FileServer::start(body.clone(), FileServerOptions::default()).await;
        let r = rig(&srv.url, &body);
        std::fs::create_dir_all(r.spec.dest.parent().expect("dir")).expect("mkdir");
        std::fs::write(part_path(&r.spec.dest), vec![0xEE; 10_000]).expect("part");
        assert!(matches!(run(&r, &CancelFlag::default()).await, Err(PortError::InvalidResponse(_))));
        run(&r, &CancelFlag::default()).await.expect("clean download");
        assert_eq!(std::fs::read(&r.spec.dest).expect("dest"), r.body);
    }

    #[tokio::test]
    async fn cancelling_stops_and_keeps_the_part_for_later() {
        let body = payload(600_000);
        let srv = FileServer::start(body.clone(), FileServerOptions { chunk_delay_ms: 15, ..Default::default() }).await;
        let r = rig(&srv.url, &body);
        let cancel = CancelFlag::default();
        let c2 = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(120)).await;
            c2.cancel();
        });
        assert_eq!(run(&r, &cancel).await, Err(PortError::Cancelled));
        let kept = std::fs::metadata(part_path(&r.spec.dest)).expect("part").len();
        assert!(kept > 0 && kept < 600_000, "{kept}");
        assert!(!r.spec.dest.exists());
    }

    #[tokio::test]
    async fn http_errors_and_unreachable_servers_are_explained() {
        let srv = FileServer::start(vec![], FileServerOptions { status: Some(404), ..Default::default() }).await;
        let r = rig(&srv.url, b"x");
        assert!(matches!(run(&r, &CancelFlag::default()).await, Err(PortError::Unavailable(m)) if m.contains("404")));
        let r = rig("http://127.0.0.1:1/file.bin", b"x");
        assert!(matches!(run(&r, &CancelFlag::default()).await, Err(PortError::Unavailable(m)) if m.contains("127.0.0.1:1")));
    }

    #[test]
    fn part_path_appends_the_suffix_to_the_whole_name() {
        assert_eq!(part_path(Path::new("/m/Qwen3.5-2B-Q4_K_M.gguf")), Path::new("/m/Qwen3.5-2B-Q4_K_M.gguf.part"));
    }
}
