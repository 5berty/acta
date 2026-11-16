// Evita una consola extra en Windows release (cuando exista el port).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(clippy::zombie_processes)]

fn main() {
    acta_desktop_lib::run();
}
