import { ChevronLeft, ChevronRight, Image as ImageIcon, Play, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Capture, CaptureReason, Escaleta, Minutes } from "../../api";
import { findTemaByPath, formatClock } from "../../shared/format";
import { Badge, Button, EmptyState, IconButton, Modal } from "../../shared/ui/ui";

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

  // Flechas del teclado para pasar de captura con el visor abierto.
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setOpen((o) => (o == null ? o : Math.min(captures.length - 1, o + 1)));
      if (e.key === "ArrowLeft") setOpen((o) => (o == null ? o : Math.max(0, o - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, captures.length]);

  if (captures.length === 0) {
    return <EmptyState icon={<ImageIcon size={26} strokeWidth={1.7} />} title="No hay capturas" hint="Se guardan si activas las capturas de la pantalla compartida en Ajustes. Están desactivadas por defecto." />;
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
              <span className="thumb-time num">{formatClock(c.at)}</span>
            </button>
          </li>
        ))}
      </ul>
      {current && open != null ? (
        <Modal label="Captura" onClose={() => setOpen(null)} className="lightbox-modal">
          <div className="lightbox">
            <div className="lightbox-stage">
              <img src={srcFor(current)} alt={`Captura ampliada ${open + 1}`} />
              <div className="lightbox-nav">
                <IconButton variant="glass" size="lg" disabled={open === 0} label="Captura anterior" onClick={() => setOpen(open - 1)}>
                  <ChevronLeft size={18} strokeWidth={2.2} aria-hidden />
                </IconButton>
                <IconButton variant="glass" size="lg" disabled={open === captures.length - 1} label="Siguiente captura" onClick={() => setOpen(open + 1)}>
                  <ChevronRight size={18} strokeWidth={2.2} aria-hidden />
                </IconButton>
              </div>
            </div>
            <aside className="lightbox-side">
              <div className="lightbox-head">
                <div>
                  <p className="lightbox-time num">{formatClock(current.at)}</p>
                  <p className="muted">
                    {open + 1} de {captures.length}
                  </p>
                </div>
                <IconButton label="Cerrar visor" onClick={() => setOpen(null)}>
                  <X size={15} strokeWidth={2.2} aria-hidden />
                </IconButton>
              </div>
              <div className="cluster">
                <Badge>{REASON[current.reason]}</Badge>
                {current.keyword ? <Badge tone="accent">«{current.keyword}»</Badge> : null}
              </div>
              {topic ? (
                <div className="lightbox-block">
                  <h3>Tema</h3>
                  <p>{topic.titulo}</p>
                </div>
              ) : null}
              {tasks.length > 0 ? (
                <div className="lightbox-block">
                  <h3>Tareas relacionadas</h3>
                  <ul className="plain">
                    {tasks.map((t) => (
                      <li key={t.id}>{t.text}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="lightbox-actions">
                <Button
                  variant="primary"
                  icon={<Play size={12} fill="currentColor" aria-hidden />}
                  onClick={() => {
                    onSeek(current.at);
                    setOpen(null);
                  }}
                >
                  Ir al momento
                </Button>
                <Button
                  variant="danger"
                  icon={<Trash2 size={13} aria-hidden />}
                  onClick={() => {
                    onDelete(current.id);
                    setOpen(null);
                  }}
                >
                  Eliminar captura
                </Button>
              </div>
            </aside>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
