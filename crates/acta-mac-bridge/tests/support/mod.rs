//! Sidecar falso para los tests: un script `/bin/sh` que habla el protocolo
//! (docs/01-arquitectura.md §4). Cada test añade sus propias ramas `case`.
#![allow(dead_code)]

use acta_mac_bridge::client::{SidecarClient, SidecarConfig};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Respuesta OK con `result` JSON literal.
pub fn ok(result: &str) -> String {
    format!(r#"printf '{{"type":"response","id":%s,"ok":true,"result":{result}}}\n' "$id""#)
}

/// Respuesta de error.
pub fn err(code: &str, message: &str) -> String {
    format!(
        r#"printf '{{"type":"response","id":%s,"ok":false,"error":{{"code":"{code}","message":"{message}"}}}}\n' "$id""#
    )
}

/// Línea de evento con `data` JSON literal.
pub fn event(name: &str, data: &str) -> String {
    format!(r#"printf '{{"type":"event","ts":1700000000000,"event":"{name}","data":{data}}}\n'"#)
}

pub const HELLO_OK: &str = r#"{"sidecar_version":"fake","protocol_version":1,"macos_version":"26.0","capabilities":["process_tap"]}"#;

/// Escribe el script. `cases` son ramas extra de `case "$cmd" in ... esac`
/// (con `;;`). `$id`, `$cmd`, `$line` y `$DIR` (carpeta del test) están
/// disponibles. Cada arranque añade una línea a `$DIR/spawns`.
pub fn fake_sidecar(dir: &Path, cases: &str) -> PathBuf {
    fake_sidecar_with_hello(dir, &format!("{};;", ok(HELLO_OK)), cases)
}

pub fn fake_sidecar_with_hello(dir: &Path, hello: &str, cases: &str) -> PathBuf {
    let path = dir.join("fake-acta-mac.sh");
    let dir_s = dir.display();
    let unsupported = err("unsupported", "fake");
    let empty = ok("{}");
    let script = format!(
        r#"#!/bin/sh
DIR="{dir_s}"
echo "$$" >> "$DIR/spawns"
while IFS= read -r line; do
  id=${{line#*\"id\":}}; id=${{id%%,*}}; id=${{id%%\}}*}}
  cmd=${{line#*\"cmd\":\"}}; cmd=${{cmd%%\"*}}
  echo "$line" >> "$DIR/requests"
  case "$cmd" in
    hello) {hello}
{cases}
    shutdown) {empty}; exit 0;;
    *) {unsupported};;
  esac
done
exit 0
"#
    );
    std::fs::write(&path, script).expect("write fake");
    let mut perm = std::fs::metadata(&path).expect("meta").permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(&path, perm).expect("chmod");
    path
}

/// Se lanza como `/bin/sh <script>`: ejecutar un fichero recién creado
/// dispara el escaneo del EDR del portátil y puede tardar segundos.
pub fn config(script: PathBuf) -> SidecarConfig {
    SidecarConfig {
        binary: "/bin/sh".into(),
        args: vec![script.display().to_string()],
        command_timeout: Duration::from_secs(5),
        hello_timeout: Duration::from_secs(10),
        restart_backoff: Duration::from_millis(20),
        shutdown_grace: Duration::from_millis(500),
        ..SidecarConfig::default()
    }
}

pub async fn start(dir: &Path, cases: &str) -> SidecarClient {
    SidecarClient::start(config(fake_sidecar(dir, cases)))
        .await
        .expect("start fake sidecar")
}

/// Número de veces que se lanzó el sidecar falso.
pub fn spawns(dir: &Path) -> usize {
    std::fs::read_to_string(dir.join("spawns"))
        .map(|s| s.lines().count())
        .unwrap_or(0)
}

/// Peticiones recibidas por el sidecar falso (una línea JSON cada una).
pub fn requests(dir: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(dir.join("requests"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// `true` si el PID sigue existiendo (vivo O zombi).
pub async fn pid_exists(pid: u32) -> bool {
    let out = tokio::process::Command::new("/bin/ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .kill_on_drop(true)
        .output()
        .await
        .expect("ps");
    !String::from_utf8_lossy(&out.stdout).trim().is_empty()
}

/// Espera hasta que `f` sea cierto (máx. `ms`).
pub async fn eventually<F: FnMut() -> bool>(ms: u64, mut f: F) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
    while tokio::time::Instant::now() < deadline {
        if f() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    f()
}
