//! Identificadores tipados. Todos son UUID v7 (ordenables por tiempo) y se
//! serializan como string.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

macro_rules! uuid_id {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub uuid::Uuid);

        impl $name {
            /// Nuevo id UUID v7.
            pub fn new() -> Self {
                Self(uuid::Uuid::now_v7())
            }
            /// Id determinista para tests (`n` en los últimos bytes).
            pub fn from_u128(n: u128) -> Self {
                Self(uuid::Uuid::from_u128(n))
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                uuid::Uuid::parse_str(s).map(Self)
            }
        }
    };
}

uuid_id!(
    /// Una reunión. Una sesión de grabación produce exactamente una reunión y
    /// comparten id (la carpeta `meetings/<MeetingId>/`).
    MeetingId
);
uuid_id!(SpeakerId);
uuid_id!(ActionItemId);
uuid_id!(DecisionId);
uuid_id!(CaptureId);
uuid_id!(GroupId);
uuid_id!(VoiceprintId);
uuid_id!(ChatThreadId);
uuid_id!(ChatMessageId);
uuid_id!(PromptId);
uuid_id!(JobId);

/// Id de un proveedor LLM configurado por el usuario (p. ej. "claude-cli").
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProviderId(pub String);

impl fmt::Display for ProviderId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<&str> for ProviderId {
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}
