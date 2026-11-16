//! Aprender una huella de voz cuando el usuario CONFIRMA un nombre
//! (`speaker_rename` con `remember: true`). Solo se guarda el embedding.

use crate::vectors_math::{merge_mean, normalize};
use acta_core::ids::{MeetingId, SpeakerId, VoiceprintId};
use acta_core::layout::DataLayout;
use acta_core::library::{MeetingStore, VoiceprintStore};
use acta_core::time::UnixMs;
use acta_core::transcription::{DiarizationResult, Voiceprint};
use acta_core::{PortError, PortResult};

/// Renombra (confirmado) y, si `remember`, crea o refuerza la huella con el
/// embedding del hablante en esta reunión. Devuelve la huella si la hubo.
#[allow(clippy::too_many_arguments)]
pub async fn rename_speaker(
    layout: &DataLayout,
    store: &dyn MeetingStore,
    voiceprints: &dyn VoiceprintStore,
    meeting_id: MeetingId,
    speaker_id: SpeakerId,
    display_name: String,
    remember: bool,
    now: UnixMs,
) -> PortResult<Option<VoiceprintId>> {
    let name = display_name.trim().to_owned();
    if name.is_empty() {
        return Err(PortError::InvalidInput("el nombre no puede estar vacío".into()));
    }
    store.rename_speaker(meeting_id, speaker_id, name.clone(), true).await?;
    if !remember {
        return Ok(None);
    }
    let transcript = store
        .get_transcript(meeting_id)
        .await?
        .ok_or_else(|| PortError::NotFound(format!("reunión {meeting_id}")))?;
    let speaker = transcript
        .speakers
        .iter()
        .find(|s| s.id == speaker_id)
        .ok_or_else(|| PortError::NotFound(format!("hablante {speaker_id}")))?;
    let Some(label) = speaker.diarization_label.clone() else {
        return Ok(None); // "Yo" o sin diarización: no hay embedding
    };
    let bytes = std::fs::read(layout.diarization_cache_json(meeting_id))?;
    let diar: DiarizationResult = serde_json::from_slice(&bytes)?;
    let Some(emb) = diar.speakers.iter().find(|s| s.label == label).map(|s| s.embedding.clone()).filter(|e| !e.is_empty()) else {
        return Ok(None);
    };
    let existing = voiceprints
        .nearest_voiceprint(&emb, &diar.embedding_model, 0.0)
        .await?
        .map(|(vp, _)| vp)
        .filter(|vp| vp.display_name.trim().eq_ignore_ascii_case(&name) || Some(vp.id) == speaker.voiceprint_id);
    let vp = match existing {
        Some(mut vp) => {
            vp.embedding = merge_mean(&vp.embedding, vp.samples, &emb);
            vp.samples += 1;
            vp.display_name = name;
            vp.updated_at = now;
            vp
        }
        None => Voiceprint {
            id: VoiceprintId::new(),
            display_name: name,
            embedding: normalize(&emb),
            model: diar.embedding_model.clone(),
            samples: 1,
            created_at: now,
            updated_at: now,
        },
    };
    let id = vp.id;
    voiceprints.upsert_voiceprint(vp).await?;
    store.link_speaker_voiceprint(speaker_id, Some(id)).await?;
    Ok(Some(id))
}
