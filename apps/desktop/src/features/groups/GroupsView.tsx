import { Check, FolderOpen, FolderPlus, Plus, Sparkles, X } from "lucide-react";
import { StarButton } from "../../shared/ui/Star";
import { Segmented } from "../../shared/ui/ui";
import { useState } from "react";
import type { Group, GroupSuggestion } from "../../api";
import { Button, IconButton } from "../../shared/ui/ui";

interface Props {
  groups: Group[];
  suggestions: GroupSuggestion[];
  selectedId: string | null;
  onSelect(id: string): void;
  onFavourite(id: string, favourite: boolean): void;
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
  const [filter, setFilter] = useState<"all" | "fav">("all");
  const starred = p.groups.filter((g) => g.favourite);
  const shown = filter === "fav" ? starred : p.groups;
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
        <>
        <Segmented
          label="Qué grupos ver"
          small
          value={filter}
          onChange={setFilter}
          options={[
            { key: "all", label: "Todos" },
            { key: "fav", label: "Favoritos" },
          ]}
        />
        {shown.length === 0 ? <p className="groups-none">Aún no tienes grupos favoritos. Márcalos con la estrella: sus reuniones nunca se sugieren para borrar.</p> : null}
        <ul className="plain group-list" aria-label="Tus grupos">
          {shown.map((g) => (
            <li key={g.id} className="group-li" data-favourite={g.favourite || undefined}>
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
              <StarButton on={g.favourite} name={g.name} noun="favorito" size={14} onToggle={(f) => p.onFavourite(g.id, f)} />
            </li>
          ))}
        </ul>
        </>
      )}
      <Button small variant="ghost" capsule icon={<Sparkles size={12} strokeWidth={2} aria-hidden />} onClick={p.onRefresh}>
        Buscar sugerencias
      </Button>
    </aside>
  );
}
