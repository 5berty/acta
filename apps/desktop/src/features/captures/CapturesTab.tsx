import { useState } from "react";
import type { Capture, CaptureReason, Escaleta, Minutes } from "../../api";
import { findTemaByPath, formatClock } from "../../shared/format";
import { Button, EmptyState, Modal } from "../../shared/ui/ui";

const REASON: Record<CaptureReason, string> = {
  slideChange: "Cambio de diapositiva",
  keyword: "Palabra clave",
  llmPick: "Elegida por la IA",
  manual: "Manual",
  candidate: "Candidata",
};

interface Props {
  captures: Capture[];
  minutes: Minutes | null;
  escaleta: Escaleta | null;
  srcFor(c: Capture): string;
  onSeek(ms: number): void;
  onDelete(id: string): void;
}

export function CapturesTab({ captures, minutes, escaleta, srcFor, onSeek, onDelete }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  if (captures.length === 0) {
    return <EmptyState title="No hay capturas" hint="Se guardan si activas las capturas de pantalla compartida en Ajustes." />;
  }
  const current = open != null ? captures[open] : undefined;
  const topic = current ? findTemaByPath(escaleta, current.topicPath) : null;
  const tasks = current ? (minutes?.actionItems.filter((a) => current.actionItemIds.includes(a.id)) ?? []) : [];

  return (
    <>
      <ul className="gallery">
        {captures.map((c, i) => (
          <li key={c.id}>
            <button type="button" className="thumb" aria-label={`Captura ${i + 1} en ${formatClock(c.at)}`} onClick={() => setOpen(i)}>
              <img src={srcFor(c)} alt={`Captura ${i + 1}`} loading="lazy" />
              <span className="thumb-time">{formatClock(c.at)}</span>
            </button>
          </li>
        ))}
      </ul>
      {current && open != null ? (
        <Modal label="Captura" onClose={() => setOpen(null)}>
          <div className="lightbox">
            <img src={srcFor(current)} alt={`Captura ampliada ${open + 1}`} />
            <div className="lightbox-side">
              <p className="muted">
                {formatClock(current.at)} · {REASON[current.reason]}
                {current.keyword ? ` · «${current.keyword}»` : ""}
              </p>
              {topic ? (
                <p>
                  <strong>Tema:</strong> {topic.titulo}
                </p>
              ) : null}
              {tasks.length > 0 ? (
                <div>
                  <strong>Tareas relacionadas</strong>
                  <ul className="plain">
                    {tasks.map((t) => (
                      <li key={t.id}>{t.text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="lightbox-actions">
                <Button
                  onClick={() => {
                    onSeek(current.at);
                    setOpen(null);
                  }}
                >
                  Ir al momento
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    onDelete(current.id);
                    setOpen(null);
                  }}
                >
                  Eliminar captura
                </Button>
              </div>
              <div className="lightbox-nav">
                <Button small disabled={open === 0} aria-label="Captura anterior" onClick={() => setOpen(open - 1)}>
                  Anterior
                </Button>
                <Button small disabled={open === captures.length - 1} aria-label="Siguiente captura" onClick={() => setOpen(open + 1)}>
                  Siguiente
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
