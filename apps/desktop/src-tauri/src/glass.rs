//! Liquid Glass (macOS 26 «Tahoe») en las ventanas de acta.
//!
//! El material nativo se declara en `tauri.conf.json` → `windowEffects`:
//! `["liquidGlassRegular", <material>]`. Tauri (window-vibrancy ≥ 0.8) monta un
//! `NSGlassEffectView` detrás del webview si `NSAppKitVersionNumber ≥ 2685`
//! (macOS 26) y, en macOS 14–15, cae al `NSVisualEffectView` con el material
//! indicado (`sidebar` en la principal, `hudWindow` en la pastilla). La ventana
//! es transparente y el CSS pinta encima capas translúcidas.
//!
//! OJO: no llames a `WebviewWindow::set_effects` sobre la pastilla después de
//! convertirla en NSPanel. En macOS 26.5 esa llamada no vuelve (AppKit se traga
//! la excepción) y se salta el resto de `setup`: bandeja, eventos y estado
//! inicial. El efecto de la configuración sobrevive a la conversión.
//!
//! Este módulo solo ofrece dos ayudas de diseño por variable de entorno, sin
//! efecto en uso normal:
//!
//! - `ACTA_THEME=light|dark`: fuerza la apariencia de la app.
//! - `ACTA_OVERLAY_PREVIEW=pill|expanded`: enseña la pastilla sin grabar.
//! - `ACTA_PREVIEW_AT=x,y`: coloca la ventana principal ahí (y la pastilla justo
//!   encima), p. ej. en un segundo monitor, siempre visible y sin robar el foco.

use tauri::{AppHandle, Manager, Runtime, Theme};

/// Qué pide el entorno. `None` en uso normal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesignPreview {
    pub theme: Option<Theme>,
    /// `Some(true)`: pastilla expandida. `Some(false)`: pastilla normal.
    pub overlay_expanded: Option<bool>,
    /// Esquina superior izquierda de la ventana principal, en puntos.
    pub origin: Option<(i32, i32)>,
}

fn origin_from(value: &str) -> Option<(i32, i32)> {
    let (x, y) = value.split_once(',')?;
    Some((x.trim().parse().ok()?, y.trim().parse().ok()?))
}

fn theme_from(value: &str) -> Option<Theme> {
    match value.trim().to_ascii_lowercase().as_str() {
        "light" | "claro" => Some(Theme::Light),
        "dark" | "oscuro" => Some(Theme::Dark),
        _ => None,
    }
}

/// Interpreta `ACTA_THEME`, `ACTA_OVERLAY_PREVIEW` y `ACTA_PREVIEW_AT` (ya leídas del entorno).
pub fn design_preview_from(theme: Option<&str>, overlay: Option<&str>, at: Option<&str>) -> Option<DesignPreview> {
    let preview = DesignPreview {
        theme: theme.and_then(theme_from),
        overlay_expanded: overlay.map(|mode| mode.trim().eq_ignore_ascii_case("expanded")),
        origin: at.and_then(origin_from),
    };
    (preview.theme.is_some() || preview.overlay_expanded.is_some() || preview.origin.is_some()).then_some(preview)
}

/// Llamar en `setup`. Sin las variables de diseño no hace nada.
pub fn install<R: Runtime>(app: &AppHandle<R>) {
    let theme = std::env::var("ACTA_THEME").ok();
    let overlay = std::env::var("ACTA_OVERLAY_PREVIEW").ok();
    let at = std::env::var("ACTA_PREVIEW_AT").ok();
    let Some(preview) = design_preview_from(theme.as_deref(), overlay.as_deref(), at.as_deref()) else { return };
    let app = app.clone();
    // Con el bucle de eventos ya en marcha: antes, el estado inicial oculta la pastilla.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if preview.theme.is_some() {
                handle.set_theme(preview.theme);
            }
            if let (Some((x, y)), Some(main)) = (preview.origin, handle.get_webview_window("main")) {
                let _ = main.set_position(tauri::LogicalPosition::new(x, y));
                // Por encima sin activarse: una ventana tapada deja de repintar.
                let _ = main.set_always_on_top(true);
            }
            let Some(expanded) = preview.overlay_expanded else { return };
            let Some(win) = handle.get_webview_window("overlay") else { return };
            let (w, h) = if expanded { crate::overlay::EXPANDED_SIZE } else { crate::overlay::PILL_SIZE };
            let _ = win.set_size(tauri::LogicalSize::new(w, h));
            if let Some((x, y)) = preview.origin {
                let _ = win.set_position(tauri::LogicalPosition::new(f64::from(x), f64::from(y) - h - 24.0));
            }
            #[cfg(target_os = "macos")]
            crate::overlay::panel::set_visible(&handle, true);
            #[cfg(not(target_os = "macos"))]
            let _ = win.show();
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_runs_have_no_design_preview() {
        assert_eq!(design_preview_from(None, None, None), None);
        assert_eq!(design_preview_from(Some("auto"), None, Some("aquí")), None);
    }

    #[test]
    fn theme_override_accepts_spanish_and_english() {
        assert_eq!(design_preview_from(Some("dark"), None, None).and_then(|p| p.theme), Some(Theme::Dark));
        assert_eq!(design_preview_from(Some(" Claro "), None, None).and_then(|p| p.theme), Some(Theme::Light));
    }

    #[test]
    fn preview_origin_allows_a_second_display() {
        assert_eq!(design_preview_from(None, None, Some("-2400, 220")).and_then(|p| p.origin), Some((-2400, 220)));
        assert_eq!(design_preview_from(None, None, Some("12")), None);
    }

    #[test]
    fn overlay_preview_picks_the_size() {
        assert_eq!(design_preview_from(None, Some("expanded"), None).and_then(|p| p.overlay_expanded), Some(true));
        assert_eq!(design_preview_from(None, Some("pill"), None).and_then(|p| p.overlay_expanded), Some(false));
    }
}
