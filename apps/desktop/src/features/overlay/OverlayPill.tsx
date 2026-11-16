import type { HealthWarning, Levels, ProcessingStep, Prompt, SessionState } from "../../api";
import { dbToLevel, formatClock, platformLabel } from "../../shared/format";
import { STEP_LABEL } from "../meetings/ProcessingStatus";

export interface PillProps {
  state: SessionState;
  elapsedMs: number;
  levels: Levels | null;
  warning: HealthWarning | null;
  /** Segundos hasta la parada automática si hay pregunta de parar abierta. */
  countdownS: number | null;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onAnswer(prompt: Prompt, answer: "accept" | "decline"): void;
  onDismiss(): void;
  onOpenMeeting(id: string): void;
}

function Meter({ label, db }: { label: string; db: number | null }) {
  const level = db == null ? 0 : dbToLevel(db);
  return (
    <div className="meter" role="meter" aria-label={`Nivel de ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ transform: `scaleX(${level})` }} />
      </span>
    </div>
  );
}

function Question({ title, label, prompt, yes, no, note, onAnswer }: { title: string; label: string; prompt: Prompt; yes: string; no: string; note?: string; onAnswer: PillProps["onAnswer"] }) {
  return (
    <div role="group" aria-label={label} className="ask">
      <p className="ask-text">{title}</p>
      {note ? <p className="ask-note">{note}</p> : null}
      <div className="ask-actions">
        <button type="button" className="pbtn pbtn-primary" onClick={() => onAnswer(prompt, "accept")}>
          {yes}
        </button>
        <button type="button" className="pbtn" onClick={() => onAnswer(prompt, "decline")}>
          {no}
        </button>
      </div>
    </div>
  );
}

export function OverlayPill(p: PillProps) {
  const s = p.state;
  let body: React.ReactNode = null;

  if (s.state === "detected") {
    const name = s.app.platform === "other" ? s.app.name : platformLabel(s.app.platform);
    body = <Question title={`Reunión de ${name} detectada — ¿Grabar?`} label="Reunión detectada" prompt={s.prompt} yes="Grabar" no="Ignorar" onAnswer={p.onAnswer} />;
  } else if (s.state === "recording" || s.state === "paused") {
    const paused = s.state === "paused";
    const stop = s.stopPrompt;
    body = (
      <>
        <div className="pill-row">
          <span className={`rec-dot${paused ? " rec-dot-paused" : ""}`} aria-hidden />
          <span className="timer" aria-label="Tiempo grabado">
            {formatClock(p.elapsedMs)}
          </span>
          <Meter label="Yo" db={paused ? null : (p.levels?.mic.rmsDbfs ?? null)} />
          <Meter label="Otros" db={paused ? null : (p.levels?.system.rmsDbfs ?? null)} />
          <button type="button" className="pbtn pbtn-icon" aria-label={paused ? "Reanudar" : "Pausar"} onClick={paused ? p.onResume : p.onPause}>
            {paused ? "▶" : "❙❙"}
          </button>
          <button type="button" className="pbtn pbtn-icon pbtn-stop" aria-label="Parar" onClick={p.onStop}>
            ■
          </button>
        </div>
        {stop && stop.kind === "stopRecording" ? (
          <Question
            title={stop.reason === "silence" ? "Parece que no habla nadie — ¿Parar?" : "La llamada ha terminado — ¿Parar?"}
            label="La llamada ha terminado"
            prompt={stop}
            yes="Parar"
            no="Seguir grabando"
            note={p.countdownS != null ? `Si nadie habla, parará solo en ${formatClock(p.countdownS * 1000)}` : undefined}
            onAnswer={p.onAnswer}
          />
        ) : null}
        {p.warning ? (
          <p role="alert" className="warn">
            {p.warning.message}
          </p>
        ) : null}
      </>
    );
  } else if (s.state === "stopping") {
    body = <p className="status">Guardando el audio…</p>;
  } else if (s.state === "recovering") {
    body = <p className="status">Recuperando una grabación interrumpida…</p>;
  } else if (s.state === "processing") {
    body = <p className="status">{STEP_LABEL[s.step as ProcessingStep]}…</p>;
  } else if (s.state === "ready") {
    body = (
      <div className="pill-row">
        <span className="status">Acta lista</span>
        <button type="button" className="pbtn pbtn-primary" onClick={() => p.onOpenMeeting(s.meetingId)}>
          Abrir acta
        </button>
        <button type="button" className="pbtn" onClick={p.onDismiss}>
          Cerrar
        </button>
      </div>
    );
  } else if (s.state === "failed") {
    body = (
      <div className="pill-row">
        <span className="status warn">{s.error}</span>
        <button type="button" className="pbtn" onClick={p.onDismiss}>
          Cerrar
        </button>
      </div>
    );
  }

  if (!body) return null;
  return (
    <div className="pill" data-tauri-drag-region>
      {body}
    </div>
  );
}
