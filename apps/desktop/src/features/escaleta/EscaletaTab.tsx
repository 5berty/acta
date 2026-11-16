import { ChevronRight, ListTree, Network } from "lucide-react";
import { useState } from "react";
import type { Escaleta, Tema } from "../../api";
import { formatClock, formatDuration } from "../../shared/format";
import { EmptyState, Segmented } from "../../shared/ui/ui";
import { MindMap } from "./MindMap";

function Node({ tema, path, onSeek }: { tema: Tema; path: string; onSeek(ms: number): void }) {
  const [open, setOpen] = useState(true);
  const hasChildren = tema.subtemas.length > 0;
  const depth = path.split(".").length;
  return (
    <li className={`tree-node tree-depth-${Math.min(depth, 3)}`}>
      <div className="tree-head">
        {hasChildren ? (
          <button type="button" className="tree-toggle" aria-expanded={open} aria-label={`${open ? "Contraer" : "Expandir"} ${tema.titulo}`} onClick={() => setOpen(!open)}>
            <ChevronRight size={13} strokeWidth={2.4} aria-hidden />
          </button>
        ) : (
          <span className="tree-toggle tree-leaf" aria-hidden />
        )}
        <span className="tree-path num">{path}</span>
        <span className="tree-title selectable">{tema.titulo}</span>
        <span className="tree-length">{formatDuration(Math.max(0, tema.fin_ms - tema.inicio_ms))}</span>
        <button type="button" className="time-link" aria-label={`Ir a ${formatClock(tema.inicio_ms)}`} onClick={() => onSeek(tema.inicio_ms)}>
          {formatClock(tema.inicio_ms)}
        </button>
      </div>
      {tema.resumen ? <p className="tree-summary selectable">{tema.resumen}</p> : null}
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

type Mode = "outline" | "map";

export function EscaletaTab({ escaleta, title, onSeek }: { escaleta: Escaleta | null; title?: string; onSeek(ms: number): void }) {
  const [mode, setMode] = useState<Mode>("outline");
  if (!escaleta || escaleta.temas.length === 0) {
    return <EmptyState icon={<ListTree size={26} strokeWidth={1.7} />} title="Todavía no hay escaleta" hint="Es el guion de la reunión por temas. Se genera junto con el acta." />;
  }
  return (
    <div className="escaleta">
      <div className="escaleta-bar">
        <Segmented
          label="Vista de la escaleta"
          small
          value={mode}
          onChange={setMode}
          options={[
            { key: "outline", label: "Esquema", icon: <ListTree size={13} aria-hidden /> },
            { key: "map", label: "Mapa", icon: <Network size={13} aria-hidden /> },
          ]}
        />
      </div>
      {mode === "outline" ? (
        <ul className="tree tree-root card" aria-label="Escaleta">
          {escaleta.temas.map((t, i) => (
            <Node key={i} tema={t} path={`${i + 1}`} onSeek={onSeek} />
          ))}
        </ul>
      ) : (
        <MindMap escaleta={escaleta} title={title ?? "Reunión"} onSeek={onSeek} />
      )}
    </div>
  );
}
