//! `MeetingDetector` sobre el sidecar: `detect.start` + `detect.signal`, con
//! la fusión y el antirrebote aquí en Rust ([`fusion`]).

pub mod fusion;

use crate::client::{SidecarClient, SidecarMessage};
use crate::protocol::{AppRuleWire, Command, DetectStartArgs, Event};
use crate::task::{Slot, spawn_stream};
use acta_core::detection::{DetectionConfig, DetectionEvent, MeetingDetector, Platform};
use acta_core::time::{Clock, SystemClock};
use acta_core::{EventStream, PortResult};
use async_trait::async_trait;
use fusion::{DetectionFusion, FusionTiming};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;

pub struct MacMeetingDetector {
    client: SidecarClient,
    clock: Arc<dyn Clock>,
    tick: Duration,
    task: Slot,
}

impl MacMeetingDetector {
    pub fn new(client: SidecarClient) -> Self {
        Self::with_clock(client, Arc::new(SystemClock), Duration::from_millis(250))
    }

    pub fn with_clock(client: SidecarClient, clock: Arc<dyn Clock>, tick: Duration) -> Self {
        Self {
            client,
            clock,
            tick,
            task: Slot::default(),
        }
    }
}

pub(crate) fn platform_wire(p: Platform) -> &'static str {
    match p {
        Platform::Teams => "teams",
        Platform::Meet => "meet",
        Platform::Zoom => "zoom",
        Platform::Slack => "slack",
        Platform::Other => "other",
    }
}

fn start_command(config: &DetectionConfig) -> Command {
    Command::DetectStart(DetectStartArgs {
        rules: config
            .rules
            .iter()
            .map(|r| AppRuleWire {
                bundle_id: r.bundle_id.clone(),
                platform: platform_wire(r.platform).into(),
                is_browser: r.is_browser,
            })
            .collect(),
        meet_url_patterns: config.meet_url_patterns.clone(),
        poll_ms: config.poll_ms,
    })
}

#[async_trait]
impl MeetingDetector for MacMeetingDetector {
    async fn start(&self, config: DetectionConfig) -> PortResult<EventStream<DetectionEvent>> {
        self.task.cancel();
        let mut rx = self.client.subscribe();
        self.client.call(start_command(&config), None).await?;
        let client = self.client.clone();
        let clock = self.clock.clone();
        let tick = self.tick;
        let (stream, handle) = spawn_stream(move |tx| async move {
            let mut fusion = DetectionFusion::new(config.rules.clone(), FusionTiming::new(config.debounce_ms));
            let mut interval = tokio::time::interval(tick);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                let events = tokio::select! {
                    _ = interval.tick() => fusion.tick(clock.now()),
                    msg = rx.recv() => match msg {
                        Ok(SidecarMessage::Event(env)) => match env.event {
                            Event::DetectSignal(sig) => fusion.on_signal(&sig, clock.now()),
                            _ => continue,
                        },
                        Ok(SidecarMessage::Restarted { .. }) => {
                            fusion.reset_signals(clock.now());
                            if let Err(e) = client.call(start_command(&config), None).await {
                                tracing::warn!("detect.start after restart failed: {e}");
                            }
                            continue;
                        }
                        Ok(SidecarMessage::GaveUp { .. }) | Err(RecvError::Closed) => return,
                        Err(RecvError::Lagged(n)) => {
                            tracing::warn!("detection lagged {n} sidecar messages");
                            continue;
                        }
                    },
                };
                for ev in events {
                    if tx.send(ev).await.is_err() {
                        return;
                    }
                }
            }
        });
        self.task.set(handle);
        Ok(stream)
    }

    async fn stop(&self) -> PortResult<()> {
        self.task.cancel();
        self.client.call(Command::DetectStop, None).await.map(|_| ())
    }
}
