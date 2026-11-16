//! `ChatEngine` (WP3). Reunión: transcript completo en contexto (si no cabe,
//! una pasada de selección por bloques). Grupo/Todo: `Retriever` (k = 12) →
//! bloques numerados `[n]` → respuesta con citas `[n]` → `Citation { n, meeting_id, at, ... }`.
//! Se descartan las citas a números que no existen.

use crate::prompts;
use crate::transcript::{Line, estimate_tokens, format_date, join_lines, mmss, render_lines, render_template, split_lines};
use acta_core::chat::*;
use acta_core::ids::{ChatMessageId, MeetingId};
use acta_core::library::MeetingStore;
use acta_core::llm::{LlmMessage, LlmProvider, LlmRequest, Role};
use acta_core::minutes::UserIdentity;
use acta_core::time::{MediaMs, UnixMs};
use acta_core::transcription::Transcript;
use acta_core::{EventStream, PortError, PortResult};
use async_trait::async_trait;
use futures::StreamExt;
use std::collections::HashSet;
use std::sync::Arc;

/// Chunks que se piden al `Retriever` para grupos/todo.
pub const RETRIEVE_K: u32 = 12;
/// Mensajes de historial que se reenvían (los más recientes).
const HISTORY_MESSAGES: usize = 10;
const OUTPUT_RESERVE: usize = 3_000;

/// Lo mínimo que el chat necesita de una reunión (los tests lo falsean).
#[async_trait]
pub trait MeetingSource: Send + Sync {
    /// (título, inicio, transcript)
    async fn load(&self, id: MeetingId) -> PortResult<(String, UnixMs, Transcript)>;
}

pub struct StoreSource(pub Arc<dyn MeetingStore>);

#[async_trait]
impl MeetingSource for StoreSource {
    async fn load(&self, id: MeetingId) -> PortResult<(String, UnixMs, Transcript)> {
        let meeting = self
            .0
            .get_meeting(id)
            .await?
            .ok_or_else(|| PortError::NotFound(format!("reunión {id}")))?;
        let transcript = self
            .0
            .get_transcript(id)
            .await?
            .ok_or_else(|| PortError::NotFound(format!("transcript de la reunión {id}")))?;
        Ok((meeting.title, meeting.started_at, transcript))
    }
}

/// Bloque numerado de contexto.
#[derive(Debug, Clone)]
struct Block {
    n: u32,
    meeting_id: MeetingId,
    title: String,
    at: MediaMs,
    end: MediaMs,
    date: String,
    text: String,
}

impl Block {
    fn render(&self) -> String {
        format!("[{}] {} · {} · {}\n{}", self.n, self.title, self.date, mmss(self.at), self.text)
    }
}

pub struct LlmChatEngine {
    provider: Arc<dyn LlmProvider>,
    source: Arc<dyn MeetingSource>,
    retriever: Arc<dyn Retriever>,
    me: UserIdentity,
}

impl LlmChatEngine {
    pub fn new(
        provider: Arc<dyn LlmProvider>,
        store: Arc<dyn MeetingStore>,
        retriever: Arc<dyn Retriever>,
        me: UserIdentity,
    ) -> Self {
        Self::with_source(provider, Arc::new(StoreSource(store)), retriever, me)
    }

    pub fn with_source(
        provider: Arc<dyn LlmProvider>,
        source: Arc<dyn MeetingSource>,
        retriever: Arc<dyn Retriever>,
        me: UserIdentity,
    ) -> Self {
        Self { provider, source, retriever, me }
    }

    fn usable_tokens(&self) -> usize {
        ((self.provider.capabilities().context_tokens as usize) * 7 / 10)
            .saturating_sub(OUTPUT_RESERVE)
            .max(1_500)
    }

    async fn meeting_blocks(&self, id: MeetingId, question: &str) -> PortResult<Vec<Block>> {
        let (title, started, transcript) = self.source.load(id).await?;
        let lines = render_lines(&transcript.speakers, &transcript.utterances, &self.me.display_name);
        let date = format_date(started);
        // Bloques de ~45 s / ≤300 tokens para poder citar con precisión.
        let groups: Vec<Vec<Line>> = split_lines(&lines, 300, 45_000);
        let mut blocks: Vec<Block> = groups
            .iter()
            .enumerate()
            .map(|(i, g)| Block {
                n: i as u32 + 1,
                meeting_id: id,
                title: title.clone(),
                at: MediaMs(g[0].at_ms),
                end: MediaMs(groups.get(i + 1).map_or(g.last().map_or(0, |l| l.at_ms) + 1_000, |next| next[0].at_ms)),
                date: date.clone(),
                text: join_lines(g),
            })
            .collect();

        let budget = self.usable_tokens();
        let total: usize = blocks.iter().map(|b| estimate_tokens(&b.render())).sum();
        if total <= budget {
            return Ok(blocks);
        }
        tracing::info!(blocks = blocks.len(), total, budget, "transcript largo en el chat: selección por bloques");
        blocks = self.select_relevant(blocks, question, budget).await?;
        Ok(blocks)
    }

    /// Reunión demasiado larga: por tandas, el LLM indica qué bloques sirven
    /// y solo esos van al contexto final (recortados al presupuesto).
    async fn select_relevant(&self, blocks: Vec<Block>, question: &str, budget: usize) -> PortResult<Vec<Block>> {
        let mut selected: HashSet<u32> = HashSet::new();
        let mut batch: Vec<&Block> = Vec::new();
        let mut size = 0usize;
        let batch_budget = budget.saturating_sub(800).max(500);
        let mut batches: Vec<Vec<&Block>> = Vec::new();
        for b in &blocks {
            let t = estimate_tokens(&b.render());
            if !batch.is_empty() && size + t > batch_budget {
                batches.push(std::mem::take(&mut batch));
                size = 0;
            }
            size += t;
            batch.push(b);
        }
        if !batch.is_empty() {
            batches.push(batch);
        }
        for batch in batches {
            let body = batch.iter().map(|b| b.render()).collect::<Vec<_>>().join("\n\n");
            let req = LlmRequest {
                system: Some("Eres un filtro de relevancia. Te paso bloques numerados [n] de una reunión y una pregunta. \
                              Responde SOLO con los números de los bloques útiles para responder, separados por comas \
                              (p. ej. `3, 4, 9`), o `ninguno`. Sin más texto.".into()),
                messages: vec![LlmMessage { role: Role::User, content: format!("Pregunta: {question}\n\n{body}") }],
                json_schema: None,
                max_tokens: Some(200),
                temperature: Some(0.0),
            };
            let reply = self.provider.complete(req).await?.text;
            selected.extend(numbers_in(&reply));
        }
        let mut out: Vec<Block> = Vec::new();
        let mut used = 0usize;
        for b in blocks.into_iter().filter(|b| selected.contains(&b.n)) {
            let t = estimate_tokens(&b.render());
            if used + t > budget {
                break;
            }
            used += t;
            out.push(b);
        }
        Ok(out)
    }

    async fn retrieved_blocks(&self, scope: &ChatScope, question: &str) -> PortResult<Vec<Block>> {
        let chunks = self.retriever.retrieve(question, scope, RETRIEVE_K).await?;
        Ok(chunks
            .into_iter()
            .enumerate()
            .map(|(i, c)| Block {
                n: i as u32 + 1,
                meeting_id: c.meeting_id,
                title: c.meeting_title,
                at: c.start,
                end: c.end,
                date: format_date(c.started_at),
                text: c.text,
            })
            .collect())
    }
}

/// Números enteros que aparecen en un texto ("3, 4 y 9" -> [3, 4, 9]).
fn numbers_in(text: &str) -> Vec<u32> {
    text.split(|c: char| !c.is_ascii_digit())
        .filter(|t| !t.is_empty())
        .filter_map(|t| t.parse().ok())
        .collect()
}

/// Números de cada `[n]` / `[1, 3]` del texto, en orden de aparición.
fn cited_numbers(text: &str) -> Vec<u32> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let after = &rest[open + 1..];
        let Some(close) = after.find(']') else { break };
        let inner = &after[..close];
        if !inner.is_empty() && inner.chars().all(|c| c.is_ascii_digit() || c == ',' || c.is_whitespace()) {
            out.extend(numbers_in(inner));
        }
        rest = &after[close + 1..];
    }
    out
}

/// Extrae las citas `[n]` / `[1, 3]` del texto, en orden de aparición,
/// ignorando las que no apuntan a un bloque existente.
fn extract_citations(text: &str, blocks: &[Block]) -> Vec<Citation> {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut out = Vec::new();
    for n in cited_numbers(text) {
        let Some(b) = blocks.iter().find(|b| b.n == n) else { continue };
        if seen.insert(n) {
            out.push(Citation {
                n,
                meeting_id: b.meeting_id,
                meeting_title: b.title.clone(),
                at: b.at,
                end: b.end,
                snippet: b.text.chars().take(240).collect(),
            });
        }
    }
    out
}

fn history_messages(history: &[ChatMessage]) -> Vec<LlmMessage> {
    let start = history.len().saturating_sub(HISTORY_MESSAGES);
    history[start..]
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .map(|m| LlmMessage {
            role: match m.role {
                ChatRole::User => Role::User,
                ChatRole::Assistant => Role::Assistant,
            },
            content: m.content.clone(),
        })
        .collect()
}

#[async_trait]
impl ChatEngine for LlmChatEngine {
    async fn ask(
        &self,
        thread: &ChatThread,
        history: &[ChatMessage],
        question: &str,
        assistant_message_id: ChatMessageId,
    ) -> PortResult<EventStream<ChatDelta>> {
        let blocks = match &thread.scope {
            ChatScope::Meeting { meeting_id } => self.meeting_blocks(*meeting_id, question).await?,
            scope => self.retrieved_blocks(scope, question).await?,
        };
        let context = if blocks.is_empty() {
            "(No se ha encontrado contexto relevante.)".to_owned()
        } else {
            blocks.iter().map(Block::render).collect::<Vec<_>>().join("\n\n")
        };
        let mut messages = history_messages(history);
        messages.push(LlmMessage {
            role: Role::User,
            content: format!("# Contexto\n{context}\n\n# Pregunta\n{question}"),
        });
        let request = LlmRequest {
            system: Some(render_template(prompts::CHAT_SYSTEM, &[("user_name", &self.me.display_name)])),
            messages,
            json_schema: None,
            max_tokens: Some(2_000),
            temperature: Some(0.3),
        };
        let mut upstream = self.provider.stream(request).await?;

        let (tx, rx) = futures::channel::mpsc::unbounded::<ChatDelta>();
        let thread_id = thread.id;
        tokio::spawn(async move {
            let delta = |text: String, done: bool, citations: Vec<Citation>, error: Option<String>| ChatDelta {
                thread_id,
                message_id: assistant_message_id,
                delta: text,
                done,
                citations,
                error,
            };
            let mut full = String::new();
            while let Some(chunk) = upstream.next().await {
                match chunk {
                    Ok(t) if t.is_empty() => {}
                    Ok(t) => {
                        full.push_str(&t);
                        if tx.unbounded_send(delta(t, false, vec![], None)).is_err() {
                            return; // el receptor se fue: se suelta el upstream (kill_on_drop)
                        }
                    }
                    Err(e) => {
                        let _ = tx.unbounded_send(delta(String::new(), true, vec![], Some(e.to_string())));
                        return;
                    }
                }
            }
            let citations = extract_citations(&full, &blocks);
            let _ = tx.unbounded_send(delta(String::new(), true, citations, None));
        });
        Ok(Box::pin(rx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structured::testing::FakeProvider;
    use crate::testutil::{sample_input, speaker, utt};
    use acta_core::ids::ChatThreadId;

    struct FakeSource {
        title: String,
        transcript: Transcript,
    }

    #[async_trait]
    impl MeetingSource for FakeSource {
        async fn load(&self, _id: MeetingId) -> PortResult<(String, UnixMs, Transcript)> {
            Ok((self.title.clone(), UnixMs(1_794_821_400_000), self.transcript.clone()))
        }
    }

    struct FakeRetriever(Vec<RetrievedChunk>, std::sync::Mutex<Vec<(String, u32)>>);

    #[async_trait]
    impl Retriever for FakeRetriever {
        async fn retrieve(&self, query: &str, _scope: &ChatScope, k: u32) -> PortResult<Vec<RetrievedChunk>> {
            self.1.lock().unwrap().push((query.to_owned(), k));
            Ok(self.0.clone())
        }
    }

    fn chunk(n: u128, title: &str, start: u64, text: &str) -> RetrievedChunk {
        RetrievedChunk {
            chunk_id: n as i64,
            meeting_id: MeetingId::from_u128(n),
            meeting_title: title.into(),
            started_at: UnixMs(1_794_821_400_000),
            start: MediaMs(start),
            end: MediaMs(start + 50_000),
            text: text.into(),
            score: 0.9,
        }
    }

    fn thread(scope: ChatScope) -> ChatThread {
        ChatThread { id: ChatThreadId::from_u128(1), scope, title: "t".into(), created_at: UnixMs(0), updated_at: UnixMs(0) }
    }

    fn me() -> UserIdentity {
        UserIdentity { display_name: "Edu".into(), aliases: vec![] }
    }

    fn engine(p: Arc<dyn LlmProvider>, transcript: Transcript, chunks: Vec<RetrievedChunk>) -> (LlmChatEngine, Arc<FakeRetriever>) {
        let retr = Arc::new(FakeRetriever(chunks, Default::default()));
        let src = Arc::new(FakeSource { title: "Kickoff".into(), transcript });
        (LlmChatEngine::with_source(p, src, retr.clone(), me()), retr)
    }

    fn transcript() -> Transcript {
        let i = sample_input();
        Transcript { meeting_id: i.meeting_id, speakers: i.speakers, utterances: i.utterances }
    }

    async fn collect(stream: EventStream<ChatDelta>) -> Vec<ChatDelta> {
        stream.collect().await
    }

    #[tokio::test]
    async fn meeting_chat_puts_full_transcript_in_context_and_streams() {
        let p = Arc::new(FakeProvider::new(vec!["El presupuesto se envía el viernes [1]."]));
        let (e, _) = engine(p.clone(), transcript(), vec![]);
        let th = thread(ChatScope::Meeting { meeting_id: MeetingId::from_u128(1) });
        let deltas = collect(e.ask(&th, &[], "¿Cuándo se envía el presupuesto?", ChatMessageId::from_u128(9)).await.expect("ask")).await;
        let (last, rest) = deltas.split_last().expect("deltas");
        assert!(rest.iter().all(|d| !d.done && d.citations.is_empty()));
        assert_eq!(rest.iter().map(|d| d.delta.as_str()).collect::<String>(), "El presupuesto se envía el viernes [1].");
        assert!(last.done && last.error.is_none());
        assert_eq!(last.message_id, ChatMessageId::from_u128(9));
        assert_eq!(last.citations.len(), 1);
        assert_eq!(last.citations[0].n, 1);
        assert_eq!(last.citations[0].meeting_title, "Kickoff");
        let req = &p.requests.lock().unwrap()[0];
        let user = &req.messages.last().expect("msg").content;
        assert!(user.contains("[1] Kickoff · 2026-11-16 09:30 · 00:01"), "{user}");
        assert!(user.contains("Edu (yo): Sí, yo me encargo."));
        assert!(user.contains("¿Cuándo se envía el presupuesto?"));
        assert!(req.system.as_ref().expect("sys").contains("[1], [2]"));
    }

    #[tokio::test]
    async fn invented_citation_numbers_are_dropped_and_commas_supported() {
        let p = Arc::new(FakeProvider::new(vec!["Dato A [2]. Dato B [1, 7]. Otra vez [2]. Falso [99]."]));
        let chunks = vec![chunk(11, "Reunión A", 60_000, "texto a"), chunk(12, "Reunión B", 125_000, "texto b")];
        let (e, retr) = engine(p.clone(), transcript(), chunks);
        let th = thread(ChatScope::Group { group_id: acta_core::ids::GroupId::from_u128(3) });
        let deltas = collect(e.ask(&th, &[], "pregunta", ChatMessageId::from_u128(1)).await.expect("ask")).await;
        let cites = &deltas.last().expect("last").citations;
        assert_eq!(cites.iter().map(|c| c.n).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(cites[0].meeting_id, MeetingId::from_u128(12));
        assert_eq!(cites[0].at, MediaMs(125_000));
        assert_eq!(cites[1].meeting_title, "Reunión A");
        assert_eq!(retr.1.lock().unwrap()[0], ("pregunta".to_string(), 12));
        let user = p.requests.lock().unwrap()[0].messages.last().expect("m").content.clone();
        assert!(user.contains("[1] Reunión A · 2026-11-16 09:30 · 01:00\ntexto a"));
        assert!(user.contains("[2] Reunión B · 2026-11-16 09:30 · 02:05"));
    }

    #[tokio::test]
    async fn empty_retrieval_tells_the_model_there_is_no_context() {
        let p = Arc::new(FakeProvider::new(vec!["No tengo información."]));
        let (e, _) = engine(p.clone(), transcript(), vec![]);
        let th = thread(ChatScope::All);
        let deltas = collect(e.ask(&th, &[], "x", ChatMessageId::from_u128(1)).await.expect("ask")).await;
        assert!(deltas.last().expect("l").citations.is_empty());
        assert!(p.requests.lock().unwrap()[0].messages.last().expect("m").content.contains("No se ha encontrado contexto"));
    }

    #[tokio::test]
    async fn history_is_forwarded_and_trimmed() {
        let p = Arc::new(FakeProvider::new(vec!["ok"]));
        let (e, _) = engine(p.clone(), transcript(), vec![]);
        let th = thread(ChatScope::All);
        let history: Vec<ChatMessage> = (0..14)
            .map(|i| ChatMessage {
                id: ChatMessageId::from_u128(i),
                thread_id: th.id,
                role: if i % 2 == 0 { ChatRole::User } else { ChatRole::Assistant },
                content: format!("m{i}"),
                citations: vec![],
                provider: None,
                created_at: UnixMs(0),
            })
            .collect();
        collect(e.ask(&th, &history, "q", ChatMessageId::from_u128(1)).await.expect("ask")).await;
        let msgs = p.requests.lock().unwrap()[0].messages.clone();
        assert_eq!(msgs.len(), HISTORY_MESSAGES + 1);
        assert_eq!(msgs[0].content, "m4");
        assert_eq!(msgs[0].role, Role::User);
    }

    #[tokio::test]
    async fn upstream_error_becomes_final_delta_with_error() {
        struct Failing(acta_core::ids::ProviderId);
        #[async_trait]
        impl LlmProvider for Failing {
            fn id(&self) -> &acta_core::ids::ProviderId {
                &self.0
            }
            fn capabilities(&self) -> acta_core::llm::ProviderCapabilities {
                acta_core::llm::ProviderCapabilities { streaming: true, native_json_schema: false, context_tokens: 100_000 }
            }
            async fn complete(&self, _r: LlmRequest) -> PortResult<acta_core::llm::LlmResponse> {
                Err(PortError::Cancelled)
            }
            async fn stream(&self, _r: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
                Ok(Box::pin(futures::stream::iter(vec![Ok("Hola".to_string()), Err(PortError::Timeout("lento".into()))])))
            }
        }
        let retr = Arc::new(FakeRetriever(vec![], Default::default()));
        let e = LlmChatEngine::with_source(Arc::new(Failing("f".into())), Arc::new(FakeSource { title: "t".into(), transcript: transcript() }), retr, me());
        let deltas = collect(e.ask(&thread(ChatScope::All), &[], "q", ChatMessageId::from_u128(1)).await.expect("ask")).await;
        let last = deltas.last().expect("last");
        assert!(last.done && last.error.as_deref().is_some_and(|m| m.contains("lento")));
    }

    #[tokio::test]
    async fn very_long_meeting_selects_relevant_blocks_first() {
        // ~120 min de texto, contexto pequeño -> pasada de selección + respuesta.
        let sp = vec![speaker(1, true, None), speaker(2, false, Some("Ana"))];
        let utterances: Vec<_> = (0..240u64)
            .map(|i| utt(i as u32, 2, i * 30_000, &format!("Bloque número {i}: {}", "texto de relleno ".repeat(40))))
            .collect();
        let t = Transcript { meeting_id: MeetingId::from_u128(1), speakers: sp, utterances };
        // `complete` (selección) responde "3, 4"; `stream` (respuesta final) cita [3].
        struct Selector {
            id: acta_core::ids::ProviderId,
            seen: std::sync::Mutex<Vec<LlmRequest>>,
        }
        #[async_trait]
        impl LlmProvider for Selector {
            fn id(&self) -> &acta_core::ids::ProviderId {
                &self.id
            }
            fn capabilities(&self) -> acta_core::llm::ProviderCapabilities {
                acta_core::llm::ProviderCapabilities { streaming: true, native_json_schema: false, context_tokens: 12_000 }
            }
            async fn complete(&self, r: LlmRequest) -> PortResult<acta_core::llm::LlmResponse> {
                self.seen.lock().unwrap().push(r);
                Ok(acta_core::llm::LlmResponse { text: "3, 4".into(), json: None, model: None, usage: Default::default() })
            }
            async fn stream(&self, r: LlmRequest) -> PortResult<EventStream<PortResult<String>>> {
                self.seen.lock().unwrap().push(r);
                Ok(Box::pin(futures::stream::iter(vec![Ok("Respuesta [3].".to_string())])))
            }
        }
        let p = Arc::new(Selector { id: "sel".into(), seen: Default::default() });
        let (e, _) = engine(p.clone(), t, vec![]);
        let th = thread(ChatScope::Meeting { meeting_id: MeetingId::from_u128(1) });
        let deltas = collect(e.ask(&th, &[], "¿qué se dijo del bloque 3?", ChatMessageId::from_u128(1)).await.expect("ask")).await;
        let seen = p.seen.lock().unwrap().clone();
        assert!(seen.len() >= 3, "varias tandas de selección + respuesta final, hubo {}", seen.len());
        assert!(seen[0].system.as_ref().expect("s").contains("filtro de relevancia"));
        // El contexto final solo lleva los bloques elegidos.
        let last_req = seen.last().expect("last").clone();
        let ctx = &last_req.messages.last().expect("m").content;
        assert!(ctx.contains("[3] ") && ctx.contains("[4] ") && !ctx.contains("[5] "), "ctx: {}", &ctx[..ctx.len().min(300)]);
        assert_eq!(deltas.last().expect("l").citations.iter().map(|c| c.n).collect::<Vec<_>>(), vec![3]);
    }
}
