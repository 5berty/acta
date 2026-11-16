//! Modelo local integrado (opcional): catálogo de modelos GGUF y recomendación
//! según el hardware. Lógica pura; la descarga y el servidor viven en
//! `acta-llm::local`.
//!
//! Los modelos son Qwen3.5 (Apache-2.0) cuantizados a Q4_K_M por Unsloth,
//! fijados a una revisión concreta de Hugging Face y a su SHA-256 (verificados
//! el 16-nov-2026). Se ejecutan con `llama-server` (llama.cpp, Metal).

use serde::{Deserialize, Serialize};

pub const GIB: u64 = 1024 * 1024 * 1024;
/// Id del proveedor que la UI crea para el modelo integrado.
pub const BUILTIN_PROVIDER_ID: &str = "builtin";
/// Espacio que debe quedar libre DESPUÉS de descargar (el watchdog de
/// grabación avisa por debajo de 1 GB).
pub const DISK_MARGIN_BYTES: u64 = 2 * GIB;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelTier {
    /// ≈ 2 B de parámetros: cualquier Mac.
    Tiny,
    /// ≈ 4 B.
    Medium,
    /// ≈ 9 B: la mejor calidad en castellano.
    Large,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    /// Id estable: es el `modelId` de `ProviderKind::BuiltIn`.
    pub id: String,
    pub tier: ModelTier,
    /// "Qwen3.5 2B".
    pub name: String,
    pub params: String,
    pub quant: String,
    /// Repositorio de Hugging Face.
    pub repo: String,
    pub file: String,
    /// Commit del repositorio (la descarga no cambia aunque el repo se actualice).
    pub revision: String,
    /// URL de descarga directa.
    pub url: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub license: String,
    pub license_url: String,
    /// Por debajo de esto no se ofrece.
    pub min_ram_gb: u32,
    /// A partir de esto va holgado y se puede recomendar.
    pub comfortable_ram_gb: u32,
    /// Memoria que ocupa en marcha (pesos + contexto), aproximada.
    pub ram_needed_bytes: u64,
    /// Contexto con el que se arranca el servidor.
    pub context_tokens: u32,
    /// Tokens/s de referencia en un M1 base (ver `expected_tokens_per_s`).
    pub base_tokens_per_s: u32,
    pub description: String,
}

fn qwen35(
    tier: ModelTier,
    params: &str,
    (revision, size_bytes, sha256): (&str, u64, &str),
    (min_ram_gb, comfortable_ram_gb, ram_needed_gb10): (u32, u32, u64),
    (context_tokens, base_tokens_per_s): (u32, u32),
    description: &str,
) -> LocalModel {
    let repo = format!("unsloth/Qwen3.5-{params}-GGUF");
    let file = format!("Qwen3.5-{params}-Q4_K_M.gguf");
    LocalModel {
        id: format!("qwen3.5-{}-q4_k_m", params.to_lowercase()),
        tier,
        name: format!("Qwen3.5 {params}"),
        params: params.into(),
        quant: "Q4_K_M".into(),
        url: format!("https://huggingface.co/{repo}/resolve/{revision}/{file}"),
        repo,
        file,
        revision: revision.into(),
        size_bytes,
        sha256: sha256.into(),
        license: "Apache-2.0".into(),
        license_url: format!("https://huggingface.co/Qwen/Qwen3.5-{params}"),
        min_ram_gb,
        comfortable_ram_gb,
        ram_needed_bytes: ram_needed_gb10 * GIB / 10,
        context_tokens,
        base_tokens_per_s,
        description: description.into(),
    }
}

/// Los tres niveles que ofrece acta, del más ligero al más capaz.
pub fn catalog() -> Vec<LocalModel> {
    vec![
        qwen35(
            ModelTier::Tiny,
            "2B",
            ("f6d5376be1edb4d416d56da11e5397a961aca8ae", 1_280_835_840, "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223"),
            (4, 8, 25),
            (16_384, 45),
            "El más ligero y rápido. Resúmenes correctos de reuniones cortas; se queda corto en reuniones largas o con muchos temas.",
        ),
        qwen35(
            ModelTier::Medium,
            "4B",
            ("e87f176479d0855a907a41277aca2f8ee7a09523", 2_740_937_888, "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4"),
            (8, 16, 45),
            (16_384, 24),
            "Equilibrado. Buen castellano y tareas bien atribuidas en la mayoría de reuniones.",
        ),
        qwen35(
            ModelTier::Large,
            "9B",
            ("3885219b6810b007914f3a7950a8d1b469d598a5", 5_680_522_464, "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8"),
            (16, 24, 85),
            (24_576, 11),
            "La mejor calidad sin salir de tu Mac: escaletas detalladas y chat fiable. Necesita memoria de sobra.",
        ),
    ]
}

pub fn find_model(id: &str) -> Option<LocalModel> {
    catalog().into_iter().find(|m| m.id == id)
}

/// Lo que se sabe del Mac para recomendar un nivel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub ram_bytes: u64,
    /// "Apple M2 Pro", "Intel(R) Core(TM) i7…".
    pub chip: String,
    pub apple_silicon: bool,
    /// Libre en el volumen de datos (`None` si no se pudo leer).
    pub free_disk_bytes: Option<u64>,
}

impl HardwareInfo {
    /// GB "de etiqueta" (un Mac de 8 GB informa 8 589 934 592 bytes).
    pub fn ram_gb(&self) -> u32 {
        (self.ram_bytes as f64 / GIB as f64).round() as u32
    }
}

/// Lee la salida de `sysctl -n hw.memsize machdep.cpu.brand_string
/// hw.optional.arm64` (una línea por clave; la tercera falta en Intel).
pub fn parse_sysctl(output: &str, free_disk_bytes: Option<u64>) -> Option<HardwareInfo> {
    let mut lines = output.lines().map(str::trim).filter(|l| !l.is_empty());
    let ram_bytes: u64 = lines.next()?.parse().ok()?;
    let chip = lines.next().unwrap_or("Mac").to_owned();
    let arm_flag = lines.next().is_some_and(|l| l == "1");
    let apple_silicon = arm_flag || chip.starts_with("Apple");
    Some(HardwareInfo { ram_bytes, chip, apple_silicon, free_disk_bytes })
}

/// Generación de Apple Silicon: "Apple M2 Pro" → 2.
pub fn apple_generation(chip: &str) -> Option<u32> {
    let rest = chip.strip_prefix("Apple M")?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok().filter(|g| *g >= 1)
}

/// Velocidad orientativa en este chip, en tokens/s. Sale de la referencia del
/// modelo (M1 base) por la generación y por la variante (Pro, Max, Ultra), que
/// es lo que manda: el ancho de banda de memoria.
pub fn expected_tokens_per_s(model: &LocalModel, hw: &HardwareInfo) -> u32 {
    let base = f64::from(model.base_tokens_per_s);
    if !hw.apple_silicon {
        return (base * 0.15).round().max(1.0) as u32;
    }
    let generation = match apple_generation(&hw.chip).unwrap_or(1) {
        1 => 1.0,
        2 => 1.15,
        3 => 1.3,
        4 => 1.5,
        _ => 1.7,
    };
    let chip = hw.chip.to_lowercase();
    let variant = if chip.contains("ultra") {
        3.0
    } else if chip.contains("max") {
        2.2
    } else if chip.contains("pro") {
        1.5
    } else {
        1.0
    };
    (base * generation * variant).round() as u32
}

/// Si un modelo cabe en este Mac.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelFit {
    /// Va holgado.
    Comfortable,
    /// Funciona, pero deja poca memoria al resto (o el Mac es Intel y va lento).
    Tight,
    /// No hay memoria: no se ofrece.
    TooBig,
    /// No cabe en el disco con el margen de seguridad.
    NoDisk,
}

impl ModelFit {
    pub fn can_download(self) -> bool {
        matches!(self, ModelFit::Comfortable | ModelFit::Tight)
    }
}

/// `already_on_disk`: lo que ya hay descargado de este modelo (no vuelve a ocupar).
pub fn fit(model: &LocalModel, hw: &HardwareInfo, already_on_disk: u64) -> ModelFit {
    let ram = hw.ram_gb();
    if ram < model.min_ram_gb {
        return ModelFit::TooBig;
    }
    let missing = model.size_bytes.saturating_sub(already_on_disk);
    if missing > 0 && hw.free_disk_bytes.is_some_and(|free| free < missing + DISK_MARGIN_BYTES) {
        return ModelFit::NoDisk;
    }
    if ram < model.comfortable_ram_gb || !hw.apple_silicon {
        return ModelFit::Tight;
    }
    ModelFit::Comfortable
}

/// El nivel recomendado: el más capaz que va holgado. Si ninguno va holgado
/// (Mac con poca memoria o Intel), el más ligero que al menos funciona.
pub fn recommend(models: &[LocalModel], hw: &HardwareInfo) -> Option<String> {
    let fits = |want: ModelFit| models.iter().filter(move |m| fit(m, hw, m.size_bytes) == want);
    fits(ModelFit::Comfortable)
        .max_by_key(|m| m.size_bytes)
        .or_else(|| fits(ModelFit::Tight).min_by_key(|m| m.size_bytes))
        .map(|m| m.id.clone())
}

/// De dónde sale el `llama-server` que se va a usar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeSource {
    /// `ACTA_LLAMA_SERVER`.
    Env,
    /// Junto al ejecutable de la app.
    Bundled,
    /// Descargado por acta en la carpeta de datos.
    Downloaded,
    /// `brew install llama.cpp`.
    Homebrew,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntimeStatus {
    /// Hay un `llama-server` utilizable.
    pub available: bool,
    pub source: Option<RuntimeSource>,
    pub path: Option<String>,
    /// Versión de llama.cpp que acta descarga ("b12444").
    pub pinned_version: String,
    /// Tamaño de esa descarga.
    pub download_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    pub model: LocalModel,
    pub fit: ModelFit,
    pub recommended: bool,
    pub downloaded: bool,
    /// Bytes ya descargados de una descarga a medias (se reanuda).
    pub partial_bytes: u64,
    pub downloading: bool,
    pub expected_tokens_per_s: u32,
}

/// Respuesta de `local_llm_status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmStatus {
    pub hardware: HardwareInfo,
    pub runtime: LocalRuntimeStatus,
    pub models: Vec<LocalModelStatus>,
    pub recommended: Option<String>,
    /// Modelo cargado ahora mismo en memoria, si hay servidor en marcha.
    pub running: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalDownloadStage {
    /// Descargando llama.cpp.
    Runtime,
    Model,
    /// Comprobando el SHA-256.
    Verifying,
    Done,
}

/// Evento `local-llm:download`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLlmDownload {
    pub model_id: String,
    pub stage: LocalDownloadStage,
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub fraction: f32,
    pub done: bool,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac(ram_gb: u64, chip: &str, free_gb: u64) -> HardwareInfo {
        HardwareInfo { ram_bytes: ram_gb * GIB, chip: chip.into(), apple_silicon: chip.starts_with("Apple"), free_disk_bytes: Some(free_gb * GIB) }
    }

    fn fits(hw: &HardwareInfo) -> Vec<ModelFit> {
        catalog().iter().map(|m| fit(m, hw, 0)).collect()
    }

    fn recommended_tier(hw: &HardwareInfo) -> Option<ModelTier> {
        let models = catalog();
        let id = recommend(&models, hw)?;
        models.into_iter().find(|m| m.id == id).map(|m| m.tier)
    }

    #[test]
    fn catalog_has_three_pinned_apache_tiers_from_small_to_large() {
        let c = catalog();
        assert_eq!(c.iter().map(|m| m.tier).collect::<Vec<_>>(), vec![ModelTier::Tiny, ModelTier::Medium, ModelTier::Large]);
        assert!(c.windows(2).all(|w| w[0].size_bytes < w[1].size_bytes && w[0].min_ram_gb < w[1].min_ram_gb));
        let mut ids: Vec<&str> = c.iter().map(|m| m.id.as_str()).collect();
        ids.dedup();
        assert_eq!(ids, ["qwen3.5-2b-q4_k_m", "qwen3.5-4b-q4_k_m", "qwen3.5-9b-q4_k_m"]);
        for m in &c {
            assert_eq!(m.license, "Apache-2.0");
            assert_eq!(m.sha256.len(), 64);
            assert!(m.sha256.chars().all(|ch| ch.is_ascii_hexdigit()));
            assert_eq!(m.revision.len(), 40, "revisión fijada: {}", m.id);
            assert_eq!(m.url, format!("https://huggingface.co/{}/resolve/{}/{}", m.repo, m.revision, m.file));
            assert!(m.file.ends_with("Q4_K_M.gguf") && m.min_ram_gb <= m.comfortable_ram_gb);
            assert!(m.ram_needed_bytes > m.size_bytes, "{} necesita más RAM que su fichero", m.id);
        }
        assert_eq!(find_model("qwen3.5-4b-q4_k_m").map(|m| m.name), Some("Qwen3.5 4B".into()));
        assert_eq!(find_model("nope"), None);
    }

    #[test]
    fn this_mac_m2_pro_with_32_gb_gets_the_large_tier() {
        let hw = mac(32, "Apple M2 Pro", 100);
        assert_eq!(fits(&hw), vec![ModelFit::Comfortable; 3]);
        assert_eq!(recommended_tier(&hw), Some(ModelTier::Large));
    }

    #[test]
    fn sixteen_gb_recommends_medium_and_flags_large_as_tight() {
        let hw = mac(16, "Apple M1", 100);
        assert_eq!(fits(&hw), vec![ModelFit::Comfortable, ModelFit::Comfortable, ModelFit::Tight]);
        assert_eq!(recommended_tier(&hw), Some(ModelTier::Medium));
    }

    #[test]
    fn eight_gb_recommends_tiny_and_never_offers_large() {
        let hw = mac(8, "Apple M1", 100);
        assert_eq!(fits(&hw), vec![ModelFit::Comfortable, ModelFit::Tight, ModelFit::TooBig]);
        assert_eq!(recommended_tier(&hw), Some(ModelTier::Tiny));
    }

    #[test]
    fn under_eight_gb_only_the_tiny_tier_is_offered() {
        let hw = mac(6, "Apple M1", 100);
        assert_eq!(fits(&hw), vec![ModelFit::Tight, ModelFit::TooBig, ModelFit::TooBig]);
        assert_eq!(recommended_tier(&hw), Some(ModelTier::Tiny));
        let hw = mac(2, "Apple M1", 100);
        assert_eq!(recommend(&catalog(), &hw), None);
    }

    #[test]
    fn a_full_disk_blocks_the_download_but_not_a_model_already_there() {
        let hw = mac(32, "Apple M2 Pro", 4);
        // 4 GB libres: cabe el pequeño (1,3 + 2 de margen), no los otros.
        assert_eq!(fits(&hw), vec![ModelFit::Comfortable, ModelFit::NoDisk, ModelFit::NoDisk]);
        let large = &catalog()[2];
        assert_eq!(fit(large, &hw, large.size_bytes), ModelFit::Comfortable);
        assert!(!ModelFit::NoDisk.can_download() && !ModelFit::TooBig.can_download() && ModelFit::Tight.can_download());
        // La recomendación mira la memoria, no el disco de hoy.
        assert_eq!(recommended_tier(&hw), Some(ModelTier::Large));
        // Sin dato de disco no se bloquea nada.
        let unknown = HardwareInfo { free_disk_bytes: None, ..hw };
        assert_eq!(fits(&unknown), vec![ModelFit::Comfortable; 3]);
    }

    #[test]
    fn intel_macs_are_always_tight_and_get_the_smallest() {
        let hw = mac(32, "Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz", 100);
        assert_eq!(fits(&hw), vec![ModelFit::Tight; 3]);
        assert_eq!(recommended_tier(&hw), Some(ModelTier::Tiny));
        assert!(expected_tokens_per_s(&catalog()[0], &hw) < 10);
    }

    #[test]
    fn sysctl_output_is_parsed_for_apple_silicon_and_intel() {
        let hw = parse_sysctl("34359738368\nApple M2 Pro\n1\n", Some(5)).expect("hw");
        assert_eq!((hw.ram_gb(), hw.chip.as_str(), hw.apple_silicon, hw.free_disk_bytes), (32, "Apple M2 Pro", true, Some(5)));
        let intel = parse_sysctl("17179869184\nIntel(R) Core(TM) i7-9750H CPU @ 2.60GHz\n", None).expect("hw");
        assert_eq!((intel.ram_gb(), intel.apple_silicon), (16, false));
        assert_eq!(parse_sysctl("", None), None);
        assert_eq!(parse_sysctl("no-number\nApple M1\n", None), None);
    }

    #[test]
    fn apple_generation_and_speed_estimate_follow_the_chip() {
        assert_eq!(apple_generation("Apple M2 Pro"), Some(2));
        assert_eq!(apple_generation("Apple M4"), Some(4));
        assert_eq!(apple_generation("Apple M10 Max"), Some(10));
        assert_eq!(apple_generation("Intel(R) Core(TM) i7"), None);
        let tiny = &catalog()[0];
        let m1 = expected_tokens_per_s(tiny, &mac(8, "Apple M1", 100));
        let m2_pro = expected_tokens_per_s(tiny, &mac(32, "Apple M2 Pro", 100));
        let m4_max = expected_tokens_per_s(tiny, &mac(64, "Apple M4 Max", 100));
        assert_eq!(m1, 45);
        // Medido en este Mac (M2 Pro, 16-nov-2026): 79 tokens/s con el pequeño.
        assert!((70..=90).contains(&m2_pro), "{m2_pro}");
        assert!(m4_max > m2_pro);
        let large = expected_tokens_per_s(&catalog()[2], &mac(32, "Apple M2 Pro", 100));
        assert!(large < m2_pro / 3);
    }

    #[test]
    fn status_serialises_in_camel_case() {
        let v = serde_json::to_value(LocalLlmDownload {
            model_id: "m".into(),
            stage: LocalDownloadStage::Verifying,
            received_bytes: 1,
            total_bytes: 2,
            fraction: 0.5,
            done: false,
            error: None,
        })
        .expect("json");
        assert_eq!(v["modelId"], "m");
        assert_eq!(v["stage"], "verifying");
        assert_eq!(serde_json::to_value(ModelFit::TooBig).expect("json"), "tooBig");
        assert_eq!(serde_json::to_value(RuntimeSource::Homebrew).expect("json"), "homebrew");
    }
}
