import { CircleCheck, FileText, ListChecks, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { ActionItem, Minutes } from "../../api";
import { formatClock, tasksSplit } from "../../shared/format";
import { Markdown } from "../../shared/Markdown";
import { Avatar, EmptyState } from "../../shared/ui/ui";

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

function TaskList({ title, icon, empty, items, onToggleTask, onSeek }: { title: string; icon: ReactNode; empty: string; items: ActionItem[]; onToggleTask: Props["onToggleTask"]; onSeek: Props["onSeek"] }) {
  const open = items.filter((t) => !t.done).length;
  return (
    <section aria-label={title} className="card">
      <div className="card-head">
        {icon}
        <h3>{title}</h3>
        {items.length > 0 ? <span className="card-count num">{open === 0 ? "Todo hecho" : `${open} pendiente${open === 1 ? "" : "s"}`}</span> : null}
      </div>
      {items.length === 0 ? (
        <p className="card-empty">{empty}</p>
      ) : (
        <ul className="plain tasks">
          {items.map((t) => (
            <li key={t.id} className={t.done ? "task task-done" : "task"}>
              <label className="task-main">
                <input type="checkbox" className="check-round" aria-label={t.text} checked={t.done} onChange={(e) => onToggleTask(t.id, e.target.checked)} />
                <span className="task-text selectable">{t.text}</span>
              </label>
              <span className="task-meta">
                {t.ownerName && !t.isMine ? (
                  <span className="task-owner">
                    <Avatar name={t.ownerName} size="sm" />
                    <span>{t.ownerName}</span>
                  </span>
                ) : null}
                {t.due ? <span className="task-due">{t.due}</span> : null}
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
  if (!minutes) {
    return <EmptyState icon={<FileText size={26} strokeWidth={1.7} />} title="Todavía no hay acta" hint="Se genera sola cuando termina el procesado de la reunión." />;
  }
  const { mine, others } = tasksSplit(minutes.actionItems);
  return (
    <div className="stack minutes">
      <section aria-label="Resumen" className="card summary">
        <div className="card-head">
          <Sparkles size={15} strokeWidth={1.9} aria-hidden />
          <h3>Resumen</h3>
        </div>
        <Markdown source={minutes.summaryMd} />
      </section>
      <section aria-label="Decisiones" className="card">
        <div className="card-head">
          <CircleCheck size={15} strokeWidth={1.9} aria-hidden />
          <h3>Decisiones</h3>
          {minutes.decisions.length > 0 ? <span className="card-count num">{minutes.decisions.length}</span> : null}
        </div>
        {minutes.decisions.length === 0 ? (
          <p className="card-empty">No se tomaron decisiones.</p>
        ) : (
          <ul className="plain decisions">
            {minutes.decisions.map((d) => (
              <li key={d.id} className="decision">
                <span className="decision-mark" aria-hidden />
                <span className="decision-text selectable">{d.text}</span>
                <TimeLink at={d.at} onSeek={onSeek} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="two-col">
        <TaskList title="Mis tareas" icon={<ListChecks size={15} strokeWidth={1.9} aria-hidden />} empty="No te has llevado deberes." items={mine} onToggleTask={onToggleTask} onSeek={onSeek} />
        <TaskList title="Tareas de otros" icon={<Users size={15} strokeWidth={1.9} aria-hidden />} empty="Nadie más se llevó tareas." items={others} onToggleTask={onToggleTask} onSeek={onSeek} />
      </div>
    </div>
  );
}
