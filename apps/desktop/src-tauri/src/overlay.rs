//! La pastilla: cuándo se ve y cómo se convierte en un NSPanel no activable,
//! visible en todos los Spaces y por encima de apps a pantalla completa.

use acta_core::recording::SessionState;

/// Tamaños lógicos de la ventana `overlay` (la UI pide expandirla).
pub const PILL_SIZE: (f64, f64) = (280.0, 56.0);
pub const EXPANDED_SIZE: (f64, f64) = (360.0, 150.0);

/// Nueva esquina superior izquierda (puntos lógicos) al pasar de `from` a
/// `to`: mismo centro horizontal y mismo borde superior.
pub fn resized_origin(origin: (f64, f64), from: (f64, f64), to: (f64, f64)) -> (f64, f64) {
    (origin.0 + (from.0 - to.0) / 2.0, origin.1)
}

/// Separación respecto al Dock (o al borde de abajo del área de trabajo).
pub const BOTTOM_MARGIN: f64 = 16.0;

/// Rectángulo en puntos lógicos (origen arriba a la izquierda).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Abajo en el centro del área de trabajo (sin barra de menús ni Dock).
pub fn default_origin(work: Rect, size: (f64, f64)) -> (f64, f64) {
    (work.x + (work.w - size.0) / 2.0, work.y + work.h - size.1 - BOTTOM_MARGIN)
}

/// Al cambiar de tamaño: mismo centro horizontal; si está en la mitad de
/// abajo de su pantalla crece hacia arriba (borde de abajo fijo), si no hacia
/// abajo (borde de arriba fijo).
pub fn anchored_origin(origin: (f64, f64), from: (f64, f64), to: (f64, f64), screen: Rect) -> (f64, f64) {
    let (x, top) = resized_origin(origin, from, to);
    let low = origin.1 + from.1 / 2.0 > screen.y + screen.h / 2.0;
    (x, if low { top + from.1 - to.1 } else { top })
}

fn clamp_into(origin: (f64, f64), size: (f64, f64), r: Rect) -> (f64, f64) {
    (origin.0.clamp(r.x, (r.x + r.w - size.0).max(r.x)), origin.1.clamp(r.y, (r.y + r.h - size.1).max(r.y)))
}

/// Dónde dejó Edu la pastilla en cada pantalla (relativo a la pantalla).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Positions(pub std::collections::BTreeMap<String, (f64, f64)>);

impl Positions {
    pub fn remember(&mut self, display: &str, screen: Rect, origin: (f64, f64)) {
        self.0.insert(display.to_owned(), (origin.0 - screen.x, origin.1 - screen.y));
    }

    pub fn origin_for(&self, display: &str, screen: Rect, size: (f64, f64)) -> Option<(f64, f64)> {
        let (dx, dy) = *self.0.get(display)?;
        Some(clamp_into((screen.x + dx, screen.y + dy), size, screen))
    }

    pub fn load(path: &std::path::Path) -> Self {
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &std::path::Path) {
        if let Ok(bytes) = serde_json::to_vec_pretty(self) {
            let _ = std::fs::write(path, bytes);
        }
    }
}

/// ¿Se muestra la pastilla en este estado? En reposo no estorba.
pub fn overlay_visible(state: &SessionState) -> bool {
    !matches!(state, SessionState::Idle)
}

#[cfg(target_os = "macos")]
pub mod panel {
    use tauri::{AppHandle, Manager, Runtime};
    use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt, tauri_panel};

    tauri_panel! {
        panel!(OverlayPanel {
            config: {
                can_become_key_window: true,
                can_become_main_window: false,
                become_key_if_only_needed: true,
                is_floating_panel: true
            }
        })
    }

    pub const LABEL: &str = "overlay";

    /// Convierte la ventana `overlay` en NSPanel. Llamar en el hilo principal (setup).
    pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
        let Some(win) = app.get_webview_window(LABEL) else {
            return Ok(());
        };
        let panel = win.to_panel::<OverlayPanel<R>>()?;
        panel.set_level(PanelLevel::Status.value());
        if let Err(e) = panel.add_style_mask(StyleMask::empty().nonactivating_panel().value()) {
            tracing::warn!("no se pudo hacer la pastilla no activable: {e}");
        }
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary()
                .stationary()
                .ignores_cycle()
                .value(),
        );
        panel.set_hides_on_deactivate(false);
        panel.set_floating_panel(true);
        panel.set_has_shadow(false);
        panel.set_transparent(true);
        Ok(())
    }

    pub fn set_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Ok(panel) = handle.get_webview_panel(LABEL) {
                match (visible, panel.is_visible()) {
                    (true, false) => panel.order_front_regardless(),
                    (false, true) => panel.hide(),
                    _ => {}
                }
            }
        });
    }
}

/// Pantalla de Tauri → (clave estable, pantalla, área de trabajo) en puntos.
pub fn monitor_rects(m: &tauri::Monitor) -> (String, Rect, Rect) {
    let s = m.scale_factor();
    let r = |x: i32, y: i32, w: u32, h: u32| Rect { x: f64::from(x) / s, y: f64::from(y) / s, w: f64::from(w) / s, h: f64::from(h) / s };
    let (p, z) = (m.position(), m.size());
    let screen = r(p.x, p.y, z.width, z.height);
    let wa = m.work_area();
    let work = r(wa.position.x, wa.position.y, wa.size.width, wa.size.height);
    let key = format!("{} {}x{}", m.name().map(String::as_str).unwrap_or("pantalla"), z.width, z.height);
    (key, screen, work)
}

/// Coloca la pastilla: donde Edu la dejó en la pantalla principal o, si no,
/// abajo en el centro encima del Dock.
pub fn place<R: tauri::Runtime>(win: &tauri::WebviewWindow<R>, positions: &std::path::Path) {
    let Ok(Some(m)) = win.primary_monitor() else { return };
    let (key, screen, work) = monitor_rects(&m);
    let (x, y) = Positions::load(positions).origin_for(&key, screen, PILL_SIZE).unwrap_or_else(|| default_origin(work, PILL_SIZE));
    let _ = win.set_position(tauri::LogicalPosition::new(x, y));
}

/// Tras arrastrarla: se recuerda su sitio en la pantalla donde quedó.
pub fn remember<R: tauri::Runtime>(win: &tauri::Window<R>, positions: &std::path::Path) {
    let (Ok(Some(m)), Ok(scale), Ok(pos)) = (win.current_monitor(), win.scale_factor(), win.outer_position()) else { return };
    let Ok(size) = win.outer_size() else { return };
    // Solo la pastilla plegada: la expandida se mueve sola al crecer.
    let size = size.to_logical::<f64>(scale);
    if (size.height - PILL_SIZE.1).abs() > 1.0 {
        return;
    }
    let pos = pos.to_logical::<f64>(scale);
    let (key, screen, _) = monitor_rects(&m);
    let mut all = Positions::load(positions);
    all.remember(&key, screen, (pos.x, pos.y));
    all.save(positions);
}

#[cfg(test)]
mod tests {
    use super::*;
    use acta_core::ids::MeetingId;

    #[test]
    fn hidden_only_when_idle() {
        assert!(!overlay_visible(&SessionState::Idle));
        assert!(overlay_visible(&SessionState::Ready { meeting_id: MeetingId::from_u128(1) }));
        assert!(overlay_visible(&SessionState::Recovering { meeting_id: MeetingId::from_u128(1) }));
    }

    const MAIN: Rect = Rect { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 };

    /// Teams tiene sus controles ARRIBA: la pastilla va abajo en el centro,
    /// encima del Dock (el área de trabajo ya lo descuenta).
    #[test]
    fn by_default_the_pill_sits_bottom_centre_above_the_dock() {
        let work = Rect { x: 0.0, y: 25.0, w: 1440.0, h: 805.0 }; // menú arriba, Dock abajo
        let (x, y) = default_origin(work, PILL_SIZE);
        assert_eq!(x, (1440.0 - PILL_SIZE.0) / 2.0);
        assert_eq!(y + PILL_SIZE.1, 25.0 + 805.0 - BOTTOM_MARGIN);
    }

    #[test]
    fn a_pill_near_the_bottom_grows_upwards_and_one_near_the_top_grows_downwards() {
        let low = (580.0, 780.0);
        let (_, y) = anchored_origin(low, PILL_SIZE, EXPANDED_SIZE, MAIN);
        assert_eq!(y + EXPANDED_SIZE.1, low.1 + PILL_SIZE.1, "mantiene el borde de abajo");
        let high = (580.0, 36.0);
        assert_eq!(anchored_origin(high, PILL_SIZE, EXPANDED_SIZE, MAIN).1, 36.0, "mantiene el borde de arriba");
    }

    #[test]
    fn positions_are_remembered_per_display_and_clamped_inside_it() {
        let mut saved = Positions::default();
        saved.remember("MSI G27CQ4 2560x1440", Rect { x: 0.0, y: 0.0, w: 2560.0, h: 1440.0 }, (100.0, 1300.0));
        saved.remember("MAG 275CQ 2560x1440", Rect { x: 2560.0, y: 0.0, w: 2560.0, h: 1440.0 }, (3000.0, 40.0));
        let back: Positions = serde_json::from_str(&serde_json::to_string(&saved).unwrap_or_default()).unwrap_or_default();
        assert_eq!(back.origin_for("MSI G27CQ4 2560x1440", Rect { x: 0.0, y: 0.0, w: 2560.0, h: 1440.0 }, PILL_SIZE), Some((100.0, 1300.0)));
        // Guardado relativo a la pantalla: si la pantalla cambia de sitio, la pastilla la sigue.
        assert_eq!(back.origin_for("MAG 275CQ 2560x1440", Rect { x: -2560.0, y: 0.0, w: 2560.0, h: 1440.0 }, PILL_SIZE), Some((-2560.0 + 440.0, 40.0)));
        // Nunca fuera de la pantalla (p. ej. ahora es más pequeña).
        let (x, y) = back.origin_for("MSI G27CQ4 2560x1440", Rect { x: 0.0, y: 0.0, w: 1280.0, h: 800.0 }, PILL_SIZE).unwrap_or_default();
        assert!(x + PILL_SIZE.0 <= 1280.0 && y + PILL_SIZE.1 <= 800.0);
        assert_eq!(back.origin_for("otra", MAIN, PILL_SIZE), None);
    }

    /// Al expandir, la pastilla crecía desde su esquina superior izquierda y
    /// se iba a la derecha: debe crecer hacia los lados y hacia abajo
    /// manteniendo el centro horizontal y el borde superior.
    #[test]
    fn resizing_keeps_horizontal_centre_and_top_edge() {
        let pill_x = (1512.0 - PILL_SIZE.0) / 2.0;
        let (x, y) = resized_origin((pill_x, 36.0), PILL_SIZE, EXPANDED_SIZE);
        assert_eq!(y, 36.0);
        assert!(((x + EXPANDED_SIZE.0 / 2.0) - (pill_x + PILL_SIZE.0 / 2.0)).abs() < 1e-9);
        // Y vuelve exactamente al sitio al plegarse.
        assert_eq!(resized_origin((x, y), EXPANDED_SIZE, PILL_SIZE), (pill_x, 36.0));
    }
}
