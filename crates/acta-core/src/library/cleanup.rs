//! Sugerir el borrado de reuniones antiguas que ya no hacen falta.
//!
//! Heurística **determinista** (sin LLM) y pura. Una reunión se sugiere solo
//! si cumple TODO esto:
//!
//! 1. Tiene más de `min_age_days` días.
//! 2. No está protegida: sin estrella, fuera de grupos con estrella, sin
//!    «mis tareas» abiertas y sin «Mantener».
//! 3. No se ha abierto, buscado ni usado en el chat en los últimos
//!    `min_age_days` días.
//! 4. Ya no está grabando ni procesando.
//!
//! Nunca se borra nada sola: esto solo produce la lista que el usuario revisa.

use super::model::MeetingStatus;
use crate::ids::MeetingId;
use crate::time::{MediaMs, UnixMs};
use serde::{Deserialize, Serialize};

pub const DAY_MS: i64 = 24 * 60 * 60 * 1000;
/// Por debajo de esto una reunión es «corta».
pub const SHORT_MEETING_MS: u64 = 3 * 60 * 1000;
/// Por debajo de estas palabras transcritas tiene «poco contenido».
pub const LITTLE_CONTENT_WORDS: u32 = 80;

/// Qué uso se apunta en una reunión.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MeetingTouch {
    /// El usuario abrió el detalle (`last_opened_at`).
    Opened,
    /// Salió en una búsqueda o se usó en el chat (`last_used_at`).
    Used,
}

/// Lo que la heurística necesita saber de una reunión.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingCleanupFacts {
    pub id: MeetingId,
    pub title: String,
    pub started_at: UnixMs,
    pub duration: MediaMs,
    pub status: MeetingStatus,
    pub favourite: bool,
    pub in_favourite_group: bool,
    pub my_open_tasks: u32,
    /// El usuario pulsó «Mantener».
    pub keep: bool,
    pub last_opened_at: Option<UnixMs>,
    pub last_used_at: Option<UnixMs>,
    /// Palabras del transcript.
    pub word_count: u32,
    pub has_minutes: bool,
}

/// Por qué se sugiere (la UI lo redacta en castellano).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CleanupReason {
    /// Tiene `days` días.
    Old { days: u32 },
    /// Nunca se abrió, buscó ni usó en el chat.
    NeverUsed,
    /// Último uso hace `days` días.
    UnusedFor { days: u32 },
    /// Dura menos de [`SHORT_MEETING_MS`].
    Short { duration_ms: u64 },
    /// Menos de [`LITTLE_CONTENT_WORDS`] palabras transcritas.
    LittleContent { words: u32 },
    /// El procesado falló y nunca se reintentó.
    Failed,
}

/// Motivos por los que se sugiere borrar la reunión, o `None` si no se sugiere.
pub fn evaluate(f: &MeetingCleanupFacts, min_age_days: u32, now: UnixMs) -> Option<Vec<CleanupReason>> {
    let min_age_ms = i64::from(min_age_days.max(1)) * DAY_MS;
    let age_ms = now.since(f.started_at);
    if age_ms < min_age_ms {
        return None;
    }
    if f.favourite || f.in_favourite_group || f.keep || f.my_open_tasks > 0 {
        return None;
    }
    if matches!(f.status, MeetingStatus::Recording | MeetingStatus::Processing) {
        return None;
    }
    let last_use = f.last_opened_at.max(f.last_used_at);
    if last_use.is_some_and(|t| now.since(t) < min_age_ms) {
        return None;
    }

    let days = |ms: i64| (ms / DAY_MS).max(0) as u32;
    let mut reasons = vec![CleanupReason::Old { days: days(age_ms) }];
    reasons.push(match last_use {
        Some(t) => CleanupReason::UnusedFor { days: days(now.since(t)) },
        None => CleanupReason::NeverUsed,
    });
    if f.status == MeetingStatus::Failed {
        reasons.push(CleanupReason::Failed);
    }
    if f.duration.0 < SHORT_MEETING_MS {
        reasons.push(CleanupReason::Short { duration_ms: f.duration.0 });
    }
    if f.word_count < LITTLE_CONTENT_WORDS {
        reasons.push(CleanupReason::LittleContent { words: f.word_count });
    }
    Some(reasons)
}

/// Una reunión que se sugiere borrar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupCandidate {
    pub meeting_id: MeetingId,
    pub title: String,
    pub started_at: UnixMs,
    pub duration: MediaMs,
    pub reasons: Vec<CleanupReason>,
    /// Lo que ocupa su carpeta (audio, capturas, transcript).
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSuggestions {
    /// De la que menos contenido tiene a la que más.
    pub candidates: Vec<CleanupCandidate>,
    pub total_bytes: u64,
    pub min_age_days: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub deleted: Vec<MeetingId>,
    /// No se borraron: favoritas, en grabación o ya inexistentes.
    pub skipped: Vec<MeetingId>,
    pub freed_bytes: u64,
}

/// Orden de la hoja de revisión: primero las que tienen más motivos (cortas,
/// vacías, fallidas) y, a igualdad, las más antiguas.
pub fn sort_candidates(candidates: &mut [CleanupCandidate]) {
    candidates.sort_by(|a, b| b.reasons.len().cmp(&a.reasons.len()).then(a.started_at.cmp(&b.started_at)));
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: UnixMs = UnixMs(1_800_000_000_000);

    fn days_ago(d: i64) -> UnixMs {
        UnixMs(NOW.0 - d * DAY_MS)
    }

    fn old_meeting() -> MeetingCleanupFacts {
        MeetingCleanupFacts {
            id: MeetingId::from_u128(1),
            title: "Daily".into(),
            started_at: days_ago(120),
            duration: MediaMs(30 * 60_000),
            status: MeetingStatus::Ready,
            favourite: false,
            in_favourite_group: false,
            my_open_tasks: 0,
            keep: false,
            last_opened_at: None,
            last_used_at: None,
            word_count: 2_000,
            has_minutes: true,
        }
    }

    #[test]
    fn an_old_unused_meeting_is_suggested_with_its_reasons() {
        let r = evaluate(&old_meeting(), 90, NOW).expect("candidate");
        assert_eq!(r, vec![CleanupReason::Old { days: 120 }, CleanupReason::NeverUsed]);
    }

    #[test]
    fn a_recent_meeting_is_never_suggested() {
        let mut f = old_meeting();
        f.started_at = days_ago(89);
        assert_eq!(evaluate(&f, 90, NOW), None);
        f.started_at = days_ago(90);
        assert!(evaluate(&f, 90, NOW).is_some());
    }

    #[test]
    fn the_age_is_configurable() {
        let mut f = old_meeting();
        f.started_at = days_ago(40);
        assert!(evaluate(&f, 30, NOW).is_some());
        assert_eq!(evaluate(&f, 180, NOW), None);
    }

    #[test]
    fn favourites_starred_groups_open_tasks_and_kept_meetings_are_protected() {
        let protect: [fn(&mut MeetingCleanupFacts); 4] = [
            |f| f.favourite = true,
            |f| f.in_favourite_group = true,
            |f| f.my_open_tasks = 1,
            |f| f.keep = true,
        ];
        for p in protect {
            let mut f = old_meeting();
            p(&mut f);
            assert_eq!(evaluate(&f, 90, NOW), None, "{f:?}");
        }
    }

    #[test]
    fn opening_or_using_it_recently_protects_it() {
        let mut f = old_meeting();
        f.last_opened_at = Some(days_ago(10));
        assert_eq!(evaluate(&f, 90, NOW), None);
        let mut f = old_meeting();
        f.last_used_at = Some(days_ago(89));
        assert_eq!(evaluate(&f, 90, NOW), None);
        // Un uso antiguo ya no protege y se cuenta el más reciente de los dos.
        let mut f = old_meeting();
        f.last_opened_at = Some(days_ago(110));
        f.last_used_at = Some(days_ago(95));
        assert_eq!(evaluate(&f, 90, NOW).expect("candidate")[1], CleanupReason::UnusedFor { days: 95 });
    }

    #[test]
    fn meetings_still_recording_or_processing_are_left_alone() {
        for status in [MeetingStatus::Recording, MeetingStatus::Processing] {
            let mut f = old_meeting();
            f.status = status;
            assert_eq!(evaluate(&f, 90, NOW), None);
        }
    }

    #[test]
    fn short_empty_and_failed_meetings_say_so() {
        let mut f = old_meeting();
        f.duration = MediaMs(45_000);
        f.word_count = 12;
        f.status = MeetingStatus::Failed;
        let r = evaluate(&f, 90, NOW).expect("candidate");
        assert!(r.contains(&CleanupReason::Short { duration_ms: 45_000 }));
        assert!(r.contains(&CleanupReason::LittleContent { words: 12 }));
        assert!(r.contains(&CleanupReason::Failed));
    }

    #[test]
    fn a_zero_age_setting_does_not_suggest_everything() {
        let mut f = old_meeting();
        f.started_at = UnixMs(NOW.0 - 3_600_000);
        assert_eq!(evaluate(&f, 0, NOW), None);
    }

    #[test]
    fn candidates_with_more_reasons_come_first_then_the_oldest() {
        let c = |n: u128, started: i64, reasons: usize| CleanupCandidate {
            meeting_id: MeetingId::from_u128(n),
            title: String::new(),
            started_at: UnixMs(started),
            duration: MediaMs(0),
            reasons: vec![CleanupReason::NeverUsed; reasons],
            bytes: 0,
        };
        let mut v = vec![c(1, 50, 2), c(2, 10, 2), c(3, 99, 4)];
        sort_candidates(&mut v);
        assert_eq!(v.iter().map(|x| x.meeting_id).collect::<Vec<_>>(), [3, 2, 1].map(MeetingId::from_u128));
    }

    #[test]
    fn reasons_serialise_tagged_in_camel_case() {
        let v = serde_json::to_value(CleanupReason::Short { duration_ms: 5 }).expect("json");
        assert_eq!(v, serde_json::json!({"kind": "short", "durationMs": 5}));
        assert_eq!(serde_json::to_value(MeetingTouch::Opened).expect("json"), "opened");
    }
}
