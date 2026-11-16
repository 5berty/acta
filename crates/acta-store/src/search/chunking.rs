//! Troceado de utterances en ventanas por turnos de hablante (~300-500 tokens).

pub const TARGET_TOKENS: usize = 300;
pub const MAX_TOKENS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkUtterance {
    /// Nombre mostrado del hablante.
    pub speaker: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkDraft {
    pub start_ms: u64,
    pub end_ms: u64,
    /// Una línea "Nombre: texto" por utterance.
    pub text: String,
}

/// Estimación barata: ~4 caracteres por token.
pub fn estimate_tokens(s: &str) -> usize {
    s.chars().count().div_ceil(4)
}

struct Unit {
    speaker: String,
    start_ms: u64,
    end_ms: u64,
    line: String,
    tokens: usize,
}

fn unit(speaker: &str, start_ms: u64, end_ms: u64, text: &str) -> Unit {
    let line = format!("{speaker}: {text}");
    let tokens = estimate_tokens(&line);
    Unit { speaker: speaker.to_owned(), start_ms, end_ms, line, tokens }
}

/// Parte una utterance gigante en trozos ≤ `MAX_TOKENS`, interpolando los tiempos.
fn split_long(u: &ChunkUtterance, text: &str) -> Vec<Unit> {
    let whole = unit(&u.speaker, u.start_ms, u.end_ms, text);
    if whole.tokens <= MAX_TOKENS {
        return vec![whole];
    }
    let budget = (MAX_TOKENS * 4).saturating_sub(u.speaker.chars().count() + 2).max(16);
    let total_chars = text.chars().count().max(1) as u64;
    let dur = u.end_ms.saturating_sub(u.start_ms);
    let mut pieces: Vec<(String, usize)> = Vec::new(); // (texto, chars acumulados al final)
    let (mut cur, mut cur_chars, mut consumed) = (String::new(), 0usize, 0usize);
    for word in text.split_whitespace() {
        let w = word.chars().count();
        if cur_chars > 0 && cur_chars + 1 + w > budget {
            consumed += cur_chars + 1;
            pieces.push((std::mem::take(&mut cur), consumed));
            cur_chars = 0;
        }
        if cur_chars > 0 {
            cur.push(' ');
            cur_chars += 1;
        }
        // Una "palabra" mayor que el presupuesto se corta en seco.
        if w > budget {
            let mut rest = word;
            while rest.chars().count() > budget {
                let cut = rest.char_indices().nth(budget).map_or(rest.len(), |(i, _)| i);
                if cur_chars > 0 {
                    consumed += cur_chars + 1;
                    pieces.push((std::mem::take(&mut cur), consumed));
                    cur_chars = 0;
                }
                pieces.push((rest[..cut].to_owned(), consumed + budget));
                consumed += budget;
                rest = &rest[cut..];
            }
            cur.push_str(rest);
            cur_chars += rest.chars().count();
            continue;
        }
        cur.push_str(word);
        cur_chars += w;
    }
    if !cur.is_empty() {
        pieces.push((cur, text.chars().count()));
    }
    let n = pieces.len();
    let mut start = u.start_ms;
    let mut out = Vec::with_capacity(n);
    for (i, (piece, upto)) in pieces.into_iter().enumerate() {
        let end = if i + 1 == n { u.end_ms } else { u.start_ms + dur * (upto as u64).min(total_chars) / total_chars };
        let end = end.max(start);
        out.push(unit(&u.speaker, start, end, &piece));
        start = end;
    }
    out
}

/// Agrupa utterances (en orden temporal) en chunks: se cierra al llegar a
/// `TARGET_TOKENS` en un cambio de turno, o antes de superar `MAX_TOKENS`.
pub fn chunk_utterances(utterances: &[ChunkUtterance]) -> Vec<ChunkDraft> {
    // 1) unidades, partiendo las gigantes.
    let mut units: Vec<Unit> = Vec::new();
    for u in utterances {
        let text = u.text.trim();
        if text.is_empty() {
            continue;
        }
        units.extend(split_long(u, text));
    }
    // 2) turnos = unidades consecutivas del mismo hablante.
    let mut turns: Vec<Vec<Unit>> = Vec::new();
    for un in units {
        match turns.last_mut() {
            Some(t) if t.last().is_some_and(|l| l.speaker == un.speaker) => t.push(un),
            _ => turns.push(vec![un]),
        }
    }
    // 3) ventanas.
    let mut out = Vec::new();
    let mut cur: Vec<Unit> = Vec::new();
    let mut cur_tokens = 0usize;
    let flush = |cur: &mut Vec<Unit>, cur_tokens: &mut usize, out: &mut Vec<ChunkDraft>| {
        if let (Some(first), Some(last)) = (cur.first(), cur.last()) {
            out.push(ChunkDraft {
                start_ms: first.start_ms,
                end_ms: last.end_ms,
                text: cur.iter().map(|u| u.line.as_str()).collect::<Vec<_>>().join("\n"),
            });
        }
        cur.clear();
        *cur_tokens = 0;
    };
    for turn in turns {
        let t: usize = turn.iter().map(|u| u.tokens).sum();
        if !cur.is_empty() && cur_tokens + t > MAX_TOKENS {
            flush(&mut cur, &mut cur_tokens, &mut out);
        }
        for u in turn {
            if !cur.is_empty() && cur_tokens + u.tokens > MAX_TOKENS {
                flush(&mut cur, &mut cur_tokens, &mut out);
            }
            cur_tokens += u.tokens;
            cur.push(u);
        }
        if cur_tokens >= TARGET_TOKENS {
            flush(&mut cur, &mut cur_tokens, &mut out);
        }
    }
    flush(&mut cur, &mut cur_tokens, &mut out);
    out
}
