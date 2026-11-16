//! `ScreenCapturer` sobre el sidecar (ScreenCaptureKit + dHash en Swift).
//!
//! - `screen.share_state` → `ShareStarted` / `ShareEnded` (sin repetir: AX y
//!   el fallback por frames pueden decir lo mismo dos veces).
//! - `screen.frame` → `FrameSaved` (slide_change y candidate).
//! - `snapshot` devuelve el frame en la respuesta; el sidecar NO lo repite
//!   como evento `screen.frame` (así no se guarda dos veces).

use crate::client::{SidecarClient, SidecarMessage};
use crate::protocol::{
    CaptureReasonName, Command, Event, ScreenFrameEvent, ScreenSnapshotArgs, ScreenSnapshotResult, ScreenStartArgs,
};
use crate::task::{Slot, spawn_stream};
use acta_core::screen::{CaptureReason, CapturedFrame, ScreenCaptureRequest, ScreenCapturer, ScreenEvent};
use acta_core::time::UnixMs;
use acta_core::{EventStream, PortResult};
use async_trait::async_trait;
use tokio::sync::broadcast::error::RecvError;

pub struct MacScreenCapturer {
    client: SidecarClient,
    task: Slot,
}

impl MacScreenCapturer {
    pub fn new(client: SidecarClient) -> Self {
        Self {
            client,
            task: Slot::default(),
        }
    }
}

pub(crate) fn reason_to_wire(r: CaptureReason) -> CaptureReasonName {
    match r {
        CaptureReason::SlideChange => CaptureReasonName::SlideChange,
        CaptureReason::Keyword => CaptureReasonName::Keyword,
        CaptureReason::LlmPick => CaptureReasonName::LlmPick,
        CaptureReason::Manual => CaptureReasonName::Manual,
        CaptureReason::Candidate => CaptureReasonName::Candidate,
    }
}

pub(crate) fn reason_from_wire(r: CaptureReasonName) -> CaptureReason {
    match r {
        CaptureReasonName::SlideChange => CaptureReason::SlideChange,
        CaptureReasonName::Keyword => CaptureReason::Keyword,
        CaptureReasonName::LlmPick => CaptureReason::LlmPick,
        CaptureReasonName::Manual => CaptureReason::Manual,
        CaptureReasonName::Candidate => CaptureReason::Candidate,
    }
}

pub(crate) fn frame_from_wire(f: ScreenFrameEvent) -> CapturedFrame {
    CapturedFrame {
        path: f.path.into(),
        at: UnixMs(f.at_unix_ms),
        reason: reason_from_wire(f.reason),
        phash: f.phash,
        width: f.width,
        height: f.height,
        keyword: f.keyword,
    }
}

fn start_args(r: &ScreenCaptureRequest) -> ScreenStartArgs {
    ScreenStartArgs {
        session_id: r.meeting_id.to_string(),
        pid: r.app.pid,
        bundle_id: r.app.bundle_id.clone(),
        window_title_hint: r.app.title.clone(),
        out_dir: r.out_dir.display().to_string(),
        candidates_dir: r.candidates_dir.display().to_string(),
        fps: r.fps,
        phash_threshold: r.phash_threshold,
        stable_frames: r.stable_frames,
        candidate_every_s: r.candidate_every_s,
        ring_seconds: r.ring_seconds,
        max_width: r.max_width,
        format: "jpeg".into(),
    }
}

#[async_trait]
impl ScreenCapturer for MacScreenCapturer {
    async fn start(&self, request: ScreenCaptureRequest) -> PortResult<EventStream<ScreenEvent>> {
        self.task.cancel();
        let args = start_args(&request);
        let mut rx = self.client.subscribe();
        self.client.call(Command::ScreenStart(args.clone()), None).await?;
        let client = self.client.clone();
        let (stream, handle) = spawn_stream(move |tx| async move {
            let mut sharing = false;
            loop {
                let ev = match rx.recv().await {
                    Ok(SidecarMessage::Event(env)) => match env.event {
                        Event::ScreenShareState(s) if s.sharing != sharing => {
                            sharing = s.sharing;
                            let at = UnixMs(env.ts);
                            if s.sharing {
                                ScreenEvent::ShareStarted {
                                    presenter: s.presenter,
                                    at,
                                }
                            } else {
                                ScreenEvent::ShareEnded { at }
                            }
                        }
                        Event::ScreenFrame(f) => ScreenEvent::FrameSaved {
                            frame: frame_from_wire(f),
                        },
                        _ => continue,
                    },
                    Ok(SidecarMessage::Restarted { .. }) => {
                        if let Err(e) = client.call(Command::ScreenStart(args.clone()), None).await {
                            tracing::warn!("screen.start after restart failed: {e}");
                        }
                        continue;
                    }
                    Ok(SidecarMessage::GaveUp { .. }) | Err(RecvError::Closed) => return,
                    Err(RecvError::Lagged(_)) => continue,
                };
                if tx.send(ev).await.is_err() {
                    return;
                }
            }
        });
        self.task.set(handle);
        Ok(stream)
    }

    async fn snapshot(&self, reason: CaptureReason, at: UnixMs, keyword: Option<String>) -> PortResult<Option<CapturedFrame>> {
        let res: ScreenSnapshotResult = self
            .client
            .call_typed(
                Command::ScreenSnapshot(ScreenSnapshotArgs {
                    reason: reason_to_wire(reason),
                    at_unix_ms: at.0,
                    keyword,
                }),
                None,
            )
            .await?;
        Ok(res.frame.map(frame_from_wire))
    }

    async fn stop(&self) -> PortResult<()> {
        self.task.cancel();
        self.client.call(Command::ScreenStop, None).await.map(|_| ())
    }
}
