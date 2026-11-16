import { useState } from "react";
import type { Group, GroupSuggestion } from "../../api";
import { Badge, Button, EmptyState } from "../../shared/ui/ui";

interface Props {
  groups: Group[];
  suggestions: GroupSuggestion[];
  selectedId: string | null;
  onSelect(id: string): void;
  onCreate(name: string): void;
  onAccept(id: string, name: string): void;
  onDismiss(id: string): void;
  onRefresh(): void;
}

function SuggestionRow({ s, onAccept, onDismiss }: { s: GroupSuggestion; onAccept(name: string): void; onDismiss(): void }) {
  const initial = s.name ?? "Grupo sin nombre";
  const [name, setName] = useState(initial);
  return (
    <li className="suggestion-row">
      <input aria-label={`Nombre de la sugerencia ${initial}`} value={name} onChange={(e) => setName(e.target.value)} />
      <span className="muted">{s.meetingIds.length} reuniones</span>
      <Button small variant="primary" aria-label={`Aceptar ${initial}`} onClick={() => onAccept(name.trim() || initial)}>
        Aceptar
      </Button>
      <Button small variant="ghost" aria-label={`Descartar ${initial}`} onClick={onDismiss}>
        Descartar
      </Button>
    </li>
  );
}

export function GroupsView(p: Props) {
  const [name, setName] = useState("");
  return (
    <aside className="groups-side">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            p.onCreate(name.trim());
            setName("");
          }
        }}
      >
        <input aria-label="Nombre del grupo nuevo" placeholder="Nuevo grupo…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" small disabled={!name.trim()}>
          Crear grupo
        </Button>
      </form>
      {p.suggestions.length > 0 ? (
        <section aria-label="Grupos sugeridos" className="card">
          <h3>Grupos sugeridos</h3>
          <ul className="plain">
            {p.suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} onAccept={(n) => p.onAccept(s.id, n)} onDismiss={() => p.onDismiss(s.id)} />
            ))}
          </ul>
        </section>
      ) : null}
      <Button small variant="ghost" onClick={p.onRefresh}>
        Buscar sugerencias
      </Button>
      {p.groups.length === 0 ? (
        <EmptyState title="Sin grupos" hint="Crea uno para reunir reuniones y preguntarles a todas a la vez." />
      ) : (
        <ul className="rows">
          {p.groups.map((g) => (
            <li key={g.id}>
              <button type="button" className={`group-item${g.id === p.selectedId ? " group-item-active" : ""}`} onClick={() => p.onSelect(g.id)}>
                <span>{g.name}</span>
                <span className="muted">
                  {g.meetingCount}
                  {g.kind === "suggested" ? " · sugerido" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Badge>{p.groups.length} grupos</Badge>
    </aside>
  );
}
