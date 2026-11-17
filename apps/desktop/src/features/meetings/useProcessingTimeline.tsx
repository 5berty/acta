import { createContext, useContext, useState, type ReactNode } from "react";
import type { ProcessingStep } from "../../api";
import { useApiEvent } from "../../app/ApiContext";

/** Cuándo empezó y acabó cada paso (reloj de pared, ms). */
export type StepTimings = Partial<Record<ProcessingStep, { startedAt: number; endedAt?: number }>>;

export interface ProcessingTimeline {
  step: ProcessingStep;
  fraction: number;
  timings: StepTimings;
}

/** Apunta que `step` está en marcha en `now`: cierra los pasos abiertos y abre este. Puro. */
export function trackProgress(timings: StepTimings, step: ProcessingStep, now: number): StepTimings {
  if (timings[step] && !timings[step].endedAt) return timings;
  const next: StepTimings = {};
  for (const [k, v] of Object.entries(timings) as [ProcessingStep, { startedAt: number; endedAt?: number }][]) {
    next[k] = v.endedAt == null ? { ...v, endedAt: now } : v;
  }
  next[step] = { startedAt: now };
  return next;
}

type All = Record<string, ProcessingTimeline>;

function useTracker(enabled: boolean): All {
  const [all, setAll] = useState<All>({});
  useApiEvent("processing:progress", (p) => {
    if (!enabled) return;
    setAll((prev) => ({ ...prev, [p.meetingId]: { step: p.step, fraction: p.fraction, timings: trackProgress(prev[p.meetingId]?.timings ?? {}, p.step, Date.now()) } }));
  });
  // Al terminar (bien o mal) se olvida: un reintento empieza de cero.
  useApiEvent("meeting:updated", (u) => {
    if (!enabled || u.status === "processing") return;
    setAll((prev) => {
      if (!(u.meetingId in prev)) return prev;
      const { [u.meetingId]: _done, ...rest } = prev;
      return rest;
    });
  });
  return all;
}

const Ctx = createContext<All | null>(null);

/** Sigue el procesado de todas las reuniones desde que arranca la app, para que los tiempos no dependan de qué pantalla esté abierta. */
export function ProcessingTimelineProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useTracker(true)}>{children}</Ctx.Provider>;
}

export function useProcessingTimeline(meetingId: string): ProcessingTimeline | null {
  const shared = useContext(Ctx);
  const local = useTracker(shared === null);
  return (shared ?? local)[meetingId] ?? null;
}
