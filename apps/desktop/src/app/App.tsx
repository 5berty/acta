import { useCallback, useEffect, useRef, useState } from "react";
import type { ActaApi, SessionSnapshot } from "../api";
import { AskPage } from "../features/chat/AskPage";
import { GroupsContainer } from "../features/groups/GroupsContainer";
import { LiveContainer } from "../features/live/LiveContainer";
import { MeetingDetailContainer } from "../features/meetings/MeetingDetailContainer";
import { MeetingListContainer } from "../features/meetings/MeetingListContainer";
import { ProcessingTimelineProvider } from "../features/meetings/useProcessingTimeline";
import { Onboarding } from "../features/onboarding/Onboarding";
import { SettingsContainer } from "../features/settings/SettingsContainer";
import { ApiProvider, useApi, useApiEvent } from "./ApiContext";
import { CommandPalette } from "./CommandPalette";
import { Sidebar, type View } from "./Sidebar";

interface Open {
  id: string;
  at: number | null;
}

/** La grabación en curso (si la hay) y su reloj, para la vista «En directo». */
function useRecording() {
  const api = useApi();
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    void api.sessionGetState().then((s) => live && setSnap((prev) => prev ?? s));
    return () => {
      live = false;
    };
  }, [api]);
  useApiEvent("session:state", setSnap);
  const state = snap?.state;
  const active = state && (state.state === "recording" || state.state === "paused") ? state : null;
  const ticking = active?.state === "recording";
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const elapsedMs = snap ? snap.elapsedMs + (ticking ? Math.max(0, now - snap.at) : 0) : 0;
  return { active, elapsedMs };
}

function Shell() {
  const [view, setView] = useState<View>("meetings");
  const [open, setOpen] = useState<Open | null>(null);
  const [group, setGroup] = useState<{ id: string; n: number } | null>(null);
  const [palette, setPalette] = useState(false);
  const api = useApi();
  const [onboarding, setOnboarding] = useState(false);
  // Al cerrar la bienvenida, Ajustes vuelve a leer lo que ella ha guardado.
  const [settingsEpoch, setSettingsEpoch] = useState(0);

  // Primer arranque: la bienvenida sale una sola vez.
  useEffect(() => {
    let cancelled = false;
    void api.settingsGet().then((s) => {
      if (!cancelled && !s.onboarding?.completed) setOnboarding(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const openMeeting = useCallback((id: string, at?: number) => {
    setOpen({ id, at: at ?? null });
    setView("meetings");
  }, []);
  const goTo = useCallback((v: View) => {
    setView(v);
    if (v === "meetings") setOpen(null);
  }, []);
  const openGroup = useCallback((id: string) => {
    setGroup((g) => ({ id, n: (g?.n ?? 0) + 1 }));
    setView("groups");
  }, []);
  const { active: recording, elapsedMs } = useRecording();
  const recordingId = recording?.meetingId ?? null;
  // La pastilla pide una reunión: si es la que se está grabando, es el directo.
  useApiEvent("main:navigate", ({ meetingId }) => (meetingId === recordingId ? setView("live") : openMeeting(meetingId)));
  // Al parar estando en el directo, se pasa a la reunión recién grabada.
  const wasRecording = useRef<string | null>(null);
  useEffect(() => {
    const before = wasRecording.current;
    wasRecording.current = recordingId;
    if (before && !recordingId && view === "live") openMeeting(before);
  }, [recordingId, view, openMeeting]);

  // ⌘K: búsqueda rápida. Sin animación: es un atajo que se usa decenas de veces al día.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      {/* Franja para arrastrar la ventana: la barra de título es transparente. */}
      <div className="window-drag" data-tauri-drag-region aria-hidden />
      <Sidebar view={view} onView={goTo} onSearch={() => setPalette(true)} live={recording ? { paused: recording.state === "paused" } : null} />
      <main className="pane">
        {view === "meetings" ? (
          open ? (
            <MeetingDetailContainer key={`${open.id}-${open.at}`} meetingId={open.id} initialSeekMs={open.at} onBack={() => setOpen(null)} onOpenMeeting={openMeeting} />
          ) : (
            <MeetingListContainer onOpen={(id) => openMeeting(id)} />
          )
        ) : null}
        {view === "groups" ? <GroupsContainer key={group ? `${group.id}-${group.n}` : "groups"} initialGroupId={group?.id ?? null} onOpenMeeting={openMeeting} /> : null}
        {view === "live" && recording ? <LiveContainer sessionId={recording.meetingId} elapsedMs={elapsedMs} paused={recording.state === "paused"} app={recording.app} /> : null}
        {view === "ask" ? <AskPage onOpenMeeting={openMeeting} /> : null}
        {view === "settings" ? <SettingsContainer key={settingsEpoch} onReplayOnboarding={() => setOnboarding(true)} /> : null}
      </main>
      {onboarding ? (
        <Onboarding
          onClose={() => {
            setOnboarding(false);
            setSettingsEpoch((n) => n + 1);
          }}
        />
      ) : null}
      {palette ? <CommandPalette onClose={() => setPalette(false)} onOpenMeeting={openMeeting} onOpenGroup={openGroup} onView={goTo} /> : null}
    </div>
  );
}

export function App({ api }: { api?: ActaApi }) {
  return (
    <ApiProvider api={api}>
      <ProcessingTimelineProvider>
        <Shell />
      </ProcessingTimelineProvider>
    </ApiProvider>
  );
}
