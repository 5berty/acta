//! La pastilla: cuándo se ve y cómo se convierte en un NSPanel no activable,
//! visible en todos los Spaces y por encima de apps a pantalla completa.

use acta_core::recording::SessionState;

/// Tamaños lógicos de la ventana `overlay` (la UI pide expandirla).
pub const PILL_SIZE: (f64, f64) = (280.0, 56.0);
pub const EXPANDED_SIZE: (f64, f64) = (360.0, 150.0);

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
        // Arriba en el centro de la pantalla principal, bajo la barra de menús.
        if let Ok(Some(m)) = win.primary_monitor() {
            let scale = m.scale_factor();
            let width = f64::from(m.size().width) / scale;
            let x = (width - super::PILL_SIZE.0) / 2.0;
            let _ = win.set_position(tauri::LogicalPosition::new(x, 36.0));
        }
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
}
