//! Mapeo de errores HTTP a `PortError` con mensajes en castellano.

use acta_core::PortError;

pub fn map_reqwest(url: &str, e: reqwest::Error) -> PortError {
    if e.is_timeout() {
        PortError::Timeout(format!("{url} no respondió a tiempo"))
    } else if e.is_connect() {
        // La causa real (DNS, conexión rechazada, certificado) va en la cadena.
        let mut cause = String::new();
        let mut src = std::error::Error::source(&e);
        while let Some(s) = src {
            cause = s.to_string();
            src = s.source();
        }
        let hint = if cause.to_lowercase().contains("certif") { "certificado no válido" } else { "¿está el servidor en marcha?" };
        PortError::Unavailable(format!("no se pudo conectar con {url} ({cause}): {hint}"))
    } else {
        PortError::Unavailable(format!("error de red con {url}: {e}"))
    }
}

pub fn map_status(status: u16, body: &str) -> PortError {
    let lower = body.to_lowercase();
    if lower.contains("blockpage") || lower.contains("risk detected") {
        return PortError::Unavailable(format!(
            "la red de tu empresa bloquea este proveedor ({status}). Usa el CLI (claude/codex) o un modelo local."
        ));
    }
    let body: String = body.trim().chars().take(400).collect();
    match status {
        401 | 403 => PortError::PermissionDenied(format!("la API rechazó la clave ({status}): {body}")),
        404 => PortError::Unavailable(format!("endpoint o modelo no encontrado (404): {body}")),
        429 => PortError::Unavailable(format!("límite de uso alcanzado (429): {body}")),
        _ => PortError::Unavailable(format!("la API respondió {status}: {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corporate_block_page_is_explained() {
        let body = "<html><title>RISK DETECTED</title><meta http-equiv=\"refresh\" content=\"0; url=https://blockpage.cloud.example.com?category=Block_IA\"></html>";
        let e = map_status(503, body);
        assert!(matches!(&e, PortError::Unavailable(m) if m.contains("red de tu empresa bloquea")), "{e}");
    }

    #[test]
    fn auth_errors_stay_permission_denied() {
        assert!(matches!(map_status(401, "{}"), PortError::PermissionDenied(_)));
    }
}
