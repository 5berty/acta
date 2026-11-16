import { useState } from "react";
import type { Escaleta, Tema } from "../../api";
import { formatClock } from "../../shared/format";
import { EmptyState } from "../../shared/ui/ui";

function Node({ tema, path, onSeek }: { tema: Tema; path: string; onSeek(ms: number): void }) {
  const [open, setOpen] = useState(true);
  const hasChildren = tema.subtemas.length > 0;
  return (
    <li className="tree-node">
      <div className="tree-head">
        {hasChildren ? (
          <button type="button" className="tree-toggle" aria-expanded={open} aria-label={`${open ? "Contraer" : "Expandir"} ${tema.titulo}`} onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tree-toggle tree-leaf" aria-hidden>
            •
          </span>
        )}
        <span className="tree-path">{path}</span>
        <span className="tree-title">{tema.titulo}</span>
        <button type="button" className="time-link" aria-label={`Ir a ${formatClock(tema.inicio_ms)}`} onClick={() => onSeek(tema.inicio_ms)}>
          {formatClock(tema.inicio_ms)}
        </button>
      </div>
      {tema.resumen ? <p className="tree-summary">{tema.resumen}</p> : null}
      {hasChildren && open ? (
        <ul className="tree">
          {tema.subtemas.map((s, i) => (
            <Node key={`${path}.${i + 1}`} tema={s} path={`${path}.${i + 1}`} onSeek={onSeek} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function EscaletaTab({ escaleta, onSeek }: { escaleta: Escaleta | null; onSeek(ms: number): void }) {
  if (!escaleta || escaleta.temas.length === 0) return <EmptyState title="Todavía no hay escaleta" />;
  return (
    <ul className="tree tree-root" aria-label="Escaleta">
      {escaleta.temas.map((t, i) => (
        <Node key={i} tema={t} path={`${i + 1}`} onSeek={onSeek} />
      ))}
    </ul>
  );
}
