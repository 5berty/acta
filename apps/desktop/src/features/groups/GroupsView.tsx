import { Check, FolderOpen, FolderPlus, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { Group, GroupSuggestion } from "../../api";
import { Button, IconButton } from "../../shared/ui/ui";

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

const count = (n: number): string => (n === 1 ? "1 reunión" : `${n} reuniones`);

function SuggestionCard({ s, onAccept, onDismiss }: { s: GroupSuggestion; onAccept(name: string): void; onDismiss(): void }) {
  const initial = s.name ?? "Grupo sin nombre";
  const [name, setName] = useState(initial);
  return (
    <li className="suggestion-item">
      <input aria-label={`Nombre de la sugerencia ${initial}`} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="suggestion-foot">
        <span className="muted">{count(s.meetingIds.length)} parecidas</span>
        <span className="spacer" />
        <IconButton small label={`Descartar ${initial}`} onClick={onDismiss}>
          <X size={13} strokeWidth={2.2} aria-hidden />
        </IconButton>
        <Button small capsule variant="primary" icon={<Check size={12} strokeWidth={2.6} aria-hidden />} aria-label={`Aceptar ${initial}`} onClick={() => onAccept(name.trim() || initial)}>
          Crear
        </Button>
      </div>
    </li>
  );
}

export function GroupsView(p: Props) {
  const [name, setName] = useState("");
  return (
    <aside className="groups-side">
      <header className="groups-head">
        <h1>Grupos</h1>
        <p className="page-sub">Junta reuniones del mismo tema y pregúntales a todas a la vez.</p>
      </header>
      <form
        className="new-group"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            p.onCreate(name.trim());
            setName("");
          }
        }}
      >
        <FolderPlus size={15} strokeWidth={1.9} aria-hidden />
        <input aria-label="Nombre del grupo nuevo" placeholder="Nuevo grupo…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" small capsule disabled={!name.trim()} icon={<Plus size={12} strokeWidth={2.6} aria-hidden />}>
          Crear grupo
        </Button>
      </form>

      {p.suggestions.length > 0 ? (
        <section aria-label="Grupos sugeridos" className="suggest-box">
          <div className="card-head">
            <Sparkles size={14} strokeWidth={1.9} aria-hidden />
            <h3>Grupos sugeridos</h3>
          </div>
          <ul className="plain suggestion-list">
            {p.suggestions.map((s) => (
              <SuggestionCard key={s.id} s={s} onAccept={(n) => p.onAccept(s.id, n)} onDismiss={() => p.onDismiss(s.id)} />
            ))}
          </ul>
        </section>
      ) : null}

      {p.groups.length === 0 ? (
        <p className="groups-none">Aún no tienes grupos. Crea uno arriba o deja que acta te sugiera alguno.</p>
      ) : (
        <ul className="plain group-list" aria-label="Tus grupos">
          {p.groups.map((g) => (
            <li key={g.id}>
              <button type="button" className={`group-item${g.id === p.selectedId ? " group-item-active" : ""}`} aria-current={g.id === p.selectedId ? "true" : undefined} onClick={() => p.onSelect(g.id)}>
                <span className="group-item-icon" aria-hidden>
                  <FolderOpen size={15} strokeWidth={1.9} />
                </span>
                <span className="group-item-name">{g.name}</span>
                <span className="group-item-count num">
                  {g.meetingCount}
                  {g.kind === "suggested" ? " · sugerido" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button small variant="ghost" capsule icon={<Sparkles size={12} strokeWidth={2} aria-hidden />} onClick={p.onRefresh}>
        Buscar sugerencias
      </Button>
    </aside>
  );
}
