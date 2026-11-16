import { useCallback, useEffect, useState } from "react";
import type { Group, MeetingSummary } from "../../api";
import { useApi } from "../../app/ApiContext";
import { AudioLines, FolderOpen, Trash2, X } from "lucide-react";
import { EmptyState, IconButton, Select } from "../../shared/ui/ui";
import { MeetingRow } from "../meetings/MeetingRow";
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
      <header className="group-head">
        <span className="group-head-icon" aria-hidden>
          <FolderOpen size={20} strokeWidth={1.8} />
        </span>
        <div className="group-head-text">
          <input className="title-input" aria-label="Nombre del grupo" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
          <input className="subtitle-input" aria-label="Descripción" placeholder="Añade una descripción" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={save} />
        </div>
        <IconButton
          label="Eliminar grupo"
          variant="glass"
          onClick={() => {
            if (window.confirm(`¿Eliminar el grupo «${group.name}»? Las reuniones se conservan.`)) void api.groupDelete(group.id).then(onDeleted);
          }}
        >
          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
        </IconButton>
      </header>
      <div className="group-body">
        <div className="group-col">
          <div className="col-head">
            <h3>Reuniones</h3>
            {candidates.length > 0 ? (
              <Select
                label="Añadir reunión"
                capsule
                value=""
                onChange={(e) => e.target.value && void api.groupAddMeeting(group.id, e.target.value).then(() => Promise.all([load(), Promise.resolve(onChanged())]))}
              >
                <option value="">Añadir reunión…</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          {members.length === 0 ? (
            <EmptyState compact icon={<AudioLines size={20} strokeWidth={1.8} />} title="Este grupo aún no tiene reuniones" hint="Añade la primera con el selector de arriba." />
          ) : (
            <ul className="group m-rows">
              {members.map((m) => (
                <MeetingRow key={m.id} meeting={m} onOpen={() => onOpenMeeting(m.id)}>
                  <IconButton
                    small
                    label={`Quitar ${m.title} del grupo`}
                    onClick={() => void api.groupRemoveMeeting(group.id, m.id).then(() => Promise.all([load(), Promise.resolve(onChanged())]))}
                  >
                    <X size={13} strokeWidth={2.2} aria-hidden />
                  </IconButton>
                </MeetingRow>
              ))}
            </ul>
          )}
        </div>
        <div className="group-col group-chat">
          <div className="col-head">
            <h3>Pregunta al grupo</h3>
          </div>
          <ChatContainer
            scope={{ kind: "group", groupId: group.id }}
            placeholder="este grupo"
            suggestions={["¿En qué hemos avanzado?", "¿Qué sigue pendiente?"]}
            onCitation={(c) => onOpenMeeting(c.meetingId, c.at)}
          />
        </div>
      </div>
    </section>
  );
}
