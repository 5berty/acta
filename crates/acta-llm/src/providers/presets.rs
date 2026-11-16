//! Proveedores con nombre propio que acta ofrece ya rellenos. Todos hablan el
//! protocolo de OpenAI, así que usan el adaptador `OpenAiCompatibleProvider`.
//! La UI tiene su espejo en `apps/desktop/src/features/providers/presets.ts`.

/// Un servidor conocido: basta con la clave (o nada, si es local).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Preset {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: &'static str,
    /// Modelo que se propone al crearlo (vacío: se elige de la lista).
    pub default_model: &'static str,
    pub needs_api_key: bool,
    /// Corre en este Mac: nada sale del equipo.
    pub local: bool,
}

pub const OLLAMA: Preset = Preset {
    id: "ollama",
    label: "Ollama",
    base_url: "http://127.0.0.1:11434/v1",
    default_model: "",
    needs_api_key: false,
    local: true,
};

pub const LM_STUDIO: Preset = Preset {
    id: "lmstudio",
    label: "LM Studio",
    base_url: "http://127.0.0.1:1234/v1",
    default_model: "",
    needs_api_key: false,
    local: true,
};

/// NaN Builders (verificado el 16-nov-2026 en nan.builders/openapi.json):
/// API compatible con OpenAI. `gemma4` no consume cuota, por eso es el de
/// partida para las actas.
pub const NAN_BUILDERS: Preset = Preset {
    id: "nan",
    label: "NaN Builders",
    base_url: "https://api.nan.builders/v1",
    default_model: "gemma4",
    needs_api_key: true,
    local: false,
};

pub const OPENROUTER: Preset = Preset {
    id: "openrouter",
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    default_model: "",
    needs_api_key: true,
    local: false,
};

pub const OPENAI: Preset = Preset {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    default_model: "",
    needs_api_key: true,
    local: false,
};

pub const ALL: [Preset; 5] = [OLLAMA, LM_STUDIO, NAN_BUILDERS, OPENROUTER, OPENAI];

/// El preset al que pertenece una URL base (sin importar barra final ni
/// `localhost` frente a `127.0.0.1`).
pub fn preset_for_base_url(base_url: &str) -> Option<Preset> {
    let norm = |u: &str| u.trim().trim_end_matches('/').to_lowercase().replace("//localhost", "//127.0.0.1");
    let wanted = norm(base_url);
    ALL.into_iter().find(|p| norm(p.base_url) == wanted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_unique_and_only_remote_ones_need_a_key() {
        for (i, a) in ALL.iter().enumerate() {
            assert!(a.base_url.ends_with("/v1"), "{}", a.base_url);
            assert_eq!(a.needs_api_key, !a.local, "{}", a.id);
            assert!(ALL.iter().skip(i + 1).all(|b| b.id != a.id && b.base_url != a.base_url));
        }
    }

    #[test]
    fn nan_builders_points_at_its_openai_compatible_api_with_an_unmetered_model() {
        assert_eq!(NAN_BUILDERS.base_url, "https://api.nan.builders/v1");
        assert_eq!(NAN_BUILDERS.default_model, "gemma4");
    }

    #[test]
    fn recognises_a_preset_from_a_base_url_however_it_is_written() {
        assert_eq!(preset_for_base_url("http://localhost:11434/v1/").map(|p| p.id), Some("ollama"));
        assert_eq!(preset_for_base_url("http://127.0.0.1:1234/v1").map(|p| p.id), Some("lmstudio"));
        assert_eq!(preset_for_base_url(" https://API.nan.builders/v1 ").map(|p| p.id), Some("nan"));
        assert_eq!(preset_for_base_url("https://openrouter.ai/api/v1").map(|p| p.id), Some("openrouter"));
        assert_eq!(preset_for_base_url("https://example.com/v1"), None);
    }
}
