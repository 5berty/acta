import { useCallback, useEffect, useState } from "react";
import type { Group, MeetingSummary } from "../../api";
import { useApi } from "../../app/ApiContext";
import { formatDate, formatDuration } from "../../shared/format";
import { Button } from "../../shared/ui/ui";
import { ChatContainer } from "../chat/ChatContainer";

interface Props {
  group: Group;
  onChanged(): void;
  onDeleted(): void;
  onOpenMeeting(id: string, at?: number): void;
}

export function GroupDetailContainer({ group, onChanged, onDeleted, onOpenMeeting }: Props) {
  const api = useApi();
  const [members, setMembers] = useState<MeetingSummary[]>([]);
  const [all, setAll] = useState<MeetingSummary[]>([]);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");

  const load = useCallback(async () => {
    const [m, a] = await Promise.all([api.meetingsList({ groupId: group.id, limit: 200 }), api.meetingsList({ limit: 200 })]);
    setMembers([...m.items]);
    setAll([...a.items]);
  }, [api, group.id]);

  useEffect(() => {
    setName(group.name);
    setDescription(group.description ?? "");
    void load();
  }, [group.id, group.name, group.description, load]);

  const candidates = all.filter((m) => !members.some((x) => x.id === m.id));
  const save = () => {
    if (name.trim() && (name !== group.name || description !== (group.description ?? ""))) {
      void api.groupUpdate(group.id, name.trim(), description).then(onChanged);
    }
  };

  return (
    <section className="group-detail" aria-label={`Grupo ${group.name}`}>
      <header>
        <input className="title-input" aria-label="Nombre del grupo" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
        <input aria-label="Descripción" placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={save} />
        <Button
          variant="ghost"
          small
          onClick={() => {
            if (window.confirm(`¿Eliminar el grupo «${group.name}»? Las reuniones se conservan.`)) void api.groupDelete(group.id).then(onDeleted);
          }}
        >
          Eliminar grupo
        </Button>
      </header>
      <div className="group-body">
        <div>
          <h3>Reuniones</h3>
          {members.length === 0 ? <p className="muted">Este grupo aún no tiene reuniones.</p> : null}
          <ul className="rows">
            {members.map((m) => (
              <li key={m.id} className="row">
                <button type="button" className="row-main" onClick={() => onOpenMeeting(m.id)}>
                  <span className="row-title">{m.title}</span>
                  <span className="row-meta">
                    {formatDate(m.startedAt)} · {formatDuration(m.duration)}
                  </span>
                </button>
                <Button
                  small
                  variant="ghost"
                  aria-label={`Quitar ${m.title} del grupo`}
                  onClick={() => void api.groupRemoveMeeting(group.id, m.id).then(() => Promise.all([load(), Promise.resolve(onChanged())]))}
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
          {candidates.length > 0 ? (
            <select
              aria-label="Añadir reunión"
              value=""
              onChange={(e) => e.target.value && void api.groupAddMeeting(group.id, e.target.value).then(() => Promise.all([load(), Promise.resolve(onChanged())]))}
            >
              <option value="">Añadir reunión…</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div>
          <h3>Pregunta al grupo</h3>
          <ChatContainer scope={{ kind: "group", groupId: group.id }} placeholder="este grupo" onCitation={(c) => onOpenMeeting(c.meetingId, c.at)} />
        </div>
      </div>
    </section>
  );
}
