import { useEffect, useState } from "react";
import type { Citation, Group, MeetingDetail, ProcessingStep, VoiceprintSummary } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { ChevronLeft, FolderOpen, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import { formatDay, formatDuration, formatTime, platformLabel } from "../../shared/format";
import { AvatarStack, Badge, EmptyState, IconButton, PlatformIcon, Select, Tabs, errorMessage, type TabDef } from "../../shared/ui/ui";
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

const capitalizeFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

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
  if (error && !detail) {
    return (
      <div className="page">
        <EmptyState icon={<TriangleAlert size={26} strokeWidth={1.7} />} title="No se ha podido abrir la reunión" hint={error}>
          <IconButton label="Volver" variant="glass" onClick={props.onBack}>
            <ChevronLeft size={17} strokeWidth={2.2} aria-hidden />
          </IconButton>
        </EmptyState>
      </div>
    );
  }
  if (!detail) return <p className="loading">Cargando…</p>;
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

  const people = detail.transcript.speakers.map((s) => s.displayName ?? s.label);
  const activity = detail.transcript.utterances.map((u) => ({ start: u.start, end: u.end }));

  return (
    <div className="detail-wrap">
      <article className="page detail">
        <header className="detail-head">
          <div className="detail-bar">
            <IconButton label="Volver" variant="glass" onClick={onBack}>
              <ChevronLeft size={17} strokeWidth={2.2} aria-hidden />
            </IconButton>
            <span className="spacer" />
            {free.length > 0 ? (
              <Select
                label="Añadir a grupo"
                capsule
                value=""
                onChange={(e) => e.target.value && void run(() => api.groupAddMeeting(e.target.value, meeting.id)).then(() => api.groupsList().then(setGroups))}
              >
                <option value="">Añadir a grupo…</option>
                {free.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <IconButton
              label="Eliminar reunión"
              variant="glass"
              onClick={() => {
                if (window.confirm("¿Eliminar esta reunión y todo su contenido?")) void api.meetingDelete(meeting.id).then(onBack);
              }}
            >
              <Trash2 size={15} strokeWidth={1.9} aria-hidden />
            </IconButton>
          </div>
          <div className="detail-hero">
            <PlatformIcon platform={meeting.platform} size="lg" />
            <div className="detail-hero-text">
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
                    <h1 className="selectable">{meeting.title}</h1>
                    <IconButton
                      label="Editar título"
                      small
                      onClick={() => {
                        setTitle(meeting.title);
                        setEditing(true);
                      }}
                    >
                      <Pencil size={13} strokeWidth={2} aria-hidden />
                    </IconButton>
                  </>
                )}
              </div>
              <p className="detail-meta">
                <span>{capitalizeFirst(formatDay(meeting.startedAt))}</span>
                <span>{formatTime(meeting.startedAt)}</span>
                <span>{formatDuration(meeting.duration)}</span>
                <span>{platformLabel(meeting.platform)}</span>
                {meeting.recovered ? <span>Recuperada tras un cierre inesperado</span> : null}
              </p>
            </div>
          </div>
          {people.length > 0 || detail.groups.length > 0 ? (
            <div className="detail-people">
              {people.length > 0 ? (
                <span className="people">
                  <AvatarStack names={people} max={6} />
                  <span className="people-names">{people.join(", ")}</span>
                </span>
              ) : null}
              {detail.groups.map((g) => (
                <Badge key={g.id} tone="accent" icon={<FolderOpen size={11} strokeWidth={2.2} aria-hidden />}>
                  {g.name}
                  <button type="button" className="badge-x" aria-label={`Quitar de ${g.name}`} onClick={() => void run(() => api.groupRemoveMeeting(g.id, meeting.id))}>
                    <X size={10} strokeWidth={2.6} aria-hidden />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}
          <ProcessingStatus
            status={meeting.status}
            step={progress?.step}
            fraction={progress?.fraction}
            error={meeting.error}
            onRetry={() => void run(() => api.meetingReprocess({ meetingId: meeting.id, steps: REPROCESS_STEPS }))}
          />
          {actionError ? <p role="alert" className="inline-error">{actionError}</p> : null}
        </header>
        <div className="sticky-bar sticky-bar-center">
          <div className="tabs-capsule glass">
            <Tabs tabs={tabs} active={tab} onChange={setTab} label="Secciones de la reunión" />
          </div>
        </div>
        <div className="page-body tab-body" role="tabpanel">
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
          {tab === "escaleta" ? <EscaletaTab escaleta={detail.escaleta} title={meeting.title} onSeek={player.seek} /> : null}
          {tab === "timeline" ? <TimelineTab events={detail.timeline} duration={meeting.duration} currentMs={player.currentMs} onSeek={player.seek} /> : null}
          {tab === "capturas" ? <CapturesContainer detail={detail} onSeek={player.seek} onChanged={() => void reload()} /> : null}
          {tab === "chat" ? (
            <ChatContainer
              scope={{ kind: "meeting", meetingId: meeting.id }}
              placeholder="esta reunión"
              suggestions={["¿Qué se decidió?", "¿Qué tengo que hacer yo?", "Resume los desacuerdos"]}
              onCitation={onCitation}
            />
          ) : null}
        </div>
      </article>
      <div className="player-dock">
        <AudioPlayer activity={activity} durationMs={meeting.duration} />
      </div>
    </div>
  );
}
