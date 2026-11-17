import { useCallback, useEffect, useState } from "react";
import type { Group, MeetingSummary } from "../../api";
import { useApi } from "../../app/ApiContext";
import { AudioLines, FolderOpen, Sparkles, Trash2, X } from "lucide-react";
import { StarButton } from "../../shared/ui/Star";
import { EmptyState, IconButton, errorMessage } from "../../shared/ui/ui";
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

  const [error, setError] = useState<string | null>(null);
  /** Ejecuta una acción; si falla, el motivo queda a la vista en vez de perderse. */
  const guard = async (run: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await run();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  const load = useCallback(async () => {
    try {
      const m = await api.meetingsList({ groupId: group.id, limit: 200 });
      setMembers([...m.items]);
    } catch (e) {
      setError(errorMessage(e));
    }
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
      setSuggestError(errorMessage(e));
    } finally {
      setSuggesting(false);
    }
  };

  const save = () => {
    if (name.trim() && (name !== group.name || description !== (group.description ?? ""))) {
      void guard(() => api.groupUpdate(group.id, name.trim(), description)).then((ok) => ok && onChanged());
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
          {suggestError ? <span className="inline-error" role="alert">{suggestError}</span> : null}
          {error ? <span className="inline-error" role="alert">{error}</span> : null}
        </div>
        <IconButton label="Sugerir título" variant="glass" disabled={suggesting || members.length === 0} onClick={() => void suggestTitle()}>
          <Sparkles size={15} strokeWidth={1.9} aria-hidden />
        </IconButton>
        <StarButton className="star-glass" on={group.favourite} name={group.name} noun="favorito" size={17} onToggle={onFavourite} />
        <IconButton
          label="Eliminar grupo"
          variant="glass"
          onClick={() => {
            if (window.confirm(`¿Eliminar el grupo «${group.name}»? Las reuniones se conservan.`)) void guard(() => api.groupDelete(group.id)).then((ok) => ok && onDeleted());
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
                const ok = await guard(async () => {
                  for (const id of ids) await api.groupAddMeeting(group.id, id);
                });
                // Aunque falle a medias, se recarga para reflejar lo que sí entró.
                await load();
                onChanged();
                return void ok;
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
                    void api.meetingSetFavourite(m.id, f).catch((e) => {
                      setError(errorMessage(e));
                      void load();
                    });
                  }}
                >
                  <IconButton
                    small
                    label={`Quitar ${m.title} del grupo`}
                    onClick={() =>
                      void guard(() => api.groupRemoveMeeting(group.id, m.id)).then(async (ok) => {
                        if (ok) {
                          await load();
                          onChanged();
                        }
                      })
                    }
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
