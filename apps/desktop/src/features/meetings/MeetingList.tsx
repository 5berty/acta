import type { Group, MeetingSummary, ProcessingStep } from "../../api";
import { formatDate, formatDuration, platformLabel } from "../../shared/format";
import { Badge, EmptyState } from "../../shared/ui/ui";
import { ProcessingStatus } from "./ProcessingStatus";

export type DatePreset = "all" | "today" | "7d" | "30d";

export interface Progress {
  step: ProcessingStep;
  fraction: number;
}

interface Props {
  items: MeetingSummary[];
  groups: Group[];
  text: string;
  groupId: string;
  datePreset: DatePreset;
  progress: Record<string, Progress | undefined>;
  loading: boolean;
  onText(v: string): void;
  onGroup(v: string): void;
  onDatePreset(v: DatePreset): void;
  onOpen(id: string): void;
  onRetry(id: string): void;
}

export function MeetingList(p: Props) {
  return (
    <section className="meeting-list" aria-label="Reuniones">
      <header className="list-filters">
        <input
          type="search"
          role="searchbox"
          aria-label="Buscar reuniones"
          placeholder="Buscar en reuniones…"
          value={p.text}
          onChange={(e) => p.onText(e.target.value)}
        />
        <label className="field-inline">
          <span className="sr-only">Grupo</span>
          <select aria-label="Grupo" value={p.groupId} onChange={(e) => p.onGroup(e.target.value)}>
            <option value="">Todos los grupos</option>
            {p.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <select aria-label="Fecha" value={p.datePreset} onChange={(e) => p.onDatePreset(e.target.value as DatePreset)}>
          <option value="all">Cualquier fecha</option>
          <option value="today">Hoy</option>
          <option value="7d">Últimos 7 días</option>
          <option value="30d">Últimos 30 días</option>
        </select>
      </header>
      {p.items.length === 0 && !p.loading ? (
        p.text || p.groupId || p.datePreset !== "all" ? (
          <EmptyState title="Ninguna reunión coincide" hint="Prueba con otros filtros." />
        ) : (
          <EmptyState title="Todavía no hay reuniones" hint="Cuando grabes una, aparecerá aquí." />
        )
      ) : (
        <ul className="rows">
          {p.items.map((m) => {
            const pr = p.progress[m.id];
            return (
              <li key={m.id} className="row">
                <button type="button" className="row-main" onClick={() => p.onOpen(m.id)}>
                  <span className="row-title">{m.title}</span>
                  <span className="row-meta">
                    {formatDate(m.startedAt)} · {formatDuration(m.duration)} · {platformLabel(m.platform)}
                    {m.speakerNames.length ? ` · ${m.speakerNames.join(", ")}` : ""}
                  </span>
                  {m.snippet ? <span className="row-snippet">{m.snippet}</span> : null}
                </button>
                <div className="row-side">
                  {m.myOpenTasks > 0 ? <Badge tone="accent">{m.myOpenTasks} tareas tuyas</Badge> : null}
                  <ProcessingStatus
                    status={m.status}
                    step={pr?.step}
                    fraction={pr?.fraction}
                    onRetry={() => p.onRetry(m.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
