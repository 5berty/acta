//! Secretos (claves de API). NUNCA van a SQLite: la BD solo guarda `SecretRef`.
//! El valor vive en el Llavero de macOS (`KeychainSecretStore`, crate `keyring`).

use acta_core::llm::SecretRef;
use acta_core::{PortError, PortResult};
use std::collections::HashMap;
use std::sync::Mutex;

pub const SERVICE: &str = "acta";

/// Referencia canónica de la clave de un proveedor: servicio "acta", cuenta "provider:<id>".
pub fn secret_ref_for_provider(provider_id: &str) -> SecretRef {
    SecretRef { service: SERVICE.into(), account: format!("provider:{provider_id}") }
}

pub trait SecretStore: Send + Sync {
    fn set(&self, r: &SecretRef, value: &str) -> PortResult<()>;
    fn get(&self, r: &SecretRef) -> PortResult<Option<String>>;
    /// Idempotente: borrar algo que no existe es `Ok`.
    fn delete(&self, r: &SecretRef) -> PortResult<()>;
}

/// Para tests y para ejecutar sin Llavero.
#[derive(Debug, Default)]
pub struct InMemorySecretStore(Mutex<HashMap<(String, String), String>>);

fn key(r: &SecretRef) -> (String, String) {
    (r.service.clone(), r.account.clone())
}

impl SecretStore for InMemorySecretStore {
    fn set(&self, r: &SecretRef, value: &str) -> PortResult<()> {
        self.0.lock().map_err(|_| PortError::Internal("secrets mutex".into()))?.insert(key(r), value.to_owned());
        Ok(())
    }
    fn get(&self, r: &SecretRef) -> PortResult<Option<String>> {
        Ok(self.0.lock().map_err(|_| PortError::Internal("secrets mutex".into()))?.get(&key(r)).cloned())
    }
    fn delete(&self, r: &SecretRef) -> PortResult<()> {
        self.0.lock().map_err(|_| PortError::Internal("secrets mutex".into()))?.remove(&key(r));
        Ok(())
    }
}

/// Llavero del sistema (macOS Keychain). Sin estado.
#[derive(Debug, Default, Clone, Copy)]
pub struct KeychainSecretStore;

impl KeychainSecretStore {
    pub fn new() -> Self {
        Self
    }
    fn entry(r: &SecretRef) -> PortResult<keyring::Entry> {
        keyring::Entry::new(&r.service, &r.account).map_err(map_kr)
    }
}

fn map_kr(e: keyring::Error) -> PortError {
    match e {
        keyring::Error::NoEntry => PortError::NotFound("secret".into()),
        keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => PortError::Unavailable(format!("keychain: {e}")),
        other => PortError::Internal(format!("keychain: {other}")),
    }
}

impl SecretStore for KeychainSecretStore {
    fn set(&self, r: &SecretRef, value: &str) -> PortResult<()> {
        Self::entry(r)?.set_password(value).map_err(map_kr)
    }
    fn get(&self, r: &SecretRef) -> PortResult<Option<String>> {
        match Self::entry(r)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(map_kr(e)),
        }
    }
    fn delete(&self, r: &SecretRef) -> PortResult<()> {
        match Self::entry(r)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(map_kr(e)),
        }
    }
}
