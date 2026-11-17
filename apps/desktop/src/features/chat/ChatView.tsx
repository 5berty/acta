import { ArrowDown, ArrowUp, Check, Copy, Quote, RotateCw, Sparkles, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Citation } from "../../api";
import { Markdown, citationLabel } from "../../shared/Markdown";
import { useStickToBottom } from "../../shared/useStickToBottom";

/** Lo mínimo que el chat necesita de un mensaje (los del directo no se guardan). */
export type ChatItem = Pick<ChatMessage, "id" | "role" | "content" | "citations"> & { provider?: string | null };

interface Props {
  messages: ChatItem[];
  /** Texto parcial por mensaje del asistente (streaming). */
  streams: Record<string, string>;
  busy: boolean;
  error?: string | null;
  placeholder?: string;
  /** Preguntas de ejemplo para el estado vacío. */
  suggestions?: string[];
  /** Quién responde ahora: «Claude Code · sonnet». */
  providerLabel?: string | null;
  /** Nombre visible de cada proveedor, para el pie de las respuestas. */
  providerNames?: Record<string, string>;
  /** Respuestas que la persona detuvo: se enseña lo que había llegado. */
  stopped?: Record<string, string>;
  emptyTitle?: string;
  emptyHint?: string;
  inputPlaceholder?: string;
  /** `panel`: columna estrecha (grupo, directo). */
  variant?: "page" | "panel";
  onSend(text: string): void;
  onStop?(): void;
  onRetry?(): void;
  onCitation(c: Citation): void;
}

function Mark({ pulse }: { pulse?: boolean }) {
  return (
    <span className={`msg-mark${pulse ? " msg-mark-pulse" : ""}`} aria-hidden>
      <Sparkles size={13} strokeWidth={2.1} />
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  const label = copied ? "Copiado" : "Copiar respuesta";
  return (
    <button
      type="button"
      className="msg-action"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => {},
        );
      }}
    >
      {copied ? <Check size={13} strokeWidth={2.6} aria-hidden /> : <Copy size={13} strokeWidth={2} aria-hidden />}
    </button>
  );
}

export function ChatView({
  messages,
  streams,
  busy,
  error,
  placeholder,
  suggestions = [],
  providerLabel,
  providerNames = {},
  stopped = {},
  emptyTitle,
  emptyHint,
  inputPlaceholder = "Escribe tu pregunta…",
  variant = "page",
  onSend,
  onStop,
  onRetry,
  onCitation,
}: Props) {
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const known = new Set(messages.map((m) => m.id));
  const orphan = Object.keys(streams).filter((id) => !known.has(id));
  const empty = messages.length === 0 && orphan.length === 0;
  const last = messages[messages.length - 1];
  const waiting = busy && orphan.length === 0 && (last?.role === "user" || (last ? streams[last.id] === "" : false));
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const { away, toBottom } = useStickToBottom(log, `${messages.length}|${waiting}|${Object.values(streams).join("").length}|${error ?? ""}`);

  const send = (t: string) => {
    toBottom();
    onSend(t);
  };
  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    send(t);
    setText("");
  };

  return (
    <div className={`chat chat-${variant}`}>
      <div className="chat-log" role="log" aria-live="polite" ref={log}>
        {empty ? (
          <div className="chat-empty">
            <span className="chat-empty-icon" aria-hidden>
              <Sparkles size={20} strokeWidth={1.8} />
            </span>
            <p className="chat-empty-text">{emptyTitle ?? `Pregunta lo que quieras sobre ${placeholder ?? "esta reunión"}.`}</p>
            <p className="chat-empty-hint">{emptyHint ?? "Cada respuesta cita el minuto exacto, para que puedas ir a escucharlo."}</p>
            {suggestions.length > 0 ? (
              <ul className="plain suggestions" aria-label="Preguntas de ejemplo">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button type="button" className="suggestion-card" disabled={busy} onClick={() => send(s)}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="msg msg-user">
                {m.content}
              </div>
            );
          }
          const wasStopped = m.id in stopped;
          const streaming = !wasStopped && m.id in streams;
          const content = wasStopped ? (stopped[m.id] ?? "") : (streams[m.id] ?? m.content);
          if (streaming && !content) return null;
          const providerName = m.provider ? (providerNames[m.provider] ?? null) : null;
          return (
            <article key={m.id} className={`msg msg-assistant${streaming ? " msg-streaming" : ""}`} data-last={m.id === lastAssistant || undefined}>
              <Mark />
              <div className="msg-main">
                {content ? <Markdown source={content} citations={m.citations} onCitation={onCitation} /> : null}
                {m.citations.length > 0 && !streaming ? (
                  <div className="cite-list">
                    {m.citations.map((c) => (
                      <button key={c.n} type="button" className="chip cite-chip" title={c.snippet || undefined} onClick={() => onCitation(c)}>
                        <Quote size={10} strokeWidth={2.4} aria-hidden />
                        <span>{citationLabel(c)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {streaming ? null : (
                  <div className="msg-foot">
                    {wasStopped ? <span className="msg-stopped">Respuesta detenida</span> : null}
                    {providerName ? <span className="msg-provider">{providerName}</span> : null}
                    {content ? <CopyButton text={content} /> : null}
                    {onRetry && m.id === lastAssistant && !busy && !error ? (
                      <button type="button" className="msg-action" aria-label="Reintentar" title="Volver a preguntar" onClick={onRetry}>
                        <RotateCw size={13} strokeWidth={2.1} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {orphan.map((id) => (
          <article key={id} className="msg msg-assistant msg-streaming">
            <Mark />
            <div className="msg-main">
              <Markdown source={streams[id] ?? ""} />
            </div>
          </article>
        ))}
        {waiting ? (
          <div className="msg msg-assistant msg-thinking" role="status" aria-label="Pensando">
            <Mark pulse />
            <span className="thinking-text">Pensando…</span>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="chat-error">
            <TriangleAlert size={15} strokeWidth={2.1} aria-hidden />
            <span className="chat-error-text">{error}</span>
            {onRetry && !busy ? (
              <button type="button" className="btn btn-secondary btn-sm btn-capsule" onClick={onRetry}>
                <RotateCw size={12} strokeWidth={2.2} aria-hidden />
                Reintentar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="composer-dock">
        {away && !empty ? (
          <button type="button" className="chat-jump glass" aria-label="Ir al final" title="Ir al final" onClick={toBottom}>
            <ArrowDown size={14} strokeWidth={2.4} aria-hidden />
          </button>
        ) : null}
        <form
          className="composer glass"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            aria-label="Pregunta"
            rows={1}
            value={text}
            placeholder={inputPlaceholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // ↩ y ⌘↩ envían; ⇧↩ salta de línea. Sin tocar la composición de un IME.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-bar">
            {providerLabel ? (
              <span className="composer-provider" title="Quién responde. Se cambia en Ajustes → Proveedores de IA.">
                <Sparkles size={11} strokeWidth={2.2} aria-hidden />
                <span>{providerLabel}</span>
              </span>
            ) : null}
            <span className="spacer" />
            <span className="composer-hint" aria-hidden>
              <span className="kbd">↩</span> enviar
            </span>
            {busy ? (
              <button type="button" className="composer-send composer-stop" aria-label="Detener" title="Detener la respuesta" onClick={onStop}>
                <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden />
              </button>
            ) : (
              <button type="submit" className="composer-send" aria-label="Enviar" disabled={!text.trim()}>
                <ArrowUp size={16} strokeWidth={2.6} aria-hidden />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
