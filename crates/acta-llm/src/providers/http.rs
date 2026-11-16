//! Mapeo de errores HTTP a `PortError` con mensajes en castellano.

use acta_core::PortError;

pub fn map_reqwest(url: &str, e: reqwest::Error) -> PortError {
    if e.is_timeout() {
        PortError::Timeout(format!("{url} no respondió a tiempo"))
    } else if e.is_connect() {
        PortError::Unavailable(format!("no se pudo conectar con {url}: ¿está el servidor en marcha?"))
    } else {
        PortError::Unavailable(format!("error de red con {url}: {e}"))
    }
}

pub fn map_status(status: u16, body: &str) -> PortError {
    let body: String = body.trim().chars().take(400).collect();
    match status {
        401 | 403 => PortError::PermissionDenied(format!("la API rechazó la clave ({status}): {body}")),
        404 => PortError::Unavailable(format!("endpoint o modelo no encontrado (404): {body}")),
        429 => PortError::Unavailable(format!("límite de uso alcanzado (429): {body}")),
        _ => PortError::Unavailable(format!("la API respondió {status}: {body}")),
    }
}
