//! ASR, diarización, previsualización en vivo, huellas de voz y modelos
//! (FluidAudio en el sidecar).
//!
//! Los trabajos largos (`asr.transcribe`, `diarize.run`) escriben su salida en
//! `transcript/` de la reunión (vía `.tmp` + rename en Swift) y aquí se leen.
//! Si el futuro se suelta a medias (cancelación), se envía `job.cancel`.

use crate::client::{SidecarClient, SidecarMessage};
use crate::protocol::{
    AsrFile, AsrLiveStartArgs, AsrTranscribeArgs, Command, DiarizationFile, DiarizeRunArgs, Event, JobCancelArgs,
    ModelStatusWire, ModelsDownloadArgs, ModelsStatusResult, SpanMs, TrackName, VoiceprintEmbedArgs,
    VoiceprintEmbedResult,
};
use crate::task::{Slot, spawn_stream};
use acta_core::api::events::ModelDownload;
use acta_core::ids::{JobId, MeetingId};
use acta_core::layout::DataLayout;
use acta_core::recording::Track;
use acta_core::time::UnixMs;
use acta_core::transcription::{
    AsrSegment, AsrWord, DiarizationResult, DiarizationTurn, DiarizeOptions, DiarizedSpeaker, Diarizer, LivePartial,
    LiveTranscriber, ProgressFn, TranscribeRequest, Transcriber,
};
use acta_core::{EventStream, PortError, PortResult};
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;

pub const ASR_MODEL: &str = "parakeet-tdt-0.6b-v3";
/// Tope de un trabajo offline (reunión de 4 h a ~100x tiempo real + descarga).
const JOB_TIMEOUT: Duration = Duration::from_secs(3 * 3600);

/// `meetings/<id>/audio/<track>.wav` → `(DataLayout, MeetingId)`.
fn meeting_of(wav: &Path) -> Option<(DataLayout, MeetingId)> {
    let audio = wav.parent()?;
    if audio.file_name()? != "audio" {
        return None;
    }
    let meeting_dir = audio.parent()?;
    let id: MeetingId = meeting_dir.file_name()?.to_str()?.parse().ok()?;
    let meetings = meeting_dir.parent()?;
    if meetings.file_name()? != "meetings" {
        return None;
    }
    Some((DataLayout::new(meetings.parent()?), id))
}

/// Dónde se escribe el `AsrFile`: el del layout si el WAV es de una reunión;
/// si no, junto al WAV.
pub(crate) fn asr_out_path(wav: &Path, track: Track) -> PathBuf {
    match meeting_of(wav) {
        Some((layout, id)) => layout.asr_json(id, track),
        None => wav.with_extension(format!("asr-{}.json", track.as_str())),
    }
}

pub(crate) fn diarization_out_path(wav: &Path) -> PathBuf {
    match meeting_of(wav) {
        Some((layout, id)) => layout.diarization_json(id),
        None => wav.with_extension("diarization.json"),
    }
}

fn track_to_wire(t: Track) -> TrackName {
    match t {
        Track::Mic => TrackName::Mic,
        Track::System => TrackName::System,
    }
}

fn path_str(p: &Path) -> PortResult<String> {
    p.to_str()
        .map(str::to_owned)
        .ok_or_else(|| PortError::InvalidInput(format!("non UTF-8 path {}", p.display())))
}

/// Envía `job.cancel` si el trabajo no terminó (futuro soltado).
struct CancelOnDrop {
    client: SidecarClient,
    job_id: Option<String>,
}

impl CancelOnDrop {
    fn done(mut self) {
        self.job_id = None;
    }
}

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if let Some(job_id) = self.job_id.take() {
            let client = self.client.clone();
            if let Ok(rt) = tokio::runtime::Handle::try_current() {
                rt.spawn(async move {
                    let _ = client.call(Command::JobCancel(JobCancelArgs { job_id }), None).await;
                });
            }
        }
    }
}

/// Ejecuta un trabajo largo reenviando su `job.progress` a `progress`.
async fn run_job(
    client: &SidecarClient,
    job_id: String,
    command: Command,
    progress: Option<ProgressFn>,
) -> PortResult<serde_json::Value> {
    let guard = CancelOnDrop {
        client: client.clone(),
        job_id: Some(job_id.clone()),
    };
    let mut rx = client.subscribe();
    let call = client.call(command, Some(JOB_TIMEOUT));
    tokio::pin!(call);
    let result = loop {
        tokio::select! {
            res = &mut call => break res,
            msg = rx.recv() => match msg {
                Ok(SidecarMessage::Event(env)) => {
                    if let (Event::JobProgress(p), Some(f)) = (env.event, progress.as_ref())
                        && p.job_id == job_id {
                            f(p.fraction.clamp(0.0, 1.0));
                        }
                }
                Ok(_) | Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => break (&mut call).await,
            },
        }
    };
    guard.done();
    result
}

async fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> PortResult<T> {
    let bytes = tokio::fs::read(path).await?;
    serde_json::from_slice(&bytes).map_err(|e| PortError::InvalidResponse(format!("{}: {e}", path.display())))
}

// ---------------------------------------------------------------------------
// Transcriber
// ---------------------------------------------------------------------------

pub struct MacTranscriber {
    client: SidecarClient,
}

impl MacTranscriber {
    pub fn new(client: SidecarClient) -> Self {
        Self { client }
    }
}

pub(crate) fn segments_from_file(file: AsrFile) -> Vec<AsrSegment> {
    file.segments
        .into_iter()
        .map(|s| AsrSegment {
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            text: s.text,
            confidence: s.confidence,
            words: s
                .words
                .into_iter()
                .map(|w| AsrWord {
                    start_ms: w.start_ms,
                    end_ms: w.end_ms,
                    text: w.text,
                })
                .collect(),
        })
        .collect()
}

#[async_trait]
impl Transcriber for MacTranscriber {
    async fn transcribe(&self, request: TranscribeRequest, progress: Option<ProgressFn>) -> PortResult<Vec<AsrSegment>> {
        let out = asr_out_path(&request.wav_path, request.track);
        let job_id = JobId::new().to_string();
        let command = Command::AsrTranscribe(AsrTranscribeArgs {
            job_id: job_id.clone(),
            wav_path: path_str(&request.wav_path)?,
            out_path: path_str(&out)?,
            language: request.language,
            model: ASR_MODEL.into(),
        });
        run_job(&self.client, job_id, command, progress).await?;
        Ok(segments_from_file(read_json(&out).await?))
    }
}

// ---------------------------------------------------------------------------
// Diarizer
// ---------------------------------------------------------------------------

pub struct MacDiarizer {
    client: SidecarClient,
}

impl MacDiarizer {
    pub fn new(client: SidecarClient) -> Self {
        Self { client }
    }
}

pub(crate) fn diarization_from_file(file: DiarizationFile) -> DiarizationResult {
    DiarizationResult {
        turns: file
            .turns
            .into_iter()
            .map(|t| DiarizationTurn {
                label: t.label,
                start_ms: t.start_ms,
                end_ms: t.end_ms,
            })
            .collect(),
        speakers: file
            .speakers
            .into_iter()
            .map(|s| DiarizedSpeaker {
                label: s.label,
                embedding: s.embedding,
                total_ms: s.total_ms,
            })
            .collect(),
        embedding_model: file.embedding_model,
    }
}

#[async_trait]
impl Diarizer for MacDiarizer {
    async fn diarize(&self, wav_path: &Path, options: DiarizeOptions, progress: Option<ProgressFn>) -> PortResult<DiarizationResult> {
        let out = diarization_out_path(wav_path);
        let job_id = JobId::new().to_string();
        let command = Command::DiarizeRun(DiarizeRunArgs {
            job_id: job_id.clone(),
            wav_path: path_str(wav_path)?,
            out_path: path_str(&out)?,
            num_speakers: options.num_speakers,
            min_speakers: options.min_speakers,
            max_speakers: options.max_speakers,
        });
        run_job(&self.client, job_id, command, progress).await?;
        Ok(diarization_from_file(read_json(&out).await?))
    }
}

// ---------------------------------------------------------------------------
// LiveTranscriber
// ---------------------------------------------------------------------------

pub struct MacLiveTranscriber {
    client: SidecarClient,
    task: Slot,
}

impl MacLiveTranscriber {
    pub fn new(client: SidecarClient) -> Self {
        Self {
            client,
            task: Slot::default(),
        }
    }
}

#[async_trait]
impl LiveTranscriber for MacLiveTranscriber {
    async fn start(&self, tracks: &[Track], language: Option<String>) -> PortResult<EventStream<LivePartial>> {
        self.task.cancel();
        let args = AsrLiveStartArgs {
            tracks: tracks.iter().copied().map(track_to_wire).collect(),
            language,
        };
        let mut rx = self.client.subscribe();
        self.client.call(Command::AsrLiveStart(args.clone()), Some(Duration::from_secs(120))).await?;
        let client = self.client.clone();
        let (stream, handle) = spawn_stream(move |tx| async move {
            loop {
                let partial = match rx.recv().await {
                    Ok(SidecarMessage::Event(env)) => match env.event {
                        Event::AsrPartial(p) => LivePartial {
                            track: crate::audio::track(p.track),
                            text: p.text,
                            at: UnixMs(p.at_unix_ms),
                            is_final: p.is_final,
                        },
                        _ => continue,
                    },
                    Ok(SidecarMessage::Restarted { .. }) => {
                        let _ = client.call(Command::AsrLiveStart(args.clone()), Some(Duration::from_secs(120))).await;
                        continue;
                    }
                    Ok(SidecarMessage::GaveUp { .. }) | Err(RecvError::Closed) => return,
                    Err(RecvError::Lagged(_)) => continue,
                };
                if tx.send(partial).await.is_err() {
                    return;
                }
            }
        });
        self.task.set(handle);
        Ok(stream)
    }

    async fn stop(&self) -> PortResult<()> {
        self.task.cancel();
        self.client.call(Command::AsrLiveStop, None).await.map(|_| ())
    }
}

// ---------------------------------------------------------------------------
// Huellas de voz y modelos (sin puerto en acta-core: los usa WP6/WP1 directamente)
// ---------------------------------------------------------------------------

pub struct MacVoiceprints {
    client: SidecarClient,
}

impl MacVoiceprints {
    pub fn new(client: SidecarClient) -> Self {
        Self { client }
    }

    /// Embedding medio de los tramos `(start_ms, end_ms)` del WAV. Devuelve
    /// `(embedding, model)`; las huellas solo se comparan con el mismo `model`.
    pub async fn embed(&self, wav: &Path, spans: &[(u64, u64)]) -> PortResult<(Vec<f32>, String)> {
        let res: VoiceprintEmbedResult = self
            .client
            .call_typed(
                Command::VoiceprintEmbed(VoiceprintEmbedArgs {
                    wav_path: path_str(wav)?,
                    spans: spans
                        .iter()
                        .map(|&(start_ms, end_ms)| SpanMs { start_ms, end_ms })
                        .collect(),
                }),
                Some(Duration::from_secs(600)),
            )
            .await?;
        Ok((res.embedding, res.model))
    }
}

pub struct MacModels {
    client: SidecarClient,
}

impl MacModels {
    pub fn new(client: SidecarClient) -> Self {
        Self { client }
    }

    pub async fn status(&self) -> PortResult<Vec<ModelStatusWire>> {
        let res: ModelsStatusResult = self.client.call_typed(Command::ModelsStatus, None).await?;
        Ok(res.models)
    }

    /// Lanza la descarga (`asr` | `diarizer` | `vad`). El stream termina con
    /// el evento `done` (o con error).
    pub async fn download(&self, name: &str) -> PortResult<EventStream<ModelDownload>> {
        let mut rx = self.client.subscribe();
        self.client
            .call(Command::ModelsDownload(ModelsDownloadArgs { name: name.into() }), None)
            .await?;
        let name = name.to_owned();
        let (stream, _handle) = spawn_stream(move |tx| async move {
            loop {
                let msg = tokio::select! {
                    _ = tx.closed() => return,
                    msg = rx.recv() => msg,
                };
                match msg {
                    Ok(SidecarMessage::Event(env)) => {
                        if let Event::ModelsProgress(p) = env.event {
                            if p.name != name {
                                continue;
                            }
                            let done = p.done || p.error.is_some();
                            let ev = ModelDownload {
                                name: p.name,
                                fraction: p.fraction,
                                done: p.done,
                                error: p.error,
                            };
                            if tx.send(ev).await.is_err() || done {
                                return;
                            }
                        }
                    }
                    Ok(SidecarMessage::Restarted { .. }) | Ok(SidecarMessage::GaveUp { .. }) => {
                        let _ = tx
                            .send(ModelDownload {
                                name: name.clone(),
                                fraction: 0.0,
                                done: false,
                                error: Some("sidecar restarted during download".into()),
                            })
                            .await;
                        return;
                    }
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => return,
                }
            }
        });
        Ok(stream)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn out_paths_follow_the_data_layout() {
        let layout = DataLayout::new("/data");
        let id = MeetingId::from_u128(3);
        let wav = layout.track_wav(id, Track::Mic);
        assert_eq!(asr_out_path(&wav, Track::Mic), layout.asr_json(id, Track::Mic));
        assert_eq!(diarization_out_path(&wav), layout.diarization_json(id));
    }

    #[test]
    fn out_paths_outside_a_meeting_sit_next_to_the_wav() {
        let wav = Path::new("/tmp/x/audio.wav");
        assert_eq!(asr_out_path(wav, Track::System), PathBuf::from("/tmp/x/audio.asr-system.json"));
        assert_eq!(diarization_out_path(wav), PathBuf::from("/tmp/x/audio.diarization.json"));
    }
}
