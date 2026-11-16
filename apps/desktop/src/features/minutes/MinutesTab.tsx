import type { ActionItem, Minutes } from "../../api";
import { formatClock, tasksSplit } from "../../shared/format";
import { Markdown } from "../../shared/Markdown";
import { EmptyState } from "../../shared/ui/ui";

interface Props {
  minutes: Minutes | null;
  onToggleTask(id: string, done: boolean): void;
  onSeek(ms: number): void;
}

function TimeLink({ at, onSeek }: { at: number | null; onSeek(ms: number): void }) {
  if (at == null) return null;
  return (
    <button type="button" className="time-link" aria-label={`Ir a ${formatClock(at)}`} onClick={() => onSeek(at)}>
      {formatClock(at)}
    </button>
  );
}

function TaskList({ title, items, onToggleTask, onSeek }: { title: string; items: ActionItem[]; onToggleTask: Props["onToggleTask"]; onSeek: Props["onSeek"] }) {
  return (
    <section aria-label={title} className="card">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">Nada por aquí.</p>
      ) : (
        <ul className="tasks">
          {items.map((t) => (
            <li key={t.id} className={t.done ? "task task-done" : "task"}>
              <label>
                <input type="checkbox" aria-label={t.text} checked={t.done} onChange={(e) => onToggleTask(t.id, e.target.checked)} />
                <span className="task-text">{t.text}</span>
              </label>
              <span className="task-meta">
                {t.ownerName && !t.isMine ? <span>{t.ownerName}</span> : null}
                {t.due ? <span className="muted">{t.due}</span> : null}
                <TimeLink at={t.at} onSeek={onSeek} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MinutesTab({ minutes, onToggleTask, onSeek }: Props) {
  if (!minutes) return <EmptyState title="Todavía no hay acta" hint="Se genera cuando termina el procesado de la reunión." />;
  const { mine, others } = tasksSplit(minutes.actionItems);
  return (
    <div className="stack">
      <section aria-label="Resumen" className="card">
        <Markdown source={minutes.summaryMd} />
      </section>
      <section aria-label="Decisiones" className="card">
        <h3>Decisiones</h3>
        {minutes.decisions.length === 0 ? (
          <p className="muted">No se tomaron decisiones.</p>
        ) : (
          <ul className="plain">
            {minutes.decisions.map((d) => (
              <li key={d.id} className="decision">
                <span>{d.text}</span>
                <TimeLink at={d.at} onSeek={onSeek} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="two-col">
        <TaskList title="Mis tareas" items={mine} onToggleTask={onToggleTask} onSeek={onSeek} />
        <TaskList title="Tareas de otros" items={others} onToggleTask={onToggleTask} onSeek={onSeek} />
      </div>
    </div>
  );
}
