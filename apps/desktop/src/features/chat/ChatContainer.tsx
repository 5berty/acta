import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatScope, ChatThread, Citation } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { errorMessage } from "../../shared/ui/ui";
import { ChatView } from "./ChatView";

interface Props {
  scope: ChatScope;
  placeholder?: string;
  onCitation(c: Citation): void;
}

export function ChatContainer({ scope, placeholder, onCitation }: Props) {
  const api = useApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<ChatThread | null>(null);
  const key = JSON.stringify(scope);

  const reload = useCallback(async () => {
    if (!thread.current) return;
    setMessages(await api.chatMessagesList(thread.current.id));
  }, [api]);

  useEffect(() => {
    let live = true;
    thread.current = null;
    setMessages([]);
    setStreams({});
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
    if (d.error) setError(d.error);
    setStreams((prev) => (d.done ? omit(prev, d.messageId) : { ...prev, [d.messageId]: (prev[d.messageId] ?? "") + d.delta }));
    if (d.done) {
      setBusy(false);
      void reload();
    }
  });

  const send = async (text: string) => {
    setError(null);
    setBusy(true);
    try {
      if (!thread.current) thread.current = await api.chatThreadCreate(scope);
      const { userMessage } = await api.chatSend(thread.current.id, text);
      setMessages((prev) => (prev.some((m) => m.id === userMessage.id) ? prev : [...prev, userMessage]));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return <ChatView messages={messages} streams={streams} busy={busy} error={error} placeholder={placeholder} onSend={(t) => void send(t)} onCitation={onCitation} />;
}

function omit(rec: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _gone, ...rest } = rec;
  return rest;
}
