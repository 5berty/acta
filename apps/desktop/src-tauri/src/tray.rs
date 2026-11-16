//! Icono en la barra de menús: grabar/parar, abrir y salir.

use crate::commands::{Core, show_main};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let record = MenuItem::with_id(app, "record", "Grabar ahora", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Parar grabación", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Abrir acta", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Salir de acta", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&record, &stop, &open, &sep, &quit])?;
    let mut builder = TrayIconBuilder::with_id("acta")
        .tooltip("acta")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let app = app.clone();
            match event.id.as_ref() {
                "record" | "stop" => {
                    let start = event.id.as_ref() == "record";
                    tauri::async_runtime::spawn(async move {
                        let core = app.state::<Core>().inner().clone();
                        let r = if start { core.session_start(None).await } else { core.session_stop().await };
                        if let Err(e) = r {
                            tracing::warn!("acción de la bandeja: {e}");
                        }
                    });
                }
                "open" => {
                    let _ = show_main(&app, None);
                }
                "quit" => app.exit(0),
                _ => {}
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).icon_as_template(false);
    }
    builder.build(app)?;
    Ok(())
}
