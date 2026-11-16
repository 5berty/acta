//! # acta-desktop (WP6)
//!
//! Composición (raíz de inyección de dependencias):
//! 1. `DataLayout` en `~/Library/Application Support/acta/`.
//! 2. `SqliteStore` (acta-store), `SidecarClient` + adaptadores (acta-mac-bridge),
//!    proveedores LLM (acta-llm), `DefaultPipeline` + supervisor (acta-audio).
//! 3. Comandos Tauri (`commands`) → `SupervisorHandle` / stores.
//! 4. `SupervisorEvent` → `app.emit(event_names::*)`.
//! 5. Ventana `overlay` convertida a NSPanel no activable (tauri-nspanel),
//!    visible en todos los Spaces y sobre pantalla completa.
//!
//! Procesos hijo: SOLO vía acta-mac-bridge / acta-llm (supervisados). Para
//! abrir URLs/Ajustes del sistema, `tauri-plugin-opener` (nunca `open` a pelo).
#![deny(clippy::zombie_processes)]

mod commands;

use acta_core::layout::{APP_DIR_NAME, DataLayout};

/// `~/Library/Application Support/acta`.
pub fn data_layout() -> Option<DataLayout> {
    dirs::data_dir().map(|d| DataLayout::new(d.join(APP_DIR_NAME)))
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![commands::session_get_state])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        tracing::error!("acta terminó con error: {e}");
    }
}
