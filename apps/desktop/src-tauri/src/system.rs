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
