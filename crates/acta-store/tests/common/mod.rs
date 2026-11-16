#![allow(dead_code, clippy::expect_used, clippy::unwrap_used)]
//! Fixtures compartidos por los tests de integración.

use acta_core::detection::Platform;
use acta_core::ids::*;
use acta_core::library::*;
use acta_core::recording::Track;
use acta_core::time::{ManualClock, MediaMs, UnixMs};
use acta_core::transcription::{NameSource, Speaker, Transcript, Utterance};
use acta_core::library::{EmbedKind, Embedder};
use acta_core::{PortError, PortResult};
use acta_store::SqliteStore;
use async_trait::async_trait;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

pub const T0: i64 = 1_700_000_000_000;

pub fn mid(n: u128) -> MeetingId {
    MeetingId::from_u128(n)
}
pub fn sid(n: u128) -> SpeakerId {
    SpeakerId::from_u128(n)
}

pub fn store() -> (SqliteStore, TempDir, ManualClock) {
    let dir = tempfile::tempdir().expect("tmp");
    let clock = ManualClock::new(UnixMs(T0));
    let s = SqliteStore::open(&dir.path().join("acta.db")).expect("open").with_clock(Arc::new(clock.clone()));
    (s, dir, clock)
}

pub fn store_with_embedder(e: Arc<dyn Embedder>) -> (SqliteStore, TempDir, ManualClock) {
    let (s, d, c) = store();
    (s.with_embedder(e), d, c)
}

pub fn new_meeting(n: u128, title: &str, started: i64) -> NewMeeting {
    NewMeeting {
        id: mid(n),
        title: title.into(),
        platform: Platform::Teams,
        app_bundle_id: Some("com.microsoft.teams2".into()),
        started_at: UnixMs(started),
        language: "es".into(),
    }
}

pub fn speaker(n: u128, meeting: u128, label: &str, track: Track, is_me: bool) -> Speaker {
    Speaker {
        id: sid(n),
        meeting_id: mid(meeting),
        label: label.into(),
        display_name: None,
        is_me,
        track,
        diarization_label: (!is_me).then(|| format!("S{n}")),
        name_source: if is_me { NameSource::Me } else { NameSource::Generic },
        confirmed: false,
        voiceprint_id: None,
    }
}

pub fn utt(idx: u32, speaker_n: u128, track: Track, start: u64, end: u64, text: &str) -> Utterance {
    Utterance { idx, speaker_id: sid(speaker_n), track, start: MediaMs(start), end: MediaMs(end), text: text.into(), confidence: Some(0.9) }
}

/// Meeting + 2 hablantes ("Yo" y "Ana") + las frases dadas (alternan mic/system).
/// Los ids de hablante son `meeting*10+1` (Yo) y `meeting*10+2` (Ana).
pub async fn seed_meeting(s: &SqliteStore, n: u128, title: &str, started: i64, lines: &[&str]) {
    use acta_core::library::MeetingStore;
    s.create_meeting(new_meeting(n, title, started)).await.expect("create");
    let (me, ana) = (n * 10 + 1, n * 10 + 2);
    let utterances = lines
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let (sp, tr) = if i % 2 == 0 { (me, Track::Mic) } else { (ana, Track::System) };
            utt(i as u32, sp, tr, i as u64 * 10_000, i as u64 * 10_000 + 9_000, t)
        })
        .collect();
    s.save_transcript(Transcript {
        meeting_id: mid(n),
        speakers: vec![speaker(me, n, "Yo", Track::Mic, true), speaker(ana, n, "Speaker 1", Track::System, false)],
        utterances,
    })
    .await
    .expect("transcript");
}

/// Embedder falso por temas: cada tema es un eje; sin tema -> eje de "otros".
/// Registra las `EmbedKind` recibidas.
pub struct TopicEmbedder {
    pub topics: Vec<Vec<&'static str>>,
    pub seen: Arc<Mutex<Vec<EmbedKind>>>,
    pub fail: bool,
}

impl TopicEmbedder {
    pub fn new(topics: Vec<Vec<&'static str>>) -> Arc<Self> {
        Arc::new(Self { topics, seen: Arc::default(), fail: false })
    }
    pub fn failing() -> Arc<Self> {
        Arc::new(Self { topics: vec![], seen: Arc::default(), fail: true })
    }
}

#[async_trait]
impl Embedder for TopicEmbedder {
    fn model_id(&self) -> &str {
        "fake-topics"
    }
    fn dims(&self) -> usize {
        384
    }
    async fn embed(&self, texts: Vec<String>, kind: EmbedKind) -> PortResult<Vec<Vec<f32>>> {
        if self.fail {
            return Err(PortError::Unavailable("model missing".into()));
        }
        self.seen.lock().expect("lock").push(kind);
        Ok(texts
            .iter()
            .map(|t| {
                let t = acta_store::text::fold_text(t);
                let mut v = vec![0.0_f32; 384];
                let mut hit = false;
                for (i, words) in self.topics.iter().enumerate() {
                    if words.iter().any(|w| t.contains(w)) {
                        v[i] += 1.0;
                        hit = true;
                    }
                }
                if !hit {
                    v[383] = 1.0;
                }
                v
            })
            .collect())
    }
}
