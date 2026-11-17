import { Check, RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { AvailableProvider, LlmOverride, MeetingStatus, ProcessingStep } from "../../api";
import { formatClock, humanizeError, type LlmContext } from "../../shared/format";
import { Badge, Button, ProgressBar, Spinner } from "../../shared/ui/ui";
import { RetryMenu } from "./RetryMenu";
import type { StepTimings } from "./useProcessingTimeline";

export const STEP_LABEL: Record<ProcessingStep, string> = {
  concatenating: "Preparando el audio",
  transcribing: "Transcribiendo",
  diarizing: "Separando hablantes",
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
  /** `null`: con el proveedor de siempre; con valor, «Reintentar con…». */
  onRetry?: (llm: LlmOverride | null) => void;
  /** Con esto, «Reintentar» lleva la flecha «Reintentar con…» (solo en el aviso grande). */
  loadProviders?: () => Promise<AvailableProvider[]>;
  /** Proveedor y modelo del acta, para decir quién falló. */
  llm?: LlmContext;
  /** Cuándo empezó y acabó cada paso: tiempos por paso en el aviso grande. */
  timings?: StepTimings;
  /** Reloj inyectable (tests); por defecto avanza solo cada segundo. */
  now?: number;
  /** `row`: compacto, para la lista. `banner`: explicado, para el detalle. */
  variant?: "row" | "banner";
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** Los pasos uno a uno: hechos (con lo que tardaron), el actual (contando) y los que faltan. */
function Steps({ step, timings, now }: { step: ProcessingStep; timings: StepTimings; now: number }) {
  const at = STEP_ORDER.indexOf(step);
  return (
    <ol className="steps" aria-label="Pasos del procesado">
      {STEP_ORDER.map((s, i) => {
        const state = i < at ? "done" : i === at ? "active" : "pending";
        const t = timings[s];
        const elapsed = t ? Math.max(0, (state === "active" ? now : (t.endedAt ?? now)) - t.startedAt) : null;
        return (
          <li key={s} className="step" data-state={state} aria-current={state === "active" ? "step" : undefined}>
            <span className="step-mark" aria-hidden>
              {state === "done" ? <Check size={10} strokeWidth={3.4} /> : null}
            </span>
            <span className="step-label">{STEP_LABEL[s]}</span>
            {elapsed != null && state !== "pending" ? <span className="step-time num">{formatClock(elapsed)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Estado de procesado de una reunión: pinta solo si hay algo que contar. */
export function ProcessingStatus({ status, step, fraction, error, onRetry, loadProviders, llm, timings, now, variant = "banner" }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const clock = useNow(now == null && status === "processing" && variant === "banner" && Boolean(step));
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
            <Button small capsule icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={() => onRetry(null)}>
              Reintentar
            </Button>
          ) : null}
        </div>
      );
    }
    const human = humanizeError(error, llm);
    return (
      <div className="notice notice-danger" role="alert">
        <span className="notice-icon" aria-hidden>
          <TriangleAlert size={18} strokeWidth={2} />
        </span>
        <div className="notice-text">
          <p className="notice-title">{human.title}</p>
          <p className="notice-hint">{human.hint}</p>
          {human.llm ? <p className="notice-llm">{human.llm}</p> : null}
          {showDetail && error ? <pre className="notice-detail selectable">{error}</pre> : null}
        </div>
        <div className="notice-actions">
          {error ? (
            <Button small variant="ghost" aria-expanded={showDetail} onClick={() => setShowDetail(!showDetail)}>
              {showDetail ? "Ocultar detalle" : "Ver detalle"}
            </Button>
          ) : null}
          {onRetry && loadProviders ? (
            <RetryMenu onRetry={onRetry} loadProviders={loadProviders} />
          ) : onRetry ? (
            <Button small variant="primary" icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={() => onRetry(null)}>
              Reintentar
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const label = step ? STEP_LABEL[step] : "En cola";
  const position = step ? STEP_ORDER.indexOf(step) + 1 : 0;
  const head = (
    <>
      <Spinner />
      <span className="processing-label">{label}…</span>
      {fraction != null ? <ProgressBar fraction={fraction} label={label} /> : null}
      {position > 0 ? (
        <span className="processing-step num">
          {position} de {STEP_ORDER.length}
        </span>
      ) : null}
    </>
  );
  if (variant === "row") return <div className="processing processing-row">{head}</div>;
  return (
    <div className="processing-banner">
      <div className="processing">{head}</div>
      {step ? <Steps step={step} timings={timings ?? {}} now={now ?? clock} /> : null}
    </div>
  );
}
