//! `SpeakerNameSource` sobre el sidecar: `speakers.watch` + eventos
//! `speakers.roster` / `speakers.active` (AX sobre Teams). Si AX falla, el
//! sidecar simplemente no emite nada: el stream queda vacío, sin error.

use crate::client::{SidecarClient, SidecarMessage};
use crate::protocol::{Command, Event, SpeakersWatchArgs};
use crate::task::{Slot, spawn_stream};
use acta_core::detection::{MeetingApp, Participant, SpeakerNameSource, SpeakerSignal};
use acta_core::time::UnixMs;
use acta_core::{EventStream, PortResult};
use async_trait::async_trait;
use tokio::sync::broadcast::error::RecvError;

pub struct MacSpeakerNames {
    client: SidecarClient,
    task: Slot,
}

impl MacSpeakerNames {
    pub fn new(client: SidecarClient) -> Self {
        Self {
            client,
            task: Slot::default(),
        }
    }
}

fn map(event: Event, pid: i32, at: UnixMs) -> Option<SpeakerSignal> {
    match event {
        Event::SpeakersRoster(r) if r.pid == pid => Some(SpeakerSignal::Roster {
            participants: r
                .participants
                .into_iter()
                .map(|p| Participant {
                    name: p.name,
                    is_self: p.is_self,
                })
                .collect(),
            at,
        }),
        Event::SpeakersActive(a) if a.pid == pid => Some(SpeakerSignal::Active { names: a.names, at }),
        _ => None,
    }
}

#[async_trait]
impl SpeakerNameSource for MacSpeakerNames {
    async fn watch(&self, app: &MeetingApp) -> PortResult<EventStream<SpeakerSignal>> {
        self.task.cancel();
        let args = SpeakersWatchArgs {
            pid: app.pid,
            bundle_id: app.bundle_id.clone(),
        };
        let mut rx = self.client.subscribe();
        self.client.call(Command::SpeakersWatch(args.clone()), None).await?;
        let client = self.client.clone();
        let (stream, handle) = spawn_stream(move |tx| async move {
            loop {
                let sig = match rx.recv().await {
                    Ok(SidecarMessage::Event(env)) => match map(env.event, args.pid, UnixMs(env.ts)) {
                        Some(s) => s,
                        None => continue,
                    },
                    Ok(SidecarMessage::Restarted { .. }) => {
                        if let Err(e) = client.call(Command::SpeakersWatch(args.clone()), None).await {
                            tracing::warn!("speakers.watch after restart failed: {e}");
                        }
                        continue;
                    }
                    Ok(SidecarMessage::GaveUp { .. }) | Err(RecvError::Closed) => return,
                    Err(RecvError::Lagged(_)) => continue,
                };
                if tx.send(sig).await.is_err() {
                    return;
                }
            }
        });
        self.task.set(handle);
        Ok(stream)
    }

    async fn unwatch(&self) -> PortResult<()> {
        self.task.cancel();
        self.client.call(Command::SpeakersUnwatch, None).await.map(|_| ())
    }
}
