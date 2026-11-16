//! `MinutesGenerator` (WP3). Tipos de cable del esquema `acta.minutes.v1`.
//!
//! - `generator`: llamada al LLM (una pasada o map-reduce) + reparación.
//! - `convert`: `MinutesV1` → `MinutesOutput` (refs `cN` → `CaptureId`, `ts_ms` → `MediaMs`,
//!   "mis tareas" con comprobación determinista de nombres).
//! - `captures`: enlazar capturas con temas/tareas y promover candidatas.
//! - `timeline`: línea de tiempo derivada.

pub mod captures;
pub mod convert;
pub mod generator;
pub mod meta;
pub mod timeline;

pub use generator::LlmMinutesGenerator;

use acta_core::minutes::Tema;
use serde::{Deserialize, Serialize};

/// Respuesta del LLM tal cual (claves en castellano, snake_case).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MinutesV1 {
    pub titulo_sugerido: Option<String>,
    pub resumen: String,
    pub decisiones: Vec<DecisionV1>,
    pub tareas: Vec<TareaV1>,
    pub escaleta: EscaletaV1,
    pub momentos_clave: Vec<MomentoV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionV1 {
    pub texto: String,
    pub ts_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TareaV1 {
    pub texto: String,
    pub responsable: Option<String>,
    pub es_mia: bool,
    pub fecha_limite: Option<String>,
    pub ts_ms: Option<u64>,
    #[serde(default)]
    pub capturas: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EscaletaV1 {
    pub temas: Vec<Tema>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MomentoV1 {
    pub ts_ms: u64,
    pub motivo: String,
    pub tema: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_is_valid_json_and_sample_matches_wire_type() {
        let schema: serde_json::Value = serde_json::from_str(crate::schemas::MINUTES_V1).expect("schema json");
        assert_eq!(schema["title"], "acta.minutes.v1");

        let sample = serde_json::json!({
            "titulo_sugerido": null,
            "resumen": "- Se revisó el plan",
            "decisiones": [{"texto": "Lanzar el lunes", "ts_ms": 120000}],
            "tareas": [{"texto": "Enviar presupuesto", "responsable": "Edu", "es_mia": true,
                        "fecha_limite": "viernes", "ts_ms": 300000, "capturas": ["c1"]}],
            "escaleta": {"temas": [{"titulo": "Plan", "resumen": "Revisión", "inicio_ms": 0, "fin_ms": 600000,
                                    "subtemas": [], "capturas": ["c1"]}]},
            "momentos_clave": [{"ts_ms": 240000, "motivo": "diapositiva con fechas", "tema": "Plan"}]
        });
        let parsed: MinutesV1 = serde_json::from_value(sample).expect("wire type");
        assert!(parsed.tareas[0].es_mia);
        assert_eq!(parsed.escaleta.temas[0].capturas, vec!["c1".to_string()]);
    }
}
