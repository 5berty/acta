//! Ayudas compartidas por las pruebas de `AppCore`.
//!
//! Los ajustes de fábrica van vacíos (sin nombre, sin proveedores: los pone
//! la bienvenida), así que cada prueba que necesita una instalación ya
//! configurada la construye aquí de forma explícita.
#![allow(dead_code)]

use acta_core::api::InstalledApp;
use acta_core::llm::{ProviderConfig, ProviderKind};
use acta_core::settings::Settings;
use acta_core::{PortError, PortResult};
use acta_desktop_lib::native::SystemInfo;
use async_trait::async_trait;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub fn claude_cli(enabled: bool) -> ProviderConfig {
    ProviderConfig {
        id: "claude-cli".into(),
        label: "Claude Code (CLI)".into(),
        enabled,
        kind: ProviderKind::ClaudeCli { binary_path: PathBuf::from("/opt/homebrew/bin/claude"), model: None, effort: None, extra_env: BTreeMap::new() },
        timeout_s: 600,
    }
}

pub fn openai_compatible(id: &str, label: &str, model: &str, enabled: bool) -> ProviderConfig {
    ProviderConfig {
        id: id.into(),
        label: label.into(),
        enabled,
        // Puerto 9 (discard): nunca hay nadie escuchando.
        kind: ProviderKind::OpenAiCompatible { base_url: "http://127.0.0.1:9/v1".into(), model: model.into(), api_key: None },
        timeout_s: 5,
    }
}

/// Una instalación que ya pasó por la bienvenida: nombre, castellano y
/// `claude-cli` activado para todo (más dos proveedores desactivados).
pub fn configured_settings() -> Settings {
    let mut s = Settings::default();
    s.user.display_name = "Ana".into();
    s.user.aliases = vec!["Ana García".into()];
    s.transcription.language = "es".into();
    s.onboarding.completed = true;
    s.llm.providers = vec![
        claude_cli(true),
        ProviderConfig {
            id: "codex-cli".into(),
            label: "Codex (CLI)".into(),
            enabled: false,
            kind: ProviderKind::CodexCli { binary_path: PathBuf::from("/opt/homebrew/bin/codex"), model: None, extra_env: BTreeMap::new() },
            timeout_s: 600,
        },
        openai_compatible("ollama", "Ollama (local)", "llama3.2", false),
    ];
    s.llm.minutes_provider = Some("claude-cli".into());
    s.llm.chat_provider = Some("claude-cli".into());
    s.llm.naming_provider = Some("claude-cli".into());
    s
}

/// macOS de mentira para `system_profile` y `apps_list`.
#[derive(Default)]
pub struct FakeSystem {
    pub full_name: Option<String>,
    pub languages: Vec<String>,
    pub apps: Vec<InstalledApp>,
    /// Carpetas de iconos que se pidieron.
    pub icon_dirs: Mutex<Vec<PathBuf>>,
    /// Simula un fallo del componente nativo.
    pub fail: bool,
}

#[async_trait]
impl SystemInfo for FakeSystem {
    async fn profile(&self) -> PortResult<(Option<String>, Vec<String>)> {
        if self.fail {
            return Err(PortError::Internal("sidecar caído".into()));
        }
        Ok((self.full_name.clone(), self.languages.clone()))
    }
    async fn installed_apps(&self, icons_dir: &Path) -> PortResult<Vec<InstalledApp>> {
        self.icon_dirs.lock().unwrap().push(icons_dir.to_path_buf());
        if self.fail {
            return Err(PortError::Internal("sidecar caído".into()));
        }
        Ok(self.apps.clone())
    }
}
