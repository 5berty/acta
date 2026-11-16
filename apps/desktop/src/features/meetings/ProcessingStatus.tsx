import { RotateCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { MeetingStatus, ProcessingStep } from "../../api";
import { humanizeError } from "../../shared/format";
import { Badge, Button, ProgressBar, Spinner } from "../../shared/ui/ui";

export const STEP_LABEL: Record<ProcessingStep, string> = {
  concatenating: "Preparando el audio",
  transcribing: "Transcribiendo",
  diarizing: "Diarizando",
  namingSpeakers: "Identificando hablantes",
  summarizing: "Resumiendo",
  indexing: "Indexando",
  pruningCaptures: "Seleccionando capturas",
};

/** Orden real del procesado, para contar «paso n de 7». */
export const STEP_ORDER: ProcessingStep[] = ["concatenating", "transcribing", "diarizing", "namingSpeakers", "summarizing", "indexing", "pruningCaptures"];

export const REPROCESS_STEPS: ProcessingStep[] = [
  "transcribing",
  "diarizing",
  "namingSpeakers",
  "summarizing",
  "indexing",
  "pruningCaptures",
];

interface Props {
  status: MeetingStatus;
  step?: ProcessingStep | null;
  fraction?: number | null;
  error?: string | null;
  onRetry?: () => void;
  /** `row`: compacto, para la lista. `banner`: explicado, para el detalle. */
  variant?: "row" | "banner";
}

/** Estado de procesado de una reunión: pinta solo si hay algo que contar. */
export function ProcessingStatus({ status, step, fraction, error, onRetry, variant = "banner" }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  if (status === "ready") return null;

  if (status === "recording") {
    return (
      <Badge tone="danger" icon={<span className="rec-dot rec-dot-sm" aria-hidden />}>
        Grabando
      </Badge>
    );
  }

  if (status === "failed") {
    if (variant === "row") {
      return (
        <div className="status-row" role="alert">
          <Badge tone="danger" icon={<TriangleAlert size={11} strokeWidth={2.4} aria-hidden />}>
            Acta sin terminar
          </Badge>
          {onRetry ? (
            <Button small capsule icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={onRetry}>
              Reintentar
            </Button>
          ) : null}
        </div>
      );
    }
    const human = humanizeError(error);
    return (
      <div className="notice notice-danger" role="alert">
        <span className="notice-icon" aria-hidden>
          <TriangleAlert size={18} strokeWidth={2} />
        </span>
        <div className="notice-text">
          <p className="notice-title">{human.title}</p>
          <p className="notice-hint">{human.hint}</p>
          {showDetail && error ? <pre className="notice-detail selectable">{error}</pre> : null}
        </div>
        <div className="notice-actions">
          {error ? (
            <Button small variant="ghost" aria-expanded={showDetail} onClick={() => setShowDetail(!showDetail)}>
              {showDetail ? "Ocultar detalle" : "Ver detalle"}
            </Button>
          ) : null}
          {onRetry ? (
            <Button small variant="primary" icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={onRetry}>
              Reintentar
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const label = step ? STEP_LABEL[step] : "En cola";
  const position = step ? STEP_ORDER.indexOf(step) + 1 : 0;
  return (
    <div className={`processing processing-${variant}`}>
      <Spinner />
      <span className="processing-label">{label}…</span>
      {fraction != null ? <ProgressBar fraction={fraction} label={label} /> : null}
      {position > 0 ? (
        <span className="processing-step num">
          {position} de {STEP_ORDER.length}
        </span>
      ) : null}
    </div>
  );
}
