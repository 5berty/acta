//! Contrato de la ola 5: lo que macOS sabe de quien usa el Mac (para proponer
//! valores en la bienvenida) y las apps instaladas (para elegirlas sin conocer
//! su identificador). `chat_send` acepta además proveedor y modelo por mensaje.
//!
//! | comando | args (JS, camelCase) | resultado |
//! |---|---|---|
//! | `system_profile` | — | `SystemProfile` (nunca falla: lo que no se sabe va `null`/vacío) |
//! | `apps_list` | — | `InstalledApp[]` (instaladas y en marcha, sin repetir, por nombre) |
//! | `chat_send` | `{ threadId, text, providerId?, model? }` | `ChatSendResult` (el proveedor/modelo solo vale para ESA respuesta) |

use serde::{Deserialize, Serialize};

/// Nombre de la cuenta e idiomas de macOS. Nunca se aplica solo: la
/// bienvenida lo propone y el usuario decide.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfile {
    /// Nombre completo de la cuenta de macOS. `None` si no se pudo leer.
    pub full_name: Option<String>,
    /// Idiomas preferidos del sistema, en orden (`["es-ES", "en-GB"]`).
    pub preferred_languages: Vec<String>,
    /// El primero que acta sabe transcribir, listo para
    /// `Settings.transcription.language`; `"auto"` si ninguno.
    pub meeting_language: String,
}

impl SystemProfile {
    /// Lo leído de macOS → perfil. Un nombre en blanco cuenta como desconocido.
    pub fn from_system(full_name: Option<String>, preferred_languages: Vec<String>) -> Self {
        let full_name = full_name.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty());
        let preferred_languages: Vec<String> =
            preferred_languages.into_iter().map(|l| l.trim().to_owned()).filter(|l| !l.is_empty()).collect();
        let meeting_language = crate::settings::language::meeting_language(&preferred_languages);
        Self { full_name, preferred_languages, meeting_language }
    }
}

/// Una app instalada o en marcha.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub bundle_id: String,
    pub name: String,
    /// Ruta del `.app`.
    pub path: String,
    pub running: bool,
    /// PNG del icono (ruta absoluta dentro de la carpeta de datos, para el
    /// asset protocol). `None` si no se pudo sacar.
    pub icon_path: Option<String>,
}

/// Sin repetir (`bundle_id`, sin distinguir mayúsculas; gana la que está en
/// marcha y, si no, la primera) y por nombre sin distinguir mayúsculas.
pub fn tidy_apps(apps: Vec<InstalledApp>) -> Vec<InstalledApp> {
    let mut out: Vec<InstalledApp> = Vec::with_capacity(apps.len());
    for app in apps {
        if app.bundle_id.trim().is_empty() {
            continue;
        }
        match out.iter_mut().find(|a| a.bundle_id.eq_ignore_ascii_case(&app.bundle_id)) {
            Some(seen) => {
                if app.running && !seen.running {
                    let icon = seen.icon_path.take();
                    *seen = InstalledApp { icon_path: app.icon_path.clone().or(icon), ..app };
                } else if seen.icon_path.is_none() {
                    seen.icon_path = app.icon_path;
                }
            }
            None => out.push(app),
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.bundle_id.cmp(&b.bundle_id)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::command_names as c;

    #[test]
    fn wave5_names_match_the_typescript_contract() {
        assert_eq!([c::SYSTEM_PROFILE, c::APPS_LIST, c::CHAT_SEND], ["system_profile", "apps_list", "chat_send"]);
    }

    #[test]
    fn the_profile_is_camel_case_and_proposes_a_meeting_language() {
        let p = SystemProfile::from_system(Some(" Ana García ".into()), vec!["es-ES".into(), "en-GB".into()]);
        assert_eq!(
            serde_json::to_value(&p).unwrap_or_default(),
            serde_json::json!({"fullName": "Ana García", "preferredLanguages": ["es-ES", "en-GB"], "meetingLanguage": "es"})
        );
        let unknown = SystemProfile::from_system(Some("  ".into()), vec!["ja-JP".into(), "".into()]);
        assert_eq!(
            serde_json::to_value(&unknown).unwrap_or_default(),
            serde_json::json!({"fullName": null, "preferredLanguages": ["ja-JP"], "meetingLanguage": "auto"})
        );
        assert_eq!(SystemProfile::from_system(None, vec![]).meeting_language, "auto");
    }

    fn app(bundle_id: &str, name: &str, running: bool, icon: Option<&str>) -> InstalledApp {
        InstalledApp { bundle_id: bundle_id.into(), name: name.into(), path: format!("/Applications/{name}.app"), running, icon_path: icon.map(str::to_owned) }
    }

    #[test]
    fn apps_are_deduplicated_by_bundle_id_and_sorted_by_name_ignoring_case() {
        let out = tidy_apps(vec![
            app("com.z", "zoom.us", false, None),
            app("com.a", "arc", false, Some("/i/a.png")),
            app("com.s", "Safari", false, None),
            app("COM.A", "Arc", true, None),
            app("", "Sin id", false, None),
        ]);
        let got: Vec<(&str, &str, bool)> = out.iter().map(|a| (a.bundle_id.as_str(), a.name.as_str(), a.running)).collect();
        assert_eq!(got, [("COM.A", "Arc", true), ("com.s", "Safari", false), ("com.z", "zoom.us", false)]);
        assert_eq!(out[0].icon_path.as_deref(), Some("/i/a.png"), "se conserva el icono que ya había");
    }

    #[test]
    fn an_installed_app_is_camel_case() {
        let v = serde_json::to_value(app("com.a", "Arc", true, None)).unwrap_or_default();
        assert_eq!(v, serde_json::json!({"bundleId": "com.a", "name": "Arc", "path": "/Applications/Arc.app", "running": true, "iconPath": null}));
    }
}
