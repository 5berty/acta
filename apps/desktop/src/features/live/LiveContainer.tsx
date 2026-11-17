import { useEffect, useRef, useState } from "react";
import type { LiveSegment, MeetingApp } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { providerById, providerDisplay } from "../chat/providerLabel";
import { LiveAsk } from "./LiveAsk";
import { LiveView } from "./LiveView";

interface Props {
  /** `MeetingId` de la grabación en curso. */
  sessionId: string;
  elapsedMs: number;
  paused: boolean;
  app: MeetingApp | null;
}

/** Fusiona por `id` (el provisional y su versión final comparten id) y ordena por tiempo. */
export function mergeSegments(prev: LiveSegment[], incoming: LiveSegment[]): LiveSegment[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.startMs - b.startMs);
}

export function LiveContainer({ sessionId, elapsedMs, paused, app }: Props) {
  const api = useApi();
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [livePreview, setLivePreview] = useState(true);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setSegments([]);
    api.liveTranscriptGet(sessionId).then(
      (t) => live && setSegments((prev) => mergeSegments(t.segments, prev)),
      () => {},
    );
    void api.settingsGet().then((s) => {
      if (!live) return;
      setLivePreview(s.transcription.livePreview);
      const p = providerById(s, s.llm.chatProvider);
      setProviderLabel(p ? providerDisplay(p) : null);
    });
    return () => {
      live = false;
    };
  }, [api, sessionId]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useApiEvent("live:transcript", (t) => {
    if (t.sessionId === sessionId) setSegments((prev) => mergeSegments(prev, t.segments));
  });

  const jump = (ms: number) => {
    const target = segments.find((s) => ms >= s.startMs && ms < s.endMs) ?? [...segments].reverse().find((s) => s.startMs <= ms) ?? segments[0];
    if (!target) return;
    setFlashId(target.id);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 2400);
    document.querySelector(`[data-seg="${CSS.escape(target.id)}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  return (
    <LiveView
      segments={segments}
      elapsedMs={elapsedMs}
      paused={paused}
      app={app}
      livePreview={livePreview}
      flashId={flashId}
      chat={<LiveAsk sessionId={sessionId} segments={segments} providerLabel={providerLabel} onJump={jump} />}
    />
  );
}
