import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatScope, ChatThread, Citation } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { errorMessage } from "../../shared/ui/ui";
import { ChatView } from "./ChatView";
import { chatScopeKey, useChatModel } from "./useChatModel";

interface Props {
  scope: ChatScope;
  placeholder?: string;
  suggestions?: string[];
  variant?: "page" | "panel";
  onCitation(c: Citation): void;
}

export function ChatContainer({ scope, placeholder, suggestions, variant, onCitation }: Props) {
  const api = useApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { model, llm, pick, loadProviders, providerNames } = useChatModel(chatScopeKey(scope));
  const thread = useRef<ChatThread | null>(null);
  /** Respuesta que se está esperando, y las que la persona ha detenido. */
  const pending = useRef<string | null>(null);
  /** «Detener» pulsado antes de saber el id de la respuesta: se cancela en cuanto llega. */
  const stopEarly = useRef(false);
  const ignored = useRef(new Set<string>());
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  const key = JSON.stringify(scope);

  const reload = useCallback(async () => {
    if (!thread.current) return;
    setMessages(await api.chatMessagesList(thread.current.id));
  }, [api]);

  useEffect(() => {
    let live = true;
    thread.current = null;
    pending.current = null;
    setMessages([]);
    setStreams({});
    setStopped({});
    void api.chatThreadsList(scope).then(async (ts) => {
      const t = ts[0];
      if (!live || !t) return;
      thread.current = t;
      const msgs = await api.chatMessagesList(t.id);
      if (live) setMessages(msgs);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);

  useApiEvent("chat:delta", (d) => {
    if (d.threadId !== thread.current?.id) return;
    if (ignored.current.has(d.messageId)) return;
    if (d.error) setError(d.error);
    setStreams((prev) => (d.done ? omit(prev, d.messageId) : { ...prev, [d.messageId]: (prev[d.messageId] ?? "") + d.delta }));
    if (d.done) {
      if (pending.current === d.messageId) pending.current = null;
      setBusy(false);
      void reload();
    }
  });

  const send = async (text: string) => {
    setError(null);
    setBusy(true);
    stopEarly.current = false;
    try {
      if (!thread.current) thread.current = await api.chatThreadCreate(scope);
      // Sin elección propia no se manda nada: responde el proveedor de chat de Ajustes.
      const { userMessage, assistantMessageId } = await api.chatSend(thread.current.id, text, llm);
      setMessages((prev) => (prev.some((m) => m.id === userMessage.id) ? prev : [...prev, userMessage]));
      if (stopEarly.current) {
        stopEarly.current = false;
        ignored.current.add(assistantMessageId);
        cancel(assistantMessageId);
        return;
      }
      pending.current = assistantMessageId;
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  // Corta la generación en el backend. Si falla, la pantalla ya está detenida:
  // se deja constancia en la consola y nada más.
  const cancel = (id: string) => {
    api.chatCancel(id).catch((e: unknown) => console.warn("No se pudo detener la respuesta", e));
  };

  // «Detener»: se cancela la generación, se deja de escuchar esa respuesta y se
  // conserva lo que había llegado.
  const stop = () => {
    const id = pending.current;
    pending.current = null;
    if (!id) {
      // Aún no se sabe qué respuesta es: se cancela en cuanto `chatSend` la devuelva.
      stopEarly.current = busy;
      setBusy(false);
      return;
    }
    setBusy(false);
    ignored.current.add(id);
    cancel(id);
    const partial = streamsRef.current[id] ?? "";
    const t = thread.current;
    setStopped((prev) => ({ ...prev, [id]: partial }));
    setStreams((prev) => omit(prev, id));
    if (t) setMessages((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, { id, threadId: t.id, role: "assistant", content: partial, citations: [], provider: null, createdAt: Date.now() }]));
  };

  const retry = () => {
    const lastQuestion = [...messages].reverse().find((m) => m.role === "user");
    if (lastQuestion) void send(lastQuestion.content);
  };

  return (
    <ChatView
      messages={messages}
      streams={streams}
      stopped={stopped}
      busy={busy}
      error={error}
      placeholder={placeholder}
      suggestions={suggestions}
      variant={variant}
      model={model}
      onPickModel={pick}
      loadProviders={loadProviders}
      providerNames={providerNames}
      onSend={(t) => void send(t)}
      onStop={stop}
      onRetry={messages.some((m) => m.role === "user") ? retry : undefined}
      onCitation={onCitation}
    />
  );
}

function omit(rec: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _gone, ...rest } = rec;
  return rest;
}
