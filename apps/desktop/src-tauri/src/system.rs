//! Pequeñas llamadas al sistema: espacio libre y URLs de Ajustes del Sistema.

use acta_core::permissions::PermissionKind;
use std::path::Path;

/// Bytes libres para el usuario en el volumen de `path` (`statvfs`).
#[allow(unsafe_code)]
pub fn disk_free(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut st = std::mem::MaybeUninit::<libc::statvfs>::zeroed();
    // SAFETY: `c` es un C string válido terminado en NUL y `st` apunta a
    // memoria del tamaño de `statvfs`; solo se lee si la llamada devuelve 0.
    let rc = unsafe { libc::statvfs(c.as_ptr(), st.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    // SAFETY: statvfs devolvió 0, así que la estructura está inicializada.
    let st = unsafe { st.assume_init() };
    #[allow(clippy::unnecessary_cast)]
    Some((st.f_bavail as u64).saturating_mul(st.f_frsize as u64))
}

/// Variable para usar otra carpeta de datos (pruebas, sin tocar la real).
pub const DATA_DIR_ENV: &str = "ACTA_DATA_DIR";

/// Carpeta de datos: `ACTA_DATA_DIR` si está y no es vacía; si no,
/// `<Application Support>/acta`.
pub fn data_root(env: Option<std::ffi::OsString>, support_dir: Option<std::path::PathBuf>) -> Option<std::path::PathBuf> {
    match env.filter(|v| !v.is_empty()) {
        Some(v) => Some(v.into()),
        None => support_dir.map(|d| d.join(acta_core::layout::APP_DIR_NAME)),
    }
}

/// Panel de Privacidad y seguridad de cada permiso.
pub fn settings_url(kind: PermissionKind) -> &'static str {
    match kind {
        PermissionKind::Microphone => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        PermissionKind::SystemAudio | PermissionKind::ScreenRecording => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        PermissionKind::Accessibility => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        PermissionKind::Automation => "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_env_override_wins_and_empty_is_ignored() {
        let support = Some(std::path::PathBuf::from("/Users/e/Library/Application Support"));
        assert_eq!(data_root(Some("/tmp/acta-x".into()), support.clone()).unwrap(), Path::new("/tmp/acta-x"));
        assert_eq!(data_root(Some("".into()), support.clone()).unwrap(), Path::new("/Users/e/Library/Application Support/acta"));
        assert_eq!(data_root(None, support).unwrap(), Path::new("/Users/e/Library/Application Support/acta"));
        assert_eq!(data_root(None, None), None);
    }

    #[test]
    fn disk_free_of_root_is_known() {
        assert!(disk_free(Path::new("/")).is_some_and(|b| b > 0));
        assert_eq!(disk_free(Path::new("/definitely/not/here")), None);
    }

    #[test]
    fn every_permission_has_a_privacy_pane() {
        for k in [
            PermissionKind::Microphone,
            PermissionKind::SystemAudio,
            PermissionKind::ScreenRecording,
            PermissionKind::Accessibility,
            PermissionKind::Automation,
        ] {
            assert!(settings_url(k).contains("Privacy_"));
        }
    }
}
