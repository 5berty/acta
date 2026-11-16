//! Detección de los CLI instalados. Las apps GUI no heredan el PATH del
//! shell, así que se pregunta a un shell de login (supervisado).
//! Si `claude` es un alias que fija variables (`CLAUDE_CONFIG_DIR=...`), se
//! devuelven también para guardarlas como `extra_env`.

use crate::process::run_supervised;
use acta_core::PortResult;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedCli {
    pub path: PathBuf,
    pub env: BTreeMap<String, String>,
}

/// `<shell> -lc 'command -v <name>'`. `Ok(None)` si no existe.
pub async fn detect_cli(shell: &Path, name: &str) -> PortResult<Option<DetectedCli>> {
    let mut cmd = Command::new(shell);
    cmd.arg("-lc").arg(format!("command -v {name}"));
    let out = run_supervised(cmd, None, Duration::from_secs(10)).await?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(parse_command_v(&String::from_utf8_lossy(&out.stdout)))
}

/// Interpreta la salida de `command -v`: ruta absoluta o definición de alias.
pub fn parse_command_v(output: &str) -> Option<DetectedCli> {
    for line in output.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('/') && !line.contains(' ') {
            return Some(DetectedCli { path: line.into(), env: BTreeMap::new() });
        }
        // `alias claude='CLAUDE_CONFIG_DIR=/x /abs/claude'` (zsh) o `claude=...` (bash `alias`).
        let def = line.strip_prefix("alias ").unwrap_or(line);
        if let Some((_, value)) = def.split_once('=') {
            // El valor del alias va entrecomillado: se quita un nivel y se vuelve a trocear.
            let mut words = shell_words(value);
            if let [single] = words.as_slice() {
                words = shell_words(single);
            }
            let mut env = BTreeMap::new();
            let mut path = None;
            for w in words {
                if path.is_none()
                    && let Some((k, v)) = w.split_once('=')
                    && !k.is_empty()
                    && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                {
                    env.insert(k.to_owned(), v.to_owned());
                } else if path.is_none() && w.starts_with('/') {
                    path = Some(PathBuf::from(w));
                }
            }
            if let Some(path) = path {
                return Some(DetectedCli { path, env });
            }
        }
    }
    None
}

/// Troceo estilo shell mínimo: comillas simples/dobles y barra invertida.
fn shell_words(s: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote: Option<char> = None;
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some('"'), '\\') => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            (Some(_), c) => cur.push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                in_word = true;
            }
            (None, '\\') => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                    in_word = true;
                }
            }
            (None, c) if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut cur));
                    in_word = false;
                }
            }
            (None, c) => {
                cur.push(c);
                in_word = true;
            }
        }
    }
    if in_word {
        words.push(cur);
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::fake_script;

    #[test]
    fn plain_path() {
        let d = parse_command_v("/opt/homebrew/bin/claude\n").expect("detected");
        assert_eq!(d.path, PathBuf::from("/opt/homebrew/bin/claude"));
        assert!(d.env.is_empty());
    }

    #[test]
    fn alias_with_env_assignment() {
        let d = parse_command_v("alias claude='CLAUDE_CONFIG_DIR=\"/Users/e/My Dir/.claude\" /Users/e/.local/bin/claude'\n").expect("detected");
        assert_eq!(d.path, PathBuf::from("/Users/e/.local/bin/claude"));
        assert_eq!(d.env.get("CLAUDE_CONFIG_DIR").map(String::as_str), Some("/Users/e/My Dir/.claude"));
    }

    #[test]
    fn noise_before_path_and_not_found() {
        assert_eq!(parse_command_v("Welcome!\n/usr/local/bin/codex\n").expect("d").path, PathBuf::from("/usr/local/bin/codex"));
        assert!(parse_command_v("").is_none());
        assert!(parse_command_v("claude: not found").is_none());
    }

    #[tokio::test]
    async fn runs_shell_supervised() {
        let dir = tempfile::tempdir().expect("dir");
        // Shell falso: ignora -lc y "encuentra" el binario.
        let shell = fake_script(dir.path(), "fakeshell", "echo /fake/bin/claude\n");
        let d = detect_cli(&shell, "claude").await.expect("ok").expect("found");
        assert_eq!(d.path, PathBuf::from("/fake/bin/claude"));
        let none = fake_script(dir.path(), "emptyshell", "exit 1\n");
        assert!(detect_cli(&none, "claude").await.expect("ok").is_none());
    }
}
