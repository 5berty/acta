//! `PermissionsProbe` sobre el sidecar (`permissions.status` / `.request`).
//! Los permisos TCC se atribuyen a acta.app (proceso responsable del sidecar).

use crate::client::SidecarClient;
use crate::protocol::{
    Command, PermissionName, PermissionStatusName, PermissionsRequestArgs, PermissionsRequestResult,
    PermissionsStatusResult,
};
use acta_core::PortResult;
use acta_core::permissions::{PermissionKind, PermissionState, PermissionStatus, PermissionsProbe};
use async_trait::async_trait;
use std::time::Duration;

/// Un diálogo del sistema puede tardar lo que tarde el usuario en contestar.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

pub struct MacPermissions {
    client: SidecarClient,
}

impl MacPermissions {
    pub fn new(client: SidecarClient) -> Self {
        Self { client }
    }
}

pub(crate) fn kind_from_wire(k: PermissionName) -> PermissionKind {
    match k {
        PermissionName::Microphone => PermissionKind::Microphone,
        PermissionName::SystemAudio => PermissionKind::SystemAudio,
        PermissionName::ScreenRecording => PermissionKind::ScreenRecording,
        PermissionName::Accessibility => PermissionKind::Accessibility,
        PermissionName::Automation => PermissionKind::Automation,
    }
}

pub(crate) fn kind_to_wire(k: PermissionKind) -> PermissionName {
    match k {
        PermissionKind::Microphone => PermissionName::Microphone,
        PermissionKind::SystemAudio => PermissionName::SystemAudio,
        PermissionKind::ScreenRecording => PermissionName::ScreenRecording,
        PermissionKind::Accessibility => PermissionName::Accessibility,
        PermissionKind::Automation => PermissionName::Automation,
    }
}

pub(crate) fn status_from_wire(s: PermissionStatusName) -> PermissionStatus {
    match s {
        PermissionStatusName::Granted => PermissionStatus::Granted,
        PermissionStatusName::Denied => PermissionStatus::Denied,
        PermissionStatusName::NotDetermined => PermissionStatus::NotDetermined,
        PermissionStatusName::Unknown => PermissionStatus::Unknown,
    }
}

#[async_trait]
impl PermissionsProbe for MacPermissions {
    async fn status(&self) -> PortResult<Vec<PermissionState>> {
        let res: PermissionsStatusResult = self.client.call_typed(Command::PermissionsStatus, None).await?;
        Ok(res
            .permissions
            .into_iter()
            .map(|p| PermissionState {
                kind: kind_from_wire(p.kind),
                status: status_from_wire(p.status),
                target: p.target,
            })
            .collect())
    }

    async fn request(&self, kind: PermissionKind) -> PortResult<PermissionStatus> {
        let res: PermissionsRequestResult = self
            .client
            .call_typed(
                Command::PermissionsRequest(PermissionsRequestArgs {
                    kind: kind_to_wire(kind),
                    target: None,
                }),
                Some(REQUEST_TIMEOUT),
            )
            .await?;
        Ok(status_from_wire(res.status))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_round_trip() {
        for k in [
            PermissionKind::Microphone,
            PermissionKind::SystemAudio,
            PermissionKind::ScreenRecording,
            PermissionKind::Accessibility,
            PermissionKind::Automation,
        ] {
            assert_eq!(kind_from_wire(kind_to_wire(k)), k);
        }
    }
}
