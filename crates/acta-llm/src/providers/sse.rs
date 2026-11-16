//! Parser mínimo de Server-Sent Events y adaptador a `EventStream`.

use acta_core::{EventStream, PortError, PortResult};
use futures::StreamExt;
use std::collections::VecDeque;

/// Acumula bytes y devuelve el `data:` de cada evento completo.
#[derive(Debug, Default)]
pub struct SseParser {
    buf: String,
}

impl SseParser {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.buf.push_str(&String::from_utf8_lossy(bytes).replace("\r\n", "\n"));
        let mut events = Vec::new();
        while let Some(pos) = self.buf.find("\n\n") {
            let block: String = self.buf.drain(..pos + 2).collect();
            let data: Vec<&str> = block
                .lines()
                .filter_map(|l| l.strip_prefix("data:"))
                .map(|d| d.strip_prefix(' ').unwrap_or(d))
                .collect();
            if !data.is_empty() {
                events.push(data.join("\n"));
            }
        }
        events
    }
}

/// Convierte una respuesta SSE en un stream de trozos de texto.
/// `extract` saca el texto de cada evento JSON (o `None` si no aporta).
pub fn text_stream(
    resp: reqwest::Response,
    extract: fn(&serde_json::Value) -> Option<String>,
) -> EventStream<PortResult<String>> {
    let state = (resp.bytes_stream().boxed(), SseParser::default(), VecDeque::<String>::new());
    Box::pin(futures::stream::unfold(state, move |mut st| async move {
        loop {
            if let Some(t) = st.2.pop_front() {
                return Some((Ok(t), st));
            }
            match st.0.next().await {
                Some(Ok(chunk)) => {
                    for data in st.1.push(&chunk) {
                        if data.trim() == "[DONE]" {
                            continue;
                        }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data)
                            && let Some(t) = extract(&v)
                            && !t.is_empty()
                        {
                            st.2.push_back(t);
                        }
                    }
                }
                Some(Err(e)) => {
                    return Some((Err(PortError::Unavailable(format!("stream interrumpido: {e}"))), st));
                }
                None => return None,
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_split_across_chunks_and_crlf() {
        let mut p = SseParser::default();
        assert!(p.push(b"data: {\"a\":").is_empty());
        let ev = p.push(b"1}\r\n\r\ndata: [DONE]\n\n");
        assert_eq!(ev, vec!["{\"a\":1}".to_string(), "[DONE]".to_string()]);
    }

    #[test]
    fn ignores_event_names_and_comments() {
        let mut p = SseParser::default();
        let ev = p.push(b": ping\n\nevent: content_block_delta\ndata: {\"x\":2}\n\n");
        assert_eq!(ev, vec!["{\"x\":2}".to_string()]);
    }
}
