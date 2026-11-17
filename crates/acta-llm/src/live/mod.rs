//! `live_ask`: preguntas sobre lo que se lleva dicho en la reunión EN CURSO.
//! Entrada: los segmentos en vivo (`[mm:ss] Yo/Otros: texto`); salida en
//! streaming con citas `[mm:ss]` que la UI convierte en saltos.

use crate::prompts;
use crate::transcript::render_template;
use acta_core::api::{LIVE_SPEAKER_ME, LIVE_SPEAKER_OTHERS, LiveCitation, LiveSegment};
use acta_core::llm::{LlmMessage, LlmRequest, Role};

/// Más allá de esto se manda solo lo más reciente (unas 2 h de reunión caben).
const MAX_CHARS: usize = 120_000;

fn mmss(ms: u64) -> String {
    let s = ms / 1000;
    format!("{:02}:{:02}", s / 60, s % 60)
}

fn who(speaker: &str) -> &str {
    match speaker {
        LIVE_SPEAKER_ME => "Yo",
        LIVE_SPEAKER_OTHERS => "Otros",
        other => other,
    }
}

/// Transcript en vivo como líneas `[mm:ss] Quién: texto`, en orden temporal.
pub fn render_live(segments: &[LiveSegment]) -> String {
    let mut sorted: Vec<&LiveSegment> = segments.iter().filter(|s| !s.text.trim().is_empty()).collect();
    sorted.sort_by_key(|s| s.start_ms);
    let lines: Vec<String> = sorted.iter().map(|s| format!("[{}] {}: {}", mmss(s.start_ms), who(&s.speaker), s.text.trim())).collect();
    let out = lines.join("\n");
    if out.len() <= MAX_CHARS {
        return out;
    }
    let mut cut = out.len() - MAX_CHARS;
    while !out.is_char_boundary(cut) {
        cut += 1;
    }
    let start = out[cut..].find('\n').map_or(cut, |i| cut + i + 1);
    format!("(…lo anterior se omite)\n{}", &out[start..])
}

pub fn live_ask_request(segments: &[LiveSegment], question: &str, user_name: &str) -> LlmRequest {
    let transcript = render_live(segments);
    let transcript = if transcript.is_empty() { "(Todavía no se ha transcrito nada.)".to_owned() } else { transcript };
    LlmRequest {
        system: Some(render_template(prompts::LIVE_ASK_SYSTEM, &[("user_name", user_name)])),
        messages: vec![LlmMessage {
            role: Role::User,
            content: format!("# Transcripción hasta ahora\n{transcript}\n\n# Pregunta\n{}", question.trim()),
        }],
        json_schema: None,
        max_tokens: Some(800),
        temperature: Some(0.2),
    }
}

/// Marcas `[mm:ss]` (o `[h:mm:ss]`) de la respuesta que existen en el
/// transcript, en orden y sin repetir. Se descartan las inventadas.
pub fn citations(answer: &str, segments: &[LiveSegment]) -> Vec<LiveCitation> {
    let mut out: Vec<LiveCitation> = Vec::new();
    let mut rest = answer;
    while let Some(open) = rest.find('[') {
        rest = &rest[open + 1..];
        let Some(close) = rest.find(']') else { break };
        let inside = &rest[..close];
        rest = &rest[close + 1..];
        let parts: Vec<u64> = match inside.split(':').map(|p| p.trim().parse::<u64>()).collect::<Result<Vec<_>, _>>() {
            Ok(p) if (2..=3).contains(&p.len()) => p,
            _ => continue,
        };
        let secs = parts.iter().fold(0, |acc, p| acc * 60 + p);
        let hit = segments
            .iter()
            .filter(|s| s.start_ms / 1000 <= secs && secs <= s.end_ms / 1000)
            .min_by_key(|s| (s.start_ms / 1000).abs_diff(secs));
        if let Some(seg) = hit
            && !out.iter().any(|c| c.start_ms == seg.start_ms)
        {
            out.push(LiveCitation { start_ms: seg.start_ms });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, speaker: &str, start: u64, text: &str) -> LiveSegment {
        LiveSegment { id: id.into(), speaker: speaker.into(), text: text.into(), start_ms: start, end_ms: start + 3_000, is_final: true }
    }

    #[test]
    fn transcript_lines_say_who_and_when_in_order() {
        let s = vec![seg("system-0", "otros", 63_000, "¿Cómo va lo de las subcuentas?"), seg("mic-0", "yo", 40_500, "Ayer arreglé el borrado.")];
        assert_eq!(render_live(&s), "[00:40] Yo: Ayer arreglé el borrado.\n[01:03] Otros: ¿Cómo va lo de las subcuentas?");
        let r = live_ask_request(&s, " ¿Han hablado de subcuentas? ", "Edu");
        assert!(r.system.as_deref().unwrap_or_default().contains("Edu"));
        assert!(r.messages[0].content.ends_with("# Pregunta\n¿Han hablado de subcuentas?"));
        assert!(live_ask_request(&[], "x", "Edu").messages[0].content.contains("Todavía no"));
    }

    #[test]
    fn only_real_timestamps_become_citations() {
        let s = vec![seg("system-0", "otros", 63_200, "subcuentas"), seg("mic-1", "yo", 125_000, "LOPD")];
        let c = citations("Sí [01:03], y luego otra vez [01:03]. También [02:06] y [09:59] y [1] y [a:b].", &s);
        assert_eq!(c, vec![LiveCitation { start_ms: 63_200 }, LiveCitation { start_ms: 125_000 }]);
    }

    #[test]
    fn very_long_meetings_keep_the_most_recent_part() {
        let s: Vec<_> = (0..4_000u64).map(|i| seg(&format!("mic-{i}"), "yo", i * 3_000, "una frase bastante larga para llenar el contexto")).collect();
        let r = render_live(&s);
        assert!(r.len() <= MAX_CHARS + 40 && r.starts_with("(…lo anterior se omite)"));
        assert!(r.ends_with("llenar el contexto"));
    }
}
