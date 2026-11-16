import { useCallback, useEffect, useState } from "react";
import type { ActaApi } from "../api";
import { AskPage } from "../features/chat/AskPage";
import { GroupsContainer } from "../features/groups/GroupsContainer";
import { MeetingDetailContainer } from "../features/meetings/MeetingDetailContainer";
import { MeetingListContainer } from "../features/meetings/MeetingListContainer";
import { SettingsContainer } from "../features/settings/SettingsContainer";
import { ApiProvider, useApiEvent } from "./ApiContext";
import { CommandPalette } from "./CommandPalette";
import { Sidebar, type View } from "./Sidebar";

interface Open {
  id: string;
  at: number | null;
}

function Shell() {
  const [view, setView] = useState<View>("meetings");
  const [open, setOpen] = useState<Open | null>(null);
  const [palette, setPalette] = useState(false);

  const openMeeting = useCallback((id: string, at?: number) => {
    setOpen({ id, at: at ?? null });
    setView("meetings");
  }, []);
  const goTo = useCallback((v: View) => {
    setView(v);
    if (v === "meetings") setOpen(null);
  }, []);
  useApiEvent("main:navigate", ({ meetingId }) => openMeeting(meetingId));

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
      <Sidebar view={view} onView={goTo} onSearch={() => setPalette(true)} />
      <main className="pane">
        {view === "meetings" ? (
          open ? (
            <MeetingDetailContainer key={`${open.id}-${open.at}`} meetingId={open.id} initialSeekMs={open.at} onBack={() => setOpen(null)} onOpenMeeting={openMeeting} />
          ) : (
            <MeetingListContainer onOpen={(id) => openMeeting(id)} />
          )
        ) : null}
        {view === "groups" ? <GroupsContainer onOpenMeeting={openMeeting} /> : null}
        {view === "ask" ? <AskPage onOpenMeeting={openMeeting} /> : null}
        {view === "settings" ? <SettingsContainer /> : null}
      </main>
      {palette ? <CommandPalette onClose={() => setPalette(false)} onOpenMeeting={openMeeting} onView={goTo} /> : null}
    </div>
  );
}

export function App({ api }: { api?: ActaApi }) {
  return (
    <ApiProvider api={api}>
      <Shell />
    </ApiProvider>
  );
}
