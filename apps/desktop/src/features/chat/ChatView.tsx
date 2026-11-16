import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, Citation } from "../../api";
import { formatClock } from "../../shared/format";
import { Button } from "../../shared/ui/ui";

interface Props {
  messages: ChatMessage[];
  /** Texto parcial por mensaje del asistente (streaming). */
  streams: Record<string, string>;
  busy: boolean;
  error?: string | null;
  placeholder?: string;
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
      <button key={i} type="button" className="cite" aria-label={`Cita ${c.n}: ${label(c)}`} onClick={() => onCitation(c)}>
        {c.n}
      </button>
    );
  });
}

export function ChatView({ messages, streams, busy, error, placeholder, onSend, onCitation }: Props) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const known = new Set(messages.map((m) => m.id));
  const orphan = Object.keys(streams).filter((id) => !known.has(id));

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
        {messages.length === 0 && orphan.length === 0 ? <p className="muted">Pregunta lo que quieras sobre {placeholder ?? "esta reunión"}.</p> : null}
        {messages.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}`}>
            <p>{m.role === "assistant" ? withCitations(streams[m.id] ?? m.content, m.citations, onCitation) : m.content}</p>
            {m.citations.length > 0 ? (
              <div className="cite-list">
                {m.citations.map((c) => (
                  <button key={c.n} type="button" className="chip" onClick={() => onCitation(c)}>
                    {label(c)}
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
        {error ? <p role="alert" className="error">{error}</p> : null}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Pregunta"
          rows={2}
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
        <Button variant="primary" type="submit" disabled={busy || !text.trim()}>
          Enviar
        </Button>
      </form>
    </div>
  );
}
