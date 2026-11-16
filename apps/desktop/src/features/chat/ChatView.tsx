import { ArrowUp, Quote, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, Citation } from "../../api";
import { formatClock } from "../../shared/format";

interface Props {
  messages: ChatMessage[];
  /** Texto parcial por mensaje del asistente (streaming). */
  streams: Record<string, string>;
  busy: boolean;
  error?: string | null;
  placeholder?: string;
  /** Preguntas de ejemplo para el estado vacío. */
  suggestions?: string[];
  onSend(text: string): void;
  onCitation(c: Citation): void;
}

const label = (c: Citation) => `${c.meetingTitle}, ${formatClock(c.at)}`;

function withCitations(content: string, citations: Citation[], onCitation: Props["onCitation"]): ReactNode[] {
  return content.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    const c = m ? citations.find((x) => x.n === Number(m[1])) : undefined;
    if (!c) return part;
    return (
      <button key={i} type="button" className="cite" aria-label={`Cita ${c.n}: ${label(c)}`} title={label(c)} onClick={() => onCitation(c)}>
        {c.n}
      </button>
    );
  });
}

export function ChatView({ messages, streams, busy, error, placeholder, suggestions = [], onSend, onCitation }: Props) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const known = new Set(messages.map((m) => m.id));
  const orphan = Object.keys(streams).filter((id) => !known.has(id));
  const empty = messages.length === 0 && orphan.length === 0;
  const waiting = busy && orphan.length === 0 && messages[messages.length - 1]?.role === "user";

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, streams]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="chat">
      <div className="chat-log" aria-live="polite">
        {empty ? (
          <div className="chat-empty">
            <span className="chat-empty-icon" aria-hidden>
              <Sparkles size={20} strokeWidth={1.8} />
            </span>
            <p className="chat-empty-text">Pregunta lo que quieras sobre {placeholder ?? "esta reunión"}.</p>
            <p className="chat-empty-hint">Cada respuesta cita el minuto exacto, para que puedas ir a escucharlo.</p>
            {suggestions.length > 0 ? (
              <ul className="plain suggestions" aria-label="Preguntas de ejemplo">
                {suggestions.map((s) => (
                  <li key={s}>
                    <button type="button" className="suggestion-card" disabled={busy} onClick={() => onSend(s)}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}`}>
            <p>{m.role === "assistant" ? withCitations(streams[m.id] ?? m.content, m.citations, onCitation) : m.content}</p>
            {m.citations.length > 0 ? (
              <div className="cite-list">
                {m.citations.map((c) => (
                  <button key={c.n} type="button" className="chip cite-chip" title={c.snippet || undefined} onClick={() => onCitation(c)}>
                    <Quote size={10} strokeWidth={2.4} aria-hidden />
                    <span>{label(c)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {orphan.map((id) => (
          <div key={id} className="bubble bubble-assistant">
            <p>{streams[id]}</p>
          </div>
        ))}
        {waiting ? (
          <div className="bubble bubble-assistant bubble-typing" aria-label="Pensando">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {error ? <p role="alert" className="inline-error">{error}</p> : null}
        <div ref={end} />
      </div>
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
          placeholder="Escribe tu pregunta…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="composer-send" aria-label="Enviar" disabled={busy || !text.trim()}>
          <ArrowUp size={16} strokeWidth={2.6} aria-hidden />
        </button>
      </form>
    </div>
  );
}
