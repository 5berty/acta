//! Ajustes del usuario. Se guardan como JSON en la tabla `settings` (clave
//! "app"). Todos los campos tienen valor por defecto (`#[serde(default)]`)
//! para que añadir campos no rompa ajustes ya guardados.

use crate::detection::{AppRule, Platform};
use crate::ids::ProviderId;
use crate::llm::{ProviderConfig, ProviderKind};
use crate::minutes::UserIdentity;
use crate::recording::{AutoStopConfig, HealthConfig};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub user: UserIdentity,
    pub recording: RecordingSettings,
    pub auto_stop: AutoStopConfig,
    pub health: HealthConfig,
    pub detection: DetectionSettings,
    pub screen: ScreenSettings,
    pub transcription: TranscriptionSettings,
    pub llm: LlmSettings,
    pub embeddings: EmbeddingSettings,
    /// Bienvenida de primer arranque: la UI la marca al terminarla o saltarla.
    pub onboarding: OnboardingSettings,
    /// Sugerencias de borrado de reuniones antiguas (nunca borra sola).
    pub cleanup: CleanupSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CleanupSettings {
    /// Enseñar el aviso «Tienes N reuniones antiguas…».
    pub enabled: bool,
    /// Antigüedad mínima (días) para sugerir una reunión.
    pub min_age_days: u32,
    /// «Recordármelo más tarde»: el aviso no vuelve hasta esta fecha.
    pub snoozed_until: Option<crate::time::UnixMs>,
}

impl Default for CleanupSettings {
    fn default() -> Self {
        Self { enabled: true, min_age_days: 90, snoozed_until: None }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OnboardingSettings {
    pub completed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecordingSettings {
    pub segment_seconds: u32,
    pub frame_ms: u32,
    /// UID del micro. `None` = el de por defecto del sistema.
    pub mic_device_uid: Option<String>,
    /// Borrar segmentos tras concatenar con éxito.
    pub delete_segments_after_concat: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DetectionSettings {
    pub enabled: bool,
    pub rules: Vec<AppRule>,
    pub meet_url_patterns: Vec<String>,
    /// Si la pregunta "¿Grabar?" no se contesta en este tiempo, se cierra.
    pub start_prompt_timeout_s: u32,
    pub poll_ms: u32,
    pub debounce_ms: u32,
    /// Bundle ids que NUNCA disparan la detección aunque usen el micro
    /// (apps de dictado como Typeless u Orca). Se aplica antes que `rules`.
    pub denylist: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScreenSettings {
    /// Opt-in: requiere permiso de Grabación de pantalla.
    pub enabled: bool,
    pub fps: f32,
    pub phash_threshold: u32,
    pub stable_frames: u32,
    pub candidate_every_s: u32,
    pub ring_seconds: u32,
    pub max_width: u32,
    /// Palabras clave que disparan captura (minúsculas, sin acentos al comparar).
    pub keywords: Vec<String>,
    /// Borrar candidatas no promovidas al terminar el procesado.
    pub prune_candidates: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TranscriptionSettings {
    pub language: String,
    pub diarization: bool,
    /// Previsualización en vivo (gasta ANE/CPU durante la llamada).
    pub live_preview: bool,
    /// Umbral coseno para reconocer una huella de voz.
    pub voiceprint_min_similarity_pct: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmSettings {
    pub providers: Vec<ProviderConfig>,
    /// Proveedor para resumen/tareas/escaleta.
    pub minutes_provider: Option<ProviderId>,
    /// Proveedor para el chat.
    pub chat_provider: Option<ProviderId>,
    /// Proveedor para nombrar grupos.
    pub naming_provider: Option<ProviderId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EmbeddingSettings {
    /// Id fastembed. Por defecto multilingual-e5-small (384 dims).
    pub model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            user: UserIdentity {
                display_name: "Edu".into(),
                aliases: vec!["Eduardo".into(), "Edu Navajas".into()],
            },
            recording: RecordingSettings::default(),
            auto_stop: AutoStopConfig::default(),
            health: HealthConfig::default(),
            detection: DetectionSettings::default(),
            screen: ScreenSettings::default(),
            transcription: TranscriptionSettings::default(),
            llm: LlmSettings::default(),
            embeddings: EmbeddingSettings::default(),
            onboarding: OnboardingSettings::default(),
            cleanup: CleanupSettings::default(),
        }
    }
}

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            segment_seconds: 30,
            frame_ms: 100,
            mic_device_uid: None,
            delete_segments_after_concat: false,
        }
    }
}

impl Default for DetectionSettings {
    fn default() -> Self {
        let rule = |bundle_id: &str, platform, is_browser| AppRule {
            bundle_id: bundle_id.into(),
            platform,
            is_browser,
        };
        Self {
            enabled: true,
            rules: vec![
                rule("com.microsoft.teams2", Platform::Teams, false),
                rule("com.microsoft.teams", Platform::Teams, false),
                rule("com.google.Chrome", Platform::Meet, true),
                rule("company.thebrowser.Browser", Platform::Meet, true),
                rule("com.microsoft.edgemac", Platform::Meet, true),
                rule("com.apple.Safari", Platform::Meet, true),
            ],
            meet_url_patterns: vec!["meet.google.com/".into()],
            start_prompt_timeout_s: 90,
            poll_ms: 1_000,
            debounce_ms: 3_000,
            denylist: Vec::new(),
        }
    }
}

impl Default for ScreenSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            fps: 1.0,
            phash_threshold: 10,
            stable_frames: 2,
            candidate_every_s: 30,
            ring_seconds: 20,
            max_width: 1920,
            keywords: [
                "importante",
                "apuntad",
                "apunta",
                "esto es clave",
                "clave",
                "fecha",
                "plazo",
                "deadline",
                "important",
                "key point",
                "take note",
                "due date",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
            prune_candidates: true,
        }
    }
}

impl Default for TranscriptionSettings {
    fn default() -> Self {
        Self {
            language: "es".into(),
            diarization: true,
            live_preview: false,
            voiceprint_min_similarity_pct: 75,
        }
    }
}

impl Default for LlmSettings {
    fn default() -> Self {
        let claude = ProviderConfig {
            id: "claude-cli".into(),
            label: "Claude Code (CLI)".into(),
            enabled: true,
            kind: ProviderKind::ClaudeCli {
                binary_path: PathBuf::from("/opt/homebrew/bin/claude"),
                model: None,
                effort: None,
                extra_env: BTreeMap::new(),
            },
            timeout_s: 600,
        };
        let codex = ProviderConfig {
            id: "codex-cli".into(),
            label: "Codex (CLI)".into(),
            enabled: false,
            kind: ProviderKind::CodexCli {
                binary_path: PathBuf::from("/opt/homebrew/bin/codex"),
                model: None,
                extra_env: BTreeMap::new(),
            },
            timeout_s: 600,
        };
        let ollama = ProviderConfig {
            id: "ollama".into(),
            label: "Ollama (local)".into(),
            enabled: false,
            kind: ProviderKind::OpenAiCompatible {
                base_url: "http://localhost:11434/v1".into(),
                model: "qwen2.5:14b".into(),
                api_key: None,
            },
            timeout_s: 600,
        };
        Self {
            providers: vec![claude, codex, ollama],
            minutes_provider: Some("claude-cli".into()),
            chat_provider: Some("claude-cli".into()),
            naming_provider: Some("claude-cli".into()),
        }
    }
}

impl Default for EmbeddingSettings {
    fn default() -> Self {
        Self {
            model: "intfloat/multilingual-e5-small".into(),
        }
    }
}
