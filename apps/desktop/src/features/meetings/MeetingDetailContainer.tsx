import { useEffect, useState } from "react";
import type { Citation, Group, MeetingDetail, ProcessingStep, VoiceprintSummary } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { formatDate, formatDuration, platformLabel } from "../../shared/format";
import { Badge, Button, EmptyState, Tabs, errorMessage, type TabDef } from "../../shared/ui/ui";
import { CapturesContainer } from "../captures/CapturesContainer";
import { ChatContainer } from "../chat/ChatContainer";
import { EscaletaTab } from "../escaleta/EscaletaTab";
import { MinutesTab } from "../minutes/MinutesTab";
import { AudioPlayer } from "../player/AudioPlayer";
import { PlayerProvider, usePlayer } from "../player/PlayerContext";
import { TimelineTab } from "../timeline/TimelineTab";
import { TranscriptTab } from "../transcript/TranscriptTab";
import { ProcessingStatus, REPROCESS_STEPS } from "./ProcessingStatus";
import { useMeetingDetail } from "./useMeetingDetail";

type TabKey = "resumen" | "transcript" | "escaleta" | "timeline" | "capturas" | "chat";

interface Props {
  meetingId: string;
  initialSeekMs?: number | null;
  onBack(): void;
  /** Para citas de otras reuniones. */
  onOpenMeeting(meetingId: string, atMs: number): void;
}

export function MeetingDetailContainer(props: Props) {
  const data = useMeetingDetail(props.meetingId);
  const { detail, error } = data;
  if (error && !detail) return <EmptyState title="No se ha podido abrir la reunión" hint={error} />;
  if (!detail) return <p className="muted pad">Cargando…</p>;
  return (
    <PlayerProvider key={detail.meeting.id} audio={detail.audio}>
      <Body {...props} detail={detail} voiceprints={data.voiceprints} reload={data.reload} />
    </PlayerProvider>
  );
}

interface BodyProps extends Props {
  detail: MeetingDetail;
  voiceprints: VoiceprintSummary[];
  reload(): Promise<void>;
}

function Body({ meetingId, initialSeekMs, onBack, onOpenMeeting, detail, voiceprints, reload }: BodyProps) {
  const api = useApi();
  const player = usePlayer();
  const [tab, setTab] = useState<TabKey>("resumen");
  const [groups, setGroups] = useState<Group[]>([]);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<{ step: ProcessingStep; fraction: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { seek } = player;

  useEffect(() => {
    void api.groupsList().then(setGroups);
  }, [api]);
  useEffect(() => {
    if (initialSeekMs != null) seek(initialSeekMs);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useApiEvent("processing:progress", (p) => p.meetingId === meetingId && setProgress({ step: p.step, fraction: p.fraction }));
  useApiEvent("meeting:updated", (u) => u.meetingId === meetingId && void reload());
  useApiEvent("capture:saved", (c) => c.meetingId === meetingId && void reload());

  const { meeting } = detail;
  const run = async (f: () => Promise<unknown>) => {
    try {
      setActionError(null);
      await f();
      await reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const tabs: TabDef<TabKey>[] = [
    { key: "resumen", label: "Resumen" },
    { key: "transcript", label: "Transcript" },
    { key: "escaleta", label: "Escaleta" },
    { key: "timeline", label: "Timeline" },
    { key: "capturas", label: "Capturas", count: detail.captures.length },
    { key: "chat", label: "Chat" },
  ];
  const free = groups.filter((g) => !detail.groups.some((x) => x.id === g.id));

  const onCitation = (c: Citation) => (c.meetingId === meetingId ? player.seek(c.at) : onOpenMeeting(c.meetingId, c.at));

  return (
    <article className="detail">
      <header className="detail-head">
        <Button variant="ghost" small onClick={onBack}>
          Volver
        </Button>
        <div className="detail-title">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const t = title.trim();
                setEditing(false);
                if (t && t !== meeting.title) void run(() => api.meetingUpdate(meeting.id, t));
              }}
            >
              <input aria-label="Título" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setEditing(false)} />
            </form>
          ) : (
            <>
              <h1>{meeting.title}</h1>
              <Button
                variant="ghost"
                small
                aria-label="Editar título"
                onClick={() => {
                  setTitle(meeting.title);
                  setEditing(true);
                }}
              >
                Editar
              </Button>
            </>
          )}
        </div>
        <p className="muted">
          {formatDate(meeting.startedAt)} · {formatDuration(meeting.duration)} · {platformLabel(meeting.platform)}
          {meeting.recovered ? " · recuperada tras un cierre inesperado" : ""}
        </p>
        <div className="detail-groups">
          {detail.groups.map((g) => (
            <Badge key={g.id} tone="accent">
              {g.name}{" "}
              <button type="button" className="badge-x" aria-label={`Quitar de ${g.name}`} onClick={() => void run(() => api.groupRemoveMeeting(g.id, meeting.id))}>
                ×
              </button>
            </Badge>
          ))}
          {free.length > 0 ? (
            <select
              aria-label="Añadir a grupo"
              value=""
              onChange={(e) => e.target.value && void run(() => api.groupAddMeeting(e.target.value, meeting.id)).then(() => api.groupsList().then(setGroups))}
            >
              <option value="">Añadir a grupo…</option>
              {free.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          ) : null}
          <span className="spacer" />
          <Button
            variant="ghost"
            small
            onClick={() => {
              if (window.confirm("¿Eliminar esta reunión y todo su contenido?")) void api.meetingDelete(meeting.id).then(onBack);
            }}
          >
            Eliminar reunión
          </Button>
        </div>
        <ProcessingStatus
          status={meeting.status}
          step={progress?.step}
          fraction={progress?.fraction}
          error={meeting.error}
          onRetry={() => void run(() => api.meetingReprocess({ meetingId: meeting.id, steps: REPROCESS_STEPS }))}
        />
        {actionError ? <p role="alert" className="error">{actionError}</p> : null}
      </header>
      <AudioPlayer />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="tab-body" role="tabpanel">
        {tab === "resumen" ? (
          <MinutesTab minutes={detail.minutes} onSeek={player.seek} onToggleTask={(id, done) => void run(() => api.actionItemSetDone(id, done))} />
        ) : null}
        {tab === "transcript" ? (
          <TranscriptTab
            transcript={detail.transcript}
            voiceprintNames={voiceprints.map((v) => v.displayName)}
            currentMs={player.currentMs}
            onSeek={player.seek}
            onRename={(sid, name, remember) => void run(() => api.speakerRename(meeting.id, sid, name, remember))}
          />
        ) : null}
        {tab === "escaleta" ? <EscaletaTab escaleta={detail.escaleta} onSeek={player.seek} /> : null}
        {tab === "timeline" ? <TimelineTab events={detail.timeline} duration={meeting.duration} onSeek={player.seek} /> : null}
        {tab === "capturas" ? <CapturesContainer detail={detail} onSeek={player.seek} onChanged={() => void reload()} /> : null}
        {tab === "chat" ? <ChatContainer scope={{ kind: "meeting", meetingId: meeting.id }} placeholder="esta reunión" onCitation={onCitation} /> : null}
      </div>
    </article>
  );
}
