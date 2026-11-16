//! Cola de procesado en segundo plano. Un trabajo cada vez, en orden de
//! llegada; NUNCA bloquea una grabación nueva (el supervisor solo encola).

use super::{Msg, SupervisorEvent};
use acta_core::api::MeetingUpdated;
use acta_core::ids::MeetingId;
use acta_core::library::{MeetingPatch, MeetingStatus, MeetingStore};
use acta_core::processing::{ProcessingPipeline, ProcessingProgress, ProcessingStep, ProgressSink};
use acta_core::recording::SessionEvent;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tokio::sync::mpsc::{self, UnboundedSender};

pub(crate) struct Job {
    pub meeting_id: MeetingId,
    pub steps: Vec<ProcessingStep>,
}

#[derive(Clone)]
pub(crate) struct Queue {
    tx: UnboundedSender<Job>,
}

impl Queue {
    pub fn enqueue(&self, meeting_id: MeetingId, steps: Vec<ProcessingStep>) {
        if self.tx.send(Job { meeting_id, steps }).is_err() {
            tracing::error!(%meeting_id, "la cola de procesado está cerrada");
        }
    }
}

struct Sink {
    meeting_id: MeetingId,
    events: broadcast::Sender<SupervisorEvent>,
    actor: UnboundedSender<Msg>,
    last: Mutex<Option<ProcessingStep>>,
}

impl ProgressSink for Sink {
    fn progress(&self, meeting_id: MeetingId, step: ProcessingStep, fraction: f32) {
        let _ = self.events.send(SupervisorEvent::Processing(ProcessingProgress {
            meeting_id,
            step,
            fraction: fraction.clamp(0.0, 1.0),
        }));
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if *last != Some(step) {
            *last = Some(step);
            let _ = self.actor.send(Msg::Processing(SessionEvent::ProcessingProgress {
                meeting_id: self.meeting_id,
                step,
            }));
        }
    }
}

async fn set_status(
    store: &Arc<dyn MeetingStore>,
    events: &broadcast::Sender<SupervisorEvent>,
    id: MeetingId,
    status: MeetingStatus,
    error: Option<String>,
) {
    let patch = MeetingPatch {
        status: Some(status),
        error: Some(error),
        ..MeetingPatch::default()
    };
    match store.patch_meeting(id, patch).await {
        Ok(m) => {
            let _ = events.send(SupervisorEvent::MeetingUpdated(MeetingUpdated {
                meeting_id: id,
                status,
                title: m.title,
            }));
        }
        Err(e) => tracing::warn!(%id, "no se pudo actualizar el estado de la reunión: {e}"),
    }
}

pub(crate) fn spawn_queue(
    store: Arc<dyn MeetingStore>,
    pipeline: Arc<dyn ProcessingPipeline>,
    events: broadcast::Sender<SupervisorEvent>,
    actor: UnboundedSender<Msg>,
) -> Queue {
    let (tx, mut rx) = mpsc::unbounded_channel::<Job>();
    tokio::spawn(async move {
        while let Some(job) = rx.recv().await {
            let id = job.meeting_id;
            set_status(&store, &events, id, MeetingStatus::Processing, None).await;
            let sink = Sink {
                meeting_id: id,
                events: events.clone(),
                actor: actor.clone(),
                last: Mutex::new(None),
            };
            let steps = if job.steps.is_empty() {
                ProcessingStep::ORDER[1..].to_vec()
            } else {
                job.steps
            };
            match pipeline.run(id, &steps, &sink).await {
                Ok(()) => {
                    set_status(&store, &events, id, MeetingStatus::Ready, None).await;
                    let _ = actor.send(Msg::Processing(SessionEvent::ProcessingFinished { meeting_id: id }));
                }
                Err(e) => {
                    let error = match e {
                        acta_core::PortError::Internal(m) => m,
                        other => other.to_string(),
                    };
                    tracing::error!(%id, "procesado fallido: {error}");
                    set_status(&store, &events, id, MeetingStatus::Failed, Some(error.clone())).await;
                    let _ = actor.send(Msg::Processing(SessionEvent::ProcessingFailed { meeting_id: id, error }));
                }
            }
        }
    });
    Queue { tx }
}
