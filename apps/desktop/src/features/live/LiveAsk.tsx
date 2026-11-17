import { useRef, useState } from "react";
import type { Citation, LiveSegment } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { errorMessage } from "../../shared/ui/ui";
import { ChatView, type ChatItem } from "../chat/ChatView";

interface Props {
  sessionId: string;
  segments: LiveSegment[];
  providerLabel?: string | null;
  /** Ir a ese minuto del directo. */
  onJump(ms: number): void;
}

const SUGGESTIONS = ["¿Qué se ha decidido hasta ahora?", "¿Me han pedido algo a mí?", "Resume los últimos minutos"];

/** Chat sobre lo dicho hasta ahora en la reunión que se está grabando. No se guarda: es para salir de dudas en el momento. */
export function LiveAsk({ sessionId, segments, providerLabel, onJump }: Props) {
  const api = useApi();
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const buffer = useRef("");
  const segs = useRef(segments);
  segs.current = segments;
  const n = useRef(0);

  useApiEvent("live:answer", (a) => {
    if (a.requestId !== pending.current) return;
    if (a.delta) {
      buffer.current += a.delta;
      const text = buffer.current;
      setStreams({ [a.requestId]: text });
    }
    if (!a.done) return;
    const content = buffer.current;
    pending.current = null;
    buffer.current = "";
    setStreams({});
    setBusy(false);
    if (a.error) setError(a.error);
    if (!content) return;
    const citations: Citation[] = (a.citations ?? []).map((c, i) => {
      const s = segs.current.find((x) => c.startMs >= x.startMs && c.startMs < x.endMs) ?? segs.current.find((x) => x.startMs === c.startMs);
      return { n: i + 1, meetingId: sessionId, meetingTitle: "", at: c.startMs, end: s?.endMs ?? c.startMs, snippet: s?.text ?? "" };
    });
    setMessages((prev) => [...prev, { id: a.requestId, role: "assistant", content, citations }]);
  });

  const ask = async (question: string) => {
    setError(null);
    setBusy(true);
    n.current += 1;
    setMessages((prev) => [...prev, { id: `q${n.current}`, role: "user", content: question, citations: [] }]);
    try {
      buffer.current = "";
      pending.current = await api.liveAsk({ sessionId, question });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const stop = () => {
    const id = pending.current;
    pending.current = null;
    setBusy(false);
    setStreams({});
    if (!id) return;
    const partial = buffer.current;
    buffer.current = "";
    setStopped((prev) => ({ ...prev, [id]: partial }));
    setMessages((prev) => [...prev, { id, role: "assistant", content: partial, citations: [] }]);
  };

  const retry = () => {
    const last = [...messages].reverse().find((m) => m.role === "user");
    if (last) void ask(last.content);
  };

  return (
    <ChatView
      variant="panel"
      messages={messages}
      streams={streams}
      stopped={stopped}
      busy={busy}
      error={error}
      providerLabel={providerLabel}
      suggestions={SUGGESTIONS}
      emptyTitle="Pregunta sobre la reunión"
      emptyHint="Sal de dudas sin interrumpir: acta responde con lo dicho hasta ahora y te lleva al minuto."
      inputPlaceholder="¿Han hablado de…?"
      onSend={(t) => void ask(t)}
      onStop={stop}
      onRetry={messages.some((m) => m.role === "user") ? retry : undefined}
      onCitation={(c) => onJump(c.at)}
      onTime={onJump}
    />
  );
}
