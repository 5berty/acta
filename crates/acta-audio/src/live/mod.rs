//! Transcripción EN VIVO por ventanas (como Meetily): mientras se graba, cada
//! pocos segundos se transcribe lo nuevo de cada pista con el MISMO
//! `Transcriber` que el procesado (Parakeet en el ANE tarda ≈0,3 s por cada
//! 20 s de audio).
//!
//! - [`LiveTap`]: copia de los samples que el writer escribe en cada pista,
//!   con su posición media (ya alineados y con los huecos rellenos), desde lo
//!   último confirmado.
//! - Ventana = desde lo confirmado hasta el borde en vivo (máx. 24 s). Los
//!   segmentos que acaban antes del borde − margen se CONFIRMAN (ya no
//!   cambian) y la ventana siguiente empieza donde acaba el último; lo demás
//!   es provisional y se vuelve a transcribir con más contexto.
//! - Lo confirmado se guarda en `live/asr-<pista>.json` (`LiveAsrState`). Al
//!   parar, el pipeline solo transcribe la cola desde `coveredMs`
//!   ([`finish_track`]) en vez de toda la reunión.

use crate::fileio::write_atomic;
use acta_core::api::{LIVE_SPEAKER_ME, LIVE_SPEAKER_OTHERS, LiveSegment, LiveTranscript};
use acta_core::ids::MeetingId;
use acta_core::layout::DataLayout;
use acta_core::recording::Track;
use acta_core::time::Clock;
use acta_core::transcription::{AsrSegment, AsrWord, LivePartial, TranscribeRequest, Transcriber};
use acta_core::PortResult;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Ajustes de las ventanas.
#[derive(Debug, Clone)]
pub struct LiveConfig {
    pub rate: u32,
    /// Cada cuánto se mira si hay audio nuevo.
    pub every: Duration,
    /// Audio nuevo mínimo para lanzar una ventana.
    pub min_window_ms: u64,
    /// Ventana máxima (Parakeet trabaja en trozos de 15 s; con 24 s hay contexto).
    pub max_window_ms: u64,
    /// Lo que acaba a menos de esto del borde en vivo sigue siendo provisional.
    pub stable_margin_ms: u64,
    /// Por debajo de esto (dBFS RMS) la ventana es silencio y no se transcribe.
    pub silence_dbfs: f32,
}

impl Default for LiveConfig {
    fn default() -> Self {
        Self {
            rate: 16_000,
            every: Duration::from_secs(3),
            min_window_ms: 1_500,
            max_window_ms: 24_000,
            stable_margin_ms: 1_200,
            silence_dbfs: -50.0,
        }
    }
}

#[derive(Default)]
struct TapTrack {
    /// Posición (sample) de `buf[0]`.
    start: u64,
    buf: Vec<i16>,
}

/// Samples escritos por pista desde lo último confirmado.
#[derive(Default)]
pub struct LiveTap {
    tracks: Mutex<[TapTrack; 2]>,
}

fn ti(track: Track) -> usize {
    match track {
        Track::Mic => 0,
        Track::System => 1,
    }
}

impl LiveTap {
    /// `position` = sample de `data[0]` en la línea media de la pista.
    pub fn append(&self, track: Track, position: u64, data: &[i16]) {
        let mut all = self.tracks.lock().unwrap_or_else(|e| e.into_inner());
        let t = &mut all[ti(track)];
        if t.buf.is_empty() && t.start == 0 {
            t.start = position;
        }
        let end = t.start + t.buf.len() as u64;
        if position > end {
            t.buf.resize(t.buf.len() + (position - end) as usize, 0);
        } else if position < end {
            // Solapa: el writer nunca reescribe, así que se descarta lo repetido.
            let skip = ((end - position) as usize).min(data.len());
            t.buf.extend_from_slice(&data[skip..]);
            return;
        }
        t.buf.extend_from_slice(data);
    }

    /// Sample siguiente al último escrito.
    pub fn end(&self, track: Track) -> u64 {
        let all = self.tracks.lock().unwrap_or_else(|e| e.into_inner());
        let t = &all[ti(track)];
        t.start + t.buf.len() as u64
    }

    /// Hasta `max` samples desde `from` (o desde lo más antiguo que quede).
    pub fn window(&self, track: Track, from: u64, max: u64) -> (u64, Vec<i16>) {
        let all = self.tracks.lock().unwrap_or_else(|e| e.into_inner());
        let t = &all[ti(track)];
        let from = from.max(t.start);
        let a = (from - t.start) as usize;
        let a = a.min(t.buf.len());
        let b = (a + max as usize).min(t.buf.len());
        (t.start + a as u64, t.buf[a..b].to_vec())
    }

    /// Suelta lo anterior a `sample` (ya confirmado).
    pub fn drop_before(&self, track: Track, sample: u64) {
        let mut all = self.tracks.lock().unwrap_or_else(|e| e.into_inner());
        let t = &mut all[ti(track)];
        if sample > t.start {
            let n = ((sample - t.start) as usize).min(t.buf.len());
            t.buf.drain(..n);
            t.start += n as u64;
        }
    }
}

/// Lo confirmado de una pista (`live/asr-<pista>.json`). Tiempos absolutos (media).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveAsrState {
    /// Todo el audio anterior a esto está transcrito y confirmado.
    pub covered_ms: u64,
    pub segments: Vec<AsrSegment>,
}

fn speaker_of(track: Track) -> &'static str {
    match track {
        Track::Mic => LIVE_SPEAKER_ME,
        Track::System => LIVE_SPEAKER_OTHERS,
    }
}

fn shift(mut s: AsrSegment, by: u64) -> AsrSegment {
    s.start_ms += by;
    s.end_ms += by;
    s.words = s.words.into_iter().map(|w| AsrWord { start_ms: w.start_ms + by, end_ms: w.end_ms + by, ..w }).collect();
    s
}

/// Estado en vivo de una pista: confirmado + provisional.
#[derive(Debug, Clone)]
pub struct TrackLive {
    pub track: Track,
    pub state: LiveAsrState,
    pub provisional: Option<LiveSegment>,
}

impl TrackLive {
    pub fn new(track: Track) -> Self {
        Self { track, state: LiveAsrState::default(), provisional: None }
    }

    fn id(&self, index: usize) -> String {
        format!("{}-{index}", self.track.as_str())
    }

    fn live_segment(&self, index: usize, s: &AsrSegment, is_final: bool) -> LiveSegment {
        LiveSegment {
            id: self.id(index),
            speaker: speaker_of(self.track).to_owned(),
            text: s.text.trim().to_owned(),
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            is_final,
        }
    }

    /// Incorpora el resultado de una ventana `[start, start+len)` (segmentos
    /// relativos a la ventana). `at_edge`: la ventana llega al borde en vivo
    /// (si no, se cortó por el máximo). Devuelve los segmentos cambiados.
    pub fn absorb(&mut self, start_ms: u64, len_ms: u64, at_edge: bool, segments: Vec<AsrSegment>, cfg: &LiveConfig) -> Vec<LiveSegment> {
        self.absorb_window(start_ms, len_ms, at_edge, false, segments, cfg)
    }

    /// Como [`Self::absorb`], sabiendo si la ventana era silencio (no se pasó
    /// por el ASR). Sin texto y CON voz, la ventana no se da por vista: la
    /// frase puede estar empezando.
    pub fn absorb_window(&mut self, start_ms: u64, len_ms: u64, at_edge: bool, silent: bool, segments: Vec<AsrSegment>, cfg: &LiveConfig) -> Vec<LiveSegment> {
        let segs: Vec<AsrSegment> =
            segments.into_iter().filter(|s| !s.text.trim().is_empty()).map(|s| shift(s, start_ms)).collect();
        let end_ms = start_ms + len_ms;
        let cutoff = if at_edge { end_ms.saturating_sub(cfg.stable_margin_ms) } else { end_ms };
        let mut confirm = segs.iter().take_while(|s| s.end_ms <= cutoff).count();
        if !at_edge && confirm == segs.len() && confirm > 1 {
            // El último pudo quedar partido por el final de la ventana.
            confirm -= 1;
        }
        if !at_edge && confirm == 0 && !segs.is_empty() {
            // Habla sin pausas más larga que la ventana: hay que avanzar.
            confirm = segs.len();
        }
        let mut changed = Vec::new();
        for s in &segs[..confirm] {
            let index = self.state.segments.len();
            changed.push(self.live_segment(index, s, true));
            self.state.segments.push(s.clone());
        }
        if confirm > 0 {
            self.state.covered_ms = self.state.covered_ms.max(segs[confirm - 1].end_ms);
        } else if segs.is_empty() && ((silent && len_ms >= 3_000) || !at_edge) {
            // Nada dicho (silencio, o ruido que llena la ventana): no hace
            // falta volver a mirar este tramo.
            self.state.covered_ms = self.state.covered_ms.max(cutoff);
        }
        let rest = &segs[confirm..];
        let next = self.state.segments.len();
        self.provisional = match (rest.first(), rest.last()) {
            (Some(first), Some(last)) => {
                let text = rest.iter().map(|s| s.text.trim()).collect::<Vec<_>>().join(" ");
                let p = LiveSegment {
                    id: self.id(next),
                    speaker: speaker_of(self.track).to_owned(),
                    text,
                    start_ms: first.start_ms,
                    end_ms: last.end_ms,
                    is_final: false,
                };
                changed.push(p.clone());
                Some(p)
            }
            _ => None,
        };
        changed
    }

    /// Todo lo de esta pista (confirmado + provisional), para `live_transcript_get`.
    pub fn all(&self) -> Vec<LiveSegment> {
        let mut out: Vec<LiveSegment> = self.state.segments.iter().enumerate().map(|(i, s)| self.live_segment(i, s, true)).collect();
        out.extend(self.provisional.clone());
        out
    }
}

/// RMS en dBFS (−∞ → −120).
pub fn dbfs(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return -120.0;
    }
    let sum: f64 = samples.iter().map(|&s| f64::from(s) * f64::from(s)).sum();
    let rms = (sum / samples.len() as f64).sqrt() / 32_768.0;
    if rms <= 0.0 { -120.0 } else { (20.0 * rms.log10()) as f32 }
}

pub fn write_wav(path: &Path, rate: u32, samples: &[i16]) -> PortResult<()> {
    let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cursor = std::io::Cursor::new(Vec::with_capacity(44 + samples.len() * 2));
    {
        let mut w = hound::WavWriter::new(&mut cursor, spec).map_err(|e| acta_core::PortError::Io(e.to_string()))?;
        for &s in samples {
            w.write_sample(s).map_err(|e| acta_core::PortError::Io(e.to_string()))?;
        }
        w.finalize().map_err(|e| acta_core::PortError::Io(e.to_string()))?;
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    Ok(write_atomic(path, cursor.get_ref())?)
}

pub fn read_state(layout: &DataLayout, id: MeetingId, track: Track) -> Option<LiveAsrState> {
    std::fs::read(layout.live_asr_path(id, track)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn save_state(layout: &DataLayout, id: MeetingId, track: Track, state: &LiveAsrState) -> PortResult<()> {
    let path = layout.live_asr_path(id, track);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    Ok(write_atomic(&path, &serde_json::to_vec(state)?)?)
}

/// Lo que produce el worker en cada vuelta.
#[derive(Debug, Clone)]
pub struct LiveUpdate {
    pub transcript: LiveTranscript,
    /// Texto nuevo para el detector de momentos importantes.
    pub partials: Vec<LivePartial>,
}

/// Todo lo de la sesión en vivo que comparten el worker y quien pregunta.
pub struct LiveSession {
    pub meeting_id: MeetingId,
    pub tap: Arc<LiveTap>,
    pub tracks: Mutex<Vec<TrackLive>>,
}

impl LiveSession {
    pub fn new(meeting_id: MeetingId) -> Arc<Self> {
        Arc::new(Self { meeting_id, tap: Arc::new(LiveTap::default()), tracks: Mutex::new(Track::ALL.into_iter().map(TrackLive::new).collect()) })
    }

    /// Todos los segmentos, en orden temporal.
    pub fn transcript(&self) -> LiveTranscript {
        let tracks = self.tracks.lock().unwrap_or_else(|e| e.into_inner());
        let mut segments: Vec<LiveSegment> = tracks.iter().flat_map(TrackLive::all).collect();
        segments.sort_by_key(|s| (s.start_ms, s.id.clone()));
        LiveTranscript { session_id: self.meeting_id, segments }
    }
}

/// Una vuelta del worker para una pista. Devuelve los cambios (vacío si no
/// había audio nuevo suficiente).
pub async fn step_track(
    session: &LiveSession,
    track: Track,
    transcriber: &dyn Transcriber,
    layout: &DataLayout,
    language: Option<String>,
    cfg: &LiveConfig,
) -> PortResult<Vec<LiveSegment>> {
    let rate = u64::from(cfg.rate);
    let covered_ms = {
        let tracks = session.tracks.lock().unwrap_or_else(|e| e.into_inner());
        tracks[ti(track)].state.covered_ms
    };
    let from = covered_ms * rate / 1000;
    let end = session.tap.end(track);
    if end <= from || (end - from) * 1000 / rate < cfg.min_window_ms {
        return Ok(Vec::new());
    }
    let (start, samples) = session.tap.window(track, from, cfg.max_window_ms * rate / 1000);
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let start_ms = start * 1000 / rate;
    let len_ms = samples.len() as u64 * 1000 / rate;
    let at_edge = start + samples.len() as u64 >= end;
    let silent = dbfs(&samples) < cfg.silence_dbfs;
    let segments = if silent { Vec::new() } else { transcribe_window(layout, session.meeting_id, track, cfg.rate, &samples, transcriber, language).await? };
    let (changed, state) = {
        let mut tracks = session.tracks.lock().unwrap_or_else(|e| e.into_inner());
        let t = &mut tracks[ti(track)];
        let changed = t.absorb_window(start_ms, len_ms, at_edge, silent, segments, cfg);
        (changed, t.state.clone())
    };
    save_state(layout, session.meeting_id, track, &state)?;
    // Se guarda 1 s de margen por si la ventana siguiente necesita contexto.
    session.tap.drop_before(track, (state.covered_ms * rate / 1000).saturating_sub(rate));
    Ok(changed)
}

/// Bucle del worker hasta que se aborta (al parar la grabación).
pub async fn run(
    session: Arc<LiveSession>,
    transcriber: Arc<dyn Transcriber>,
    layout: DataLayout,
    language: Option<String>,
    cfg: LiveConfig,
    clock: Arc<dyn Clock>,
    on_update: impl Fn(LiveUpdate) + Send + Sync + 'static,
) {
    let mut failing = false;
    loop {
        tokio::time::sleep(cfg.every).await;
        let mut changed = Vec::new();
        let mut partials = Vec::new();
        for track in Track::ALL {
            match step_track(&session, track, transcriber.as_ref(), &layout, language.clone(), &cfg).await {
                Ok(c) => {
                    failing = false;
                    partials.extend(c.iter().filter(|s| s.is_final).map(|s| LivePartial { track, text: s.text.clone(), at: clock.now(), is_final: true }));
                    changed.extend(c);
                }
                Err(e) => {
                    if !failing {
                        tracing::warn!(track = track.as_str(), "transcripción en vivo: {e}");
                    }
                    failing = true;
                }
            }
        }
        if !changed.is_empty() {
            on_update(LiveUpdate { transcript: LiveTranscript { session_id: session.meeting_id, segments: changed }, partials });
        }
    }
}

/// Al procesar: lo confirmado en vivo + la cola que faltaba, transcrita
/// ahora desde `audio/<pista>.wav`. `None` si no hubo transcripción en vivo.
pub async fn finish_track(
    layout: &DataLayout,
    id: MeetingId,
    track: Track,
    transcriber: &dyn Transcriber,
    language: Option<String>,
) -> PortResult<Option<Vec<AsrSegment>>> {
    let Some(state) = read_state(layout, id, track) else { return Ok(None) };
    let wav = layout.track_wav(id, track);
    let (rate, tail) = {
        let wav = wav.clone();
        let covered = state.covered_ms;
        tokio::task::spawn_blocking(move || read_tail(&wav, covered))
            .await
            .map_err(|e| acta_core::PortError::Internal(format!("join: {e}")))??
    };
    let mut segments = state.segments;
    if tail.len() as u64 * 1000 / u64::from(rate.max(1)) >= 300 && dbfs(&tail) >= LiveConfig::default().silence_dbfs {
        let r = transcribe_window(layout, id, track, rate, &tail, transcriber, language).await?;
        segments.extend(r.into_iter().filter(|s| !s.text.trim().is_empty()).map(|s| shift(s, state.covered_ms)));
    }
    Ok(Some(segments))
}

/// Transcribe una ventana y no deja nada en `live/` (ni el WAV ni el JSON
/// que escribe el sidecar junto a él).
async fn transcribe_window(
    layout: &DataLayout,
    id: MeetingId,
    track: Track,
    rate: u32,
    samples: &[i16],
    transcriber: &dyn Transcriber,
    language: Option<String>,
) -> PortResult<Vec<AsrSegment>> {
    let wav = layout.live_window_wav(id, track);
    write_wav(&wav, rate, samples)?;
    let r = transcriber.transcribe(TranscribeRequest { wav_path: wav.clone(), track, language }, None).await;
    let _ = std::fs::remove_file(&wav);
    let _ = std::fs::remove_file(wav.with_extension(format!("asr-{}.json", track.as_str())));
    r
}

fn read_tail(wav: &Path, from_ms: u64) -> PortResult<(u32, Vec<i16>)> {
    let mut r = hound::WavReader::open(wav).map_err(|e| acta_core::PortError::Io(format!("{}: {e}", wav.display())))?;
    let rate = r.spec().sample_rate;
    let from = (from_ms * u64::from(rate) / 1000).min(u64::from(r.duration()));
    r.seek(from as u32).map_err(|e| acta_core::PortError::Io(e.to_string()))?;
    let tail = r.samples::<i16>().collect::<Result<Vec<_>, _>>().map_err(|e| acta_core::PortError::Io(e.to_string()))?;
    Ok((rate, tail))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: u64, end: u64, text: &str) -> AsrSegment {
        AsrSegment { start_ms: start, end_ms: end, text: text.into(), confidence: None, words: vec![] }
    }

    #[test]
    fn tap_mirrors_positions_pads_gaps_and_drops_confirmed_audio() {
        let tap = LiveTap::default();
        tap.append(Track::Mic, 0, &[1, 2, 3]);
        tap.append(Track::Mic, 5, &[6]);
        assert_eq!(tap.end(Track::Mic), 6);
        assert_eq!(tap.window(Track::Mic, 2, 10), (2, vec![3, 0, 0, 6]));
        tap.append(Track::Mic, 5, &[9, 7]); // solapa una muestra
        assert_eq!(tap.window(Track::Mic, 0, 100).1, vec![1, 2, 3, 0, 0, 6, 7]);
        tap.drop_before(Track::Mic, 3);
        assert_eq!(tap.window(Track::Mic, 0, 2), (3, vec![0, 0]));
        assert_eq!(tap.end(Track::System), 0);
    }

    #[test]
    fn segments_before_the_live_edge_are_confirmed_and_the_rest_stays_provisional() {
        let cfg = LiveConfig::default();
        let mut t = TrackLive::new(Track::Mic);
        let changed = t.absorb(10_000, 8_000, true, vec![seg(0, 2_000, "Hola a todos."), seg(2_500, 7_500, "Vamos con las subcuentas")], &cfg);
        assert_eq!(changed.len(), 2);
        assert_eq!((changed[0].id.as_str(), changed[0].is_final, changed[0].start_ms, changed[0].speaker.as_str()), ("mic-0", true, 10_000, "yo"));
        assert_eq!((changed[1].id.as_str(), changed[1].is_final), ("mic-1", false));
        assert_eq!(t.state.covered_ms, 12_000);
        // La siguiente ventana empieza en 12 s y confirma el provisional con el MISMO id.
        let changed = t.absorb(12_000, 9_000, true, vec![seg(500, 5_600, "Vamos con las subcuentas, José.")], &cfg);
        assert_eq!((changed[0].id.as_str(), changed[0].is_final, changed[0].text.as_str()), ("mic-1", true, "Vamos con las subcuentas, José."));
        assert!(t.provisional.is_none());
        assert_eq!(t.all().len(), 2);
    }

    #[test]
    fn a_window_cut_by_the_maximum_keeps_its_last_segment_and_long_speech_still_advances() {
        let cfg = LiveConfig::default();
        let mut t = TrackLive::new(Track::System);
        let c = t.absorb(0, 24_000, false, vec![seg(0, 10_000, "uno"), seg(10_000, 24_000, "dos cortado")], &cfg);
        assert_eq!(c.iter().filter(|s| s.is_final).count(), 1);
        assert_eq!(t.state.covered_ms, 10_000);
        assert_eq!(c[0].speaker, "otros");
        let mut t = TrackLive::new(Track::System);
        t.absorb(0, 24_000, false, vec![seg(0, 24_000, "sin pausas")], &cfg);
        assert_eq!(t.state.covered_ms, 24_000);
    }

    #[test]
    fn silence_moves_the_cursor_without_segments_and_blank_text_is_ignored() {
        let cfg = LiveConfig::default();
        let mut t = TrackLive::new(Track::Mic);
        assert!(t.absorb_window(0, 6_000, true, true, vec![], &cfg).is_empty());
        assert_eq!(t.state.covered_ms, 4_800);
        assert!(t.absorb_window(4_800, 2_000, true, true, vec![seg(0, 900, "  ")], &cfg).is_empty());
        assert_eq!(t.state.covered_ms, 4_800, "una ventana corta sin nada no avanza");
    }

    /// Real (17-nov): la primera frase se perdía. La ventana tenía voz que
    /// empezaba al final y el ASR aún no devolvía texto; se daba por silencio
    /// y el cursor saltaba por encima del principio de la frase.
    #[test]
    fn audio_with_voice_but_no_text_yet_is_kept_for_the_next_window() {
        let cfg = LiveConfig::default();
        let mut t = TrackLive::new(Track::System);
        assert!(t.absorb_window(0, 9_000, true, false, vec![], &cfg).is_empty());
        assert_eq!(t.state.covered_ms, 0);
        // Ventana llena por el máximo y aun así sin texto (ruido): se avanza.
        t.absorb_window(0, 24_000, false, false, vec![], &cfg);
        assert_eq!(t.state.covered_ms, 24_000);
    }

    #[test]
    fn dbfs_of_silence_and_of_a_full_scale_tone() {
        assert!(dbfs(&[0; 160]) < -100.0);
        assert!(dbfs(&[16_384, -16_384].repeat(80)) > -7.0);
    }

    struct Echo(Mutex<Vec<u64>>);
    #[async_trait::async_trait]
    impl Transcriber for Echo {
        async fn transcribe(&self, r: TranscribeRequest, _p: Option<acta_core::transcription::ProgressFn>) -> PortResult<Vec<AsrSegment>> {
            let reader = hound::WavReader::open(&r.wav_path).map_err(|e| acta_core::PortError::Io(e.to_string()))?;
            let ms = u64::from(reader.duration()) * 1000 / 16_000;
            self.0.lock().unwrap_or_else(|e| e.into_inner()).push(ms);
            Ok(vec![seg(0, ms / 2, "primera mitad"), seg(ms / 2, ms.saturating_sub(100), &format!("{ms} ms"))])
        }
    }

    fn tone(ms: u64) -> Vec<i16> {
        (0..ms * 16).map(|i| if i % 2 == 0 { 8_000 } else { -8_000 }).collect()
    }

    #[tokio::test]
    async fn worker_steps_persist_what_is_confirmed_and_the_pipeline_only_transcribes_the_tail() {
        let dir = tempfile::tempdir().unwrap_or_else(|e| panic!("{e}"));
        let layout = DataLayout::new(dir.path());
        let id = MeetingId::from_u128(1);
        let session = LiveSession::new(id);
        let echo = Echo(Mutex::default());
        let cfg = LiveConfig::default();
        session.tap.append(Track::Mic, 0, &tone(5_000));
        let c = step_track(&session, Track::Mic, &echo, &layout, Some("es".into()), &cfg).await.unwrap_or_default();
        assert_eq!(c.iter().map(|s| s.is_final).collect::<Vec<_>>(), vec![true, false], "lo del borde sigue provisional");
        session.tap.append(Track::Mic, 80_000, &tone(4_000));
        let c = step_track(&session, Track::Mic, &echo, &layout, None, &cfg).await.unwrap_or_default();
        assert!(c.iter().any(|s| s.is_final), "{c:?}");
        let state = read_state(&layout, id, Track::Mic).unwrap_or_default();
        assert!(state.covered_ms > 0 && !state.segments.is_empty());
        // Silencio en la otra pista: no se llama al ASR.
        session.tap.append(Track::System, 0, &[0; 80_000]);
        assert!(step_track(&session, Track::System, &echo, &layout, None, &cfg).await.unwrap_or_default().is_empty());
        assert_eq!(echo.0.lock().unwrap_or_else(|e| e.into_inner()).len(), 2);

        // Al parar: el WAV completo dura 12 s; solo se transcribe desde coveredMs.
        write_wav(&layout.track_wav(id, Track::Mic), 16_000, &tone(12_000)).unwrap_or_default();
        let all = finish_track(&layout, id, Track::Mic, &echo, None).await.unwrap_or_default().unwrap_or_default();
        let tail_ms = *echo.0.lock().unwrap_or_else(|e| e.into_inner()).last().unwrap_or(&0);
        assert_eq!(tail_ms, 12_000 - state.covered_ms);
        assert_eq!(all.len(), state.segments.len() + 2);
        assert_eq!(all[state.segments.len()].start_ms, state.covered_ms, "la cola empieza donde acaba lo confirmado");
        assert!(finish_track(&layout, MeetingId::from_u128(2), Track::Mic, &echo, None).await.unwrap_or_default().is_none());
        assert!(session.transcript().segments.windows(2).all(|w| w[0].start_ms <= w[1].start_ms));
    }
}
