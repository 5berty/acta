import { useState } from "react";
import type { ActaApi } from "../api";
import { ChatContainer } from "../features/chat/ChatContainer";
import { GroupsContainer } from "../features/groups/GroupsContainer";
import { MeetingDetailContainer } from "../features/meetings/MeetingDetailContainer";
import { MeetingListContainer } from "../features/meetings/MeetingListContainer";
import { SettingsContainer } from "../features/settings/SettingsContainer";
import { ApiProvider } from "./ApiContext";
import { Sidebar, type View } from "./Sidebar";

interface Open {
  id: string;
  at: number | null;
}

function Shell() {
  const [view, setView] = useState<View>("meetings");
  const [open, setOpen] = useState<Open | null>(null);

  const openMeeting = (id: string, at?: number) => {
    setOpen({ id, at: at ?? null });
    setView("meetings");
  };

  return (
    <div className="app">
      <Sidebar
        view={view}
        onView={(v) => {
          setView(v);
          if (v === "meetings") setOpen(null);
        }}
      />
      <main className="main">
        {view === "meetings" ? (
          open ? (
            <MeetingDetailContainer key={`${open.id}-${open.at}`} meetingId={open.id} initialSeekMs={open.at} onBack={() => setOpen(null)} onOpenMeeting={openMeeting} />
          ) : (
            <MeetingListContainer onOpen={(id) => openMeeting(id)} />
          )
        ) : null}
        {view === "groups" ? <GroupsContainer onOpenMeeting={openMeeting} /> : null}
        {view === "ask" ? (
          <div className="ask-page">
            <h1>Pregunta a todas tus reuniones</h1>
            <ChatContainer scope={{ kind: "all" }} placeholder="todas tus reuniones" onCitation={(c) => openMeeting(c.meetingId, c.at)} />
          </div>
        ) : null}
        {view === "settings" ? <SettingsContainer /> : null}
      </main>
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
