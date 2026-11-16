import { useState } from "react";
import type { Speaker, Transcript } from "../../api";
import { formatClock, speakerColor } from "../../shared/format";
import { Button, EmptyState } from "../../shared/ui/ui";

interface Props {
  transcript: Transcript;
  voiceprintNames: string[];
  currentMs: number;
  onSeek(ms: number): void;
  onRename(speakerId: string, name: string, remember: boolean): void;
}

const nameOf = (s: Speaker): string => s.displayName ?? s.label;

function RenameForm({ speaker, names, onSave, onCancel }: { speaker: Speaker; names: string[]; onSave(name: string, remember: boolean): void; onCancel(): void }) {
  const [value, setValue] = useState(nameOf(speaker));
  const [remember, setRemember] = useState(true);
  const listId = `vp-${speaker.id}`;
  return (
    <form
      className="rename-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSave(value.trim(), remember);
      }}
    >
      <input role="combobox" aria-label="Nombre del hablante" list={listId} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <datalist id={listId}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <label className="check">
        <input type="checkbox" aria-label="Recordar esta voz" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Recordar esta voz
      </label>
      <Button small variant="primary" type="submit" aria-label="Guardar nombre">
        Guardar
      </Button>
      <Button small variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}

export function TranscriptTab({ transcript, voiceprintNames, currentMs, onSeek, onRename }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const index = new Map(transcript.speakers.map((s, i) => [s.id, i]));
  const byId = new Map(transcript.speakers.map((s) => [s.id, s]));

  if (transcript.utterances.length === 0) return <EmptyState title="Sin transcripción" hint="Aparecerá cuando termine la transcripción." />;

  return (
    <div className="transcript">
      <ul className="speakers" aria-label="Hablantes">
        {transcript.speakers.map((s, i) => {
          const suggested = !s.isMe && !s.confirmed && (s.nameSource === "voiceprint" || s.nameSource === "appUi") && s.displayName;
          return (
            <li key={s.id} className="speaker-chip">
              <span className="dot" style={{ background: speakerColor(i) }} aria-hidden />
              {editing === s.id ? (
                <RenameForm
                  speaker={s}
                  names={voiceprintNames}
                  onCancel={() => setEditing(null)}
                  onSave={(n, r) => {
                    onRename(s.id, n, r);
                    setEditing(null);
                  }}
                />
              ) : (
                <>
                  <span className="speaker-name">{nameOf(s)}</span>
                  {suggested ? (
                    <span className="suggestion">
                      ¿Es {s.displayName}?{" "}
                      <Button small variant="primary" aria-label={`Confirmar a ${s.displayName}`} onClick={() => onRename(s.id, s.displayName!, true)}>
                        Confirmar
                      </Button>
                    </span>
                  ) : null}
                  {!s.isMe ? (
                    <Button small variant="ghost" aria-label={`Renombrar a ${nameOf(s)}`} onClick={() => setEditing(s.id)}>
                      Renombrar
                    </Button>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <ol className="lines">
        {transcript.utterances.map((u) => {
          const s = byId.get(u.speakerId);
          const active = currentMs >= u.start && currentMs < u.end;
          return (
            <li key={u.idx}>
              <button
                type="button"
                className={`line${active ? " line-active" : ""}`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSeek(u.start)}
              >
                <span className="line-time">{formatClock(u.start)}</span>
                <span className="line-speaker" style={{ color: speakerColor(index.get(u.speakerId) ?? 0) }}>
                  {s ? nameOf(s) : "?"}
                </span>
                <span className="line-text">{u.text}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
