import { AudioLines, Camera, ListChecks, MessageCircle, Mic, Search, SearchX, Star } from "lucide-react";
import type { ReactNode } from "react";
import type { Group, MeetingSummary, ProcessingStep } from "../../api";
import { groupByDay } from "../../shared/format";
import { Badge, Button, EmptyState, Segmented, Select } from "../../shared/ui/ui";
import { MeetingRow } from "./MeetingRow";
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
  /** Solo favoritas: con estrella o en un grupo con estrella. */
  favouritesOnly: boolean;
  progress: Record<string, Progress | undefined>;
  loading: boolean;
  onText(v: string): void;
  onGroup(v: string): void;
  onDatePreset(v: DatePreset): void;
  onFavouritesOnly(v: boolean): void;
  onFavourite(id: string, favourite: boolean): void;
  onOpen(id: string): void;
  onRetry(id: string): void;
  onRecord?(): void;
  /** Aviso sobre la lista (sugerencia de limpieza). */
  banner?: ReactNode;
}

const DATES: { key: DatePreset; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
];

const HOW = [
  { icon: <Mic size={16} aria-hidden />, title: "Graba", text: "Entra en una llamada de Teams o Meet y acta te preguntará si la graba." },
  { icon: <AudioLines size={16} aria-hidden />, title: "Se transcribe en tu Mac", text: "Tu voz y la de los demás van en pistas separadas. Nada sale de aquí." },
  { icon: <MessageCircle size={16} aria-hidden />, title: "Pregunta", text: "Resumen, decisiones y tareas al momento. Y un chat que cita el minuto exacto." },
];

export function MeetingList(p: Props) {
  const filtered = Boolean(p.text || p.groupId || p.datePreset !== "all" || p.favouritesOnly);
  const sections = groupByDay(p.items, Date.now());
  const empty = p.items.length === 0 && !p.loading;

  return (
    <section className="page meeting-list" aria-label="Reuniones">
      <header className="page-head">
        <div className="page-title">
          <h1>Reuniones</h1>
          {p.items.length > 0 ? <span className="page-count num">{p.items.length}</span> : null}
        </div>
      </header>
      <div className="sticky-bar">
        <div className="toolbar glass">
          <label className="search-field">
            <Search size={14} strokeWidth={2.1} aria-hidden />
            <input type="search" role="searchbox" aria-label="Buscar reuniones" placeholder={p.favouritesOnly ? "Buscar en tus favoritas" : "Buscar por título o por lo que se dijo"} value={p.text} onChange={(e) => p.onText(e.target.value)} />
          </label>
          {p.groups.length > 0 ? (
            <Select label="Grupo" capsule value={p.groupId} onChange={(e) => p.onGroup(e.target.value)}>
              <option value="">Todos los grupos</option>
              {p.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          ) : null}
          <button type="button" className="fav-filter" aria-pressed={p.favouritesOnly} title="Reuniones con estrella y las de tus grupos favoritos" onClick={() => p.onFavouritesOnly(!p.favouritesOnly)}>
            <Star size={13} strokeWidth={2} aria-hidden />
            Favoritas
          </button>
          <Segmented label="Fecha" small options={DATES} value={p.datePreset} onChange={p.onDatePreset} />
        </div>
      </div>

      <div className="page-body">
        {p.banner}
        {empty && p.favouritesOnly && !p.text && !p.groupId && p.datePreset === "all" ? (
          <EmptyState icon={<Star size={26} strokeWidth={1.7} />} title="Todavía no tienes favoritas" hint="Marca con la estrella las reuniones que quieras tener a mano. Nunca se sugieren para borrar." />
        ) : empty && filtered ? (
          <EmptyState icon={<SearchX size={26} strokeWidth={1.7} />} title="Ninguna reunión coincide" hint="Prueba con otras palabras o quita algún filtro." />
        ) : null}
        {empty && !filtered ? (
          <div className="onboarding">
            <EmptyState icon={<AudioLines size={28} strokeWidth={1.7} />} title="Todavía no hay reuniones" hint="Tu primera acta está a una llamada de distancia.">
              {p.onRecord ? (
                <Button variant="primary" size="lg" capsule onClick={p.onRecord}>
                  Empezar a grabar
                </Button>
              ) : null}
            </EmptyState>
            <ol className="how">
              {HOW.map((h) => (
                <li key={h.title} className="how-step card">
                  <span className="how-icon" aria-hidden>
                    {h.icon}
                  </span>
                  <p className="how-title">{h.title}</p>
                  <p className="how-text">{h.text}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {sections.map((s) => (
          <section key={s.key} className="day" aria-label={s.label}>
            <h3 className="day-title">{s.label}</h3>
            <ul className="group m-rows">
              {s.items.map((m) => {
                const pr = p.progress[m.id];
                return (
                  <MeetingRow key={m.id} meeting={m} when={s.key === "today" || s.key === "yesterday" ? "time" : "date"} onOpen={() => p.onOpen(m.id)} onFavourite={(f) => p.onFavourite(m.id, f)}>
                    {m.captureCount > 0 ? (
                      <Badge icon={<Camera size={11} strokeWidth={2.2} aria-hidden />}>{m.captureCount}</Badge>
                    ) : null}
                    {m.myOpenTasks > 0 ? (
                      <Badge tone="accent" icon={<ListChecks size={11} strokeWidth={2.4} aria-hidden />}>
                        {m.myOpenTasks === 1 ? "1 tarea tuya" : `${m.myOpenTasks} tareas tuyas`}
                      </Badge>
                    ) : null}
                    <ProcessingStatus variant="row" status={m.status} step={pr?.step} fraction={pr?.fraction} onRetry={() => p.onRetry(m.id)} />
                  </MeetingRow>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
