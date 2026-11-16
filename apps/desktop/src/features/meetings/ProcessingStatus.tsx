import type { MeetingStatus, ProcessingStep } from "../../api";
import { Button, ProgressBar } from "../../shared/ui/ui";

export const STEP_LABEL: Record<ProcessingStep, string> = {
  concatenating: "Preparando el audio",
  transcribing: "Transcribiendo",
  diarizing: "Diarizando",
  namingSpeakers: "Identificando hablantes",
  summarizing: "Resumiendo",
  indexing: "Indexando",
  pruningCaptures: "Seleccionando capturas",
};

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
}

/** Estado de procesado de una reunión: pinta solo si hay algo que contar. */
export function ProcessingStatus({ status, step, fraction, error, onRetry }: Props) {
  if (status === "ready") return null;
  if (status === "recording") return <p className="processing processing-live">Grabando…</p>;
  if (status === "failed") {
    return (
      <div className="processing processing-failed" role="alert">
        <span>Ha fallado el procesado{error ? `: ${error}` : ""}</span>
        {onRetry ? (
          <Button small onClick={onRetry}>
            Reintentar
          </Button>
        ) : null}
      </div>
    );
  }
  const label = step ? STEP_LABEL[step] : "En cola";
  return (
    <div className="processing">
      <span>{label}…</span>
      {fraction != null ? <ProgressBar fraction={fraction} label={label} /> : null}
    </div>
  );
}
