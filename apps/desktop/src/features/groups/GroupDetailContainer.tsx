import { useCallback, useEffect, useState } from "react";
import type { Group, MeetingSummary } from "../../api";
import { useApi } from "../../app/ApiContext";
import { AudioLines, FolderOpen, Sparkles, Trash2, X } from "lucide-react";
import { StarButton } from "../../shared/ui/Star";
import { EmptyState, IconButton } from "../../shared/ui/ui";
import { MeetingPicker } from "./MeetingPicker";
import { MeetingRow } from "../meetings/MeetingRow";
import { ChatContainer } from "../chat/ChatContainer";

interface Props {
  group: Group;
  onChanged(): void;
  onFavourite(favourite: boolean): void;
  onDeleted(): void;
  onOpenMeeting(id: string, at?: number): void;
}

export function GroupDetailContainer({ group, onChanged, onFavourite, onDeleted, onOpenMeeting }: Props) {
  const api = useApi();
  const [members, setMembers] = useState<MeetingSummary[]>([]);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");

  const load = useCallback(async () => {
    const m = await api.meetingsList({ groupId: group.id, limit: 200 });
    setMembers([...m.items]);
  }, [api, group.id]);

  useEffect(() => {
    setName(group.name);
    setDescription(group.description ?? "");
    void load();
  }, [group.id, group.name, group.description, load]);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const suggestTitle = async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const s = await api.groupsSuggestTitle(group.id);
      setName(s.name);
      const desc = description.trim() ? description : (s.description ?? "");
      setDescription(desc);
      await api.groupUpdate(group.id, s.name, desc);
      onChanged();
    } catch (e) {
      setSuggestError((e as { message?: string }).message ?? "No se pudo sugerir un título.");
    } finally {
      setSuggesting(false);
    }
  };

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
          {suggestError ? <span className="muted" role="status">{suggestError}</span> : null}
        </div>
        <IconButton label="Sugerir título" variant="glass" disabled={suggesting || members.length === 0} onClick={() => void suggestTitle()}>
          <Sparkles size={15} strokeWidth={1.9} aria-hidden />
        </IconButton>
        <StarButton className="star-glass" on={group.favourite} name={group.name} noun="favorito" size={17} onToggle={onFavourite} />
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
            <MeetingPicker
              excludeIds={members.map((m) => m.id)}
              onAdd={async (ids) => {
                for (const id of ids) await api.groupAddMeeting(group.id, id);
                await load();
                onChanged();
              }}
            />
          </div>
          {members.length === 0 ? (
            <EmptyState compact icon={<AudioLines size={20} strokeWidth={1.8} />} title="Este grupo aún no tiene reuniones" hint="Pulsa «Añadir reunión» para buscar y elegir varias a la vez." />
          ) : (
            <ul className="group m-rows">
              {members.map((m) => (
                <MeetingRow
                  key={m.id}
                  meeting={m}
                  onOpen={() => onOpenMeeting(m.id)}
                  onFavourite={(f) => {
                    setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, favourite: f } : x)));
                    void api.meetingSetFavourite(m.id, f).catch(load);
                  }}
                >
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
            variant="panel"
            suggestions={["¿Qué tareas tengo?", "¿Qué se decidió?", "Resume lo último sobre este tema"]}
            onCitation={(c) => onOpenMeeting(c.meetingId, c.at)}
          />
        </div>
      </div>
    </section>
  );
}
