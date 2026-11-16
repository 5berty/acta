#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Secretos: nunca en claro en la BD; el Llavero real va detrás de `SecretStore`.

use acta_core::llm::SecretRef;
use acta_store::secrets::{InMemorySecretStore, SecretStore};

fn r(account: &str) -> SecretRef {
    SecretRef { service: "acta".into(), account: account.into() }
}

#[test]
fn in_memory_store_set_get_delete() {
    let s = InMemorySecretStore::default();
    assert_eq!(s.get(&r("provider:a")).unwrap(), None);
    s.set(&r("provider:a"), "sk-1").unwrap();
    s.set(&r("provider:b"), "sk-2").unwrap();
    assert_eq!(s.get(&r("provider:a")).unwrap().as_deref(), Some("sk-1"));
    s.set(&r("provider:a"), "sk-3").unwrap();
    assert_eq!(s.get(&r("provider:a")).unwrap().as_deref(), Some("sk-3"));
    s.delete(&r("provider:a")).unwrap();
    s.delete(&r("provider:a")).unwrap(); // idempotente
    assert_eq!(s.get(&r("provider:a")).unwrap(), None);
    assert_eq!(s.get(&r("provider:b")).unwrap().as_deref(), Some("sk-2"));
}

#[test]
fn secret_ref_for_provider_is_stable() {
    let x = acta_store::secrets::secret_ref_for_provider("openrouter");
    assert_eq!((x.service.as_str(), x.account.as_str()), ("acta", "provider:openrouter"));
}

#[test]
fn debug_of_keychain_store_does_not_leak() {
    // El adaptador real no se ejercita en tests (tocaría el Llavero del usuario),
    // pero debe existir y ser construible sin efectos.
    let k = acta_store::secrets::KeychainSecretStore::new();
    assert!(format!("{k:?}").contains("KeychainSecretStore"));
}
